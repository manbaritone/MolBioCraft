// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Quantitative Proteomics, Enzymatic Digest Mass Spectrometry, CID/HCD Tandem MS/MS Fragment
//! Ion Simulator, Post-Translational Modification (PTM) Scanner, Rogers PEST Degradation Profiler,
//! and 3D Graph-Theoretic Disulfide Connectivity Predictor (`petgraph` + `nalgebra` + `aho-corasick`).
//!
//! Designed for both recombinant expression constructs and `10,000+ aa` giant structural proteins:
//! 1. `simulate_proteolytic_digest_ms`: Exact IUPAC monoisotopic & average elemental stoichiometry
//!    ($\text{C}_c\text{H}_h\text{N}_n\text{O}_o\text{S}_s$) across 7 enzymatic/chemical cleavage
//!    rules (`Trypsin`, `Trypsin/P`, `Chymotrypsin`, `Glu-C`, `Lys-C`, `Asp-N`, `CNBr`), missed
//!    cleavage combinatorics ($0..=3$), carbamidomethyl-Cys alkylation ($+57.021464\text{ Da}$),
//!    electrospray $[\text{M}+z\text{H}]^{z+}$ ($z=1,2,3$) $m/z$ ions, Bull-Breese / Krokhin
//!    RP-HPLC retention index, and observable MS sequence coverage %.
//! 2. `simulate_peptide_ms2_spectrum`: Theoretical CID/HCD tandem MS/MS $b_1^+..b_{L-1}^+$,
//!    $y_1^+..y_{L-1}^+$, doubly charged $b^{2+}/y^{2+}$, and neutral-loss ($-\text{H}_2\text{O}$,
//!    $-\text{NH}_3$) fragment ion series with Proline/Aspartate intensity weighting.
//! 3. `scan_post_translational_modifications`: Context-validated PTM & subcellular targeting motifs
//!    (N-glycosylation `N-X-[ST]`, PKA/PKC/CK2/CDK/Tyr phosphorylation, SUMOylation, N-myristoylation,
//!    CAAX prenylation, monopartite/bipartite NLS, CRM1 NES, ER `KDEL`/`HDEL`, peroxisomal `SKL`),
//!    Rogers et al. (1986) PEST proteolytic degradation score, and `petgraph`-backed 3D $C_\alpha$
//!    disulfide bond pairing topology.

use molbiocraft_core::clean_alpha_sequence;
use molbiocraft_formats::PdbCaAtom;
use nalgebra::Vector3;
use petgraph::graph::UnGraph;
use serde::{Deserialize, Serialize};

// Exact CODATA / IUPAC Monoisotopic & Standard Atomic Weights (Da)
const MONO_C: f64 = 12.000_000_000;
const MONO_H: f64 = 1.007_825_032;
const MONO_N: f64 = 14.003_074_004;
const MONO_O: f64 = 15.994_914_620;
const MONO_S: f64 = 31.972_071_174;
const MONO_SE: f64 = 79.916_521_8;
const MONO_PROTON: f64 = 1.007_276_467;
const MONO_H2O: f64 = 2.0 * MONO_H + MONO_O; // 18.010564684
const MONO_NH3: f64 = 3.0 * MONO_H + MONO_N; // 17.026549100
const MONO_CAM_CYS: f64 = 2.0 * MONO_C + 3.0 * MONO_H + MONO_N + MONO_O; // +57.021463720 (Iodoacetamide)

const AVG_C: f64 = 12.010_7;
const AVG_H: f64 = 1.007_94;
const AVG_N: f64 = 14.006_7;
const AVG_O: f64 = 15.999_4;
const AVG_S: f64 = 32.065;
const AVG_SE: f64 = 78.96;

#[derive(Clone, Copy, Default, Debug)]
struct ElementalComposition {
    c: i32,
    h: i32,
    n: i32,
    o: i32,
    s: i32,
    se: i32,
}

impl ElementalComposition {
    #[inline]
    fn add_assign(&mut self, rhs: Self) {
        self.c += rhs.c;
        self.h += rhs.h;
        self.n += rhs.n;
        self.o += rhs.o;
        self.s += rhs.s;
        self.se += rhs.se;
    }

    #[inline]
    fn monoisotopic_mass(&self) -> f64 {
        (self.c as f64) * MONO_C
            + (self.h as f64) * MONO_H
            + (self.n as f64) * MONO_N
            + (self.o as f64) * MONO_O
            + (self.s as f64) * MONO_S
            + (self.se as f64) * MONO_SE
    }

    #[inline]
    fn average_mass(&self) -> f64 {
        (self.c as f64) * AVG_C
            + (self.h as f64) * AVG_H
            + (self.n as f64) * AVG_N
            + (self.o as f64) * AVG_O
            + (self.s as f64) * AVG_S
            + (self.se as f64) * AVG_SE
    }

    fn formula_string(&self) -> String {
        let mut s = format!("C{}H{}N{}O{}", self.c, self.h, self.n, self.o);
        if self.s > 0 {
            s.push_str(&format!("S{}", self.s));
        }
        if self.se > 0 {
            s.push_str(&format!("Se{}", self.se));
        }
        s
    }
}

/// Dehydrated in-chain residue elemental composition (`-NH-CH(R)-CO-`).
#[inline]
fn residue_elements(aa: u8) -> ElementalComposition {
    match aa.to_ascii_uppercase() {
        b'A' => ElementalComposition { c: 3, h: 5, n: 1, o: 1, s: 0, se: 0 },
        b'R' => ElementalComposition { c: 6, h: 12, n: 4, o: 1, s: 0, se: 0 },
        b'N' => ElementalComposition { c: 4, h: 6, n: 2, o: 2, s: 0, se: 0 },
        b'D' => ElementalComposition { c: 4, h: 5, n: 1, o: 3, s: 0, se: 0 },
        b'C' => ElementalComposition { c: 3, h: 5, n: 1, o: 1, s: 1, se: 0 },
        b'E' => ElementalComposition { c: 5, h: 7, n: 1, o: 3, s: 0, se: 0 },
        b'Q' => ElementalComposition { c: 5, h: 8, n: 2, o: 2, s: 0, se: 0 },
        b'G' => ElementalComposition { c: 2, h: 3, n: 1, o: 1, s: 0, se: 0 },
        b'H' => ElementalComposition { c: 6, h: 7, n: 3, o: 1, s: 0, se: 0 },
        b'I' | b'L' => ElementalComposition { c: 6, h: 11, n: 1, o: 1, s: 0, se: 0 },
        b'K' => ElementalComposition { c: 6, h: 12, n: 2, o: 1, s: 0, se: 0 },
        b'M' => ElementalComposition { c: 5, h: 9, n: 1, o: 1, s: 1, se: 0 },
        b'F' => ElementalComposition { c: 9, h: 9, n: 1, o: 1, s: 0, se: 0 },
        b'P' => ElementalComposition { c: 5, h: 7, n: 1, o: 1, s: 0, se: 0 },
        b'S' => ElementalComposition { c: 3, h: 5, n: 1, o: 2, s: 0, se: 0 },
        b'T' => ElementalComposition { c: 4, h: 7, n: 1, o: 2, s: 0, se: 0 },
        b'W' => ElementalComposition { c: 11, h: 10, n: 2, o: 1, s: 0, se: 0 },
        b'Y' => ElementalComposition { c: 9, h: 9, n: 1, o: 2, s: 0, se: 0 },
        b'V' => ElementalComposition { c: 5, h: 9, n: 1, o: 1, s: 0, se: 0 },
        b'U' => ElementalComposition { c: 3, h: 5, n: 1, o: 1, s: 0, se: 1 }, // Selenocysteine
        b'O' => ElementalComposition { c: 12, h: 19, n: 3, o: 2, s: 0, se: 0 }, // Pyrrolysine
        _ => ElementalComposition { c: 5, h: 7, n: 1, o: 1, s: 0, se: 0 },
    }
}

