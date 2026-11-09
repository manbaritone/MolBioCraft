// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Protein Biophysics (ProtParam MW, Henderson-Hasselbalch Bjellqvist pI, Pace Extinction
//! Coefficient, Guruprasad Instability Index, Ikai Aliphatic Index, Kyte-Doolittle Hydropathy,
//! Kolaskar-Tongaonkar Antigenic Epitopes, GOR Secondary Structure), Lupas Heptad Coiled-Coils &
//! Transmembrane Helix Topology, and `nalgebra` 3x3 SVD **Kabsch 3D Structure Superposition** on
//! sequence-aligned residue pairs.

use crate::aa_params;
use crate::translation_orf::{find_orfs, translate_sequence};
use bio::alignment::pairwise::Aligner;
use bio::alignment::AlignmentOperation;
use bio::scores::blosum62;
use molbiocraft_formats::pdb_mmcif::{
    ca_atoms_of_structure, parse_mmcif_structure, parse_pdb_structure, AtomRecord, PdbError, SecondaryStructureKind,
    Structure, StructureAtom, StructureChain, StructureModel, StructureResidue,
};
use molbiocraft_formats::{parse_pdb_or_mmcif_ca_coordinates, three_to_one_aa, PdbCaAtom};
use nalgebra::{Matrix3, Vector3};
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub fn kyte_doolittle(aa: u8) -> f64 {
    match aa.to_ascii_uppercase() {
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
    }
}

