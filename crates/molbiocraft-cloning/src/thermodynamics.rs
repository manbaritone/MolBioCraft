// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

use molbiocraft_core::{
    clean_alpha_sequence, format_thousands, reverse_complement_iupac, HistoryTreeNode,
    MoleculeType, PrimerRecord, PrimerThermodynamics, SequenceDocument, SequenceFeature, Topology,
};
use molbiocraft_protein::translate_codon_standard;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrimerMetricsReport {
    pub length: usize,
    pub gc_percent: f64,
    pub tm_c: f64,
    pub delta_g37: f64,
    pub hairpin_delta_g: f64,
    pub self_dimer_delta_g: f64,
    pub gc_clamp3_prime: bool,
    /// Why `tm_c` is no answer (BG-01M6SHQ0): the oligo holds N or another base that is not A, C,
    /// G or T, which primer3-py 2.4.0 `calc_tm` refuses. `tm_c` stays a number, so no reader of it
    /// breaks; this sentence is what a reader shows in its place. Absent for an A/C/G/T oligo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tm_no_answer_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PcrPrimerDesignResult {
    pub forward: PrimerRecord,
    pub reverse: PrimerRecord,
    pub amplicon_seq: String,
    pub amplicon_length: usize,
    /// Why the design differs from the request (region adjusted) or could not be made.
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedPrimerBindingHit {
    pub primer: PrimerRecord,
    pub bind_start: usize,
    pub bind_end: usize,
    pub strand: i8,
    pub mismatches: usize,
    pub effective_tm_c: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutagenesisSimulationResult {
    pub mode: String,
    pub position_bp: usize,
    pub original_subseq: String,
    pub replacement_subseq: String,
    pub codon_change_label: String,
    pub forward_mutagenic_primer: String,
    pub reverse_mutagenic_primer: String,
    pub primer_tm_c: f64,
    pub annealing_temp_c: f64,
    pub mutant_document: SequenceDocument,
    /// Non-empty when the request could not be carried out (the document is then unchanged), or to
    /// name a caveat of a result that was: primer flanks shorter than 15 nt, or a mutagenic primer
    /// holding N, whose `primer_tm_c` and `annealing_temp_c` are then no answer (BG-01M6SHQ0).
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnealedOligoResult {
    #[serde(rename = "topOligo5to3")]
    pub top_oligo_5to3: String,
    #[serde(rename = "bottomOligo5to3")]
    pub bottom_oligo_5to3: String,
    pub left_overhang5_prime: String,
    pub right_overhang5_prime: String,
    pub duplex_length_bp: usize,
    pub tm_duplex_c: f64,
    pub phosphorylated5_prime: bool,
    pub annealed_document: SequenceDocument,
    /// Paired region between the oligos (bp) — the part the Tm refers to.
    #[serde(default)]
    pub paired_length_bp: usize,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LigationRatioRow {
    pub ratio_label: String,
    pub vector_mass_ng: f64,
    pub insert_length_bp: usize,
    pub required_insert_mass_ng: f64,
    pub required_insert_pmol: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnaLigationCalculations {
    pub length_bp: usize,
    pub mw_ds_dna_da: f64,
    pub mw_ss_dna_da: f64,
    pub mw_rna_da: f64,
    pub conc_ng_per_ul: f64,
    pub volume_ul: f64,
    pub total_mass_ng: f64,
    pub pmol_ds_dna: f64,
    pub pmol_ends_linear: f64,
    pub molarity_nanomolar: f64,
    pub copy_number_per_ul: String,
    pub od260_units: f64,
    pub ligation_ratios: Vec<LigationRatioRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecondaryStructureStemLoop {
    pub id: String,
    pub stem_start5: usize,
    pub stem_end5: usize,
    pub loop_start: usize,
    pub loop_end: usize,
    pub stem_start3: usize,
    pub stem_end3: usize,
    pub stem_length_bp: usize,
    pub loop_length_nt: usize,
    #[serde(rename = "deltaGKcalMol")]
    pub delta_g_kcal_mol: f64,
    pub top_stem_seq: String,
    pub loop_seq: String,
    pub bottom_stem_seq: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecondaryStructureReport {
    pub molecule_type: String,
    pub length_nt: usize,
    pub dot_bracket: String,
    pub minimum_free_energy_kcal_mol: f64,
    pub paired_bases_count: usize,
    pub paired_pct: f64,
    pub stem_loops: Vec<SecondaryStructureStemLoop>,
    /// The folding temperature the energies were taken at, in degrees Celsius.
    pub temperature_c: f64,
    /// Whether helix ends were given the terminal-mismatch energy of their neighbours
    /// (`RNAfold` default `-d2`) or nothing at all (`-d0`).
    pub dangling_ends: bool,
    /// Whether the molecule was folded as a closed circle, so that the loop outside the
    /// outermost helices wraps the origin rather than hanging open at both ends.
    pub circular: bool,
    /// −RT ln Q over every structure the molecule can adopt, at or below the MFE: how much
    /// better the whole ensemble is than its single best member.
    pub ensemble_free_energy_kcal_mol: f64,
    /// The share of the ensemble that is the MFE structure exactly.
    pub mfe_frequency: f64,
    /// Mean base-pair distance between two structures drawn from the ensemble: zero for a
    /// molecule with one way to fold, large for one with many.
    pub ensemble_diversity: f64,
    /// How many structures were drawn to estimate the diversity.
    pub sampled_structures: usize,
    /// What the fold left out of its input (D0005), one plain sentence per event: the fold cap
    /// cutting the sequence. Always serialised, as an empty list when the whole sequence was folded.
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[inline]
fn round_to(val: f64, decimals: u32) -> f64 {
    let factor = 10f64.powi(decimals as i32);
    (val * factor).round() / factor
}

/// Unified SantaLucia (1998/2004) Nearest-Neighbor dinucleotide $(\Delta H^\circ, \Delta S^\circ)$ parameters
/// in $(\text{kcal/mol}, \text{cal/(mol}\cdot\text{K)})$.
#[inline]
fn santalucia_nn_step(b1: u8, b2: u8) -> (f64, f64) {
    match (b1, b2) {
        (b'A', b'A') | (b'T', b'T') => (-7.9, -22.2),
        (b'A', b'T') => (-7.2, -20.4),
        (b'T', b'A') => (-7.2, -21.3),
        (b'C', b'A') | (b'T', b'G') => (-8.5, -22.7),
        (b'G', b'T') | (b'A', b'C') => (-8.4, -22.4),
        (b'C', b'T') | (b'A', b'G') => (-7.8, -21.0),
        (b'G', b'A') | (b'T', b'C') => (-8.2, -22.2),
        (b'C', b'G') => (-10.6, -27.2),
        (b'G', b'C') => (-9.8, -24.4),
        (b'G', b'G') | (b'C', b'C') => (-8.0, -19.9),
        _ => (-7.8, -21.5),
    }
}

/// The one sentence a Tm reader shows in place of a Tm for a span or oligo holding `ambiguity_bases`
/// bases that are not A, C, G or T (BG-01M6SHQ0). The app's TypeScript readouts write the same words
/// (`tmNoAnswerSentence`, src/core/bioEngine.ts), so a reader shows one reason wherever it reads it.
pub fn tm_no_answer_reason(ambiguity_bases: usize) -> String {
    format!(
        "Tm n/a: the span holds {} N or other ambiguity base{}; Tm is computed on A/C/G/T only, as Primer3 does",
        format_thousands(ambiguity_bases),
        if ambiguity_bases == 1 { "" } else { "s" }
    )
}

/// The no-answer reason for an oligo already read as `calculate_primer_metrics` reads it (letters
/// only, upper case, U as T): set when any base is not A, C, G or T, None otherwise.
fn tm_no_answer_reason_of(cleaned: &[u8]) -> Option<String> {
    let ambiguity_bases = cleaned.iter().filter(|b| !matches!(b, b'A' | b'C' | b'G' | b'T')).count();
    (ambiguity_bases > 0).then(|| tm_no_answer_reason(ambiguity_bases))
}

/// SantaLucia (1998) nearest-neighbour oligonucleotide Tm as Primer3 computes it (SantaLucia salt
/// correction, von Ahsen Mg2+ equivalence), self-dimer $\Delta G^\circ_{37}$ and intramolecular
/// hairpin $\Delta G^\circ_{37}$. The Tm is Primer3's on an A/C/G/T oligo only: one holding N or
/// another ambiguity base, in either case, has none (primer3-py 2.4.0 `calc_tm` raises ValueError
/// for any base but A, C, G and T), so the report carries `tm_no_answer_reason` beside a `tm_c` that
/// stays a number (BG-01M6SHQ0). Biopython 1.88 is not the reference here: `Tm_NN` drops the bases
/// it cannot read, even with strict, and answers, and `Tm_GC(strict=True)` refuses N, R, Y and the
/// other codes that leave GC unknown but answers for S and W.
pub fn calculate_primer_metrics(
    raw_primer_seq: &str,
    na_mm: f64,
    mg_mm: f64,
    primer_nm: f64,
) -> PrimerMetricsReport {
    let s = clean_alpha_sequence(raw_primer_seq).replace('U', "T");
    let bytes = s.as_bytes();
    let n = bytes.len();
    let tm_no_answer_reason = tm_no_answer_reason_of(bytes);
    if n < 6 {
        return PrimerMetricsReport {
            length: n,
            gc_percent: 0.0,
            tm_c: 0.0,
            delta_g37: 0.0,
            hairpin_delta_g: 0.0,
            self_dimer_delta_g: 0.0,
            gc_clamp3_prime: false,
            tm_no_answer_reason,
        };
    }

    // SantaLucia (2004) terminal AT vs GC initiation corrections
    let mut dh = 0.0f64;
    let mut ds = 0.0f64;
    for &term in &[bytes[0], bytes[n - 1]] {
        if term == b'G' || term == b'C' {
            dh += 0.1;
            ds += -2.8;
        } else {
            dh += 2.3;
            ds += 4.1;
        }
    }

    let mut gc_count = 0usize;
    for i in 0..n {
        if bytes[i] == b'G' || bytes[i] == b'C' {
            gc_count += 1;
        }
        if i + 1 < n {
            let (step_h, step_s) = santalucia_nn_step(bytes[i], bytes[i + 1]);
            dh += step_h;
            ds += step_s;
        }
    }

    let f_gc = (gc_count as f64) / (n as f64);
    let r_gas = 1.9872;
    let c_molar = (primer_nm.max(1.0)) * 1e-9;
    // Primer3 default: SantaLucia (1998) unified nearest-neighbour parameters, the
    // SantaLucia (1998) entropy salt correction and the von Ahsen et al. (2001) divalent-cation
    // equivalence [Na+]eq = [Na+] + 120·√[Mg2+] (dNTP 0). Checked against primer3.calc_tm.
    let mono_equiv = ((na_mm + 120.0 * mg_mm.max(0.0).sqrt()) / 1000.0).max(0.001);
    let ds_salt_37 = ds + 0.368 * ((n - 1) as f64) * mono_equiv.ln();
    let self_complementary = reverse_complement_iupac(&s, false) == s;
    let (ds_tm, ct) = if self_complementary { (ds_salt_37 - 1.4, c_molar) } else { (ds_salt_37, c_molar / 4.0) };
    let tm_kelvin = dh * 1000.0 / (ds_tm + r_gas * ct.ln());
    let delta_g37 = dh - (310.15 * ds_salt_37) / 1000.0;
    // SantaLucia (1998) salt correction of ΔG per nearest-neighbour step, used for dimers/hairpins:
    // ΔG°37(salt) = ΔG°37(1 M) − 0.114 · ln[Na+eq] per phosphate (von Ahsen Na+ equivalent).
    let salt_dg_per_step = -0.114 * mono_equiv.ln();

    // Antiparallel self-dimer & intramolecular stem-loop thermodynamic scan
    let rc = reverse_complement_iupac(&s, false);
    let rc_bytes = rc.as_bytes();
    let n_i = n as isize;
    let mut best_dimer_dg = 0.0f64;

    for shift in (-n_i + 3)..=(n_i - 3) {
        let mut idx = 0usize;
        while idx < n {
            let j_i = (idx as isize) + shift;
            if j_i >= 0 && (j_i as usize) < n && bytes[idx] == rc_bytes[j_i as usize] {
                let run_start = idx;
                while idx < n {
                    let jj = (idx as isize) + shift;
                    if jj >= 0 && (jj as usize) < n && bytes[idx] == rc_bytes[jj as usize] {
                        idx += 1;
                    } else {
                        break;
                    }
                }
                let run_len = idx - run_start;
                if run_len >= 2 {
                    let mut seg_dg = 1.96 + salt_dg_per_step * (run_len - 1) as f64; // initiation + salt
                    for k in run_start..(idx - 1) {
                        let (sh, ss) = santalucia_nn_step(bytes[k], bytes[k + 1]);
                        seg_dg += sh - (310.15 * ss) / 1000.0;
                    }
                    if seg_dg < best_dimer_dg {
                        best_dimer_dg = seg_dg;
                    }
                }
            } else {
                idx += 1;
            }
        }
    }

    // Intramolecular hairpin scan (loop >= 3 nt)
    let mut best_hairpin_dg = 0.0f64;
    if n >= 9 {
        for i in 0..(n - 7) {
            for j in (i + 6)..n {
                let mut stem = 0usize;
                while i + stem + 3 < j.saturating_sub(stem)
                    && bytes[i + stem] == complement_dna_byte(bytes[j - stem])
                {
                    stem += 1;
                }
                if stem >= 3 {
                    let loop_len = (j - stem) - (i + stem) + 1;
                    let loop_pen = 3.5 + 1.75 * r_gas * 0.31015 * ((loop_len as f64) / 4.0).ln().max(0.0);
                    let mut h_dg = loop_pen + salt_dg_per_step * (stem - 1) as f64;
                    for k in 0..(stem - 1) {
                        let (sh, ss) = santalucia_nn_step(bytes[i + k], bytes[i + k + 1]);
                        h_dg += sh - (310.15 * ss) / 1000.0;
                    }
                    if h_dg < best_hairpin_dg {
                        best_hairpin_dg = h_dg;
                    }
                }
            }
        }
    }

    let last = bytes[n - 1];
    let gc_clamp = last == b'G' || last == b'C';

    PrimerMetricsReport {
        length: n,
        gc_percent: round_to(f_gc * 100.0, 1),
        tm_c: round_to(tm_kelvin - 273.15, 1),
        delta_g37: round_to(delta_g37, 2),
        hairpin_delta_g: round_to(best_hairpin_dg, 2),
        self_dimer_delta_g: round_to(best_dimer_dg, 2),
        gc_clamp3_prime: gc_clamp,
        tm_no_answer_reason,
    }
}

/// Computes full SantaLucia (2004) + Owczarzy (2008) nearest-neighbor primer thermodynamics
/// including exact dinucleotide enthalpy ($\Delta H^\circ$) and salt-adjusted entropy ($\Delta S^\circ$).
pub fn calculate_primer_thermodynamics_santalucia(
    raw_primer_seq: &str,
    na_mm: f64,
    mg_mm: f64,
    primer_nm: f64,
) -> PrimerThermodynamics {
    let cleaned = clean_alpha_sequence(raw_primer_seq).replace('U', "T");
    let bytes = cleaned.as_bytes();
    let n = bytes.len();
    let rep = calculate_primer_metrics(&cleaned, na_mm, mg_mm, primer_nm);
    if n < 2 {
        return PrimerThermodynamics {
            sequence: cleaned,
            length: n,
            gc_percent: rep.gc_percent,
            delta_h_kcal: 0.0,
            delta_s_cal: 0.0,
            delta_g_37_kcal: 0.0,
            tm_salt_corrected_c: 0.0,
            hairpin_dg_kcal: 0.0,
            self_dimer_dg_kcal: 0.0,
            gc_clamp_3prime: rep.gc_clamp3_prime,
        };
    }

    let mut dh = 0.0_f64;
    let mut ds = 0.0_f64;
    for &term in &[bytes[0], bytes[n - 1]] {
        if term == b'G' || term == b'C' {
            dh += 0.1;
            ds += -2.8;
        } else {
            dh += 2.3;
            ds += 4.1;
        }
    }
    for i in 0..(n - 1) {
        let (sh, ss) = santalucia_nn_step(bytes[i], bytes[i + 1]);
        dh += sh;
        ds += ss;
    }
    let mono_equiv = ((na_mm.max(1.0) + 120.0 * mg_mm.max(0.0).sqrt()) / 1000.0).max(0.001);
    let ds_salt = ds + 0.368 * ((n - 1) as f64) * mono_equiv.ln();

    PrimerThermodynamics {
        sequence: cleaned,
        length: rep.length,
        gc_percent: rep.gc_percent,
        delta_h_kcal: round_to(dh, 2),
        delta_s_cal: round_to(ds_salt, 2),
        delta_g_37_kcal: rep.delta_g37,
        tm_salt_corrected_c: rep.tm_c,
        hairpin_dg_kcal: rep.hairpin_delta_g,
        self_dimer_dg_kcal: rep.self_dimer_delta_g,
        gc_clamp_3prime: rep.gc_clamp3_prime,
    }
}

#[inline]
fn complement_dna_byte(b: u8) -> u8 {
    match b {
        b'A' => b'T',
        b'T' | b'U' => b'A',
        b'G' => b'C',
        b'C' => b'G',
        _ => b'N',
    }
}

/// Automatically design optimal Forward & Reverse PCR primers for a target region,
/// balancing $\Delta T_m$, 3' GC clamp, hairpin/dimer penalties, and optional 5' restriction/homology tails.
pub fn design_pcr_primers(
    doc: &SequenceDocument,
    region_start: usize,
    region_end: usize,
    target_tm_c: f64,
    fwd_tail5_prime: &str,
    rev_tail5_prime: &str,
) -> PcrPrimerDesignResult {
    design_pcr_primers_with_slack(doc, region_start, region_end, target_tm_c, fwd_tail5_prime, rev_tail5_prime, 0)
}

/// Like [`design_pcr_primers`], but each primer may start up to `position_slack_bp` bases
/// *outside* the region (the product still contains the whole region) when that brings its
/// Tm closer to the target. With 0 the primers sit exactly at the region ends.
pub fn design_pcr_primers_with_slack(
    doc: &SequenceDocument,
    region_start: usize,
    region_end: usize,
    target_tm_c: f64,
    fwd_tail5_prime: &str,
    rev_tail5_prime: &str,
    position_slack_bp: usize,
) -> PcrPrimerDesignResult {
    let s = clean_alpha_sequence(&doc.sequence).replace('U', "T");
    let seq_len = s.len();
    const MIN_AMPLICON: usize = 34; // two 17-nt primers
    let mut warnings = Vec::new();
    if seq_len < MIN_AMPLICON {
        return PcrPrimerDesignResult {
            forward: PrimerRecord::default(),
            reverse: PrimerRecord::default(),
            amplicon_seq: String::new(),
            amplicon_length: 0,
            warnings: vec![format!(
                "The template is {seq_len} bp; at least {MIN_AMPLICON} bp are needed for a primer pair."
            )],
        };
    }

    let start_idx = region_start.saturating_sub(1).min(seq_len - MIN_AMPLICON);
    let end_idx = region_end.max(start_idx + MIN_AMPLICON).min(seq_len);
    if start_idx + 1 != region_start.max(1) || end_idx != region_end {
        warnings.push(format!(
            "Region {}–{} was adjusted to {}–{} (amplicon ≥ {MIN_AMPLICON} bp, within the {seq_len}-bp template).",
            region_start,
            region_end,
            start_idx + 1,
            end_idx
        ));
    }
    let tgt_tm = if target_tm_c <= 10.0 { 60.0 } else { target_tm_c };

    // Each moved base costs a little, so the exact region end wins unless moving helps.
    const SHIFT_COST_PER_BP: f64 = 0.02;
    let score = |cand: &str, shift: usize| {
        let m = calculate_primer_metrics(cand, 50.0, 1.5, 250.0);
        (m.tm_c - tgt_tm).abs()
            + if m.gc_clamp3_prime { 0.0 } else { 1.0 }
            + (m.hairpin_delta_g.abs() * 0.25)
            + (m.self_dimer_delta_g.abs() * 0.15)
            + shift as f64 * SHIFT_COST_PER_BP
    };

    let original_start_idx = start_idx;
    let original_end_idx = end_idx;
    let mut best_fwd_anneal = s[start_idx..(start_idx + 20).min(seq_len)].to_string();
    let mut best_fwd_cost = f64::INFINITY;
    let mut fwd_start = start_idx;
    for shift in 0..=position_slack_bp.min(start_idx) {
        let p = start_idx - shift;
        for len in 17..=28usize {
            if p + len > seq_len {
                break;
            }
            let cand = &s[p..p + len];
            let penalty = score(cand, shift);
            if penalty < best_fwd_cost {
                best_fwd_cost = penalty;
                best_fwd_anneal = cand.to_string();
                fwd_start = p;
            }
        }
    }

    let mut best_rev_anneal =
        reverse_complement_iupac(&s[end_idx.saturating_sub(20)..end_idx], false);
    let mut best_rev_cost = f64::INFINITY;
    let mut rev_end = end_idx;
    for shift in 0..=position_slack_bp.min(seq_len - end_idx) {
        let e = end_idx + shift;
        for len in 17..=28usize {
            if len > e {
                break;
            }
            let cand = reverse_complement_iupac(&s[e - len..e], false);
            let penalty = score(&cand, shift);
            if penalty < best_rev_cost {
                best_rev_cost = penalty;
                best_rev_anneal = cand;
                rev_end = e;
            }
        }
    }
    let start_idx = fwd_start;
    let end_idx = rev_end;
    if start_idx != original_start_idx {
        warnings.push(format!(
            "The forward primer starts {} bp before the region to get closer to the {tgt_tm:.1} °C target.",
            original_start_idx - start_idx
        ));
    }
    if end_idx != original_end_idx {
        warnings.push(format!(
            "The reverse primer starts {} bp after the region to get closer to the {tgt_tm:.1} °C target.",
            end_idx - original_end_idx
        ));
    }

    let clean_fwd_tail = clean_alpha_sequence(fwd_tail5_prime).replace('U', "T");
    let clean_rev_tail = clean_alpha_sequence(rev_tail5_prime).replace('U', "T");
    let full_fwd_seq = format!("{}{}", clean_fwd_tail, best_fwd_anneal);
    let full_rev_seq = format!("{}{}", clean_rev_tail, best_rev_anneal);

    let fwd_anneal_m = calculate_primer_metrics(&best_fwd_anneal, 50.0, 1.5, 250.0);
    let fwd_full_m = calculate_primer_metrics(&full_fwd_seq, 50.0, 1.5, 250.0);
    let rev_anneal_m = calculate_primer_metrics(&best_rev_anneal, 50.0, 1.5, 250.0);
    let rev_full_m = calculate_primer_metrics(&full_rev_seq, 50.0, 1.5, 250.0);
    for (label, m) in [("Forward", &fwd_anneal_m), ("Reverse", &rev_anneal_m)] {
        // A primer holding N has no Tm to set beside the target (BG-01M6SHQ0).
        if let Some(reason) = &m.tm_no_answer_reason {
            warnings.push(format!("{label} primer: {reason}."));
            continue;
        }
        let tm = m.tm_c;
        if (tm - tgt_tm).abs() > 3.0 {
            warnings.push(format!(
                "{label} primer Tm is {tm:.1} °C, more than 3 °C from the {tgt_tm:.1} °C target{}.",
                if position_slack_bp == 0 { "; allowing the primers to move outward may help" } else { "" }
            ));
        }
    }

    let amplicon_seq = format!(
        "{}{}{}",
        clean_fwd_tail,
        &s[start_idx..end_idx],
        reverse_complement_iupac(&clean_rev_tail, false)
    );
    let amplicon_length = amplicon_seq.len();
    let short_name: String = doc.name.chars().take(12).collect();

    let forward = PrimerRecord {
        id: format!("prm-fwd-{}-{}", start_idx + 1, best_fwd_anneal.len()),
        name: format!("{}_{}_Fwd", short_name, start_idx + 1),
        sequence: full_fwd_seq.clone(),
        anneal_sequence: best_fwd_anneal.clone(),
        tail5_prime: clean_fwd_tail,
        bind_start: start_idx + 1,
        bind_end: start_idx + best_fwd_anneal.len(),
        strand: 1,
        length: full_fwd_seq.len(),
        gc_percent: fwd_full_m.gc_percent,
        tm_anneal_c: fwd_anneal_m.tm_c,
        tm_full_c: fwd_full_m.tm_c,
        delta_g37: fwd_full_m.delta_g37,
        hairpin_delta_g: fwd_full_m.hairpin_delta_g,
        self_dimer_delta_g: fwd_full_m.self_dimer_delta_g,
        gc_clamp3_prime: fwd_anneal_m.gc_clamp3_prime,
        notes: None,
        tm_no_answer_reason: fwd_anneal_m.tm_no_answer_reason.clone(),
    };

    let reverse = PrimerRecord {
        id: format!("prm-rev-{}-{}", end_idx, best_rev_anneal.len()),
        name: format!("{}_{}_Rev", short_name, end_idx),
        sequence: full_rev_seq.clone(),
        anneal_sequence: best_rev_anneal.clone(),
        tail5_prime: clean_rev_tail,
        bind_start: end_idx - best_rev_anneal.len() + 1,
        bind_end: end_idx,
        strand: -1,
        length: full_rev_seq.len(),
        gc_percent: rev_full_m.gc_percent,
        tm_anneal_c: rev_anneal_m.tm_c,
        tm_full_c: rev_full_m.tm_c,
        delta_g37: rev_full_m.delta_g37,
        hairpin_delta_g: rev_full_m.hairpin_delta_g,
        self_dimer_delta_g: rev_full_m.self_dimer_delta_g,
        gc_clamp3_prime: rev_anneal_m.gc_clamp3_prime,
        notes: None,
        tm_no_answer_reason: rev_anneal_m.tm_no_answer_reason.clone(),
    };

    PcrPrimerDesignResult {
        forward,
        reverse,
        amplicon_seq,
        amplicon_length,
        warnings,
    }
}

/// Screen a library of saved primers against a target sequence on both strands,
/// requiring an exact 5-nt 3' pentamer clamp while tolerating up to `max_mismatches` in the 5' body.
pub fn test_saved_primers_on_sequence(
    raw_seq: &str,
    saved_primers: &[PrimerRecord],
    max_mismatches: usize,
) -> Vec<SavedPrimerBindingHit> {
    let s = clean_alpha_sequence(raw_seq).replace('U', "T");
    let seq_len = s.len();
    if seq_len < 12 || saved_primers.is_empty() {
        return Vec::new();
    }
    let rc = reverse_complement_iupac(&s, false);
    let s_bytes = s.as_bytes();
    let rc_bytes = rc.as_bytes();
    let mut hits = Vec::new();

    for prm in saved_primers {
        let raw_oligo = if !prm.anneal_sequence.is_empty() {
            &prm.anneal_sequence
        } else {
            &prm.sequence
        };
        let oligo = clean_alpha_sequence(raw_oligo).replace('U', "T");
        let l = oligo.len();
        if l < 12 || l > seq_len {
            continue;
        }
        let oligo_b = oligo.as_bytes();
        let clamp5 = &oligo_b[l - 5..];
        let metrics = calculate_primer_metrics(&oligo, 50.0, 1.5, 250.0);

        for (target_b, strand) in [(s_bytes, 1i8), (rc_bytes, -1i8)] {
            for start_idx in 0..=(seq_len - l) {
                if &target_b[start_idx + l - 5..start_idx + l] != clamp5 {
                    continue;
                }
                let mut mm = 0usize;
                for k in 0..(l - 5) {
                    if target_b[start_idx + k] != oligo_b[k] {
                        mm += 1;
                        if mm > max_mismatches {
                            break;
                        }
                    }
                }
                if mm <= max_mismatches {
                    let bind_start = if strand == 1 {
                        start_idx + 1
                    } else {
                        seq_len - (start_idx + l) + 1
                    };
                    let bind_end = if strand == 1 {
                        start_idx + l
                    } else {
                        seq_len - start_idx
                    };
                    // The hit's Tm is the oligo's, so the primer carries its reason with it.
                    let mut primer = prm.clone();
                    primer.tm_no_answer_reason = metrics.tm_no_answer_reason.clone();
                    hits.push(SavedPrimerBindingHit {
                        primer,
                        bind_start,
                        bind_end,
                        strand,
                        mismatches: mm,
                        effective_tm_c: round_to(metrics.tm_c - (mm as f64) * 2.4, 1),
                    });
                }
            }
        }
    }

    hits.sort_by_key(|h| h.bind_start);
    hits
}

/// Simulate Primer-Directed Site-Directed Mutagenesis (`Substitution`, `Insertion`, or `Deletion`).
pub fn simulate_site_directed_mutagenesis(
    doc: &SequenceDocument,
    mode: &str,
    position_bp: usize,
    replacement_bases: &str,
    deletion_length_bp: usize,
) -> MutagenesisSimulationResult {
    let s = clean_alpha_sequence(&doc.sequence).replace('U', "T");
    let seq_len = s.len();
    let clean_rep = clean_alpha_sequence(replacement_bases).replace('U', "T");
    let refuse = |msg: String| MutagenesisSimulationResult {
        mode: mode.to_string(),
        position_bp,
        original_subseq: String::new(),
        replacement_subseq: String::new(),
        codon_change_label: String::new(),
        forward_mutagenic_primer: String::new(),
        reverse_mutagenic_primer: String::new(),
        primer_tm_c: 0.0,
        annealing_temp_c: 0.0,
        mutant_document: doc.clone(),
        warnings: vec![msg],
    };
    if position_bp == 0 || position_bp > seq_len {
        return refuse(format!("Position {position_bp} is outside the {seq_len}-bp sequence."));
    }
    if mode != "Deletion" && clean_rep.is_empty() {
        return refuse(format!("{mode} needs the bases to introduce."));
    }
    let pos0 = position_bp - 1;
    let del_len = deletion_length_bp.max(1).min(seq_len - pos0);
    let (new_seq, orig_sub, mut_sub) = match mode {
        "Insertion" => (format!("{}{}{}", &s[..pos0], clean_rep, &s[pos0..]), "-".to_string(), clean_rep.clone()),
        "Deletion" => {
            let end_del = pos0 + del_len;
            (format!("{}{}", &s[..pos0], &s[end_del..]), s[pos0..end_del].to_string(), format!("Δ{del_len}bp"))
        }
        _ => {
            if pos0 + clean_rep.len() > seq_len {
                return refuse(format!(
                    "Replacing {} bases at {position_bp} would run past the end of the sequence.",
                    clean_rep.len()
                ));
            }
            let end_sub = pos0 + clean_rep.len();
            (format!("{}{}{}", &s[..pos0], clean_rep, &s[end_sub..]), s[pos0..end_sub].to_string(), clean_rep.clone())
        }
    };

    // QuikChange-style complementary primers: the change flanked by up to 15 nt on each side.
    let flank_left = &s[pos0.saturating_sub(15)..pos0];
    let right_anchor = match mode {
        "Deletion" => pos0 + del_len,
        "Insertion" => pos0,
        _ => pos0 + clean_rep.len(),
    };
    let flank_right = &s[right_anchor..(right_anchor + 15).min(seq_len)];
    let fwd_primer = if mode == "Deletion" {
        format!("{}{}", flank_left, flank_right)
    } else {
        format!("{}{}{}", flank_left, clean_rep, flank_right)
    };
    let rev_primer = reverse_complement_iupac(&fwd_primer, false);
    let prm_metrics = calculate_primer_metrics(&fwd_primer, 50.0, 1.5, 250.0);
    let mut warnings = Vec::new();
    if flank_left.len() < 15 || flank_right.len() < 15 {
        warnings.push("The change is near a sequence end; the primer flanks are shorter than 15 nt.".into());
    }
    // A primer holding N has no Tm, so neither its Tm nor the annealing temperature drawn from it
    // is an answer (BG-01M6SHQ0).
    if let Some(reason) = &prm_metrics.tm_no_answer_reason {
        warnings.push(format!("Mutagenic primer: {reason}."));
    }
    let primer_tm_text = match &prm_metrics.tm_no_answer_reason {
        Some(reason) => reason.clone(),
        None => format!("Tm = {} °C", prm_metrics.tm_c),
    };

    // Amino-acid change: read the codon in the frame of the CDS that covers the position.
    let cds = doc.features.iter().find(|f| {
        f.feature_type.eq_ignore_ascii_case("CDS") && f.segments.is_none() && f.start <= position_bp && position_bp <= f.end
    });
    let codon_change_label = match (mode, cds) {
        ("Insertion", _) => format!("ins_{}_{} (+{} bp)", position_bp, clean_rep, clean_rep.len()),
        ("Deletion", _) => format!("del_{}_{} (-{} bp)", position_bp, orig_sub, orig_sub.len()),
        (_, Some(f)) => {
            let read = |seq: &str, c0: usize| -> String {
                if f.strand >= 0 {
                    seq.get(c0..c0 + 3).unwrap_or("NNN").to_string()
                } else {
                    reverse_complement_iupac(seq.get(c0..c0 + 3).unwrap_or("NNN"), false)
                }
            };
            let (codon_idx, c0) = if f.strand >= 0 {
                let k = (position_bp - f.start) / 3;
                (k + 1, f.start - 1 + 3 * k)
            } else {
                let k = (f.end - position_bp) / 3;
                (k + 1, f.end - 3 * (k + 1))
            };
            if c0 + 3 > seq_len || c0 + 3 > new_seq.len() {
                format!("g.{position_bp}{orig_sub}>{clean_rep}")
            } else {
                let (wt_codon, mut_codon) = (read(&s, c0), read(&new_seq, c0));
                let (wt_aa, mut_aa) = (translate_codon_standard(&wt_codon), translate_codon_standard(&mut_codon));
                format!("{} {}{}{} ({} → {})", f.name, wt_aa, codon_idx, mut_aa, wt_codon, mut_codon)
            }
        }
        _ => format!("g.{position_bp}{orig_sub}>{clean_rep} (no CDS annotated here)"),
    };
    let mutant_name_tag = codon_change_label.split(' ').nth(1).unwrap_or(mode).to_string();

    let mut mutant_doc = doc.clone();
    mutant_doc.id = format!("doc-sdm-{}-{}", pos0 + 1, new_seq.len());
    mutant_doc.name = if mode == "Substitution" && cds.is_some() {
        format!("{}_{}", doc.name, mutant_name_tag)
    } else {
        format!("{}_{}", doc.name, mode)
    };
    mutant_doc.accession = format!("MBC_SDM_{}", pos0 + 1);
    mutant_doc.description = format!(
        "Site-Directed Mutagenesis ({}) derived from {}.",
        codon_change_label, doc.name
    );
    mutant_doc.sequence = new_seq.clone();
    mutant_doc.updated_at = "2026-10-31T00:00:00Z".to_string();
    mutant_doc.features.push(SequenceFeature {
        id: format!("feat-sdm-{}", pos0 + 1),
        name: format!("SDM: {}", codon_change_label),
        feature_type: "misc_feature".to_string(),
        start: pos0 + 1,
        end: if mode == "Deletion" { (pos0 + 1).min(new_seq.len().max(1)) } else { pos0 + clean_rep.len() },
        strand: 1,
        color: "#f43f5e".to_string(),
        notes: Some(format!(
            "Site-Directed Mutagenesis ({}): {} -> {}",
            mode, orig_sub, mut_sub
        )),
        qualifiers: None,
        segments: None,
        cleavage_site: None,
    });
    mutant_doc.history.push(HistoryTreeNode {
        id: format!("h-sdm-{}", pos0 + 1),
        timestamp: "2026-10-31 00:00".to_string(),
        operation: format!("Site-Directed Mutagenesis ({})", codon_change_label),
        description: format!(
            "{} at position {} bp using mutagenic primer pair ({})",
            mode, position_bp, primer_tm_text
        ),
        parent_ids: vec![doc.id.clone()],
        length_bp: new_seq.len(),
        topology: doc.topology,
        history_color: Some("#f43f5e".to_string()),
        inserted_range: None,
    });

    MutagenesisSimulationResult {
        mode: mode.to_string(),
        position_bp,
        original_subseq: orig_sub,
        replacement_subseq: mut_sub,
        codon_change_label,
        forward_mutagenic_primer: fwd_primer,
        reverse_mutagenic_primer: rev_primer,
        primer_tm_c: prm_metrics.tm_c,
        annealing_temp_c: round_to((prm_metrics.tm_c - 4.0).max(55.0), 1),
        mutant_document: mutant_doc,
        warnings,
    }
}

/// Anneal two complementary single-stranded oligonucleotides with sticky 5' overhangs.
pub fn anneal_complementary_oligos(
    duplex_name: &str,
    top_oligo_5to3: &str,
    bottom_oligo_5to3: &str,
    phosphorylated5_prime: bool,
) -> AnnealedOligoResult {
    let top = clean_alpha_sequence(top_oligo_5to3).replace('U', "T");
    let bot = clean_alpha_sequence(bottom_oligo_5to3).replace('U', "T");
    let mut warnings = Vec::new();
    // Find the register in which the bottom oligo pairs with the top one: slide rc(bottom) along
    // the top strand and keep the longest perfectly complementary overlap (≥ 4 bp).
    let rc_bot = reverse_complement_iupac(&bot, false);
    let (tb, rb) = (top.as_bytes(), rc_bot.as_bytes());
    let (lt, lr) = (tb.len() as isize, rb.len() as isize);
    let mut best: Option<(isize, usize)> = None; // (offset of rc(bottom) on top, overlap)
    for o in (-lr + 1)..lt {
        let (lo, hi) = (o.max(0), (o + lr).min(lt));
        if hi - lo < 4 {
            continue;
        }
        if (lo..hi).all(|k| tb[k as usize] == rb[(k - o) as usize]) {
            let ov = (hi - lo) as usize;
            if best.map_or(true, |(_, b)| ov > b) {
                best = Some((o, ov));
            }
        }
    }
    if top.is_empty() || bot.is_empty() {
        warnings.push("Both oligos are required.".to_string());
    } else if best.is_none() {
        warnings.push("The oligos have no perfectly complementary region of ≥ 4 bp; they will not anneal.".to_string());
    }
    let (o, paired) = best.unwrap_or((0, 0));
    let (left_oh, right_oh, duplex_seq) = if paired > 0 {
        let left = if o > 0 { top[..o as usize].to_string() } else { String::new() };
        let r_end = o + lr;
        let right = if r_end > lt { bot[..(r_end - lt) as usize].to_string() } else { String::new() };
        if o < 0 || r_end < lt {
            warnings.push("At least one end has a 3' overhang.".to_string());
        }
        let prefix = if o < 0 { &rc_bot[..(-o) as usize] } else { "" };
        let suffix = if r_end > lt { &rc_bot[(lt - o) as usize..] } else { "" };
        (left, right, format!("{prefix}{top}{suffix}"))
    } else {
        (String::new(), String::new(), top.clone())
    };
    let paired_seq = if paired > 0 { top[o.max(0) as usize..(o.max(0) as usize + paired)].to_string() } else { String::new() };
    let metrics = calculate_primer_metrics(&paired_seq, 50.0, 1.5, 250.0);
    // A paired region holding N has no duplex Tm (BG-01M6SHQ0).
    if let Some(reason) = &metrics.tm_no_answer_reason {
        warnings.push(format!("Duplex: {reason}."));
    }
    let duplex_tm_text = match &metrics.tm_no_answer_reason {
        Some(reason) => reason.clone(),
        None => format!("Tm = {} °C", metrics.tm_c),
    };
    let safe_name = if duplex_name.trim().is_empty() {
        "Annealed_Oligo_Adapter"
    } else {
        duplex_name.trim()
    };

    let annealed_doc = SequenceDocument {
        id: format!("doc-oligo-{}", duplex_seq.len()),
        name: safe_name.to_string(),
        accession: format!("MBC_OLIGO_{}", duplex_seq.len()),
        description: format!(
            "Annealed synthetic dsDNA oligonucleotide duplex ({} bp, 5' overhangs: {} / {}{}).",
            duplex_seq.len(),
            left_oh,
            right_oh,
            if phosphorylated5_prime {
                ", 5'-Phosphorylated"
            } else {
                ""
            }
        ),
        molecule_type: MoleculeType::DNA,
        topology: Topology::Linear,
        sequence: duplex_seq.clone(),
        features: vec![SequenceFeature {
            id: format!("feat-oligo-{}", duplex_seq.len()),
            name: format!("{} ({}/{})", safe_name, left_oh, right_oh),
            feature_type: "misc_feature".to_string(),
            start: 1,
            end: duplex_seq.len().max(1),
            strand: 1,
            color: "#06b6d4".to_string(),
            notes: Some(format!("Top 5'->3': {} | Bottom 5'->3': {}", top, bot)),
            qualifiers: None,
            segments: None,
            cleavage_site: None,
        }],
        primers: Vec::new(),
        history: vec![HistoryTreeNode {
            id: format!("h-oligo-{}", duplex_seq.len()),
            timestamp: "2026-10-31 00:00".to_string(),
            operation: "Anneal Complementary Oligonucleotides".to_string(),
            description: format!(
                "Annealed {} nt top and {} nt bottom oligos: {} bp paired ({})",
                top.len(),
                bot.len(),
                paired,
                duplex_tm_text
            ),
            parent_ids: Vec::new(),
            length_bp: duplex_seq.len(),
            topology: Topology::Linear,
            history_color: Some("#06b6d4".to_string()),
            inserted_range: None,
        }],
        chromatogram: None,
        alignment_meta: None,
        document_kind: None,
        doc_metadata: Option::<HashMap<String, serde_json::Value>>::None,
        created_at: "2026-10-31T00:00:00Z".to_string(),
        updated_at: "2026-10-31T00:00:00Z".to_string(),
        folder: "Cloning Inserts & PCR".to_string(),
    };

    AnnealedOligoResult {
        top_oligo_5to3: top.clone(),
        bottom_oligo_5to3: bot,
        left_overhang5_prime: left_oh,
        right_overhang5_prime: right_oh,
        duplex_length_bp: duplex_seq.len(),
        tm_duplex_c: metrics.tm_c,
        phosphorylated5_prime,
        annealed_document: annealed_doc,
        paired_length_bp: paired,
        warnings,
    }
}

/// Compute comprehensive dsDNA / ssDNA / RNA molecular weights, molarity, Avogadro copy number,
/// $\text{OD}_{260}$, and stoichiometric vector:insert ligation mass tables.
pub fn compute_dna_and_ligation_calculations(
    length_bp: usize,
    conc_ng_per_ul: f64,
    volume_ul: f64,
    vector_mass_ng: f64,
    insert_length_bp: usize,
) -> DnaLigationCalculations {
    let l = length_bp.max(1);
    let lf = l as f64;
    let ins_l = insert_length_bp.max(1);
    let ins_lf = ins_l as f64;

    let mw_ds_dna_da = round_to(lf * 617.96 + 36.04, 1);
    let mw_ss_dna_da = round_to(lf * 308.98 + 18.02, 1);
    let mw_rna_da = round_to(lf * 321.47 + 18.02, 1);

    let total_mass_ng = round_to(conc_ng_per_ul * volume_ul, 2);
    let pmol_ds_dna = round_to((total_mass_ng * 1000.0) / mw_ds_dna_da, 3);
    let pmol_ends_linear = round_to(pmol_ds_dna * 2.0, 3);
    let molarity_nanomolar = round_to((conc_ng_per_ul * 1e6) / mw_ds_dna_da, 2);
    let copies = ((conc_ng_per_ul * 1e-9) / mw_ds_dna_da) * 6.022_140_76e23;
    let copy_number_per_ul = format!("{:.2e}", copies);
    let od260_units = round_to(conc_ng_per_ul / 50.0, 3);

    let ratios = [
        ("1 : 1 (Equimolar)", 1.0),
        ("1 : 3 (Standard Sticky-End Ligation)", 3.0),
        ("1 : 5 (Blunt-End / Low-Efficiency)", 5.0),
        ("1 : 7 (Short Adapter / Linker)", 7.0),
    ];

    let ins_mw = ins_lf * 617.96 + 36.04;
    let ligation_ratios = ratios
        .iter()
        .map(|(label, mult)| {
            let req_ng = round_to(vector_mass_ng * (ins_lf / lf) * mult, 2);
            let req_pmol = round_to((req_ng * 1000.0) / ins_mw, 3);
            LigationRatioRow {
                ratio_label: (*label).to_string(),
                vector_mass_ng,
                insert_length_bp: ins_l,
                required_insert_mass_ng: req_ng,
                required_insert_pmol: req_pmol,
            }
        })
        .collect();

    DnaLigationCalculations {
        length_bp: l,
        mw_ds_dna_da,
        mw_ss_dna_da,
        mw_rna_da,
        conc_ng_per_ul,
        volume_ul,
        total_mass_ng,
        pmol_ds_dna,
        pmol_ends_linear,
        molarity_nanomolar,
        copy_number_per_ul,
        od260_units,
        ligation_ratios,
    }
}

/// The longest sequence [`predict_secondary_structure_with`] folds whole, in nucleotides.
const FOLD_CAP_NT: usize = 600;

/// Minimum-free-energy secondary structure (Zuker) with the full nearest-neighbour model:
/// Turner 2004 for RNA, Mathews 2004 for DNA, at 37 degrees with ViennaRNA's default dangling
/// ends. Sequences longer than 600 nt are folded over their first 600 nt, and the report's
/// `warnings` says so.
pub fn predict_secondary_structure(raw_seq: &str, molecule_type: &str) -> SecondaryStructureReport {
    predict_secondary_structure_with(raw_seq, molecule_type, 37.0, true, false)
}

/// How many structures the ensemble is sampled with: enough that the diversity settles to about a
/// tenth of a base pair, and cheap beside the partition function itself.
const ENSEMBLE_SAMPLES: usize = 4000;

/// As [`predict_secondary_structure`], folding at `temperature_c` degrees Celsius, with dangling
/// ends on or off, and as a linear molecule or a closed circle — ViennaRNA
/// `RNAfold -T <temperature>`, `-d2` / `-d0` and `-c`.
pub fn predict_secondary_structure_with(
    raw_seq: &str,
    molecule_type: &str,
    temperature_c: f64,
    dangling_ends: bool,
    circular: bool,
) -> SecondaryStructureReport {
    let temperature_c = temperature_c.clamp(-20.0, 120.0);
    let is_rna = !molecule_type.eq_ignore_ascii_case("DNA");
    let mol_label = if is_rna { "RNA" } else { "DNA" };
    let cleaned = clean_alpha_sequence(raw_seq);
    let capped: String = cleaned.chars().take(FOLD_CAP_NT).collect();
    let seq = if is_rna { capped.replace('T', "U") } else { capped.replace('U', "T") };
    let n = seq.len();
    let mut warnings = Vec::new();
    if cleaned.len() > n {
        let (cap, whole) = (format_thousands(n), format_thousands(cleaned.len()));
        let mut w = format!("Folding capped at {cap} nt: only nucleotides 1-{cap} of the {whole}-nt sequence were folded.");
        if circular {
            w.push_str(" They were folded as a linear fragment, not as a circle.");
        }
        warnings.push(w);
    }
    // A molecule folded over only the first 600 nt of a longer sequence is no longer a circle:
    // the ends being joined is exactly what the cap takes away.
    let circular = circular && cleaned.len() == n;
    let (dot_bracket, mfe, partner) =
        crate::nn_fold::mfe_fold_full(&seq, !is_rna, dangling_ends, temperature_c, circular);
    let ensemble = crate::nn_fold::ensemble_fold_full(
        &seq,
        !is_rna,
        dangling_ends,
        temperature_c,
        circular,
        ENSEMBLE_SAMPLES,
    );

    // Extract contiguous elementary hairpin stem-loops from the folded base-pair table
    let mut stem_loops = Vec::new();
    let mut idx = 0usize;
    while idx < n {
        if let Some(j_outer) = partner[idx] {
            if j_outer > idx {
                let mut stem_len = 1usize;
                while idx + stem_len < j_outer.saturating_sub(stem_len)
                    && partner[idx + stem_len] == Some(j_outer - stem_len)
                {
                    stem_len += 1;
                }
                let s5_start = idx;
                let s5_end = idx + stem_len - 1;
                let s3_end = j_outer;
                let s3_start = j_outer + 1 - stem_len;
                let l_start = s5_end + 1;
                let l_end = s3_start.saturating_sub(1);
                let has_inner_pairs = (l_start..=l_end).any(|p| partner[p].is_some());

                if !has_inner_pairs && stem_len >= 3 && l_end >= l_start {
                    let dg = crate::nn_fold::stem_loop_energy_at(
                        &seq, !is_rna, temperature_c, s5_start, s3_end, stem_len,
                    );
                    stem_loops.push(SecondaryStructureStemLoop {
                        id: format!("sl-{}", stem_loops.len() + 1),
                        stem_start5: s5_start + 1,
                        stem_end5: s5_end + 1,
                        loop_start: l_start + 1,
                        loop_end: l_end + 1,
                        stem_start3: s3_start + 1,
                        stem_end3: s3_end + 1,
                        stem_length_bp: stem_len,
                        loop_length_nt: l_end - l_start + 1,
                        delta_g_kcal_mol: round_to(dg, 2),
                        top_stem_seq: seq[s5_start..=s5_end].to_string(),
                        loop_seq: seq[l_start..=l_end].to_string(),
                        bottom_stem_seq: seq[s3_start..=s3_end].to_string(),
                    });
                    idx = s5_end + 1;
                    continue;
                }
            }
        }
        idx += 1;
    }

    let paired_count = partner.iter().filter(|p| p.is_some()).count();
    let total_mfe = round_to(mfe, 2);

    SecondaryStructureReport {
        molecule_type: mol_label.to_string(),
        length_nt: n,
        dot_bracket,
        minimum_free_energy_kcal_mol: total_mfe,
        paired_bases_count: paired_count,
        paired_pct: round_to(((paired_count as f64) / (n as f64)) * 100.0, 1),
        stem_loops,
        temperature_c: round_to(temperature_c, 1),
        dangling_ends,
        circular,
        ensemble_free_energy_kcal_mol: round_to(ensemble.ensemble_free_energy_kcal_mol, 2),
        // Left unrounded: over a few hundred nucleotides the best structure's share of the
        // ensemble runs to 10^-14 and smaller, which rounding to four places would report as zero.
        mfe_frequency: ensemble.mfe_frequency,
        ensemble_diversity: round_to(ensemble.ensemble_diversity, 2),
        sampled_structures: ensemble.sampled_structures,
        warnings,
    }
}

#[cfg(test)]
mod validation_tests {
    use super::*;

    #[test]
    fn tm_matches_primer3_default() {
        // primer3-py 2.3 calc_tm defaults (SantaLucia 1998 table and salt correction, dNTP 0)
        for (seq, na, mg, nm, tm) in [
            ("ATGGTGAGCAAGGGCGAGGAG", 50.0, 1.5, 250.0, 67.69),
            ("AAAATTTTAAAATTTTAAAA", 50.0, 1.5, 250.0, 42.19),
            ("GCTAGCGCGGCCGCGTCGACGG", 50.0, 3.0, 500.0, 79.84),
            ("ATGGTGAGCAAGGGCGAGGAG", 50.0, 0.0, 250.0, 60.72),
            ("GCTAGCGCGGCCGCGTCGACGG", 100.0, 0.0, 50.0, 72.3),
        ] {
            let m = calculate_primer_metrics(seq, na, mg, nm);
            assert!((m.tm_c - tm).abs() <= 0.06, "{seq} {na}/{mg}/{nm}: {} vs {tm}", m.tm_c);
        }
        // Duplex ΔG°37 (primer3 calc_heterodimer with the reverse complement): −25.01
        let m = calculate_primer_metrics("ATGGTGAGCAAGGGCGAGGAG", 50.0, 1.5, 250.0);
        assert!((m.delta_g37 - -25.01).abs() < 0.1);
    }

    #[test]
    fn annealing_finds_the_true_overhangs() {
        // BbsI-style sgRNA oligos: CACC overhang on the top, AAAC on the bottom.
        let r = anneal_complementary_oligos("g", "CACCGTTTTAGAGCTAGAAATAGC", "AAACGCTATTTCTAGCTCTAAAAC", true);
        assert_eq!((r.left_overhang5_prime.as_str(), r.right_overhang5_prime.as_str()), ("CACC", "AAAC"));
        assert_eq!(r.paired_length_bp, 20);
        assert!(r.warnings.is_empty());
        let none = anneal_complementary_oligos("x", "AAAAAAAA", "AAAAAAAA", false);
        assert!(!none.warnings.is_empty());
    }

    #[test]
    fn mutagenesis_uses_the_cds_frame_and_refuses_bad_requests() {
        let mut doc = SequenceDocument {
            id: "d".into(),
            name: "t".into(),
            sequence: "GGGGGATGTACAAATAAGGGGGGGGGGGGGGGGGGG".into(),
            ..serde_json::from_str::<SequenceDocument>(r#"{"id":"x","name":"x","accession":"","description":"","moleculeType":"DNA","topology":"linear","sequence":"","features":[],"primers":[],"history":[],"createdAt":"","updatedAt":"","folder":""}"#).unwrap()
        };
        doc.features.push(SequenceFeature {
            id: "c".into(),
            name: "orf".into(),
            feature_type: "CDS".into(),
            start: 6,
            end: 17,
            strand: 1,
            color: String::new(),
            notes: None,
            qualifiers: None,
            segments: None,
            cleavage_site: None,
        });
        // codon 2 of the CDS (TAC, Tyr) at 9..11 -> CAC (His)
        let r = simulate_site_directed_mutagenesis(&doc, "Substitution", 9, "C", 1);
        assert!(r.codon_change_label.contains("Y2H"), "{}", r.codon_change_label);
        assert_eq!(&r.mutant_document.sequence[8..11], "CAC");
        assert!(!simulate_site_directed_mutagenesis(&doc, "Substitution", 99, "C", 1).warnings.is_empty());
        assert!(!simulate_site_directed_mutagenesis(&doc, "Insertion", 5, "", 1).warnings.is_empty());
    }
}

#[cfg(test)]
mod primer_slack_tests {
    use super::*;

    fn doc(seq: &str) -> SequenceDocument {
        SequenceDocument { name: "t".into(), sequence: seq.into(), ..Default::default() }
    }

    /// A GC-rich region start pushes a fixed-position primer far above the target Tm;
    /// allowing the primer to move outward finds a better site and keeps the region inside.
    #[test]
    fn outward_slack_brings_gc_rich_primers_toward_target_tm() {
        let lead = "ATTGCATACGTTAGCATTAGCTAACGTTAGCATGCATTAGCATTAGCA"; // 48 bp, ~33% GC
        let gc = "GCGGCCGCGGGCCGCGGCGCCGGCGC"; // 26 bp GC-rich region start
        let body: String = "ACGTTGCAATGCTAGCTAGGATCCATGAATTCAGTCAGTA".repeat(8);
        let seq = format!("{lead}{gc}{body}{lead}");
        let d = doc(&seq);
        let start = lead.len() + 1;
        let end = lead.len() + gc.len() + body.len();
        let fixed = design_pcr_primers_with_slack(&d, start, end, 58.0, "", "", 0);
        let slid = design_pcr_primers_with_slack(&d, start, end, 58.0, "", "", 40);
        let miss = |r: &PcrPrimerDesignResult| (r.forward.tm_anneal_c - 58.0).abs();
        assert!(miss(&slid) < miss(&fixed), "fixed {:.1} vs slid {:.1}", fixed.forward.tm_anneal_c, slid.forward.tm_anneal_c);
        assert!(slid.forward.bind_start < start, "forward should move outward");
        assert!(slid.amplicon_seq.contains(&seq[start - 1..end]), "product must contain the region");
        assert!(slid.warnings.iter().any(|w| w.contains("bp before the region")));
        // Default behaviour (no slack) is unchanged: primers sit exactly at the region ends.
        let legacy = design_pcr_primers(&d, start, end, 58.0, "", "");
        assert_eq!(legacy.forward.bind_start, start);
        assert_eq!(legacy.reverse.bind_end, end);
    }
}