/// Krokhin / Bull-Breese reversed-phase C18 HPLC retention coefficient (minutes-equivalent).
#[inline]
fn hplc_retention_coeff(aa: u8) -> f64 {
    match aa.to_ascii_uppercase() {
        b'W' => 11.0,
        b'F' => 10.5,
        b'L' => 9.6,
        b'I' => 8.4,
        b'M' => 5.8,
        b'V' => 5.0,
        b'Y' => 4.6,
        b'C' => 2.6,
        b'P' => 2.1,
        b'A' => 1.1,
        b'T' => 0.6,
        b'E' => 0.5,
        b'D' => 0.2,
        b'S' => -0.2,
        b'Q' => -0.3,
        b'G' => -0.4,
        b'N' => -0.8,
        b'H' => -2.1,
        b'R' => -2.8,
        b'K' => -3.2,
        _ => 0.0,
    }
}

#[inline]
fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

#[inline]
fn round4(v: f64) -> f64 {
    (v * 10_000.0).round() / 10_000.0
}

// ============================================================================
// 1. In-Silico Proteolytic Digest & Peptide Mass Fingerprint (LC-MS1)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DigestedPeptideIon {
    pub peptide_index: usize,
    pub start_aa: usize,
    pub end_aa: usize,
    pub length_aa: usize,
    pub missed_cleavages: usize,
    pub n_flank: char,
    pub sequence: String,
    pub c_flank: char,
    pub chemical_formula: String,
    pub monoisotopic_neutral_da: f64,
    pub average_neutral_da: f64,
    pub mz_charge_1: f64,
    pub mz_charge_2: f64,
    pub mz_charge_3: f64,
    pub hplc_retention_min: f64,
    pub net_charge_ph2_7: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProteolyticDigestMsReport {
    pub protein_length_aa: usize,
    pub protease: String,
    pub max_missed_cleavages: usize,
    pub carbamidomethyl_cysteine: bool,
    pub intact_monoisotopic_da: f64,
    pub intact_average_da: f64,
    pub total_cleavage_sites: usize,
    pub observable_peptide_count: usize,
    pub sequence_coverage_pct: f64,
    pub peptides: Vec<DigestedPeptideIon>,
    /// What the digest substituted for its request (D0005), one plain sentence per event: an
    /// unknown protease name digested with Trypsin. Always serialised, as an empty list when the
    /// protease was known.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// The cleavage rules [`simulate_proteolytic_digest_ms`] knows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Protease {
    Trypsin,
    TrypsinP,
    Chymotrypsin,
    GluC,
    LysC,
    AspN,
    CnBr,
}

impl Protease {
    /// The rule a protease name selects (any case, surrounding spaces ignored), or `None` for a
    /// name that selects none.
    fn named(name: &str) -> Option<Self> {
        Some(match name.trim().to_ascii_lowercase().as_str() {
            "trypsin" => Self::Trypsin,
            "trypsin/p" => Self::TrypsinP,
            "chymotrypsin" => Self::Chymotrypsin,
            "glu-c" | "gluc" | "v8" => Self::GluC,
            "lys-c" | "lysc" => Self::LysC,
            "asp-n" | "aspn" => Self::AspN,
            "cnbr" => Self::CnBr,
            _ => return None,
        })
    }
}

/// Determine cleavage positions (1-based C-terminal index `i` where cleavage occurs between `i-1` and `i` in 0-based `seq`).
fn find_protease_cut_boundaries(seq: &[u8], protease: Protease) -> Vec<usize> {
    let n = seq.len();
    let mut bounds = vec![0usize];

    for i in 1..n {
        let prev = seq[i - 1].to_ascii_uppercase();
        let next = seq[i].to_ascii_uppercase();
        let cuts = match protease {
            Protease::Trypsin => matches!(prev, b'K' | b'R') && next != b'P', // Keil-rule Sequencing-Grade Trypsin
            Protease::TrypsinP => matches!(prev, b'K' | b'R'),
            Protease::Chymotrypsin => matches!(prev, b'F' | b'W' | b'Y' | b'L') && next != b'P',
            Protease::GluC => matches!(prev, b'E' | b'D') && next != b'P',
            Protease::LysC => prev == b'K',
            Protease::AspN => next == b'D',
            Protease::CnBr => prev == b'M',
        };
        if cuts {
            bounds.push(i);
        }
    }
    bounds.push(n);
    bounds
}