fn kolaskar_antigenicity(aa: u8) -> f64 {
    match aa.to_ascii_uppercase() {
        b'V' => 1.38,
        b'C' => 1.41,
        b'L' => 1.25,
        b'I' => 1.15,
        b'Y' => 1.16,
        b'H' => 1.10,
        b'F' => 1.07,
        b'P' => 1.06,
        b'K' => 1.05,
        b'A' => 1.06,
        b'Q' => 1.03,
        b'S' => 1.02,
        b'T' => 0.96,
        b'E' => 0.93,
        b'R' => 0.90,
        b'W' => 0.89,
        b'D' => 0.87,
        b'M' => 0.83,
        b'N' => 0.78,
        b'G' => 0.74,
        _ => 1.0,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HydrophobicityPoint {
    pub position: usize,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigenicDeterminant {
    pub start_aa: usize,
    pub end_aa: usize,
    pub peptide: String,
    pub max_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecondaryStructureSummary {
    pub helix_percent: f64,
    pub sheet_percent: f64,
    pub coil_percent: f64,
    pub states_per_residue: Vec<String>,
}

/// How [`analyze_protein_sequence`] chose the protein it analysed from a DNA or RNA input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TranslationRule {
    /// The longest forward-strand ORF of at least 30 aa, from an ATG to the first in-frame stop
    /// of the standard code, ORFs found as [`find_orfs`] finds them; of two as long, the one that
    /// starts first.
    LongestForwardOrf,
    /// With no such ORF: the forward frame with the fewest stop codons (of two with as few, the
    /// lower), translated through its last whole codon with its stops left out.
    FewestStopFrame,
}

/// The bases of a DNA or RNA input that [`analyze_protein_sequence`] translated and analysed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslatedSpan {
    pub rule: TranslationRule,
    /// First and last base, 1-based and inclusive, counted over the input's letters, `*` and `-`
    /// (as `clean_sequence` keeps them). An ORF's span ends with its stop codon.
    pub start: usize,
    pub end: usize,
    /// Stop codons left out of the analysed protein: none for an ORF, whose stop ends it.
    pub stops_removed: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProteinAnalysisReport {
    pub length_aa: usize,
    /// For a DNA or RNA input, the bases translated into the protein analysed here, so a caller
    /// can say which they were (BG-01M6S13D). `None` for a protein input, and when the frame
    /// translated holds no whole codon (an input under three bases, or a lone stop codon, whose
    /// fewest-stop frame is an empty one).
    #[serde(default)]
    pub translated_span: Option<TranslatedSpan>,
    pub molecular_weight_da: f64,
    pub molecular_weight_kda: f64,
    pub isoelectric_point_pi: f64,
    /// Net charge on the same Bjellqvist titration the pI is solved from, evaluated at pH 7.
    pub charge_at_ph7: f64,
    pub extinction_coeff280_reduced: usize,
    pub extinction_coeff280_cystine: usize,
    /// Absorbance at 280 nm of a 1 mg/ml solution in a 1 cm cell: the molar extinction with all
    /// cysteines paired as cystines, divided by the molecular weight.
    pub a280_of_1mg_per_ml: f64,
    pub gravy_hydropathy: f64,
    pub aliphatic_index: f64,
    pub instability_index: f64,
    pub is_stable: bool,
    pub amino_acid_counts: BTreeMap<String, usize>,
    pub hydrophobicity_profile: Vec<HydrophobicityPoint>,
    pub antigenic_determinants: Vec<AntigenicDeterminant>,
    pub secondary_structure_summary: SecondaryStructureSummary,
}

/// Comprehensive biophysical analysis of a protein sequence, or of the protein a DNA or RNA input
/// translates to by [`TranslationRule`] (the report's `translated_span` names those bases).
/// Scales cleanly to giant multi-thousand-residue proteins (e.g. Titin, APOB, BRCA2).
pub fn analyze_protein_sequence(
    raw_input: &str,
    is_dna: bool,
    window_size: usize,
) -> ProteinAnalysisReport {
    let (aa_raw, translated_span): (String, Option<TranslatedSpan>) = if is_dna {
        // find_orfs lists the longest first, the first-starting of two as long
        let best = find_orfs(raw_input, 30, false, 1).into_iter().find(|o| o.strand == 1);
        if let Some(best) = best {
            let span = TranslatedSpan {
                rule: TranslationRule::LongestForwardOrf,
                start: best.start,
                end: best.end,
                stops_removed: 0,
            };
            (best.protein_seq, Some(span))
        } else {
            let mut candidates: Vec<(usize, String)> =
                (0..3).map(|f| (f, translate_sequence(raw_input, f, 1))).collect();
            // a stable sort, so of two frames with as few stops the lower stays first
            candidates.sort_by_key(|(_, s)| s.as_bytes().iter().filter(|&&b| b == b'*').count());
            let (frame, protein) = candidates.swap_remove(0);
            let stops = protein.bytes().filter(|&b| b == b'*').count();
            let span = (!protein.is_empty()).then(|| TranslatedSpan {
                rule: TranslationRule::FewestStopFrame,
                start: frame + 1,
                end: frame + 3 * protein.len(),
                stops_removed: stops,
            });
            (protein.replace('*', ""), span)
        }
    } else {
        let protein = raw_input
            .bytes()
            .filter_map(|b| {
                let u = b.to_ascii_uppercase();
                u.is_ascii_alphabetic().then_some(u as char)
            })
            .collect();
        (protein, None)
    };

    let bytes = aa_raw.as_bytes();
    let len = bytes.len();
    let denom = len.max(1) as f64;

    let mut counts_map: BTreeMap<String, usize> = BTreeMap::new();
    let mut table = [0usize; 128];
    let mut hydro_sum = 0.0f64;

    for &b in bytes {
        table[(b as usize) & 127] += 1;
        *counts_map.entry((b as char).to_string()).or_insert(0) += 1;
        hydro_sum += kyte_doolittle(b);
    }
    let mw = crate::translation_orf::polypeptide_mass_da(&aa_raw);

    // Isoelectric point: Henderson–Hasselbalch titration over the Bjellqvist pKa scale that
    // ExPASy ProtParam uses, with the position-specific terminal values, solved by bisection.
    let pk_of = |table: &[(u8, f64)], residue: Option<u8>, default: f64| -> f64 {
        residue
            .and_then(|r| table.iter().find(|(a, _)| *a == r.to_ascii_uppercase()).map(|(_, p)| *p))
            .unwrap_or(default)
    };
    let pk_nterm = pk_of(&aa_params::PK_NTERM_SPECIFIC, bytes.first().copied(), aa_params::PK_NTERM);
    let pk_cterm = pk_of(&aa_params::PK_CTERM_SPECIFIC, bytes.last().copied(), aa_params::PK_CTERM);
    let n_of = |c: u8| table[c as usize] as f64;
    let net_charge = |ph: f64| -> f64 {
        // A basic group is protonated (charge +1) with probability 1/(1 + 10^(pH − pKa)).
        let base = |n: f64, pk: f64| n / (1.0 + 10f64.powf(ph - pk));
        // An acidic group is deprotonated (charge −1) with probability 1/(1 + 10^(pKa − pH)).
        let acid = |n: f64, pk: f64| n / (1.0 + 10f64.powf(pk - ph));
        base(1.0, pk_nterm)
            + base(n_of(b'K'), aa_params::PK_K)
            + base(n_of(b'R'), aa_params::PK_R)
            + base(n_of(b'H'), aa_params::PK_H)
            - acid(1.0, pk_cterm)
            - acid(n_of(b'D'), aa_params::PK_D)
            - acid(n_of(b'E'), aa_params::PK_E)
            - acid(n_of(b'C'), aa_params::PK_C)
            - acid(n_of(b'Y'), aa_params::PK_Y)
    };
    let (mut lo, mut hi) = (0.0f64, 14.0f64);
    for _ in 0..60 {
        let mid = 0.5 * (lo + hi);
        if net_charge(mid) > 0.0 {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let pi = if len == 0 { f64::NAN } else { ((0.5 * (lo + hi)) * 100.0).round() / 100.0 };

    // Molar extinction at 280 nm (Pace et al. 1995): Trp 5500, Tyr 1490, cystine 125.
    let nw = table[b'W' as usize];
    let ny = table[b'Y' as usize];
    let nc = table[b'C' as usize];
    let ext_reduced = nw * 5500 + ny * 1490;
    let ext_cystine = ext_reduced + (nc / 2) * 125;
    // Beer-Lambert for a 1 mg/ml solution in a 1 cm cell: A = epsilon * c, and 1 mg/ml is
    // 1/MW mol/l, so the absorbance is the molar extinction over the molecular weight.
    let a280 = if mw > 0.0 { ext_cystine as f64 / mw } else { 0.0 };

    let xa = (table[b'A' as usize] as f64 / denom) * 100.0;
    let xv = (table[b'V' as usize] as f64 / denom) * 100.0;
    let xi = (table[b'I' as usize] as f64 / denom) * 100.0;
    let xl = (table[b'L' as usize] as f64 / denom) * 100.0;
    let aliphatic_index = ((xa + 2.9 * xv + 3.9 * (xi + xl)) * 10.0).round() / 10.0;

    // Guruprasad, Reddy & Pandit (1990) instability index: (10/L) * sum of the dipeptide
    // instability weights (DIWV) along the chain. Dipeptides containing a non-standard residue
    // are skipped, as ExPASy does.
    let mut diwv_sum = 0.0f64;
    for pair in bytes.windows(2) {
        if let (Some(i), Some(j)) = (aa_params::aa_index(pair[0]), aa_params::aa_index(pair[1])) {
            diwv_sum += aa_params::DIWV[i][j];
        }
    }
    let instability_index = if len > 1 {
        (((10.0 / denom) * diwv_sum) * 100.0).round() / 100.0
    } else {
        f64::NAN
    };

    // Kyte-Doolittle sliding-window profile (adaptive stride on huge > 4,000 aa proteins)
    let win = window_size.clamp(3, 29);
    let half_w = win / 2;
    let prof_stride = (len / 2000).max(1);
    let mut hydro_profile = Vec::with_capacity((len / prof_stride) + 1);
    let mut i = 0usize;
    while i < len {
        let s = i.saturating_sub(half_w);
        let e = (i + half_w).min(len - 1);
        let mut sval = 0.0f64;
        for &b in &bytes[s..=e] {
            sval += kyte_doolittle(b);
        }
        hydro_profile.push(HydrophobicityPoint {
            position: i + 1,
            score: ((sval / ((e - s + 1) as f64)) * 100.0).round() / 100.0,
        });
        i += prof_stride;
    }

    // Kolaskar-Tongaonkar Antigenic Determinants: every run of at least 6 residues whose window
    // average (7 residues, fewer at the chain ends) is at least 1.06, along the whole chain.
    let mut epitopes = Vec::new();
    let mut in_ep = false;
    let mut ep_start = 1usize;
    let mut ep_max = 0.0f64;
    // The run open since `ep_start` ends at residue `end` (1-based).
    let close_region = |epitopes: &mut Vec<AntigenicDeterminant>, ep_start: usize, end: usize, ep_max: f64| {
        if end + 1 >= ep_start + 6 {
            epitopes.push(AntigenicDeterminant {
                start_aa: ep_start,
                end_aa: end,
                peptide: aa_raw[ep_start - 1..end].to_string(),
                max_score: (ep_max * 100.0).round() / 100.0,
            });
        }
    };
    for idx in 0..len {
        let s = idx.saturating_sub(3);
        let e = (idx + 3).min(len - 1);
        let avg: f64 = bytes[s..=e]
            .iter()
            .map(|&b| kolaskar_antigenicity(b))
            .sum::<f64>()
            / ((e - s + 1) as f64);
        if avg >= 1.06 {
            if !in_ep {
                in_ep = true;
                ep_start = idx + 1;
                ep_max = avg;
            } else if avg > ep_max {
                ep_max = avg;
            }
        } else if in_ep {
            close_region(&mut epitopes, ep_start, idx, ep_max);
            in_ep = false;
        }
    }
    // A run still open at the last residue is a region to the C terminus.
    if in_ep {
        close_region(&mut epitopes, ep_start, len, ep_max);
    }

    // GOR Secondary Structure Prediction
    let mut states = Vec::with_capacity(len.min(4000));
    let (mut h_cnt, mut e_cnt, mut c_cnt) = (0usize, 0usize, 0usize);
    for idx in 0..len {
        let s = idx.saturating_sub(3);
        let e = (idx + 4).min(len);
        let mut h_score = 0.0f64;
        let mut e_score = 0.0f64;
        for &b in &bytes[s..e] {
            if matches!(b, b'E' | b'A' | b'L' | b'M' | b'Q' | b'K' | b'R' | b'H') {
                h_score += 1.0;
            }
            if matches!(b, b'V' | b'I' | b'Y' | b'F' | b'W' | b'T' | b'C') {
                e_score += 1.0;
            }
            if matches!(b, b'P' | b'G') {
                h_score -= 1.2;
                e_score -= 0.8;
            }
        }
        let st = if h_score >= 3.5 && h_score >= e_score {
            h_cnt += 1;
            "H"
        } else if e_score >= 3.0 {
            e_cnt += 1;
            "E"
        } else {
            c_cnt += 1;
            "C"
        };
        if states.len() < 4000 {
            states.push(st.to_string());
        }
    }

    ProteinAnalysisReport {
        length_aa: len,
        translated_span,
        molecular_weight_da: (mw * 100.0).round() / 100.0,
        molecular_weight_kda: ((mw / 1000.0) * 100.0).round() / 100.0,
        isoelectric_point_pi: pi,
        charge_at_ph7: if len == 0 { f64::NAN } else { (net_charge(7.0) * 100.0).round() / 100.0 },
        extinction_coeff280_reduced: ext_reduced,
        extinction_coeff280_cystine: ext_cystine,
        a280_of_1mg_per_ml: (a280 * 100.0).round() / 100.0,
        gravy_hydropathy: ((hydro_sum / denom) * 1000.0).round() / 1000.0,
        aliphatic_index,
        instability_index,
        is_stable: instability_index < 40.0,
        amino_acid_counts: counts_map,
        hydrophobicity_profile: hydro_profile,
        antigenic_determinants: epitopes,
        secondary_structure_summary: SecondaryStructureSummary {
            helix_percent: (((h_cnt as f64 / denom) * 100.0) * 10.0).round() / 10.0,
            sheet_percent: (((e_cnt as f64 / denom) * 100.0) * 10.0).round() / 10.0,
            coil_percent: (((c_cnt as f64 / denom) * 100.0) * 10.0).round() / 10.0,
            states_per_residue: states,
        },
    }
}

// ============================================================================
// 2. Lupas Heptad Coiled-Coils & Transmembrane Helix Topology
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoiledCoilDomain {
    pub id: String,
    pub start_aa: usize,
    pub end_aa: usize,
    pub length_aa: usize,
    pub lupas_probability: f64,
    pub heptad_peptide: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransmembraneHelix {
    pub id: String,
    pub helix_label: String,
    pub start_aa: usize,
    pub end_aa: usize,
    pub length_aa: usize,
    pub mean_hydropathy_kd: f64,
    pub orientation: String,
    pub sequence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProteinTopologyAndCoilsReport {
    pub protein_sequence: String,
    pub length_aa: usize,
    pub n_terminus_location: String,
    pub coiled_coils: Vec<CoiledCoilDomain>,
    pub transmembrane_helices: Vec<TransmembraneHelix>,
}

pub fn predict_coiled_coils_and_transmembrane(
    protein_seq_raw: &str,
) -> ProteinTopologyAndCoilsReport {
    let prot: String = protein_seq_raw
        .bytes()
        .filter_map(|b| {
            let u = b.to_ascii_uppercase();
            matches!(
                u,
                b'A' | b'C'
                    | b'D'
                    | b'E'
                    | b'F'
                    | b'G'
                    | b'H'
                    | b'I'
                    | b'K'
                    | b'L'
                    | b'M'
                    | b'N'
                    | b'P'
                    | b'Q'
                    | b'R'
                    | b'S'
                    | b'T'
                    | b'V'
                    | b'W'
                    | b'Y'
            )
            .then_some(u as char)
        })
        .collect();
    let bytes = prot.as_bytes();
    let is_core = |b: u8| matches!(b, b'L' | b'I' | b'V' | b'M' | b'A' | b'Y' | b'F');
    let is_charged = |b: u8| matches!(b, b'E' | b'K' | b'R' | b'Q' | b'D');

    let mut coiled_coils = Vec::new();
    let win_cc = 21usize;
    if bytes.len() >= win_cc {
        let mut i = 0usize;
        while i + win_cc <= bytes.len() {
            let seg = &bytes[i..i + win_cc];
            if !seg.contains(&b'P') {
                let mut best_phase = 0.0f64;
                for phase in 0..7usize {
                    let mut core_hits = 0usize;
                    let mut salt_hits = 0usize;
                    for k in 0..win_cc {
                        let reg = (k + phase) % 7;
                        if (reg == 0 || reg == 3) && is_core(seg[k]) {
                            core_hits += 1;
                        }
                        if matches!(reg, 1 | 4 | 5 | 6) && is_charged(seg[k]) {
                            salt_hits += 1;
                        }
                    }
                    let score =
                        (core_hits as f64 / 6.0) * 0.65 + (salt_hits as f64 / 8.0).min(1.0) * 0.35;
                    if score > best_phase {
                        best_phase = score;
                    }
                }
                if best_phase >= 0.64 {
                    let mut end = i + win_cc;
                    while end < bytes.len() && bytes[end] != b'P' && end - i < 56 {
                        if !is_core(bytes[end]) && !is_charged(bytes[end]) {
                            break;
                        }
                        end += 1;
                    }
                    coiled_coils.push(CoiledCoilDomain {
                        id: format!("cc-{}", i + 1),
                        start_aa: i + 1,
                        end_aa: end,
                        length_aa: end - i,
                        lupas_probability: ((best_phase.min(0.99)) * 100.0).round() / 100.0,
                        heptad_peptide: prot[i..end.min(i + 28)].to_string(),
                    });
                    i = end;
                    continue;
                }
            }
            i += 2;
        }
    }

    let mut raw_tm: Vec<(usize, usize, f64)> = Vec::new();
    let tm_win = 19usize;
    if bytes.len() >= tm_win {
        let mut idx = 0usize;
        while idx + tm_win <= bytes.len() {
            let kd_sum: f64 = bytes[idx..idx + tm_win]
                .iter()
                .map(|&b| kyte_doolittle(b))
                .sum();
            let mean_kd = kd_sum / tm_win as f64;
            if mean_kd >= 1.55 {
                raw_tm.push((
                    idx,
                    (idx + 21).min(bytes.len()),
                    (mean_kd * 100.0).round() / 100.0,
                ));
                idx += 22;
            } else {
                idx += 1;
            }
        }
    }

    let n_term_loc = if let Some(&(s0, e0, _)) = raw_tm.first() {
        let loop1 = &bytes[..s0];
        let loop2_end = raw_tm
            .get(1)
            .map(|x| x.0)
            .unwrap_or_else(|| (e0 + 25).min(bytes.len()));
        let loop2 = &bytes[e0..loop2_end];
        let pos1 = loop1.iter().filter(|&&b| b == b'K' || b == b'R').count();
        let pos2 = loop2.iter().filter(|&&b| b == b'K' || b == b'R').count();
        if pos1 >= pos2 {
            "Cytoplasmic (Inside)"
        } else {
            "Extracellular / Luminal (Outside)"
        }
    } else {
        "Soluble / Non-Membrane"
    };

    let starts_inside = n_term_loc == "Cytoplasmic (Inside)";
    let transmembrane_helices: Vec<TransmembraneHelix> = raw_tm
        .into_iter()
        .enumerate()
        .map(|(idx, (s0, e0, mean_kd))| {
            let in_to_out = (idx % 2 == 0) == starts_inside;
            TransmembraneHelix {
                id: format!("tm-{}", idx + 1),
                helix_label: format!("TM{}", idx + 1),
                start_aa: s0 + 1,
                end_aa: e0,
                length_aa: e0 - s0,
                mean_hydropathy_kd: mean_kd,
                orientation: if in_to_out {
                    "In -> Out".into()
                } else {
                    "Out -> In".into()
                },
                sequence: prot[s0..e0].to_string(),
            }
        })
        .collect();

    ProteinTopologyAndCoilsReport {
        length_aa: prot.len(),
        protein_sequence: prot,
        n_terminus_location: n_term_loc.into(),
        coiled_coils,
        transmembrane_helices,
    }
}

// ============================================================================
// 3. Sequence-paired 3D Kabsch SVD Superposition (`nalgebra::Matrix3`) & Contact Map
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerResidueDeviation {
    /// 1-based position of the pair in alignment order.
    pub residue_index: usize,
    pub res_a: String,
    pub res_b: String,
    /// The residue number of each side of the pair, as its structure file gives it (the author
    /// number for mmCIF).
    pub res_seq_a: i32,
    pub res_seq_b: i32,
    pub distance_angstrom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactPair3D {
    pub res_i: usize,
    pub res_j: usize,
    pub distance_angstrom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdbStructureAlignmentReport {
    /// Polymer $C_\alpha$ atoms in each whole structure: every chain of its first model, one per
    /// amino-acid residue of a polymer chain (see [`align_pdb_chains_kabsch`]). A calcium ion or
    /// a ligand atom named `CA` is not one.
    pub atoms_model_a: usize,
    pub atoms_model_b: usize,
    /// The residue pairs the superposition is computed on: the columns of the sequence alignment
    /// of the two chains where neither side is a gap.
    pub aligned_residue_pairs: usize,
    /// RMSD over all `aligned_residue_pairs` $C_\alpha$ pairs after the optimal superposition, Å.
    pub rmsd_angstrom: f64,
    /// $\frac{1}{L}\sum 1/(1 + (d_i/d_0)^2)$ over the aligned pairs on this superposition, with
    /// $L$ the longer chain's length and $d_0$ from the number of pairs. It is scored on the
    /// sequence-paired superposition, not searched for the best TM-score.
    pub tm_score: f64,
    pub structural_similarity_verdict: String,
    /// The first 48 pairs, in alignment order.
    pub per_residue_deviations: Vec<PerResidueDeviation>,
    /// The rotation part of `transformation_matrix` (B onto A), to 4 decimals.
    pub rotation_matrix: [[f64; 3]; 3],
    /// The `atoms_model_a` polymer $C_\alpha$ atoms of structure A, all chains.
    pub atoms_a: Vec<PdbCaAtom>,
    /// The `atoms_model_b` polymer $C_\alpha$ atoms of structure B (all chains), moved by
    /// `transformation_matrix`.
    pub superimposed_atoms_b: Vec<PdbCaAtom>,
    /// Every non-local $C_\alpha$ contact of structure A, all chains: atom pairs at most 8.0 Å
    /// apart and at least 4 apart in `atoms_a` order, ordered by `res_i` then `res_j`, which index
    /// `atoms_a`.
    pub intra_chain_contacts: Vec<ContactPair3D>,
    /// The chain superposed from each structure: the author chain id for mmCIF (the id a PDB
    /// file shows), the chain column for PDB.
    pub chain_a: String,
    pub chain_b: String,
    /// How the residues were paired and superposed, in words.
    pub pairing_method: String,
    /// Fraction of the pairs whose two residues have the same one-letter code, to 4 decimals (a
    /// modified residue has its parent's code, so `MSE` matches `MET`; two residues coded `X`
    /// count as the same).
    pub sequence_identity: f64,
    /// The sequence alignment's score in BLOSUM62 units (gaps scored as in `pairing_method`).
    pub alignment_score: f64,
    /// The two chains' one-letter sequences as aligned, `-` for a gap. A column without a gap is
    /// one of the `aligned_residue_pairs`.
    pub aligned_sequence_a: String,
    pub aligned_sequence_b: String,
    /// Row-major 4x4 homogeneous matrix `[R t; 0 0 0 1]` that maps structure **B onto A**: a
    /// point `x` of B lands at `R x + t` in A's frame. Not rounded.
    pub transformation_matrix: [[f64; 4]; 4],
}

/// The pairing and superposition [`align_pdb_chains_kabsch`] performs, as the report states it.
pub const SUPERPOSITION_PAIRING_METHOD: &str = "Residues paired by a global sequence alignment of \
     the two chains (BLOSUM62, gap open -10, extend -0.5); Kabsch SVD superposition of every \
     aligned Cα pair";

/// One residue of a chain as the superposition reads it.
pub(crate) struct TraceResidue {
    res_name: String,
    /// One-letter code ([`residue_code`]): a modified residue has its parent's, anything else
    /// outside the 20 standard amino acids is `X`.
    pub(crate) code: u8,
    res_seq: i32,
    pub(crate) pos: Vector3<f64>,
}

/// One protein chain: its residues that have a $C_\alpha$, in chain order.
pub(crate) struct ChainTrace {
    /// Author chain id (mmCIF) or the chain column (PDB).
    pub(crate) id: String,
    /// The mmCIF label chain id, which also names this chain.
    label_id: Option<String>,
    pub(crate) residues: Vec<TraceResidue>,
}

/// A structure as the superposition reads it: its polymer $C_\alpha$ list and its protein chains.
pub(crate) struct SuperpositionInput {
    /// The polymer $C_\alpha$ atoms of the first model, every chain ([`polymer_c_alpha`]).
    ca_atoms: Vec<PdbCaAtom>,
    chains: Vec<ChainTrace>,
    /// Whether the first model has any atom named `CA` at all, polymer or not.
    any_atom_named_ca: bool,
}

/// Modified amino acids and the standard residue each derives from: the parent its wwPDB
/// Chemical Component Dictionary entry names (`_chem_comp.mon_nstd_parent_comp_id`), whose code
/// RCSB's canonical one-letter sequence gives it. Every pair agrees with Biopython 1.88's
/// `Bio.Data.PDBData.protein_letters_3to1_extended`, which is generated from that dictionary.
const MODIFIED_RESIDUE_PARENTS: &[(&str, u8)] = &[
    ("MSE", b'M'), // selenomethionine
    ("FME", b'M'), // N-formylmethionine
    ("MHO", b'M'), // S-oxymethionine
    ("SEP", b'S'), // phosphoserine
    ("TPO", b'T'), // phosphothreonine
    ("PTR", b'Y'), // O-phosphotyrosine
    ("TYS", b'Y'), // O-sulfotyrosine
    ("CSO", b'C'), // S-hydroxycysteine
    ("CSD", b'C'), // 3-sulfinoalanine
    ("CME", b'C'), // S,S-(2-hydroxyethyl)thiocysteine
    ("OCS", b'C'), // cysteinesulfonic acid
    ("HYP", b'P'), // 4-hydroxyproline
    ("PCA", b'Q'), // pyroglutamic acid
    ("CGU", b'E'), // gamma-carboxyglutamic acid
    ("MLY", b'K'), // N6,N6-dimethyllysine
    ("M3L", b'K'), // N6,N6,N6-trimethyllysine
    ("ALY", b'K'), // N6-acetyllysine
    ("KCX", b'K'), // lysine NZ-carboxylic acid
    ("LLP", b'K'), // lysine with pyridoxal 5'-phosphate
];

/// The one-letter code of a residue name: a standard amino acid's own, a modified residue's
/// parent's ([`MODIFIED_RESIDUE_PARENTS`]), else `X`.
fn residue_code(res_name: &str) -> u8 {
    let name = res_name.trim().to_ascii_uppercase();
    match three_to_one_aa(&name) {
        'X' => MODIFIED_RESIDUE_PARENTS.iter().find(|(n, _)| *n == name).map_or(b'X', |&(_, code)| code),
        code => code as u8,
    }
}

/// The $C_\alpha$ of a residue of a polymer chain, by one rule for both formats: an atom named
/// `CA` whose element is carbon (or not given), in a polymer residue. mmCIF marks a polymer
/// residue itself, with a `label_seq_id`. A legacy PDB file gives every residue a number (waters
/// and ligands too, [`Structure::label_ids_from_author`]), so there a polymer residue is one
/// written as `ATOM`, or a `HETATM` amino acid ([`residue_code`] not `X`) such as a
/// selenomethionine. A calcium ion's atom, also named `CA`, is never one: it is not carbon, and
/// it is not in a polymer residue.
fn polymer_c_alpha<'a>(structure: &Structure, residue: &'a StructureResidue) -> Option<&'a StructureAtom> {
    let ca = residue
        .atoms
        .iter()
        .find(|a| a.name == "CA" && a.element.as_deref().is_none_or(|e| e.eq_ignore_ascii_case("C")))?;
    let polymer = if structure.label_ids_from_author {
        ca.record == AtomRecord::Atom || residue_code(&residue.res_name) != b'X'
    } else {
        residue.label_seq_id.is_some()
    };
    polymer.then_some(ca)
}

/// Read PDB or mmCIF text through the full-atom model, the same way for both: a chain's residues
/// are the residues of the **first model** that have a polymer $C_\alpha$ ([`polymer_c_alpha`]),
/// in chain order, so the other models of an NMR entry, a calcium ion and a ligand are never
/// residues while a modified residue in the chain (a `HETATM` selenomethionine) is. A blank PDB
/// chain column reads as chain `A`, as the PDB $C_\alpha$ view gives it. The $C_\alpha$ list
/// carries the file's `HELIX`/`SHEET` secondary structure for a PDB file that declares any, as
/// that view does, and otherwise the one inferred from $C_\alpha$ geometry. The TM-score
/// alignment (`structure_align`) reads its chains through this and [`select_chain`] too, so the
/// two superpositions always read the same residues.
pub(crate) fn read_superposition_input(text: &str, which: char) -> Result<SuperpositionInput, String> {
    // The same test the formats crate uses to tell mmCIF from PDB text.
    let structure = if text.contains("_atom_site.") {
        parse_mmcif_structure(text).map_err(|e| format!("Structure {which}: {e}"))?
    } else {
        match parse_pdb_structure(text) {
            Ok(structure) => structure,
            // No atom records: `select_chain` says the structure holds no C-alpha atoms.
            Err(PdbError::NoAtoms) => {
                return Ok(SuperpositionInput { ca_atoms: Vec::new(), chains: Vec::new(), any_atom_named_ca: false })
            }
            Err(e) => return Err(format!("Structure {which}: {e}")),
        }
    };
    let from_pdb = structure.label_ids_from_author;
    let mut any_atom_named_ca = false;
    let mut polymer = StructureModel { model_num: 1, atom_record_count: 0, hetatm_record_count: 0, chains: Vec::new() };
    let mut chains = Vec::new();
    for chain in structure.models.first().map_or(&[][..], |m| &m.chains[..]) {
        any_atom_named_ca |= chain.residues.iter().any(|r| r.atoms.iter().any(|a| a.name == "CA"));
        let kept: Vec<StructureResidue> = chain
            .residues
            .iter()
            .filter_map(|r| {
                let ca = polymer_c_alpha(&structure, r)?;
                Some(StructureResidue {
                    res_name: r.res_name.clone(),
                    label_seq_id: r.label_seq_id,
                    auth_seq_id: r.auth_seq_id,
                    ins_code: r.ins_code.clone(),
                    secondary_structure: r.secondary_structure,
                    atoms: vec![ca.clone()],
                })
            })
            .collect();
        if kept.is_empty() {
            continue;
        }
        let blank_to_a = |id: &str| if from_pdb && id.is_empty() { "A".to_string() } else { id.to_string() };
        chains.push(ChainTrace {
            id: blank_to_a(&chain.auth_asym_id),
            label_id: (!from_pdb).then(|| chain.label_asym_id.clone()),
            residues: kept
                .iter()
                .map(|r| TraceResidue {
                    res_name: r.res_name.clone(),
                    code: residue_code(&r.res_name),
                    res_seq: r.auth_seq_id.or(r.label_seq_id).unwrap_or_default(),
                    pos: Vector3::new(r.atoms[0].x, r.atoms[0].y, r.atoms[0].z),
                })
                .collect(),
        });
        polymer.chains.push(StructureChain {
            label_asym_id: blank_to_a(&chain.label_asym_id),
            auth_asym_id: blank_to_a(&chain.auth_asym_id),
            residues: kept,
        });
    }
    let declared = from_pdb && !(structure.helices.is_empty() && structure.strands.is_empty());
    let polymer = Structure { models: vec![polymer], helices: Vec::new(), strands: Vec::new(), label_ids_from_author: from_pdb };
    let mut ca_atoms = ca_atoms_of_structure(&polymer);
    if declared {
        let residues = polymer.models[0].chains.iter().flat_map(|c| &c.residues);
        for (atom, residue) in ca_atoms.iter_mut().zip(residues) {
            atom.secondary_structure = match residue.secondary_structure {
                Some(SecondaryStructureKind::Helix) => "H",
                Some(SecondaryStructureKind::Strand) => "E",
                None => "C",
            }
            .into();
        }
    }
    Ok(SuperpositionInput { ca_atoms, chains, any_atom_named_ca })
}

/// The chain named `wanted` (author id first, then mmCIF label id), or the first protein chain
/// when no name is given. An empty or blank name counts as no name.
pub(crate) fn select_chain<'a>(input: &'a SuperpositionInput, wanted: Option<&str>, which: char) -> Result<&'a ChainTrace, String> {
    if input.chains.is_empty() {
        return Err(if !input.any_atom_named_ca {
            format!("Structure {which} holds no Cα atoms; load a PDB or mmCIF structure")
        } else {
            format!("Structure {which} has no protein chain: none of its Cα atoms is in a polymer residue")
        });
    }
    match wanted.map(str::trim).filter(|w| !w.is_empty()) {
        None => Ok(&input.chains[0]),
        Some(id) => input
            .chains
            .iter()
            .find(|c| c.id == id)
            .or_else(|| input.chains.iter().find(|c| c.label_id.as_deref() == Some(id)))
            .ok_or_else(|| {
                let ids: Vec<&str> = input.chains.iter().map(|c| c.id.as_str()).collect();
                format!("Structure {which} has no protein chain '{id}' (its protein chains: {})", ids.join(", "))
            }),
    }
}

/// Global alignment of two one-letter sequences under BLOSUM62 with a gap of length `k` costing
/// `-10 - 0.5 (k - 1)`, end gaps included (Biopython `PairwiseAligner`'s convention for
/// `open_gap_score=-10, extend_gap_score=-0.5`). Rust-Bio scores a gap as `open + k * extend` in
/// integers, so every score is doubled: open -19, extend -1, twice BLOSUM62, and the score halved.
/// Returns the aligned index pairs `(i in a, j in b)`, the two gapped strings and the score.
fn align_chain_sequences(a: &[u8], b: &[u8]) -> (Vec<(usize, usize)>, String, String, f64) {
    let doubled = |x: u8, y: u8| 2 * blosum62(x, y);
    let mut aligner = Aligner::with_capacity(a.len(), b.len(), -19, -1, &doubled);
    let alignment = aligner.global(a, b);
    let (mut i, mut j) = (0usize, 0usize);
    let mut pairs = Vec::new();
    let (mut row_a, mut row_b) = (String::new(), String::new());
    for op in &alignment.operations {
        // Rust-Bio's `Ins` consumes a residue of x (a) alone and `Del` one of y (b) alone. A
        // global alignment has no clips; one would read as that many gap columns.
        let (take_a, take_b) = match *op {
            AlignmentOperation::Match | AlignmentOperation::Subst => (1, 1),
            AlignmentOperation::Ins => (1, 0),
            AlignmentOperation::Del => (0, 1),
            AlignmentOperation::Xclip(n) => (n, 0),
            AlignmentOperation::Yclip(n) => (0, n),
        };
        if take_a == 1 && take_b == 1 {
            pairs.push((i, j));
        }
        for k in 0..take_a.max(take_b) {
            row_a.push(if k < take_a { a[i + k] as char } else { '-' });
            row_b.push(if k < take_b { b[j + k] as char } else { '-' });
        }
        i += take_a;
        j += take_b;
    }
    (pairs, row_a, row_b, alignment.score as f64 / 2.0)
}

/// Superpose two structures on the residues that correspond, not on atom order.
///
/// The chain `chain_a` of structure A and `chain_b` of structure B (each the first protein chain
/// when `None`) are paired residue by residue by a global sequence alignment of their one-letter
/// sequences (BLOSUM62, gap open -10, extend -0.5, end gaps penalised, as Biopython's
/// `PairwiseAligner`); every aligned pair is then superposed by Kabsch (1976) SVD,
/// `nalgebra::Matrix3::svd(true, true)` with the reflection correction ($\det(V U^T) = +1$), and
/// the RMSD is taken over all of the pairs. Residue numbering plays no part. The motion that maps
/// B onto A moves every polymer $C_\alpha$ atom of B, and contacts ($|i - j| \ge 4$, $d \le 8$ Å)
/// are listed for structure A. PDB and mmCIF text are read alike: the first model only, and of
/// it the residues with a polymer $C_\alpha$ (see `polymer_c_alpha`), a modified residue under its
/// parent's one-letter code (`MSE` as `M`).
///
/// Two chains whose alignment pairs no residue give a report with no pairs, B unmoved (the
/// identity matrix), RMSD, TM-score and identity 0, and a verdict that says so. Errors name what
/// is missing: a structure with no $C_\alpha$ atoms or no protein chain, a named chain that is
/// not in its structure (with the chains that are), or PDB or mmCIF text that cannot be read.
pub fn align_pdb_chains_kabsch(
    pdb_text_a: &str,
    pdb_text_b: &str,
    chain_a: Option<&str>,
    chain_b: Option<&str>,
) -> Result<PdbStructureAlignmentReport, String> {
    let input_a = read_superposition_input(pdb_text_a, 'A')?;
    let input_b = read_superposition_input(pdb_text_b, 'B')?;
    let trace_a = select_chain(&input_a, chain_a, 'A')?;
    let trace_b = select_chain(&input_b, chain_b, 'B')?;

    let seq_a: Vec<u8> = trace_a.residues.iter().map(|r| r.code).collect();
    let seq_b: Vec<u8> = trace_b.residues.iter().map(|r| r.code).collect();
    let (pairs, aligned_sequence_a, aligned_sequence_b, alignment_score) = align_chain_sequences(&seq_a, &seq_b);

    let n = pairs.len();
    // With no pairs every sum below is zero; dividing by 1 keeps the zeros rather than NaN.
    let nf = n.max(1) as f64;
    let (mut ca, mut cb) = (Vector3::<f64>::zeros(), Vector3::<f64>::zeros());
    for &(i, j) in &pairs {
        ca += trace_a.residues[i].pos;
        cb += trace_b.residues[j].pos;
    }
    ca /= nf;
    cb /= nf;

    // Cross-covariance H = sum_i (B_i - cb) * (A_i - ca)^T so R * (B_i - cb) aligns onto (A_i - ca)
    let mut h = Matrix3::<f64>::zeros();
    for &(i, j) in &pairs {
        h += (trace_b.residues[j].pos - cb) * (trace_a.residues[i].pos - ca).transpose();
    }
    let svd = h.svd(true, true);
    // No pairs, no motion: the SVD of a zero H is any pair of orthogonal matrices.
    let rot = if let (Some(u), Some(v_t), true) = (svd.u, svd.v_t, n > 0) {
        let v = v_t.transpose();
        let u_t = u.transpose();
        let det = (&v * &u_t).determinant();
        let d_sign = if det < 0.0 { -1.0 } else { 1.0 };
        let corr = Matrix3::new(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, d_sign);
        v * corr * u_t
    } else {
        Matrix3::identity()
    };
    let shift = ca - rot * cb;

    let d0 = (1.24 * ((n.max(16) as f64) - 15.0).cbrt() - 1.8).max(0.5);
    let mut sum_sq = 0.0f64;
    let mut tm_acc = 0.0f64;
    let mut identical = 0usize;
    let mut deviations = Vec::with_capacity(n.min(48));
    for (k, &(i, j)) in pairs.iter().enumerate() {
        let (ra, rb) = (&trace_a.residues[i], &trace_b.residues[j]);
        let dist_sq = (ra.pos - (rot * rb.pos + shift)).norm_squared();
        sum_sq += dist_sq;
        tm_acc += 1.0 / (1.0 + dist_sq / (d0 * d0));
        identical += usize::from(ra.code == rb.code);
        if deviations.len() < 48 {
            deviations.push(PerResidueDeviation {
                residue_index: k + 1,
                res_a: ra.res_name.clone(),
                res_b: rb.res_name.clone(),
                res_seq_a: ra.res_seq,
                res_seq_b: rb.res_seq,
                distance_angstrom: (dist_sq.sqrt() * 1000.0).round() / 1000.0,
            });
        }
    }

    let superimposed_b: Vec<PdbCaAtom> = input_b
        .ca_atoms
        .iter()
        .map(|atom_b| {
            let p = rot * Vector3::new(atom_b.x, atom_b.y, atom_b.z) + shift;
            let mut moved = atom_b.clone();
            moved.x = (p.x * 1000.0).round() / 1000.0;
            moved.y = (p.y * 1000.0).round() / 1000.0;
            moved.z = (p.z * 1000.0).round() / 1000.0;
            moved
        })
        .collect();

    let rmsd = (((sum_sq / nf).sqrt()) * 1000.0).round() / 1000.0;
    let longer = trace_a.residues.len().max(trace_b.residues.len()) as f64;
    let tm_score = ((tm_acc / longer) * 1000.0).round() / 1000.0;
    let verdict = if n == 0 {
        format!(
            "Not superposed: the sequence alignment of chain {} and chain {} pairs no residues, so structure B is left where it is",
            trace_a.id, trace_b.id
        )
    } else if tm_score >= 0.5 {
        "Same Global Fold Topology (TM-score ≥ 0.50)".into()
    } else if tm_score >= 0.3 {
        "Moderate Local Substructure Similarity".into()
    } else {
        "Distinct Tertiary Fold Geometry".into()
    };

    let r4 = |v: f64| (v * 10000.0).round() / 10000.0;
    let rot_arr = [
        [r4(rot[(0, 0)]), r4(rot[(0, 1)]), r4(rot[(0, 2)])],
        [r4(rot[(1, 0)]), r4(rot[(1, 1)]), r4(rot[(1, 2)])],
        [r4(rot[(2, 0)]), r4(rot[(2, 1)]), r4(rot[(2, 2)])],
    ];
    let transformation_matrix = [
        [rot[(0, 0)], rot[(0, 1)], rot[(0, 2)], shift.x],
        [rot[(1, 0)], rot[(1, 1)], rot[(1, 2)], shift.y],
        [rot[(2, 0)], rot[(2, 1)], rot[(2, 2)], shift.z],
        [0.0, 0.0, 0.0, 1.0],
    ];

    Ok(PdbStructureAlignmentReport {
        atoms_model_a: input_a.ca_atoms.len(),
        atoms_model_b: input_b.ca_atoms.len(),
        aligned_residue_pairs: n,
        rmsd_angstrom: rmsd,
        tm_score,
        structural_similarity_verdict: verdict,
        per_residue_deviations: deviations,
        rotation_matrix: rot_arr,
        intra_chain_contacts: intra_chain_contacts(&input_a.ca_atoms),
        chain_a: trace_a.id.clone(),
        chain_b: trace_b.id.clone(),
        pairing_method: SUPERPOSITION_PAIRING_METHOD.into(),
        sequence_identity: ((identical as f64 / nf) * 10000.0).round() / 10000.0,
        alignment_score,
        aligned_sequence_a,
        aligned_sequence_b,
        transformation_matrix,
        atoms_a: input_a.ca_atoms,
        superimposed_atoms_b: superimposed_b,
    })
}

/// $C_\alpha$ contacts of structure A for the 3D viewer: every pair of its atoms (all chains) at
/// most 8.0 Å apart and at least 4 apart in `atoms_a` order, ordered by the first atom and then the
/// second. The atoms are binned in 8 Å cells, so each is compared only with those of its own cell
/// and the 26 around it, which hold every atom within 8 Å of it. An atom with a coordinate that is
/// not a finite number is in contact with none.
fn intra_chain_contacts(atoms_a: &[PdbCaAtom]) -> Vec<ContactPair3D> {
    const CUTOFF: f64 = 8.0;
    let finite = |a: &PdbCaAtom| a.x.is_finite() && a.y.is_finite() && a.z.is_finite();
    let cell_of = |a: &PdbCaAtom| [a.x, a.y, a.z].map(|v| (v / CUTOFF).floor() as i64);
    let mut cells: FxHashMap<[i64; 3], Vec<usize>> = FxHashMap::default();
    for (k, atom) in atoms_a.iter().enumerate().filter(|(_, a)| finite(a)) {
        cells.entry(cell_of(atom)).or_default().push(k);
    }
    let mut contacts = Vec::new();
    for (i, a) in atoms_a.iter().enumerate().filter(|(_, a)| finite(a)) {
        let [cx, cy, cz] = cell_of(a);
        for dx in -1i64..=1 {
            for dy in -1i64..=1 {
                for dz in -1i64..=1 {
                    // A cell past the i64 range holds no atom (coordinates saturate into the last one).
                    let (Some(x), Some(y), Some(z)) = (cx.checked_add(dx), cy.checked_add(dy), cz.checked_add(dz)) else {
                        continue;
                    };
                    for &j in cells.get(&[x, y, z]).into_iter().flatten() {
                        if j < i + 4 {
                            continue;
                        }
                        let b = &atoms_a[j];
                        let (ex, ey, ez) = (a.x - b.x, a.y - b.y, a.z - b.z);
                        let d2 = ex * ex + ey * ey + ez * ez;
                        if d2 <= CUTOFF * CUTOFF {
                            contacts.push(ContactPair3D {
                                res_i: i,
                                res_j: j,
                                distance_angstrom: ((d2.sqrt()) * 100.0).round() / 100.0,
                            });
                        }
                    }
                }
            }
        }
    }
    contacts.sort_unstable_by_key(|c| (c.res_i, c.res_j));
    contacts
}

/// [`align_pdb_chains_kabsch`] on the first protein chain of each structure. Inputs that cannot
/// be superposed give a report with no pairs whose verdict says why, and each structure's
/// $C_\alpha$ atoms as read.
pub fn align_pdb_structures_kabsch(pdb_text_a: &str, pdb_text_b: &str) -> PdbStructureAlignmentReport {
    align_pdb_chains_kabsch(pdb_text_a, pdb_text_b, None, None).unwrap_or_else(|reason| {
        let atoms_a = parse_pdb_or_mmcif_ca_coordinates(pdb_text_a);
        let atoms_b = parse_pdb_or_mmcif_ca_coordinates(pdb_text_b);
        PdbStructureAlignmentReport {
            atoms_model_a: atoms_a.len(),
            atoms_model_b: atoms_b.len(),
            aligned_residue_pairs: 0,
            rmsd_angstrom: 0.0,
            tm_score: 0.0,
            structural_similarity_verdict: reason,
            per_residue_deviations: Vec::new(),
            rotation_matrix: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            atoms_a,
            superimposed_atoms_b: atoms_b,
            intra_chain_contacts: Vec::new(),
            chain_a: String::new(),
            chain_b: String::new(),
            pairing_method: SUPERPOSITION_PAIRING_METHOD.into(),
            sequence_identity: 0.0,
            alignment_score: 0.0,
            aligned_sequence_a: String::new(),
            aligned_sequence_b: String::new(),
            transformation_matrix: [
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 0.0],
                [0.0, 0.0, 0.0, 1.0],
            ],
        }
    })
}

#[cfg(test)]
mod protparam_validation {
    use super::*;

    /// Escherichia coli K-12 MG1655 ferredoxin Fdx (gene fdx), NCBI RefSeq NP_417020.1, 111 aa.
    const FERREDOXIN_NP_417020_1: &str = "MPKIVILPHQDLCPDGAVLEANSGETILDAALRNGIEIEHACEKSCACTTCHCIVREGFDSLPESSEQEDDMLDKAWGLEPESRLSCQARVTDEDLVVEIPRYTINHAREH";
    /// Escherichia coli K-12 MG1655 nitrate reductase A beta subunit NarH (gene narH), NCBI RefSeq
    /// NP_415743.1, 512 aa.
    const NARH_NP_415743_1: &str = "MKIRSQVGMVLNLDKCIGCHTCSVTCKNVWTSREGVEYAWFNNVETKPGQGFPTDWENQEKYKGGWIRKINGKLQPRMGNRAMLLGKIFANPHLPGIDDYYEPFDFDYQNLHTAPEGSKSQPIARPRSLITGERMAKIEKGPNWEDDLGGEFDKLAKDKNFDNIQKAMYSQFENTFMMYLPRLCEHCLNPACVATCPSGAIYKREEDGIVLIDQDKCRGWRMCITGCPYKKIYFNWKSGKSEKCIFCYPRIEAGQPTVCSETCVGRIRYLGVLLYDADAIERAASTENEKDLYQRQLDVFLDPNDPKVIEQAIKDGIPLSVIEAAQQSPVYKMAMEWKLALPLHPEYRTLPMVWYVPPLSPIQSAADAGELGSNGILPDVESLRIPVQYLANLLTAGDTKPVLRALKRMLAMRHYKRAETVDGKVDTRALEEVGLTEAQAQEMYRYLAIANYEDRFVVPSSHRELAREAFPEKNGCGFTFGDGCHGSDTKFNLFNSRRIDAIDVTSKTEPHP";
    /// Aequorea victoria green fluorescent protein, NCBI GenBank AAA27721.1: the conceptual
    /// translation of the gfp10 cDNA M62653.1 (Prasher et al. 1992, Gene 111:229), 238 aa, the
    /// same sequence as UniProtKB P42212. It is the wild type, so residue 80 is Q.
    const GFP_AAA27721_1: &str = "MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTFSYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITHGMDELYK";

    /// The NCBI protein record `ncbi/protein/<accession>.fasta` of the reference-data folder, as
    /// scripts/outside-data/fetch.sh fetches it: (its header line, its residues). The folder is
    /// `MOLBIOCRAFT_TEST_DATA_DIR` (a relative value is read from the repo root), else
    /// `<repo>/test-data`. When the file is absent this prints `skipped: reference data absent`
    /// and returns `None`; with `MOLBIOCRAFT_REQUIRE_TEST_DATA=1` it fails instead, as the nightly
    /// reference check runs it. A file that is not one FASTA record of that accession fails.
    fn ncbi_protein_record(accession: &str) -> Option<(String, String)> {
        let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let dir = match std::env::var_os("MOLBIOCRAFT_TEST_DATA_DIR") {
            Some(d) if !d.is_empty() => repo.join(d),
            _ => repo.join("test-data"),
        };
        let v = std::env::var_os("MOLBIOCRAFT_REQUIRE_TEST_DATA").unwrap_or_default();
        let required = match v.to_str() {
            Some("1") => true,
            Some("" | "0") => false,
            _ => panic!("MOLBIOCRAFT_REQUIRE_TEST_DATA must be 1, 0 or unset, not {v:?}"),
        };
        let p = dir.join("ncbi/protein").join(format!("{accession}.fasta"));
        let text = match std::fs::read_to_string(&p) {
            Ok(text) => text,
            Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory) => {
                assert!(!required, "reference data required (MOLBIOCRAFT_REQUIRE_TEST_DATA=1) but absent: {}", p.display());
                eprintln!("skipped: reference data absent ({})", p.display());
                return None;
            }
            Err(e) => panic!("{}: unreadable: {e}", p.display()),
        };
        let mut lines = text.lines().map(str::trim_end).filter(|l| !l.is_empty());
        let header = lines.next().unwrap_or_else(|| panic!("{}: empty", p.display())).to_string();
        assert!(header.starts_with(&format!(">{accession} ")), "{}: header {header:?} is not record {accession}", p.display());
        let residues: String = lines.collect();
        assert!(!residues.contains('>'), "{}: more than one record", p.display());
        assert!(!residues.is_empty(), "{}: no residues", p.display());
        Some((header, residues))
    }

    /// The ferredoxin and NarH sequences the statistics are checked on are their NCBI RefSeq
    /// records, as fetched.
    #[test]
    fn protparam_cases_are_their_ncbi_records() {
        for (accession, seq) in [("NP_417020.1", FERREDOXIN_NP_417020_1), ("NP_415743.1", NARH_NP_415743_1)] {
            let Some((header, residues)) = ncbi_protein_record(accession) else { continue };
            assert!(header.ends_with("[Escherichia coli str. K-12 substr. MG1655]"), "{accession}: header {header:?}");
            assert_eq!(seq, residues, "{accession}: the test's sequence is not the fetched record");
        }
    }

    /// The GFP case of `mw_pi_extinction_instability_and_gravy_match_expasy` is GenBank
    /// AAA27721.1, as fetched.
    #[test]
    fn gfp_case_is_its_ncbi_record() {
        let Some((header, residues)) = ncbi_protein_record("AAA27721.1") else { return };
        assert!(header.ends_with("[Aequorea victoria]"), "AAA27721.1: header {header:?}");
        assert_eq!(GFP_AAA27721_1, residues, "AAA27721.1: the test's GFP is not the fetched record");
    }

    /// Weight, extinction and absorbance match ExPASy ProtParam, and the charge at pH 7 matches
    /// Biopython, on the two E. coli RefSeq proteins.
    ///
    /// ExPASy: each sequence posted to https://web.expasy.org/cgi-bin/protparam/protparam with
    /// curl on 2026-11-08 (UTC). It prints the weight and pI to 0.01, the extinction coefficients
    /// as integers, and `Abs 0.1% (=1 g/l)` to 0.001; the absorbance here is the one "assuming all
    /// pairs of Cys residues form cystines", which is the one our A280 is. Charge: Biopython 1.88
    /// `ProteinAnalysis(seq).charge_at_pH(7.0)`, run with `uv run --with biopython==1.88` on
    /// 2026-11-08 and printed to 6 decimals. Its pKa scale is the Bjellqvist one that ExPASy's pI,
    /// and our pI and charge, are read off.
    ///
    /// Our report rounds weight, pI and charge to 0.01, so each must equal its reference to that
    /// rounding (0.005). Our A280 is rounded to 0.01 and ExPASy's to 0.001, so the two may differ
    /// by 0.005 + 0.0005. The extinction coefficients are exact.
    #[test]
    fn charge_matches_biopython_and_absorbance_matches_expasy() {
        // (accession, sequence, aa, ExPASy: weight in Da, reduced and cystine extinction in
        // M-1 cm-1, A280 of 1 g/l, pI; Biopython: charge at pH 7)
        let cases = [
            ("NP_417020.1", FERREDOXIN_NP_417020_1, 111usize, 12_330.82, 6_990usize, 7_365usize, 0.597, 4.49, -14.087704),
            ("NP_415743.1", NARH_NP_415743_1, 512, 58_066.41, 82_280, 83_280, 1.434, 6.36, -2.801907),
        ];
        for (acc, seq, len, mw, ext_red, ext_cys, a280, pi, charge) in cases {
            let r = analyze_protein_sequence(seq, false, 9);
            assert_eq!(r.length_aa, len, "{acc}: length");
            assert!((r.molecular_weight_da - mw).abs() <= 0.005 + 1e-9, "{acc}: MW {} against ExPASy {mw}", r.molecular_weight_da);
            assert_eq!((r.extinction_coeff280_reduced, r.extinction_coeff280_cystine), (ext_red, ext_cys), "{acc}: extinction");
            assert!((r.a280_of_1mg_per_ml - a280).abs() <= 0.0055 + 1e-9, "{acc}: A280 {} against ExPASy {a280}", r.a280_of_1mg_per_ml);
            assert!((r.isoelectric_point_pi - pi).abs() <= 0.005 + 1e-9, "{acc}: pI {} against ExPASy {pi}", r.isoelectric_point_pi);
            assert!((r.charge_at_ph7 - charge).abs() <= 0.005 + 1e-9, "{acc}: charge {} against Biopython {charge}", r.charge_at_ph7);
        }
    }

    /// Net charge on Biopython 1.88's Bjellqvist curve, so the curve can be read at any pH: the
    /// tables `positive_pKs`, `negative_pKs`, `pKnterminal` and `pKcterminal` of
    /// `Bio.SeqUtils.IsoelectricPoint`, transcribed here (not taken from `aa_params`), under its
    /// Henderson-Hasselbalch `charge_at_pH`.
    fn biopython_charge_at_ph(seq: &str, ph: f64) -> f64 {
        let s = seq.as_bytes();
        let n = |aa: u8| s.iter().filter(|&&b| b == aa).count() as f64;
        let pk_nterm = match s[0] {
            b'A' => 7.59,
            b'M' => 7.0,
            b'S' => 6.93,
            b'P' => 8.36,
            b'T' => 6.82,
            b'V' => 7.44,
            b'E' => 7.7,
            _ => 7.5,
        };
        let pk_cterm = match s[s.len() - 1] {
            b'D' => 4.55,
            b'E' => 4.75,
            _ => 3.55,
        };
        let pos = |count: f64, pk: f64| count / (10f64.powf(ph - pk) + 1.0);
        let neg = |count: f64, pk: f64| count / (10f64.powf(pk - ph) + 1.0);
        pos(1.0, pk_nterm) + pos(n(b'K'), 10.0) + pos(n(b'R'), 12.0) + pos(n(b'H'), 5.98)
            - neg(1.0, pk_cterm)
            - neg(n(b'D'), 4.05)
            - neg(n(b'E'), 4.45)
            - neg(n(b'C'), 9.0)
            - neg(n(b'Y'), 10.0)
    }

    /// The charge and the pI are two readings of one titration curve, so the charge at the pI is
    /// zero. A charge borrowed from another pKa scale would quietly break that.
    ///
    /// Our report shows the curve at two points only, the pH-7 charge and the pI, so both are
    /// held to Biopython's Bjellqvist curve: the pH-7 charge must lie on it, and the curve must
    /// change sign inside the 0.01 pH the pI is printed to and keep that sign half a unit either
    /// side. The sign test is used rather than |charge(pI)| < 0.01 because the curve is steep at
    /// these roots (Biopython: -12.7 and -7.1 charges per pH unit for Ferredoxin and
    /// lysozyme), so even the exact curve reads +0.018 and +0.027 at the printed 4.49 and 9.32.
    /// The Rodwell or Grimsley scale gives the same pH-7 sign on all three proteins and fails
    /// here (Rodwell: -13.92 for Ferredoxin against -14.09).
    #[test]
    fn the_charge_curve_crosses_zero_at_the_isoelectric_point() {
        // (sequence, Biopython 1.88 `IsoelectricPoint(seq).charge_at_pH(7.0)`)
        for (seq, biopython_charge_ph7) in [
            ("MPKIVILPHQDLCPDGAVLEANSGETILDAALRNGIEIEHACEKSCACTTCHCIVREGFDSLPESSEQEDDMLDKAWGLEPESRLSCQARVTDEDLVVEIPRYTINHAREH", -14.087704),
            ("KVFGRCELAAAMKRHGLDNYRGYSLGNWVCAAKFESNFNTQATNRNTDGSTDYGILQINSRWWCNDGRTPGSRNLCNIPCSALLSSDITASVNCAKKIVSDGNGMNAWVAWRNRCKGTDVQAWIRGCRL", 7.772433),
            ("ACDEFGHIKLMNPQRSTVWY", -0.124929),
        ] {
            let r = analyze_protein_sequence(seq, false, 9);
            // A protein whose pI is below 7 is negatively charged at pH 7, and vice versa.
            if r.isoelectric_point_pi < 7.0 {
                assert!(r.charge_at_ph7 < 0.0, "{seq}: pI {} charge {}", r.isoelectric_point_pi, r.charge_at_ph7);
            } else {
                assert!(r.charge_at_ph7 > 0.0, "{seq}: pI {} charge {}", r.isoelectric_point_pi, r.charge_at_ph7);
            }

            // The transcribed curve is Biopython's own (printed to 6 decimals).
            let q = |ph: f64| biopython_charge_at_ph(seq, ph);
            assert!((q(7.0) - biopython_charge_ph7).abs() < 1e-6, "{seq}: reference curve {}", q(7.0));
            // Our pH-7 charge is a point on that curve, to the 0.01 it is printed to.
            assert!(
                (r.charge_at_ph7 - q(7.0)).abs() <= 0.005 + 1e-9,
                "{seq}: charge {} off the Bjellqvist curve {}",
                r.charge_at_ph7,
                q(7.0)
            );
            // The curve's zero lies within the rounding of our printed pI.
            let pi = r.isoelectric_point_pi;
            assert!(q(pi - 0.005) >= 0.0 && q(pi + 0.005) <= 0.0, "{seq}: no zero crossing at pI {pi}");
            assert!(q(pi - 0.5) > 0.0, "{seq}: charge {} at pI - 0.5", q(pi - 0.5));
            assert!(q(pi + 0.5) < 0.0, "{seq}: charge {} at pI + 0.5", q(pi + 0.5));
        }
    }

    /// Weight, pI, extinction coefficients, instability index and GRAVY against ExPASy
    /// ProtParam: every case's values are the ones
    /// https://web.expasy.org/cgi-bin/protparam/protparam printed for its sequence when queried
    /// with curl on 2026-11-08 (UTC).
    #[test]
    fn mw_pi_extinction_instability_and_gravy_match_expasy() {
        struct Case(&'static str, f64, f64, usize, usize, f64, f64);
        let cases = [
            // GFP, NCBI GenBank AAA27721.1 (238 aa; gfp_case_is_its_ncbi_record checks it)
            Case(GFP_AAA27721_1, 26886.32, 5.67, 21890, 22015, 31.07, -0.521),
            // Hen egg-white lysozyme C (mature, 129 aa)
            Case(
                "KVFGRCELAAAMKRHGLDNYRGYSLGNWVCAAKFESNFNTQATNRNTDGSTDYGILQINSRWWCNDGRTPGSRNLCNIPCSALLSSDITASVNCAKKIVSDGNGMNAWVAWRNRCKGTDVQAWIRGCRL",
                14313.14, 9.32, 37470, 37970, 16.09, -0.472,
            ),
            // Insulin A chain (acidic; Biopython's default pI floor would clip this to 4.05)
            Case("GIVEQCCTSICSLYQLENYCN", 2383.71, 3.79, 2980, 3230, 22.54, 0.214),
            Case("ACDEFGHIKLMNPQRSTVWY", 2395.74, 6.78, 6990, 6990, 84.74, -0.490),
        ];
        for Case(seq, mw, pi, ext_red, ext_cys, instab, gravy) in cases {
            let r = analyze_protein_sequence(seq, false, 9);
            assert!((r.molecular_weight_da - mw).abs() < 0.02, "{seq}: MW {}", r.molecular_weight_da);
            assert!((r.isoelectric_point_pi - pi).abs() < 0.02, "{seq}: pI {}", r.isoelectric_point_pi);
            assert_eq!((r.extinction_coeff280_reduced, r.extinction_coeff280_cystine), (ext_red, ext_cys), "{seq}");
            assert!((r.instability_index - instab).abs() < 0.02, "{seq}: instability {}", r.instability_index);
            assert!((r.gravy_hydropathy - gravy).abs() < 0.01, "{seq}: gravy {}", r.gravy_hydropathy);
        }
    }
}

/// Superposition on synthetic chains whose answer is known by construction: a chain, and a copy
/// of it moved by a known rigid motion with residues deleted, added, substituted, renumbered or
/// jittered. No reference data is read here (the RCSB comparison is
/// `tests/structure_superposition_reference.rs`).
#[cfg(test)]
mod kabsch_tests {
    use super::*;
    use molbiocraft_formats::one_to_three_aa;
    use nalgebra::{Rotation3, Unit};

    /// 40 residues. The block removed below (indices 15..20, `YPCIN`) has different residues on
    /// either side of each of its edges (`Y`/`L` and `F`/`N`), so exactly one gap placement scores
    /// best and the correct pairing is the only optimal one.
    const SEQ: &[u8] = b"MKTLVAGHEDWQRSFYPCINLKEGAVTRWPDHMQSYFCEN";
    const DELETED: std::ops::Range<usize> = 15..20;

    #[derive(Clone)]
    struct Res {
        aa: u8,
        num: i32,
        pos: Vector3<f64>,
    }

    /// An irregular C-alpha trace (a seeded random walk of 3.8 A steps), numbered from 1. A walk
    /// has no screw symmetry, so a wrong pairing cannot be absorbed by some other rigid motion.
    fn chain_of(seq: &[u8], seed: u64) -> Vec<Res> {
        let mut state = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
        let mut next = move || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state >> 11) as f64 / (1u64 << 53) as f64 - 0.5
        };
        let mut pos = Vector3::new(10.0, -4.0, 6.0);
        seq.iter()
            .enumerate()
            .map(|(i, &aa)| {
                pos += Vector3::new(next(), next(), next()).normalize() * 3.8;
                Res { aa, num: i as i32 + 1, pos }
            })
            .collect()
    }

    fn without_deleted(chain: &[Res]) -> Vec<Res> {
        chain.iter().enumerate().filter(|(i, _)| !DELETED.contains(i)).map(|(_, r)| r.clone()).collect()
    }

    /// The rigid motion B is made with: B = Q A + S.
    fn q() -> Matrix3<f64> {
        *Rotation3::from_axis_angle(&Unit::new_normalize(Vector3::new(1.0, 2.0, 3.0)), 1.1).matrix()
    }
    fn s() -> Vector3<f64> {
        Vector3::new(12.5, -7.25, 30.0)
    }

    fn moved(chain: &[Res]) -> Vec<Res> {
        chain.iter().map(|r| Res { pos: q() * r.pos + s(), ..r.clone() }).collect()
    }

    /// Each atom displaced by exactly `amp` in a seeded random direction.
    fn jittered(chain: &[Res], amp: f64, seed: u64) -> Vec<Res> {
        let walk = chain_of(&vec![b'A'; chain.len() + 1], seed);
        chain
            .iter()
            .zip(walk.windows(2))
            .map(|(r, w)| Res { pos: r.pos + (w[1].pos - w[0].pos) * (amp / 3.8), ..r.clone() })
            .collect()
    }

    fn pdb(chains: &[(&str, &[Res])]) -> String {
        let mut out = String::from("HEADER    SYNTHETIC\n");
        let mut serial = 0;
        for (id, residues) in chains {
            for r in *residues {
                serial += 1;
                out.push_str(&format!(
                    "ATOM  {:>5}  CA  {:>3} {}{:>4}    {:>8.3}{:>8.3}{:>8.3}  1.00 20.00           C\n",
                    serial,
                    one_to_three_aa(r.aa),
                    id,
                    r.num,
                    r.pos.x,
                    r.pos.y,
                    r.pos.z
                ));
            }
        }
        out.push_str("END\n");
        out
    }

    /// mmCIF whose label and author chain ids differ, plus a calcium ion (a `HETATM` whose atom is
    /// also named `CA`) filed under author chain `ion_auth` as a non-polymer of its own label chain.
    fn cif(chains: &[(&str, &str, &[Res])], ion_auth: &str) -> String {
        let mut out = String::from(
            "data_SYN\nloop_\n_atom_site.group_PDB\n_atom_site.id\n_atom_site.label_atom_id\n\
             _atom_site.label_comp_id\n_atom_site.label_asym_id\n_atom_site.label_seq_id\n\
             _atom_site.auth_asym_id\n_atom_site.auth_seq_id\n_atom_site.Cartn_x\n\
             _atom_site.Cartn_y\n_atom_site.Cartn_z\n",
        );
        let mut id = 0;
        for (label, auth, residues) in chains {
            for (k, r) in residues.iter().enumerate() {
                id += 1;
                out.push_str(&format!(
                    "ATOM {id} CA {} {label} {} {auth} {} {:.3} {:.3} {:.3}\n",
                    one_to_three_aa(r.aa),
                    k + 1,
                    r.num,
                    r.pos.x,
                    r.pos.y,
                    r.pos.z
                ));
            }
        }
        out.push_str(&format!("HETATM {} CA CA Z . {ion_auth} 901 0.000 0.000 0.000\n", id + 1));
        out
    }

    fn apply(t: &[[f64; 4]; 4], p: &Vector3<f64>) -> Vector3<f64> {
        Vector3::new(
            t[0][0] * p.x + t[0][1] * p.y + t[0][2] * p.z + t[0][3],
            t[1][0] * p.x + t[1][1] * p.y + t[1][2] * p.z + t[1][3],
            t[2][0] * p.x + t[2][1] * p.y + t[2][2] * p.z + t[2][3],
        )
    }

    /// RMSD over the given (A, B) pairs once B is moved by `t`, computed here from scratch.
    fn rmsd_under(t: &[[f64; 4]; 4], pairs: &[(&Res, &Res)]) -> f64 {
        let sum: f64 = pairs.iter().map(|(a, b)| (a.pos - apply(t, &b.pos)).norm_squared()).sum();
        (sum / pairs.len() as f64).sqrt()
    }

    /// The motion that undoes the construction B = Q A + S, as a 4x4 matrix: R = Q^T, t = -Q^T S.
    fn construction_inverse() -> [[f64; 4]; 4] {
        let qt = q().transpose();
        let t = -(qt * s());
        [
            [qt[(0, 0)], qt[(0, 1)], qt[(0, 2)], t.x],
            [qt[(1, 0)], qt[(1, 1)], qt[(1, 2)], t.y],
            [qt[(2, 0)], qt[(2, 1)], qt[(2, 2)], t.z],
            [0.0, 0.0, 0.0, 1.0],
        ]
    }

    fn superpose(a: &str, b: &str) -> PdbStructureAlignmentReport {
        align_pdb_chains_kabsch(a, b, None, None).expect("superposition")
    }

    /// B lacks A's first three residues and an internal block of five, carries four residues A
    /// does not have, and differs from A at two residues it keeps. Pairing by position (the first
    /// min(nA, nB) atoms) misreads every residue after the first gap; pairing by sequence finds
    /// the 32 residues the two share, substituted ones included.
    #[test]
    fn unequal_chains_superpose_on_aligned_residues() {
        let a = chain_of(SEQ, 7);
        let a_shared: Vec<Res> = without_deleted(&a).into_iter().skip(3).collect();
        assert_eq!(a_shared.len(), 32);
        let mut b_shared = a_shared.clone();
        for (num, aa) in [(9, b'K'), (30, b'A')] {
            b_shared.iter_mut().find(|r| r.num == num).unwrap().aa = aa;
        }
        let mut extra = chain_of(b"GWKD", 99);
        for (k, r) in extra.iter_mut().enumerate() {
            r.num = 41 + k as i32;
            r.pos += Vector3::new(25.0, 25.0, 25.0);
        }
        let with_extra = |shared: &[Res]| -> Vec<Res> { shared.iter().chain(extra.iter()).cloned().collect() };

        // An exact rigid copy: the known RMSD is zero, over every shared residue.
        let r = superpose(&pdb(&[("A", &a)]), &pdb(&[("A", &moved(&with_extra(&b_shared)))]));
        assert_eq!((r.atoms_model_a, r.atoms_model_b), (40, 36));
        assert_eq!(r.aligned_residue_pairs, 32);
        assert!(r.rmsd_angstrom <= 0.002, "exact copy RMSD {}", r.rmsd_angstrom);

        // A jittered copy: the RMSD is the root-mean-square over all 32 pairs (not only the 30
        // identical ones), and the superposition is at least as good as the motion the copy was
        // made with.
        let b_noisy = moved(&with_extra(&jittered(&b_shared, 0.6, 5)));
        let r = superpose(&pdb(&[("A", &a)]), &pdb(&[("A", &b_noisy)]));
        assert_eq!(r.aligned_residue_pairs, 32);
        let truth: Vec<(&Res, &Res)> = a_shared.iter().zip(b_noisy.iter()).collect();
        let own = rmsd_under(&r.transformation_matrix, &truth);
        assert!((r.rmsd_angstrom - own).abs() < 0.003, "reported {} vs over all pairs {own}", r.rmsd_angstrom);
        let made_with = rmsd_under(&construction_inverse(), &truth);
        assert!(r.rmsd_angstrom <= made_with + 0.003, "reported {} worse than the construction {made_with}", r.rmsd_angstrom);
        assert!(r.rmsd_angstrom > 0.2, "jitter should leave a real RMSD, got {}", r.rmsd_angstrom);
    }

    /// The same structure numbered from -4 instead of keeping A's numbers pairs the same residues
    /// and gives the same RMSD; numbering plays no part in the pairing. Both RMSDs are the one
    /// over the true pairs, so neither pairing by number (which pairs the renumbered copy's
    /// residue 1 with A's residue 1) nor pairing by position passes.
    #[test]
    fn offset_numbering_does_not_change_rmsd() {
        let a = chain_of(SEQ, 7);
        let b = moved(&jittered(&without_deleted(&a), 0.6, 11));
        let mut renumbered = b.clone();
        for (k, r) in renumbered.iter_mut().enumerate() {
            r.num = k as i32 - 4;
        }
        let pdb_a = pdb(&[("A", &a)]);
        let kept = superpose(&pdb_a, &pdb(&[("A", &b)]));
        let offset = superpose(&pdb_a, &pdb(&[("A", &renumbered)]));
        assert_eq!(kept.aligned_residue_pairs, 35);
        assert_eq!(offset.aligned_residue_pairs, 35);
        assert_eq!(kept.rmsd_angstrom, offset.rmsd_angstrom);
        let a_kept = without_deleted(&a);
        let truth: Vec<(&Res, &Res)> = a_kept.iter().zip(renumbered.iter()).collect();
        let own = rmsd_under(&offset.transformation_matrix, &truth);
        assert!((offset.rmsd_angstrom - own).abs() < 0.003, "reported {} vs over the true pairs {own}", offset.rmsd_angstrom);
        assert!(offset.rmsd_angstrom <= rmsd_under(&construction_inverse(), &truth) + 0.003);
        assert!(kept.rmsd_angstrom > 0.2, "jitter should leave a real RMSD, got {}", kept.rmsd_angstrom);
        let paired = |r: &PdbStructureAlignmentReport| -> Vec<(i32, f64)> {
            r.per_residue_deviations.iter().map(|d| (d.res_seq_a, d.distance_angstrom)).collect()
        };
        assert_eq!(paired(&kept), paired(&offset));
        let d = &offset.per_residue_deviations[15];
        assert_eq!((d.res_seq_a, d.res_seq_b), (21, 11), "A's residue 21 pairs with B's 16th, numbered 11");

        // A against itself numbered 500 higher (and moved): every residue pairs, RMSD 0.
        let shifted: Vec<Res> = moved(&a).into_iter().map(|r| Res { num: r.num + 500, ..r }).collect();
        let r = superpose(&pdb_a, &pdb(&[("A", &shifted)]));
        assert_eq!(r.aligned_residue_pairs, 40);
        assert!(r.rmsd_angstrom <= 0.002, "renumbered self RMSD {}", r.rmsd_angstrom);
    }

    /// The report says how many pairs were used, the alignment that chose them, the identity over
    /// them, the Biopython-scale score, and the method in words.
    #[test]
    fn reports_the_paired_residue_count() {
        let a = chain_of(SEQ, 7);
        let mut b = without_deleted(&a);
        // Three substitutions, far from the gap: residue 5 V->I, 27 T->W, 34 Q->E.
        for (num, aa) in [(5, b'I'), (27, b'W'), (34, b'E')] {
            b.iter_mut().find(|r| r.num == num).unwrap().aa = aa;
        }
        let r = superpose(&pdb(&[("A", &a)]), &pdb(&[("A", &moved(&b))]));

        assert_eq!(r.aligned_residue_pairs, 35);
        assert_eq!(r.aligned_sequence_a, std::str::from_utf8(SEQ).unwrap());
        assert_eq!(r.aligned_sequence_b, "MKTLIAGHEDWQRSF-----LKEGAVWRWPDHMESYFCEN");
        assert_eq!(r.sequence_identity, 0.9143, "32 identical of 35 pairs");

        // Biopython's affine convention: a gap of length k costs open + (k - 1) * extend, so the
        // five-residue gap costs -10 - 4 * 0.5 = -12.
        let pair_score: i32 =
            without_deleted(&a).iter().zip(&b).map(|(x, y)| bio::scores::blosum62(x.aa, y.aa)).sum();
        assert_eq!(r.alignment_score, pair_score as f64 - 12.0);

        for word in ["global", "BLOSUM62", "gap open -10", "extend -0.5", "Kabsch"] {
            assert!(r.pairing_method.contains(word), "method '{}' does not say '{word}'", r.pairing_method);
        }
        let d = &r.per_residue_deviations[15];
        assert_eq!((d.residue_index, d.res_a.as_str(), d.res_seq_a, d.res_seq_b), (16, "LEU", 21, 21));
    }

    /// The 4x4 matrix maps B onto A: x_A = R x_B + t, row-major, last row 0 0 0 1. For a copy made
    /// as B = Q A + S it is R = Q^T, t = -Q^T S.
    #[test]
    fn reports_a_4x4_transformation_matrix() {
        let a = chain_of(SEQ, 7);
        let b = moved(&without_deleted(&a));
        let r = superpose(&pdb(&[("A", &a)]), &pdb(&[("A", &b)]));
        let t = r.transformation_matrix;
        let want = construction_inverse();
        assert_eq!(t[3], [0.0, 0.0, 0.0, 1.0]);
        for i in 0..3 {
            for j in 0..3 {
                assert!((t[i][j] - want[i][j]).abs() < 1e-3, "R[{i}][{j}] {} vs {}", t[i][j], want[i][j]);
                assert!((r.rotation_matrix[i][j] - t[i][j]).abs() < 1e-4, "rotation_matrix is the same rotation");
            }
            assert!((t[i][3] - want[i][3]).abs() < 0.01, "t[{i}] {} vs {}", t[i][3], want[i][3]);
        }
        for (x, y) in without_deleted(&a).iter().zip(&b) {
            assert!((apply(&t, &y.pos) - x.pos).norm() < 0.005, "residue {} not mapped onto A", x.num);
        }
        assert_eq!(r.superimposed_atoms_b.len(), b.len());
        for (atom, y) in r.superimposed_atoms_b.iter().zip(&b) {
            let p = apply(&t, &y.pos);
            assert!((Vector3::new(atom.x, atom.y, atom.z) - p).norm() < 0.003, "superimposed B is B under the matrix");
        }

        // A mirror image is not superposed by a reflection: the matrix stays a rigid motion
        // (det R = +1), so the mirrored copy keeps a real RMSD.
        let mirrored: Vec<Res> = a.iter().map(|r| Res { pos: Vector3::new(-r.pos.x, r.pos.y, r.pos.z), ..r.clone() }).collect();
        let m = superpose(&pdb(&[("A", &a)]), &pdb(&[("A", &mirrored)]));
        let tm = m.transformation_matrix;
        let rot = Matrix3::new(tm[0][0], tm[0][1], tm[0][2], tm[1][0], tm[1][1], tm[1][2], tm[2][0], tm[2][1], tm[2][2]);
        assert!((rot.determinant() - 1.0).abs() < 1e-6, "det R = {}", rot.determinant());
        assert!(m.rmsd_angstrom > 1.0, "a mirror image superposed with RMSD {}", m.rmsd_angstrom);
    }

    /// Structure A holds chains A and B, structure B chains X and Y; B.Y is a moved copy of A.B
    /// lacking five residues, while A.A and B.X share a sequence but not a shape. Naming the chains
    /// superposes the named pair; file order would pair A.A with B.X.
    #[test]
    fn superposes_the_named_chains() {
        let decoy = b"WHPKCEYRGNDLSAVQMFTI";
        let pair_a = chain_of(SEQ, 7);
        let first_a = chain_of(decoy, 21);
        let first_b = moved(&chain_of(decoy, 33));
        let pair_b = moved(&without_deleted(&pair_a));
        let struct_a = pdb(&[("A", &first_a), ("B", &pair_a)]);
        let struct_b = pdb(&[("X", &first_b), ("Y", &pair_b)]);

        let named = align_pdb_chains_kabsch(&struct_a, &struct_b, Some("B"), Some("Y")).unwrap();
        assert_eq!((named.chain_a.as_str(), named.chain_b.as_str()), ("B", "Y"));
        assert_eq!(named.aligned_residue_pairs, 35);
        assert!(named.rmsd_angstrom <= 0.002, "named chains RMSD {}", named.rmsd_angstrom);
        // The whole of each structure is still returned, B moved by the named chains' motion.
        assert_eq!((named.atoms_a.len(), named.superimposed_atoms_b.len()), (60, 55));

        // Without names, each structure's first protein chain is used.
        let default = align_pdb_chains_kabsch(&struct_a, &struct_b, None, None).unwrap();
        assert_eq!((default.chain_a.as_str(), default.chain_b.as_str()), ("A", "X"));
        assert_eq!(default.aligned_residue_pairs, 20);
        assert!(default.rmsd_angstrom > 1.0, "different shapes, RMSD {}", default.rmsd_angstrom);

        // A chain that is not there is an error that names it and the chains that are.
        let err = align_pdb_chains_kabsch(&struct_a, &struct_b, Some("B"), Some("Q")).unwrap_err();
        assert!(err.contains("'Q'") && err.contains("X, Y"), "{err}");

        // mmCIF: a chain is named by its author id (the id a PDB file shows), else by its label
        // id. Here the decoy's label id is "Y", the paired chain's author id, so "Y" must find the
        // author chain first. The chain's first residue, written as a HETATM selenomethionine, is
        // one of its residues; the calcium ion filed under author chain Y (label chain Z) is not
        // a protein chain, so it can neither be named nor listed.
        let plain = cif(&[("Y", "X", &first_b), ("C", "Y", &pair_b)], "Y");
        let cif_b = plain.replace("\nATOM 21 CA MET C 1 Y 1 ", "\nHETATM 21 CA MSE C 1 Y 1 ");
        assert_ne!(cif_b, plain, "the fixture's first residue of chain Y is MET 1");
        for id in ["Y", "C"] {
            let r = align_pdb_chains_kabsch(&struct_a, &cif_b, Some("B"), Some(id)).unwrap();
            assert_eq!(r.chain_b, "Y", "chain named '{id}'");
            assert_eq!(r.aligned_residue_pairs, 35);
            assert_eq!(r.aligned_sequence_b.len(), 40, "the ion joined chain Y, or MSE left it");
            assert!(r.aligned_sequence_b.starts_with('M'), "MSE is chain Y's first residue, coded as its parent Met");
            assert!(r.rmsd_angstrom <= 0.002, "mmCIF chain '{id}' RMSD {}", r.rmsd_angstrom);
        }
        let err = align_pdb_chains_kabsch(&struct_a, &cif_b, Some("B"), Some("Z")).unwrap_err();
        assert!(err.ends_with("(its protein chains: X, Y)"), "{err}");
    }

    // ---- US01M6P2A3 round 2 ----

    /// A legacy PDB `HETATM` record in chain A, element in columns 77-78.
    fn hetatm(serial: usize, name: &str, res: &str, seq: i32, pos: Vector3<f64>, element: &str) -> String {
        format!(
            "HETATM{serial:>5} {name:<4} {res:>3} A{seq:>4}    {:>8.3}{:>8.3}{:>8.3}  1.00 20.00          {element:>2}\n",
            pos.x, pos.y, pos.z
        )
    }

    /// Every methionine of PDB or mmCIF text rewritten as a `HETATM` selenomethionine (`MSE`), as
    /// the wwPDB files a SeMet crystal structure.
    fn as_semet(text: &str) -> String {
        let mut out = String::new();
        for line in text.lines() {
            if line.starts_with("ATOM  ") && line.get(17..20) == Some("MET") {
                out.push_str(&format!("HETATM{}MSE{}", &line[6..17], &line[20..]));
            } else if line.starts_with("ATOM ") && line.contains(" CA MET ") {
                out.push_str(&line.replacen("ATOM ", "HETATM ", 1).replacen(" CA MET ", " CA MSE ", 1));
            } else {
                out.push_str(line);
            }
            out.push('\n');
        }
        out
    }

    /// The Kabsch reflection correction belongs on the axis of the smallest singular value.
    /// Structure A is a near-planar set (a 4 x 2 x 2 grid, 12 x 6 x 1 A, centred on the origin),
    /// B its mirror image through its own plane, moved: B = Q M A + S with M = diag(1, 1, -1).
    /// The cross-covariance is H = Q M diag(320, 144, 4), whose SVD has U = Q M and V = I, so
    /// det(V U^T) = -1 and the best proper rotation is V diag(1, 1, -1) U^T = Q^T: B's mirror
    /// image is put back flat on A, and the RMSD is 2 rms(z) = 1 A. Biopython 1.88
    /// `SVDSuperimposer` on the same 3-decimal coordinates gives 0.99992 A and a rotation within
    /// 5e-5 of Q^T. The correction put on the largest axis would give R = diag(-1, 1, -1) Q^T,
    /// which turns the set over end to end: RMSD 2 rms(x) = 8.94 A.
    #[test]
    fn the_reflection_correction_flips_the_smallest_singular_axis() {
        let seq = b"MKTLVAGHEDWQRSFY";
        let mut grid = Vec::new();
        for x in [-6.0, -2.0, 2.0, 6.0] {
            for y in [-3.0, 3.0] {
                for z in [-0.5, 0.5] {
                    grid.push(Vector3::new(x, y, z));
                }
            }
        }
        let mirror = Matrix3::from_diagonal(&Vector3::new(1.0, 1.0, -1.0));
        let chain = |points: Vec<Vector3<f64>>| -> Vec<Res> {
            seq.iter().zip(points).enumerate().map(|(k, (&aa, pos))| Res { aa, num: k as i32 + 1, pos }).collect()
        };
        let a = chain(grid.clone());
        let b = chain(grid.iter().map(|p| q() * mirror * p + s()).collect());
        let r = superpose(&pdb(&[("A", &a)]), &pdb(&[("A", &b)]));

        assert_eq!(r.aligned_residue_pairs, 16);
        assert!((r.rmsd_angstrom - 1.0).abs() <= 0.001, "RMSD {} where Biopython gives 0.99992", r.rmsd_angstrom);
        let want = construction_inverse();
        for i in 0..3 {
            for j in 0..3 {
                let got = r.transformation_matrix[i][j];
                assert!((got - want[i][j]).abs() < 1e-3, "R[{i}][{j}] {got} vs Q^T {}", want[i][j]);
            }
            assert!((r.transformation_matrix[i][3] - want[i][3]).abs() < 0.01, "t[{i}]");
        }
    }

    /// End gaps cost what inner gaps cost (a global alignment), so a chain that carries ten extra
    /// residues after its first one keeps that first residue paired. A is C + 20 residues; B is
    /// the same C, ten glycines, then the same 20. Pairing the two Cs costs one ten-residue inner
    /// gap (-10 - 9 * 0.5 = -14.5) and scores 105.5; Biopython 1.88 `PairwiseAligner` (global,
    /// BLOSUM62, open -10, extend -0.5) gives that one optimal alignment and score. With B's end
    /// gaps free (a semiglobal alignment, or Biopython with `end_insertion_score = 0`) A's C pairs
    /// with B's last glycine instead, the ten residues before it overhang for nothing, and the
    /// score is 108.0.
    #[test]
    fn end_gaps_are_penalised_like_inner_gaps() {
        let core = b"MKTLVAGHEDWQRSFYPINL";
        let a = chain_of(&[b"C".as_slice(), core].concat(), 7);
        let mut glycines = chain_of(b"GGGGGGGGGG", 41);
        for r in &mut glycines {
            r.pos += Vector3::new(-20.0, 15.0, 5.0);
        }
        let mut b: Vec<Res> = std::iter::once(a[0].clone()).chain(glycines).chain(a[1..].iter().cloned()).collect();
        for (k, r) in b.iter_mut().enumerate() {
            r.num = k as i32 + 1;
        }
        let r = superpose(&pdb(&[("A", &a)]), &pdb(&[("A", &moved(&b))]));

        assert_eq!(r.aligned_sequence_a, "C----------MKTLVAGHEDWQRSFYPINL");
        assert_eq!(r.aligned_sequence_b, "CGGGGGGGGGGMKTLVAGHEDWQRSFYPINL");
        assert_eq!(r.alignment_score, 105.5, "Biopython's global score");
        assert_eq!(r.aligned_residue_pairs, 21);
        let first = &r.per_residue_deviations[0];
        assert_eq!((first.res_seq_a, first.res_seq_b), (1, 1), "A's C pairs with B's first residue, its C");
        assert!(r.rmsd_angstrom <= 0.002, "every pair is a moved copy, RMSD {}", r.rmsd_angstrom);
    }

    /// One selenomethionine chain reads the same from legacy PDB and from mmCIF: the same 40
    /// residues with each `HETATM` `MSE` coded `M` (its parent, as RCSB's canonical sequence codes
    /// it), so it pairs with the methionine chain it was made from at identity 1 and RMSD 0. The
    /// PDB file also holds, in chain A with residue numbers of their own, what is not a residue of
    /// the chain: a haem (`HEM`), a calcium ion whose atom is named `CA` (element `CA`), the same
    /// ion as an `ATOM` record (as molecular-dynamics packages write ions) and a water; the mmCIF
    /// file holds its calcium ion. None of them is read as a residue or a C-alpha atom.
    #[test]
    fn a_semet_chain_reads_the_same_from_pdb_and_mmcif() {
        let a = chain_of(SEQ, 7);
        let b = moved(&a);
        let near = |k: usize| b[k].pos + Vector3::new(1.5, 0.0, 0.0);
        let hets = [
            hetatm(901, "FE", "HEM", 201, near(3), "FE"),
            hetatm(902, " CHA", "HEM", 201, near(4), "C"),
            hetatm(903, " NA", "HEM", 201, near(5), "N"),
            hetatm(904, "CA", "CA", 301, near(10), "CA"),
            hetatm(905, "CA", "CA", 302, near(20), "CA").replacen("HETATM", "ATOM  ", 1),
            hetatm(906, " O", "HOH", 401, near(30), "O"),
            // S-adenosylmethionine: a ligand with a carbon atom named CA, numbered like a residue.
            hetatm(907, " N", "SAM", 501, near(35), "N"),
            hetatm(908, " CA", "SAM", 501, near(36), "C"),
            hetatm(909, " C", "SAM", 501, near(37), "C"),
        ]
        .concat();
        let pdb_b = as_semet(&pdb(&[("A", &b)])).replace("END\n", &format!("{hets}END\n"));
        let cif_b = as_semet(&cif(&[("A", "A", &b)], "A"));
        assert_eq!(pdb_b.matches(" CA  MSE A").count(), 2, "the fixture's two Met are MSE");
        assert_eq!(cif_b.matches(" CA MSE A ").count(), 2, "the fixture's two Met are MSE");

        let methionine = pdb(&[("A", &a)]);
        let seq = std::str::from_utf8(SEQ).unwrap();
        for (text, format) in [(&pdb_b, "PDB"), (&cif_b, "mmCIF")] {
            let r = superpose(&methionine, text);
            assert_eq!(r.aligned_sequence_b, seq, "{format}: MSE reads as M, nothing else joins the chain");
            assert_eq!((r.aligned_residue_pairs, r.sequence_identity), (40, 1.0), "{format}");
            assert!(r.rmsd_angstrom <= 0.002, "{format}: RMSD {}", r.rmsd_angstrom);
            assert_eq!(r.atoms_model_b, 40, "{format}: polymer C-alpha atoms");
            let names: Vec<&str> = r.superimposed_atoms_b.iter().map(|x| x.res_name.as_str()).collect();
            assert_eq!(names.iter().filter(|&&n| n == "MSE").count(), 2, "{format}: {names:?}");
            assert!(names.iter().all(|n| !["CA", "HEM", "HOH", "SAM"].contains(n)), "{format}: {names:?}");
        }
        let r = superpose(&pdb_b, &cif_b);
        assert_eq!((r.aligned_residue_pairs, r.atoms_model_a, r.atoms_model_b), (40, 40, 40));
        assert_eq!(r.aligned_sequence_a, r.aligned_sequence_b);
        assert!(r.rmsd_angstrom <= 0.002, "PDB against mmCIF RMSD {}", r.rmsd_angstrom);
    }

    /// The C-alpha atoms a report counts, moves and scans for contacts are those of polymer
    /// residues: a calcium ion, whose atom is also named `CA`, is none of them, even 1.5 A from a
    /// C-alpha atom where it would make contacts.
    #[test]
    fn a_calcium_ion_is_not_a_c_alpha_atom() {
        let a = chain_of(SEQ, 7);
        let b = moved(&a);
        let ion_at = |text: String, p: Vector3<f64>| {
            text.replace(" 0.000 0.000 0.000\n", &format!(" {:.3} {:.3} {:.3}\n", p.x, p.y, p.z))
        };
        let cif_a = ion_at(cif(&[("A", "A", &a)], "A"), a[10].pos + Vector3::new(1.5, 0.0, 0.0));
        let cif_b = ion_at(cif(&[("A", "A", &b)], "A"), b[10].pos + Vector3::new(1.5, 0.0, 0.0));
        assert!(cif_a.contains("HETATM 41 CA CA Z . A 901 "), "the fixture holds its ion");

        let r = superpose(&cif_a, &cif_b);
        assert_eq!((r.atoms_model_a, r.atoms_model_b), (40, 40));
        assert_eq!((r.atoms_a.len(), r.superimposed_atoms_b.len()), (40, 40));
        assert!(r.atoms_a.iter().chain(&r.superimposed_atoms_b).all(|x| x.res_name != "CA"), "the ion is listed");
        assert!(!r.intra_chain_contacts.is_empty());
        assert!(r.intra_chain_contacts.iter().all(|c| c.res_i < 40 && c.res_j < 40), "a contact with the ion");
        assert!(r.rmsd_angstrom <= 0.002);

        // A structure holding nothing but the ion has an atom named CA but no protein chain.
        let err = align_pdb_chains_kabsch(&cif(&[], "A"), &cif_b, None, None).unwrap_err();
        assert!(err.starts_with("Structure A has no protein chain"), "{err}");
    }

    /// The C-alpha atoms a PDB superposition lists and moves are the PDB C-alpha view's
    /// (`parse_pdb_or_mmcif_ca_coordinates`), field for field: a blank chain column reads as chain
    /// `A`, the file's `HELIX` and `SHEET` records give the secondary structure, and an `ATOM`
    /// residue of unknown type (`UNK`) is a residue, coded `X`.
    #[test]
    fn a_pdb_c_alpha_list_is_the_pdb_c_alpha_view() {
        let a = chain_of(b"MKTLVAGHEDWQRSFYPCINXKEGAVTRWPDHMQSYFCEN", 7);
        let records = |kind: &str, (r1, s1): (&str, i32), (r2, s2): (&str, i32)| match kind {
            "HELIX" => format!("HELIX    1   1 {r1:>3}   {s1:>4}  {r2:>3}   {s2:>4}  1\n"),
            _ => format!("SHEET    1  S1 1 {r1:>3}  {s1:>4}  {r2:>3}  {s2:>4}  0\n"),
        };
        let header = records("HELIX", ("VAL", 5), ("SER", 14)) + &records("SHEET", ("ASN", 20), ("VAL", 26));
        let text = pdb(&[(" ", &a)]).replacen("HEADER    SYNTHETIC\n", &format!("HEADER    SYNTHETIC\n{header}"), 1);
        assert!(text.contains(" CA  UNK  "), "the fixture's residue 21 is UNK in a blank chain");

        let r = superpose(&text, &text);
        assert_eq!(r.chain_a, "A");
        assert_eq!(r.aligned_sequence_a, "MKTLVAGHEDWQRSFYPCINXKEGAVTRWPDHMQSYFCEN");
        let view = serde_json::to_value(parse_pdb_or_mmcif_ca_coordinates(&text)).unwrap();
        assert_eq!(serde_json::to_value(&r.atoms_a).unwrap(), view);
        let ss: String = r.atoms_a.iter().map(|x| x.secondary_structure.as_str()).collect();
        assert_eq!(&ss[4..14], "HHHHHHHHHH", "the declared helix");
        assert_eq!(&ss[19..26], "EEEEEEE", "the declared strand");
    }
}