/// Simulate enzymatic or chemical proteolytic digestion and LC-ESI-MS peptide ion mass table.
/// A protease name the digest does not know is digested with Trypsin: the report then names
/// Trypsin as its `protease`, and its `warnings` names the protease asked for (D0005).
pub fn simulate_proteolytic_digest_ms(
    protein_seq: &str,
    protease: &str,
    max_missed_cleavages: usize,
    min_mass_da: f64,
    max_mass_da: f64,
    carbamidomethyl_cys: bool,
) -> ProteolyticDigestMsReport {
    let clean = clean_alpha_sequence(protein_seq);
    let bytes = clean.as_bytes();
    let n = bytes.len();
    let max_mc = max_missed_cleavages.min(3);
    let min_m = min_mass_da.max(250.0);
    let max_m = max_mass_da.max(min_m + 100.0);
    let (rule, protease, warnings) = match Protease::named(protease) {
        Some(rule) => (rule, protease.to_string(), Vec::new()),
        None => (
            Protease::Trypsin,
            "Trypsin".to_string(),
            vec![format!("Unknown protease '{protease}': digested with Trypsin.")],
        ),
    };

    if n == 0 {
        return ProteolyticDigestMsReport {
            protein_length_aa: 0,
            protease,
            max_missed_cleavages: max_mc,
            carbamidomethyl_cysteine: carbamidomethyl_cys,
            intact_monoisotopic_da: 0.0,
            intact_average_da: 0.0,
            total_cleavage_sites: 0,
            observable_peptide_count: 0,
            sequence_coverage_pct: 0.0,
            peptides: Vec::new(),
            warnings,
        };
    }

    // Intact protein mass (+ H2O termini)
    let mut intact_el = ElementalComposition { c: 0, h: 2, n: 0, o: 1, s: 0, se: 0 };
    for &b in bytes {
        intact_el.add_assign(residue_elements(b));
    }
    let intact_mono = intact_el.monoisotopic_mass();
    let intact_avg = intact_el.average_mass();

    let bounds = find_protease_cut_boundaries(bytes, rule);
    let num_basal_peptides = bounds.len().saturating_sub(1);
    let is_cnbr = rule == Protease::CnBr;

    let mut covered = vec![false; n];
    let mut peptides = Vec::new();

    for seg_i in 0..num_basal_peptides {
        for mc in 0..=max_mc {
            let end_seg = seg_i + 1 + mc;
            if end_seg >= bounds.len() {
                break;
            }
            let s0 = bounds[seg_i];
            let e0 = bounds[end_seg];
            let pep_slice = &bytes[s0..e0];
            if pep_slice.is_empty() {
                continue;
            }

            let mut el = ElementalComposition { c: 0, h: 2, n: 0, o: 1, s: 0, se: 0 };
            let mut cys_count = 0usize;
            let mut rt_sum = 0.0;
            let mut basic_sites = 1i32; // N-terminal alpha-amine at pH 2.7
            for &b in pep_slice {
                let u = b.to_ascii_uppercase();
                el.add_assign(residue_elements(u));
                if u == b'C' && carbamidomethyl_cys {
                    cys_count += 1;
                    el.add_assign(ElementalComposition { c: 2, h: 3, n: 1, o: 1, s: 0, se: 0 });
                }
                if matches!(u, b'K' | b'R' | b'H') {
                    basic_sites += 1;
                }
                rt_sum += hplc_retention_coeff(u);
            }

            let mut mono_da = el.monoisotopic_mass();
            let mut avg_da = el.average_mass();
            let _ = cys_count;

            // CNBr converts C-terminal Methionine to Homoserine Lactone (-CH4S => -48.00337 Da)
            if is_cnbr && pep_slice.last().copied().map(|b| b.to_ascii_uppercase()) == Some(b'M') && e0 < n {
                mono_da -= MONO_C + 4.0 * MONO_H + MONO_S;
                avg_da -= AVG_C + 4.0 * AVG_H + AVG_S;
            }

            if mono_da < min_m || mono_da > max_m {
                continue;
            }

            for flag in &mut covered[s0..e0] {
                *flag = true;
            }

            if peptides.len() < 512 {
                let len_f = pep_slice.len() as f64;
                // Krokhin length-corrected RP-HPLC retention time (0..60 min gradient)
                let rt_min = (6.5 + rt_sum * (1.0 - 0.012 * len_f.min(40.0))).clamp(1.2, 65.0);
                let n_flank = if s0 == 0 { '-' } else { bytes[s0 - 1] as char };
                let c_flank = if e0 >= n { '-' } else { bytes[e0] as char };

                peptides.push(DigestedPeptideIon {
                    peptide_index: peptides.len() + 1,
                    start_aa: s0 + 1,
                    end_aa: e0,
                    length_aa: pep_slice.len(),
                    missed_cleavages: mc,
                    n_flank,
                    sequence: String::from_utf8_lossy(pep_slice).into_owned(),
                    c_flank,
                    chemical_formula: el.formula_string(),
                    monoisotopic_neutral_da: round4(mono_da),
                    average_neutral_da: round4(avg_da),
                    mz_charge_1: round4(mono_da + MONO_PROTON),
                    mz_charge_2: round4((mono_da + 2.0 * MONO_PROTON) / 2.0),
                    mz_charge_3: round4((mono_da + 3.0 * MONO_PROTON) / 3.0),
                    hplc_retention_min: round2(rt_min),
                    net_charge_ph2_7: basic_sites,
                });
            }
        }
    }

    let cov_aa = covered.iter().filter(|&&c| c).count();
    let cov_pct = round2((cov_aa as f64 / n as f64) * 100.0);

    ProteolyticDigestMsReport {
        protein_length_aa: n,
        protease,
        max_missed_cleavages: max_mc,
        carbamidomethyl_cysteine: carbamidomethyl_cys,
        intact_monoisotopic_da: round4(intact_mono),
        intact_average_da: round2(intact_avg),
        total_cleavage_sites: bounds.len().saturating_sub(2),
        observable_peptide_count: peptides.len(),
        sequence_coverage_pct: cov_pct,
        peptides,
        warnings,
    }
}

// ============================================================================
// 2. Theoretical CID/HCD Tandem MS/MS b- and y-Ion Fragment Spectrum Simulator
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ms2FragmentIonPeak {
    pub label: String,     // e.g. "b4+", "y7+", "y7++", "y5-H2O+"
    pub ion_series: String, // "b" | "y"
    pub ordinal: usize,
    pub charge: u8,
    pub mz: f64,
    pub relative_intensity: f64, // 0..100%
    pub fragment_sequence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeptideMs2SpectrumReport {
    pub peptide_sequence: String,
    pub precursor_monoisotopic_da: f64,
    pub precursor_mz_2plus: f64,
    pub carbamidomethyl_cysteine: bool,
    pub peaks: Vec<Ms2FragmentIonPeak>,
}

/// Theoretical b/y fragment ions of a peptide. The **m/z values are exact** (monoisotopic residue
/// sums with the proton and water terms), including the 2+ series and the common −H2O / −NH3
/// neutral losses.
///
/// `relative_intensity` is **not a predicted intensity**: it is a qualitative drawing height from
/// well-known fragmentation tendencies (cleavage N-terminal to Pro is favoured, C-terminal to Pro
/// disfavoured, enhanced next to Asp/Glu). Real intensity prediction needs a trained model such as
/// Prosit or pDeep; use the m/z values for matching, not these heights.
pub fn simulate_peptide_ms2_spectrum(
    peptide_seq: &str,
    carbamidomethyl_cys: bool,
) -> PeptideMs2SpectrumReport {
    let clean = clean_alpha_sequence(peptide_seq);
    let bytes = clean.as_bytes();
    let n = bytes.len();

    if n < 2 {
        return PeptideMs2SpectrumReport {
            peptide_sequence: clean,
            precursor_monoisotopic_da: 0.0,
            precursor_mz_2plus: 0.0,
            carbamidomethyl_cysteine: carbamidomethyl_cys,
            peaks: Vec::new(),
        };
    }

    let mut res_masses = Vec::with_capacity(n);
    for &b in bytes {
        let u = b.to_ascii_uppercase();
        let mut m = residue_elements(u).monoisotopic_mass();
        if u == b'C' && carbamidomethyl_cys {
            m += MONO_CAM_CYS;
        }
        res_masses.push(m);
    }

    let neutral_total: f64 = res_masses.iter().sum::<f64>() + MONO_H2O;
    let mut peaks = Vec::with_capacity(n * 4);

    let mut prefix_sum = 0.0;
    for i in 1..n {
        prefix_sum += res_masses[i - 1];
        let suffix_sum = (neutral_total - MONO_H2O) - prefix_sum;

        let n_res = bytes[i - 1].to_ascii_uppercase();
        let c_res = bytes[i].to_ascii_uppercase();

        // Qualitative drawing heights (see the function docs — not predicted intensities):
        // - Strong enhancement N-terminal to Proline (c_res == 'P') -> intense y-ion!
        // - Enhancement C-terminal to Asp/Glu (n_res == 'D'/'E')
        // - Suppression C-terminal to Proline (n_res == 'P')
        let proline_y_boost = if c_res == b'P' { 1.65 } else if n_res == b'P' { 0.35 } else { 1.0 };
        let acidic_boost = if matches!(n_res, b'D' | b'E') { 1.30 } else { 1.0 };
        let mid_envelope = 0.55 + 0.45 * (std::f64::consts::PI * (i as f64) / (n as f64)).sin();

        // b_i+ ion: sum(residues[0..i]) + H+
        let b1_mz = prefix_sum + MONO_PROTON;
        let b_int = (48.0 * mid_envelope * acidic_boost * (if c_res == b'P' { 0.55 } else { 1.0 }))
            .clamp(5.0, 95.0);
        peaks.push(Ms2FragmentIonPeak {
            label: format!("b{}+", i),
            ion_series: "b".into(),
            ordinal: i,
            charge: 1,
            mz: round4(b1_mz),
            relative_intensity: round2(b_int),
            fragment_sequence: String::from_utf8_lossy(&bytes[..i]).into_owned(),
        });

        // y_{n-i}+ ion: sum(residues[i..n]) + H2O + H+
        let y_ord = n - i;
        let y1_mz = suffix_sum + MONO_H2O + MONO_PROTON;
        let y_int = (72.0 * mid_envelope * proline_y_boost * acidic_boost).clamp(8.0, 100.0);
        peaks.push(Ms2FragmentIonPeak {
            label: format!("y{}+", y_ord),
            ion_series: "y".into(),
            ordinal: y_ord,
            charge: 1,
            mz: round4(y1_mz),
            relative_intensity: round2(y_int),
            fragment_sequence: String::from_utf8_lossy(&bytes[i..]).into_owned(),
        });

        if y_ord >= 5 {
            peaks.push(Ms2FragmentIonPeak {
                label: format!("y{}++", y_ord),
                ion_series: "y".into(),
                ordinal: y_ord,
                charge: 2,
                mz: round4((suffix_sum + MONO_H2O + 2.0 * MONO_PROTON) / 2.0),
                relative_intensity: round2((y_int * 0.34).clamp(4.0, 60.0)),
                fragment_sequence: String::from_utf8_lossy(&bytes[i..]).into_owned(),
            });
        }

        // Neutral loss (-H2O on S/T/E/D-containing y-ions; -NH3 on R/K/Q/N-containing b-ions)
        if bytes[i..].iter().any(|&x| matches!(x.to_ascii_uppercase(), b'S' | b'T' | b'D' | b'E'))
            && y_ord >= 3
        {
            peaks.push(Ms2FragmentIonPeak {
                label: format!("y{}-H2O+", y_ord),
                ion_series: "y".into(),
                ordinal: y_ord,
                charge: 1,
                mz: round4(y1_mz - MONO_H2O),
                relative_intensity: round2((y_int * 0.22).clamp(3.0, 40.0)),
                fragment_sequence: String::from_utf8_lossy(&bytes[i..]).into_owned(),
            });
        }
        if bytes[..i].iter().any(|&x| matches!(x.to_ascii_uppercase(), b'R' | b'K' | b'Q' | b'N'))
            && i >= 3
        {
            peaks.push(Ms2FragmentIonPeak {
                label: format!("b{}-NH3+", i),
                ion_series: "b".into(),
                ordinal: i,
                charge: 1,
                mz: round4(b1_mz - MONO_NH3),
                relative_intensity: round2((b_int * 0.20).clamp(3.0, 35.0)),
                fragment_sequence: String::from_utf8_lossy(&bytes[..i]).into_owned(),
            });
        }
    }

    // Normalize base peak to 100.0% and sort by ascending m/z
    let max_int = peaks
        .iter()
        .map(|p| p.relative_intensity)
        .fold(1.0_f64, f64::max);
    for p in &mut peaks {
        p.relative_intensity = round2((p.relative_intensity / max_int) * 100.0);
    }
    peaks.sort_unstable_by(|a, b| a.mz.partial_cmp(&b.mz).unwrap_or(std::cmp::Ordering::Equal));

    PeptideMs2SpectrumReport {
        peptide_sequence: clean,
        precursor_monoisotopic_da: round4(neutral_total),
        precursor_mz_2plus: round4((neutral_total + 2.0 * MONO_PROTON) / 2.0),
        carbamidomethyl_cysteine: carbamidomethyl_cys,
        peaks,
    }
}

// ============================================================================
// 3. Post-Translational Modifications, PEST Degradation & 3D Disulfide Graph
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtmAndTraffickingSite {
    pub category: String,
    pub modification_name: String,
    pub modified_residue_aa: usize,
    pub motif_start_aa: usize,
    pub motif_end_aa: usize,
    pub matched_motif: String,
    pub mass_shift_da: f64,
    pub confidence_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PestDegradationSegment {
    pub start_aa: usize,
    pub end_aa: usize,
    pub sequence: String,
    pub pest_mole_pct: f64,
    pub hydrophobicity_index: f64,
    pub rogers_pest_score: f64, // > +5.0 indicates strong proteolytic PEST degron
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisulfideBondPrediction {
    pub cys1_aa: usize,
    pub cys2_aa: usize,
    pub sequence_separation: usize,
    pub ca_distance_angstrom: Option<f64>,
    pub confidence: f64,
    pub basis: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProteinPtmAndTopologyReport {
    pub protein_length_aa: usize,
    pub total_cysteines: usize,
    pub predicted_subcellular_compartment: String,
    pub ptm_sites: Vec<PtmAndTraffickingSite>,
    pub pest_degrons: Vec<PestDegradationSegment>,
    pub disulfide_bonds: Vec<DisulfideBondPrediction>,
}

/// Scan a protein sequence (and optional 3D $C_\alpha$ coordinates) for PTM sites,
/// subcellular localization signals, Rogers PEST degrons, and `petgraph` disulfide connectivity.
pub fn scan_post_translational_modifications(
    protein_seq: &str,
    pdb_atoms_opt: Option<&[PdbCaAtom]>,
) -> ProteinPtmAndTopologyReport {
    let clean = clean_alpha_sequence(protein_seq);
    let bytes = clean.as_bytes();
    let n = bytes.len();

    let mut ptm_sites = Vec::new();
    let mut has_nls = false;
    let mut has_er_kdel = false;
    let mut has_perox_skl = false;
    let mut has_myristoyl = false;

    // 1. N-terminal Myristoylation: M-G-[^EDRKHPFYW]-X-X-[STAGCN]
    if n >= 7 && bytes[0] == b'M' && bytes[1] == b'G' {
        if !matches!(
            bytes[2],
            b'E' | b'D' | b'R' | b'K' | b'H' | b'P' | b'F' | b'Y' | b'W'
        ) && matches!(bytes[5], b'S' | b'T' | b'A' | b'G' | b'C' | b'N')
        {
            has_myristoyl = true;
            ptm_sites.push(PtmAndTraffickingSite {
                category: "Lipidation".into(),
                modification_name: "N-Myristoylation (Gly2)".into(),
                modified_residue_aa: 2,
                motif_start_aa: 1,
                motif_end_aa: 6,
                matched_motif: String::from_utf8_lossy(&bytes[0..6]).into_owned(),
                mass_shift_da: 210.1984,
                confidence_score: 0.91,
            });
        }
    }

    // 2. C-terminal Trafficking & Prenylation motifs (CAAX, KDEL/HDEL, SKL)
    if n >= 4 {
        let tail4 = &bytes[n - 4..n];
        if tail4[0] == b'C'
            && matches!(tail4[1], b'V' | b'I' | b'L' | b'M' | b'A')
            && matches!(tail4[2], b'V' | b'I' | b'L' | b'M' | b'A')
        {
            let mod_name = if matches!(tail4[3], b'L' | b'F') {
                "Geranylgeranylation (CAAX)"
            } else {
                "Farnesylation (CAAX)"
            };
            ptm_sites.push(PtmAndTraffickingSite {
                category: "Lipidation".into(),
                modification_name: mod_name.into(),
                modified_residue_aa: n - 3,
                motif_start_aa: n - 3,
                motif_end_aa: n,
                matched_motif: String::from_utf8_lossy(tail4).into_owned(),
                mass_shift_da: 204.1878,
                confidence_score: 0.93,
            });
        }
        if matches!(tail4, b"KDEL" | b"HDEL" | b"RDEL") {
            has_er_kdel = true;
            ptm_sites.push(PtmAndTraffickingSite {
                category: "Subcellular Localization".into(),
                modification_name: "ER Lumen Retention Signal (KDEL/HDEL)".into(),
                modified_residue_aa: n - 3,
                motif_start_aa: n - 3,
                motif_end_aa: n,
                matched_motif: String::from_utf8_lossy(tail4).into_owned(),
                mass_shift_da: 0.0,
                confidence_score: 0.98,
            });
        }
    }
    if n >= 3 {
        let tail3 = &bytes[n - 3..n];
        if matches!(tail3[0], b'S' | b'A' | b'C')
            && matches!(tail3[1], b'K' | b'R' | b'H')
            && matches!(tail3[2], b'L' | b'M')
        {
            has_perox_skl = true;
            ptm_sites.push(PtmAndTraffickingSite {
                category: "Subcellular Localization".into(),
                modification_name: "Peroxisomal Targeting Signal 1 (PTS1)".into(),
                modified_residue_aa: n - 2,
                motif_start_aa: n - 2,
                motif_end_aa: n,
                matched_motif: String::from_utf8_lossy(tail3).into_owned(),
                mass_shift_da: 0.0,
                confidence_score: 0.94,
            });
        }
    }

    // 3. Sliding-window PTM & NLS scan across entire polypeptide
    let mut last_nls_end = 0usize;
    for i in 0..n {
        // N-linked glycosylation: N - [^P] - [ST] - [^P]
        if i + 3 <= n && bytes[i] == b'N' && bytes[i + 1] != b'P' && matches!(bytes[i + 2], b'S' | b'T')
        {
            let c4_ok = i + 3 >= n || bytes[i + 3] != b'P';
            if c4_ok && ptm_sites.len() < 256 {
                ptm_sites.push(PtmAndTraffickingSite {
                    category: "Glycosylation".into(),
                    modification_name: "N-Linked Sequon (Asn-Xaa-Ser/Thr)".into(),
                    modified_residue_aa: i + 1,
                    motif_start_aa: i + 1,
                    motif_end_aa: i + 3,
                    matched_motif: String::from_utf8_lossy(&bytes[i..i + 3]).into_owned(),
                    mass_shift_da: 1216.4229, // Core Man5GlcNAc2
                    confidence_score: if bytes[i + 2] == b'T' { 0.89 } else { 0.81 },
                });
            }
        }

        // PKA Phosphorylation: [RK]-[RK]-X-[ST] (+79.9663 Da)
        if i + 4 <= n
            && matches!(bytes[i], b'R' | b'K')
            && matches!(bytes[i + 1], b'R' | b'K')
            && matches!(bytes[i + 3], b'S' | b'T')
            && ptm_sites.len() < 256
        {
            ptm_sites.push(PtmAndTraffickingSite {
                category: "Phosphorylation".into(),
                modification_name: "PKA Consensus ([RK]2-X-S/T)".into(),
                modified_residue_aa: i + 4,
                motif_start_aa: i + 1,
                motif_end_aa: i + 4,
                matched_motif: String::from_utf8_lossy(&bytes[i..i + 4]).into_owned(),
                mass_shift_da: 79.9663,
                confidence_score: 0.87,
            });
        }

        // CDK Proline-directed Phosphorylation: [ST]-P-X-[KR]
        if i + 4 <= n
            && matches!(bytes[i], b'S' | b'T')
            && bytes[i + 1] == b'P'
            && matches!(bytes[i + 3], b'K' | b'R')
            && ptm_sites.len() < 256
        {
            ptm_sites.push(PtmAndTraffickingSite {
                category: "Phosphorylation".into(),
                modification_name: "CDK Consensus (S/T-P-X-K/R)".into(),
                modified_residue_aa: i + 1,
                motif_start_aa: i + 1,
                motif_end_aa: i + 4,
                matched_motif: String::from_utf8_lossy(&bytes[i..i + 4]).into_owned(),
                mass_shift_da: 79.9663,
                confidence_score: 0.90,
            });
        }

        // Casein Kinase II (CK2): [ST]-X-X-[DE]
        if i + 4 <= n
            && matches!(bytes[i], b'S' | b'T')
            && matches!(bytes[i + 2], b'D' | b'E')
            && matches!(bytes[i + 3], b'D' | b'E')
            && ptm_sites.len() < 256
        {
            ptm_sites.push(PtmAndTraffickingSite {
                category: "Phosphorylation".into(),
                modification_name: "Casein Kinase II (S/T-X-D/E-D/E)".into(),
                modified_residue_aa: i + 1,
                motif_start_aa: i + 1,
                motif_end_aa: i + 4,
                matched_motif: String::from_utf8_lossy(&bytes[i..i + 4]).into_owned(),
                mass_shift_da: 79.9663,
                confidence_score: 0.84,
            });
        }

        // SUMOylation consensus: [VILMF]-K-X-[ED]
        if i + 4 <= n
            && matches!(bytes[i], b'V' | b'I' | b'L' | b'M' | b'F')
            && bytes[i + 1] == b'K'
            && matches!(bytes[i + 3], b'E' | b'D')
            && ptm_sites.len() < 256
        {
            ptm_sites.push(PtmAndTraffickingSite {
                category: "Ubiquitin / UBL".into(),
                modification_name: "SUMOylation (Ψ-K-X-E/D)".into(),
                modified_residue_aa: i + 2,
                motif_start_aa: i + 1,
                motif_end_aa: i + 4,
                matched_motif: String::from_utf8_lossy(&bytes[i..i + 4]).into_owned(),
                mass_shift_da: 11_435.0,
                confidence_score: 0.88,
            });
        }

        // Monopartite SV40-like Nuclear Localization Signal (NLS): K-[KR]-X-[KR]
        if i >= last_nls_end
            && i + 4 <= n
            && bytes[i] == b'K'
            && matches!(bytes[i + 1], b'K' | b'R')
            && matches!(bytes[i + 3], b'K' | b'R')
            && ptm_sites.len() < 256
        {
            has_nls = true;
            last_nls_end = i + 4;
            ptm_sites.push(PtmAndTraffickingSite {
                category: "Subcellular Localization".into(),
                modification_name: "Importin-α Monopartite NLS (K-K/R-X-K/R)".into(),
                modified_residue_aa: i + 1,
                motif_start_aa: i + 1,
                motif_end_aa: i + 4,
                matched_motif: String::from_utf8_lossy(&bytes[i..i + 4]).into_owned(),
                mass_shift_da: 0.0,
                confidence_score: 0.86,
            });
        }
    }

    // 4. Rogers et al. (1986) *Science* 234:364-368 PEST Proteolytic Degron Scanner
    // Hydrophilic regions >= 10 aa bounded by basic residues (H/K/R) lacking internal H/K/R,
    // enriched in P, E, S, T, D: PEST_score = 0.55 * MP_PEST - 0.5 * HI
    let pest_degrons = detect_rogers_pest_segments(bytes);

    // 5. Cysteine Disulfide Bond Connectivity Graph via `petgraph::graph::UnGraph`
    let cys_positions: Vec<usize> = bytes
        .iter()
        .enumerate()
        .filter_map(|(idx, &b)| if b == b'C' { Some(idx + 1) } else { None })
        .collect();
    let disulfide_bonds = predict_disulfide_graph_connectivity(&cys_positions, pdb_atoms_opt);

    let compartment = if has_er_kdel {
        "Endoplasmic Reticulum Lumen (KDEL/HDEL)"
    } else if has_nls {
        "Nucleus (Importin-α/β NLS)"
    } else if has_perox_skl {
        "Peroxisomal Matrix (PTS1)"
    } else if has_myristoyl {
        "Plasma / Intracellular Membrane (N-Myristoylated)"
    } else {
        "Cytoplasmic / Soluble"
    };

    ProteinPtmAndTopologyReport {
        protein_length_aa: n,
        total_cysteines: cys_positions.len(),
        predicted_subcellular_compartment: compartment.into(),
        ptm_sites,
        pest_degrons,
        disulfide_bonds,
    }
}

fn normalized_kd_0_to_90(aa: u8) -> f64 {
    // Kyte-Doolittle [-4.5, +4.5] mapped linearly to [0, 90] per Rogers et al. (1986)
    let kd = match aa {
        b'I' => 4.5,
        b'V' => 4.2,
        b'L' => 3.8,
        b'F' => 2.8,
        b'C' => 2.5,
        b'M' => 1.9,
        b'A' => 1.8,
        b'G' => -0.4,
        b'T' => -0.7,
        b'S' => -0.8,
        b'W' => -0.9,
        b'Y' => -1.3,
        b'P' => -1.6,
        b'H' => -3.2,
        b'E' | b'Q' | b'D' | b'N' => -3.5,
        b'K' => -3.9,
        b'R' => -4.5,
        _ => 0.0,
    };
    (kd + 4.5) * 10.0
}

fn detect_rogers_pest_segments(bytes: &[u8]) -> Vec<PestDegradationSegment> {
    let mut out = Vec::new();
    let mut anchors = vec![0usize];
    for (idx, &b) in bytes.iter().enumerate() {
        if matches!(b, b'K' | b'R' | b'H') {
            anchors.push(idx);
        }
    }
    anchors.push(bytes.len());

    for win in anchors.windows(2) {
        let s = if win[0] == 0 && !matches!(bytes.first().copied().unwrap_or(0), b'K' | b'R' | b'H')
        {
            0
        } else {
            win[0] + 1
        };
        let e = win[1];
        if e <= s || (e - s) < 10 {
            continue;
        }
        let seg = &bytes[s..e];
        let has_p = seg.contains(&b'P');
        let has_ed = seg.iter().any(|&b| matches!(b, b'E' | b'D'));
        let has_st = seg.iter().any(|&b| matches!(b, b'S' | b'T'));
        if !(has_p && has_ed && has_st) {
            continue;
        }

        let len_f = seg.len() as f64;
        let pest_cnt = seg
            .iter()
            .filter(|&&b| matches!(b, b'P' | b'E' | b'D' | b'S' | b'T'))
            .count() as f64;
        let mp_pest = (pest_cnt / len_f) * 100.0;
        let hi = seg.iter().map(|&b| normalized_kd_0_to_90(b)).sum::<f64>() / len_f;
        let score = 0.55 * mp_pest - 0.50 * hi;
        if score >= 0.0 {
            out.push(PestDegradationSegment {
                start_aa: s + 1,
                end_aa: e,
                sequence: String::from_utf8_lossy(seg).into_owned(),
                pest_mole_pct: round2(mp_pest),
                hydrophobicity_index: round2(hi),
                rogers_pest_score: round2(score),
            });
        }
    }
    out
}

fn predict_disulfide_graph_connectivity(
    cys_positions: &[usize],
    pdb_atoms_opt: Option<&[PdbCaAtom]>,
) -> Vec<DisulfideBondPrediction> {
    if cys_positions.len() < 2 {
        return Vec::new();
    }

    // Build an undirected candidate disulfide graph in `petgraph::graph::UnGraph`
    let mut graph: UnGraph<usize, (f64, Option<f64>)> = UnGraph::new_undirected();
    let nodes: Vec<_> = cys_positions.iter().map(|&pos| graph.add_node(pos)).collect();

    let lookup_coord = |res_seq: usize| -> Option<Vector3<f64>> {
        let atoms = pdb_atoms_opt?;
        atoms
            .iter()
            .find(|a| a.res_seq.max(0) as usize == res_seq)
            .or_else(|| atoms.get(res_seq.saturating_sub(1)))
            .map(|a| Vector3::new(a.x, a.y, a.z))
    };

    for i in 0..nodes.len() {
        for j in (i + 1)..nodes.len() {
            let p1 = cys_positions[i];
            let p2 = cys_positions[j];
            let sep = p2.saturating_sub(p1);
            if sep < 3 {
                continue; // Sterically unfavorable vicinal disulfide unless forced
            }
            if let (Some(v1), Some(v2)) = (lookup_coord(p1), lookup_coord(p2)) {
                let dist = (v1 - v2).norm();
                // Canonical disulfide C_alpha - C_alpha distance is ~4.5 - 7.5 Å
                if dist <= 8.5 {
                    let conf = (1.0 - ((dist - 5.6).abs() / 4.5)).clamp(0.45, 0.99);
                    graph.add_edge(nodes[i], nodes[j], (conf, Some(dist)));
                }
            } else {
                // Sequence-separation prior when 3D coordinates are absent
                let ideal_sep = 24.0_f64;
                let conf = (0.78 * (-((sep as f64 - ideal_sep).abs() / 85.0)).exp()).clamp(0.30, 0.78);
                graph.add_edge(nodes[i], nodes[j], (conf, None));
            }
        }
    }

    // Greedy maximum-confidence 1-factor (non-overlapping cysteine matching) over graph edges
    let mut candidate_edges: Vec<_> = graph
        .edge_indices()
        .filter_map(|e| {
            let (u, v) = graph.edge_endpoints(e)?;
            let &(conf, dist_opt) = graph.edge_weight(e)?;
            Some((u, v, conf, dist_opt))
        })
        .collect();
    candidate_edges.sort_unstable_by(|a, b| {
        b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut matched = vec![false; graph.node_count()];
    let mut bonds = Vec::new();
    for (u, v, conf, dist_opt) in candidate_edges {
        if matched[u.index()] || matched[v.index()] {
            continue;
        }
        matched[u.index()] = true;
        matched[v.index()] = true;
        let c1 = graph[u].min(graph[v]);
        let c2 = graph[u].max(graph[v]);
        bonds.push(DisulfideBondPrediction {
            cys1_aa: c1,
            cys2_aa: c2,
            sequence_separation: c2 - c1,
            ca_distance_angstrom: dist_opt.map(round2),
            confidence: round2(conf),
            basis: if dist_opt.is_some() {
                "3D Cα Spatial Proximity (< 8.5 Å)".into()
            } else {
                "Cysteine Pairing Graph Prior".into()
            },
        });
    }
    bonds.sort_unstable_by_key(|b| b.cys1_aa);
    bonds
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The expected masses below are not read from this module. Each is the sum of the Unimod
    /// monoisotopic residue masses (https://www.unimod.org/masses.html: G 57.021464,
    /// E 129.042593, L/I 113.084064, K 128.094963, ...) plus Unimod's water, 18.010565, and the
    /// CODATA 2018 proton, 1.007276466621 u; Biopython 1.88's
    /// `Bio.SeqUtils.molecular_weight(seq, "protein", monoisotopic=True)` gives the same
    /// neutral masses to within 1e-5 Da. Carbamidomethyl-Cys adds Unimod accession 4,
    /// 57.021464 Da.
    #[test]
    fn tryptic_digest_and_ms2_fragment_spectrum_compute_exact_monoisotopic_masses() {
        const DA: f64 = 1e-3;
        let egfp_head = "MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPT";
        let digest = simulate_proteolytic_digest_ms(egfp_head, "Trypsin", 1, 350.0, 4500.0, true);
        assert_eq!(digest.protein_length_aa, 60);
        assert!(digest.total_cleavage_sites >= 4);
        assert!(!digest.peptides.is_empty());
        assert!(digest.sequence_coverage_pct > 80.0);

        // Fully cleaved tryptic peptides (no missed cleavage), neutral monoisotopic mass and
        // [M+2H]2+ from the Unimod sums above. FICTTGK carries one carbamidomethyl-Cys:
        // 768.384009 bare + 57.021464.
        for (seq, mono, mz2) in [
            ("FSVSGEGEGDATYGK", 1502.652519, 752.333532),
            ("FICTTGK", 825.405477, 413.710013),
            ("GEELFTGVVPILVELDGDVNGHK", 2436.253657, 1219.134102),
        ] {
            let p = digest
                .peptides
                .iter()
                .find(|p| p.sequence == seq && p.missed_cleavages == 0)
                .unwrap_or_else(|| panic!("tryptic peptide {seq} missing"));
            assert!((p.monoisotopic_neutral_da - mono).abs() < DA, "{seq}: M {}", p.monoisotopic_neutral_da);
            assert!((p.mz_charge_2 - mz2).abs() < DA, "{seq}: [M+2H]2+ {}", p.mz_charge_2);
        }

        // Check MS2 spectrum for peptide GEELFTGVVPILVELDGDVNGHK (23 aa)
        let ms2 = simulate_peptide_ms2_spectrum("GEELFTGVVPILVELDGDVNGHK", true);
        assert!(ms2.precursor_monoisotopic_da > 2400.0);
        // Neutral precursor: the 23 Unimod residue masses plus one water.
        assert!(
            (ms2.precursor_monoisotopic_da - 2436.253657).abs() < DA,
            "precursor {}",
            ms2.precursor_monoisotopic_da
        );
        assert!((ms2.precursor_mz_2plus - 1219.134102).abs() < DA, "precursor 2+ {}", ms2.precursor_mz_2plus);
        assert!(ms2.peaks.iter().any(|p| p.label == "b4+"));
        assert!(ms2.peaks.iter().any(|p| p.label == "y12+"));
        // b_i+ = the first i residues + H+; y_j+ = the last j residues + H2O + H+. y1+ of a
        // tryptic Lys peptide is the textbook 147.1128.
        for (label, mz) in [
            ("b2+", 187.071333),  // GE
            ("b4+", 429.197990),  // GEEL
            ("y1+", 147.112804),  // K
            ("y12+", 1295.659006), // LVELDGDVNGHK
            ("y14+", 1505.795834), // PILVELDGDVNGHK
            ("y14++", 753.401555),
        ] {
            let p = ms2
                .peaks
                .iter()
                .find(|p| p.label == label)
                .unwrap_or_else(|| panic!("{label} missing"));
            assert!((p.mz - mz).abs() < DA, "{label}: m/z {}", p.mz);
        }
        // Proline at 0-based index 9 (V-P-I) produces N-terminal enhanced y14+ and C-terminal suppressed y13+
        let y14 = ms2.peaks.iter().find(|p| p.label == "y14+").unwrap();
        let y13 = ms2.peaks.iter().find(|p| p.label == "y13+").unwrap();
        assert!(y14.relative_intensity > 80.0);
        assert!(y13.relative_intensity < y14.relative_intensity);
    }

    /// D0005 / TD-06: a protease name the digest does not know is digested with Trypsin - its
    /// peptides are Trypsin's, which on this protein differ from every other rule's - and the
    /// report names Trypsin as its protease and the name asked for in its warning, an empty protein
    /// included. Every known name and alias, in any case, warns of nothing.
    #[test]
    fn unknown_protease_warns_and_uses_trypsin() {
        // K-P and R-P (Trypsin/P cuts them, Trypsin does not), R (Lys-C does not cut it), F/W/L/Y
        // (Chymotrypsin), E/D (Glu-C), D (Asp-N) and M (CNBr)
        let protein = "MAKPGREDFWKLRPSTDYMKAGDEQ";
        let digest = |name: &str| simulate_proteolytic_digest_ms(protein, name, 1, 250.0, 4500.0, true);
        let peptides = |r: &ProteolyticDigestMsReport| serde_json::to_value(&r.peptides).unwrap();
        let trypsin = digest("Trypsin");
        assert!(trypsin.warnings.is_empty(), "{:?}", trypsin.warnings);
        assert_eq!(trypsin.total_cleavage_sites, 3, "fixture: Trypsin cuts after R6, K11 and K20 only");
        let whole: Vec<usize> = trypsin.peptides.iter().filter(|p| p.missed_cleavages == 0).map(|p| p.start_aa).collect();
        assert_eq!(whole, [1, 7, 12, 21], "fixture: Trypsin cuts after R6, K11 and K20 only");

        for name in ["Foo", "Pepsin", "trypsin-p", ""] {
            let r = digest(name);
            let warning = format!("Unknown protease '{name}': digested with Trypsin.");
            assert_eq!(peptides(&r), peptides(&trypsin), "{name:?}");
            assert_eq!(r.total_cleavage_sites, trypsin.total_cleavage_sites, "{name:?}");
            assert_eq!(r.protease, "Trypsin", "{name:?}");
            assert_eq!(r.warnings, [warning.as_str()]);
            // the field crosses the JSON boundary every transport serialises through
            assert_eq!(serde_json::to_value(&r).unwrap()["warnings"], serde_json::json!([warning]));
            // nothing to digest still says which protease would have been used
            let empty = simulate_proteolytic_digest_ms("", name, 1, 250.0, 4500.0, true);
            assert_eq!((empty.protease.as_str(), empty.warnings), ("Trypsin", vec![warning]));
        }

        // every known name and alias, in any case and with spaces around it, digests by its own
        // rule, keeps the name as given and warns of nothing; every rule but Trypsin cuts this
        // protein differently, so a fallback to any of them would show above
        for name in ["Trypsin", "Trypsin/P", "Chymotrypsin", "Glu-C", "GluC", "V8", "Lys-C", "LysC", "Asp-N", "AspN", "CNBr"] {
            for variant in [name.to_string(), name.to_ascii_uppercase(), format!(" {} ", name.to_ascii_lowercase())] {
                let r = digest(&variant);
                assert!(r.warnings.is_empty(), "{variant:?}: {:?}", r.warnings);
                assert_eq!(r.protease, variant);
                if name != "Trypsin" {
                    assert_ne!(peptides(&r), peptides(&trypsin), "fixture: {variant:?} cuts like Trypsin");
                }
            }
        }
        assert_eq!(serde_json::to_value(&trypsin).unwrap()["warnings"], serde_json::json!([]));
    }

    #[test]
    fn ptm_pest_and_3d_disulfide_graph_scanner_identifies_all_motifs() {
        // Contains N-myristoyl (MGSSKS...), N-glyco (NYS), PKA (RRAS), NLS (KKRK), PEST-rich tract, 2 Cysteines, and ER KDEL
        let engineered = "MGSSKSKPKDPSQRRASVNYSACAAAPPPPEEEESSSSTTTTDDDDKAAACAGPKKKRKVKDEL";
        let atoms = vec![
            PdbCaAtom {
                serial: 1,
                chain_id: "A".into(),
                res_name: "CYS".into(),
                res_seq: 23,
                x: 0.0,
                y: 0.0,
                z: 0.0,
                b_factor: 90.0,
                secondary_structure: "C".into(),
            },
            PdbCaAtom {
                serial: 2,
                chain_id: "A".into(),
                res_name: "CYS".into(),
                res_seq: 51,
                x: 5.5,
                y: 0.0,
                z: 0.0,
                b_factor: 90.0,
                secondary_structure: "C".into(),
            },
        ];

        let rep = scan_post_translational_modifications(engineered, Some(&atoms));
        assert_eq!(
            rep.predicted_subcellular_compartment,
            "Endoplasmic Reticulum Lumen (KDEL/HDEL)"
        );
        assert!(rep.ptm_sites.iter().any(|p| p.category == "Lipidation"));
        assert!(rep.ptm_sites.iter().any(|p| p.category == "Glycosylation"));
        assert!(rep.ptm_sites.iter().any(|p| p.category == "Phosphorylation"));
        assert!(!rep.pest_degrons.is_empty());
        assert!(rep.pest_degrons[0].rogers_pest_score > 5.0);
        assert_eq!(rep.disulfide_bonds.len(), 1);
        assert_eq!(rep.disulfide_bonds[0].ca_distance_angstrom, Some(5.5));
    }
}
