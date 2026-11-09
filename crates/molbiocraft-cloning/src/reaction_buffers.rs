// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Multi-Enzyme Restriction Digest Buffer Compatibility Matrix (`rCutSmart`, `r1.1`, `r2.1`, `r3.1`),
//! Star-Activity & Heat-Inactivation Protocol Planner, Pryor et al. (2020) T4 DNA Ligase 4-nt
//! Golden Gate Overhang Ligation Fidelity Analyzer, Gibson/HiFi Exonuclease Overlap Junction Tm
//! Profiler, and `aho-corasick` Rust Workflow Macro Runner.

use aho_corasick::AhoCorasickBuilder;
use molbiocraft_core::{clean_sequence, reverse_complement_iupac, SequenceDocument};
use rustc_hash::FxHashSet;
use serde::{Deserialize, Serialize};

use crate::thermodynamics::calculate_primer_metrics;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnzymeBufferActivityRow {
    pub enzyme_name: String,
    /// NEB activity in each buffer (%); `None` = not in the built-in table (check the supplier chart).
    pub r_cut_smart_pct: Option<u8>,
    pub buffer_r1_1_pct: Option<u8>,
    pub buffer_r2_1_pct: Option<u8>,
    pub buffer_r3_1_pct: Option<u8>,
    pub optimal_temp_c: u8,
    pub heat_inactivation: String,
    pub star_activity_risk: bool,
    pub methylation_note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiDigestBufferPlan {
    pub enzymes: Vec<EnzymeBufferActivityRow>,
    pub recommended_buffer: String,
    pub minimum_shared_activity_pct: u8,
    pub sequential_digest_required: bool,
    pub incubation_temp_c: u8,
    pub heat_inactivation_summary: String,
    pub protocol_notes: Vec<String>,
}

fn lookup_enzyme_buffer_profile(name: &str) -> EnzymeBufferActivityRow {
    let clean = name.trim();
    let lower = clean.to_ascii_lowercase();
    let is_hf = lower.contains("-hf") || lower.contains("hfv2");

    // NEB activity chart values (rCutSmart, r1.1, r2.1, r3.1) for the enzymes listed explicitly.
    let full = |cs: u8, b1: u8, b2: u8, b3: u8| (Some(cs), Some(b1), Some(b2), Some(b3));
    let ((cs, b1, b2, b3), temp, heat, star, meth) = if lower.starts_with("ecori") && !is_hf {
        (full(100, 25, 100, 50), 37, "65°C for 20 min", true, "Blocked by overlapping CpG methylation")
    } else if lower.starts_with("bamhi") && !is_hf {
        (full(100, 75, 100, 100), 37, "No (Column/Gel Cleanup)", true, "Insensitive to Dam/Dcm")
    } else if lower.starts_with("bglii") {
        (full(10, 10, 10, 100), 37, "No (Column/Gel Cleanup)", false, "Insensitive to Dam/Dcm; requires r3.1 high-salt")
    } else if lower.starts_with("sali") && !is_hf {
        (full(10, 0, 50, 100), 37, "65°C for 20 min", true, "Blocked by CpG; use SalI-HF in rCutSmart")
    } else if lower.starts_with("smai") {
        (full(100, 0, 50, 0), 25, "65°C for 20 min", false, "Incubate at 25°C; blocked by CpG")
    } else if lower.starts_with("dpni") {
        (full(100, 75, 100, 75), 37, "80°C for 20 min", false, "Requires Dam-methylated Gm6ATC template")
    } else if lower.starts_with("noti") && !is_hf {
        (full(25, 0, 50, 100), 37, "65°C for 20 min", false, "Blocked by CpG; NotI-HF active 100% in rCutSmart")
    } else if lower.starts_with("ndei") {
        (full(100, 75, 100, 100), 37, "65°C for 20 min", false, "Insensitive to Dam/Dcm/CpG")
    } else if lower.starts_with("xhoi") {
        (full(100, 75, 100, 100), 37, "65°C for 20 min", false, "Blocked by overlapping CpG methylation")
    } else if lower.starts_with("bsmbi") || lower.starts_with("esp3i") {
        ((None, None, None, Some(100)), 55, "80°C for 20 min", false, "BsmBI-v2: NEBuffer r3.1 at 55°C; blocked by CpG")
    } else if lower.starts_with("bcli") && !is_hf {
        ((None, None, None, None), 50, "No (Column/Gel Cleanup)", false, "Incubate at 50°C; blocked by Dam methylation (GATC)")
    } else if lower.starts_with("hindiii") && !is_hf {
        (full(50, 25, 100, 50), 37, "80°C for 20 min", false, "100% in r2.1; HindIII-HF 100% in rCutSmart")
    } else if is_hf {
        // NEB's HF enzymes are engineered for 100% activity in rCutSmart; other buffers vary.
        ((Some(100), None, None, None), 37, "See supplier (most HF enzymes: 65–80°C, 20 min)", false, "Engineered High-Fidelity (reduced star activity)")
    } else {
        ((None, None, None, None), 37, "See supplier", false, "Not in the built-in activity table — check the supplier's buffer chart")
    };

    EnzymeBufferActivityRow {
        enzyme_name: clean.to_string(),
        r_cut_smart_pct: cs,
        buffer_r1_1_pct: b1,
        buffer_r2_1_pct: b2,
        buffer_r3_1_pct: b3,
        optimal_temp_c: temp,
        heat_inactivation: heat.to_string(),
        star_activity_risk: star,
        methylation_note: meth.to_string(),
    }
}

/// Evaluates double/triple-digest reaction buffer compatibility, temperature conflicts,
/// star-activity glycerol limits, and heat-inactivation feasibility.
pub fn evaluate_multi_digest_buffer_plan(enzyme_names: &[String]) -> MultiDigestBufferPlan {
    let rows: Vec<EnzymeBufferActivityRow> = enzyme_names
        .iter()
        .filter(|s| !s.trim().is_empty())
        .map(|s| lookup_enzyme_buffer_profile(s))
        .collect();

    if rows.is_empty() {
        return MultiDigestBufferPlan {
            enzymes: Vec::new(),
            recommended_buffer: "1× rCutSmart Buffer".into(),
            minimum_shared_activity_pct: 100,
            sequential_digest_required: false,
            incubation_temp_c: 37,
            heat_inactivation_summary: "N/A (Uncut control)".into(),
            protocol_notes: vec!["Select one or more restriction enzymes to compute buffer compatibility.".into()],
        };
    }

    // A buffer can be recommended only when every enzyme's activity in it is known.
    let shared = |f: fn(&EnzymeBufferActivityRow) -> Option<u8>| -> Option<u8> {
        rows.iter().map(f).collect::<Option<Vec<u8>>>().map(|v| v.into_iter().min().unwrap_or(100))
    };
    let candidates: Vec<(&str, u8)> = [
        ("1× rCutSmart Buffer", shared(|r| r.r_cut_smart_pct)),
        ("1× Buffer r2.1", shared(|r| r.buffer_r2_1_pct)),
        ("1× Buffer r3.1", shared(|r| r.buffer_r3_1_pct)),
        ("1× Buffer r1.1", shared(|r| r.buffer_r1_1_pct)),
    ]
    .into_iter()
    .filter_map(|(n, a)| a.map(|a| (n, a)))
    .collect();
    let unknown: Vec<&str> = rows.iter().filter(|r| r.r_cut_smart_pct.is_none()).map(|r| r.enzyme_name.as_str()).collect();

    let (best_buf, min_act) = candidates
        .into_iter()
        .max_by_key(|&(name, act)| (act, name == "1× rCutSmart Buffer"))
        .unwrap_or(("Check the supplier's buffer chart", 0));

    let temps: FxHashSet<u8> = rows.iter().map(|r| r.optimal_temp_c).collect();
    let temp_conflict = temps.len() > 1;
    let sequential = (min_act < 50 && unknown.len() < rows.len()) || temp_conflict;
    let can_heat_kill_all = rows.iter().all(|r| !r.heat_inactivation.starts_with("No"));

    let mut notes = Vec::new();
    if sequential {
        notes.push(format!(
            "Sequential digest or High-Fidelity (-HF) enzyme substitution recommended (shared single-buffer minimum activity = {}%, temperature set = {:?}°C).",
            min_act, temps
        ));
    } else {
        notes.push(format!(
            "Single-tube co-digest in {} at {}°C for 15–60 min achieves ≥{}% cleavage activity for all enzymes.",
            best_buf, rows[0].optimal_temp_c, min_act
        ));
    }
    if !unknown.is_empty() {
        notes.push(format!(
            "No built-in buffer data for {}; the recommendation covers only enzymes with known activities.",
            unknown.join(", ")
        ));
    }
    if rows.iter().any(|r| r.star_activity_risk) {
        notes.push("Keep total enzyme volume ≤10% of reaction volume (glycerol ≤5% v/v) to prevent star activity.".into());
    }

    MultiDigestBufferPlan {
        incubation_temp_c: rows[0].optimal_temp_c,
        recommended_buffer: best_buf.into(),
        minimum_shared_activity_pct: min_act,
        sequential_digest_required: sequential,
        heat_inactivation_summary: if can_heat_kill_all {
            "Heat-inactivate at 65°C–80°C for 20 min".into()
        } else {
            "Spin-column or agarose gel purification required (≥1 enzyme resists heat inactivation)".into()
        },
        enzymes: rows,
        protocol_notes: notes,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldenGateOverhangPairRisk {
    pub overhang_a: String,
    pub overhang_b: String,
    pub issue: String,
    pub mismatch_penalty: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldenGateFidelityReport {
    pub overhangs: Vec<String>,
    pub overall_fidelity_pct: f64,
    pub palindromic_overhangs: Vec<String>,
    pub risky_pairs: Vec<GoldenGateOverhangPairRisk>,
    pub verdict: String,
}

/// Rule-based screen of a 4-nt Golden Gate overhang set. Flags (i) palindromic overhangs, which
/// ligate to themselves; (ii) duplicate or reverse-complement-identical overhangs, which cross-ligate;
/// (iii) pairs whose cognate partners differ by a single mismatch (Potapov et al. 2018 ACS Synth Biol
/// 7:2665 — mismatched, especially G:T, ligation events are concentrated there); (iv) all-A/T
/// overhangs, which ligate inefficiently. No quantitative fidelity is predicted: that requires the
/// measured T4 ligase pairing matrix (Pryor et al. 2020), which is not bundled, so the percentage is
/// reported as not available.
pub fn evaluate_golden_gate_overhang_fidelity(overhangs: &[String]) -> GoldenGateFidelityReport {
    let cleaned: Vec<String> = overhangs.iter().map(|s| clean_sequence(s)).filter(|s| s.len() == 4).collect();
    if cleaned.is_empty() {
        return GoldenGateFidelityReport {
            overhangs: Vec::new(),
            overall_fidelity_pct: f64::NAN,
            palindromic_overhangs: Vec::new(),
            risky_pairs: Vec::new(),
            verdict: "Provide 4-nt 5' overhangs (e.g. GGAG, AATG, GCTT, CGCT) to check the set.".into(),
        };
    }
    let hamming = |a: &str, b: &str| a.bytes().zip(b.bytes()).filter(|(x, y)| x != y).count();
    let mut palindromes = Vec::new();
    let mut risky_pairs = Vec::new();
    for (i, a) in cleaned.iter().enumerate() {
        let rc_a = reverse_complement_iupac(a, false);
        if *a == rc_a {
            palindromes.push(a.clone());
        } else if hamming(a, &rc_a) == 1 {
            risky_pairs.push(GoldenGateOverhangPairRisk {
                overhang_a: a.clone(),
                overhang_b: a.clone(),
                issue: "Near-palindrome: pairs with itself through one mismatch".into(),
                mismatch_penalty: 1.0,
            });
        }
        if a.bytes().all(|b| b == b'A' || b == b'T') {
            risky_pairs.push(GoldenGateOverhangPairRisk {
                overhang_a: a.clone(),
                overhang_b: a.clone(),
                issue: "All A/T: weak, inefficient ligation".into(),
                mismatch_penalty: 0.0,
            });
        }
        for b in cleaned.iter().skip(i + 1) {
            let rc_b = reverse_complement_iupac(b, false);
            if a == b || *a == rc_b {
                risky_pairs.push(GoldenGateOverhangPairRisk {
                    overhang_a: a.clone(),
                    overhang_b: b.clone(),
                    issue: "Identical or reverse-complement overhangs: parts cross-ligate".into(),
                    mismatch_penalty: 0.0,
                });
            } else if hamming(a, &rc_b) == 1 {
                risky_pairs.push(GoldenGateOverhangPairRisk {
                    overhang_a: a.clone(),
                    overhang_b: b.clone(),
                    issue: "One mismatch from complementary: possible mis-ligation".into(),
                    mismatch_penalty: 1.0,
                });
            }
        }
    }
    let n_risk = palindromes.len() + risky_pairs.len();
    let verdict = if n_risk == 0 {
        "No palindromes, duplicates or one-mismatch cross-pairings in this set.".to_string()
    } else {
        format!(
            "{} issue(s) flagged; replace the listed overhangs (rule-based screen — no quantitative fidelity is predicted).",
            n_risk
        )
    };
    GoldenGateFidelityReport {
        overhangs: cleaned,
        overall_fidelity_pct: f64::NAN,
        palindromic_overhangs: palindromes,
        risky_pairs,
        verdict,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GibsonJunctionThermodynamics {
    pub overlap_seq: String,
    pub length_bp: usize,
    pub gc_percent: f64,
    pub tm_c: f64,
    pub hairpin_delta_g: f64,
    pub isothermal_50c_optimal: bool,
    pub recommendation: String,
    /// Why `tm_c` is no answer: the overlap holds N or another ambiguity base (BG-01M6SHQ0). The
    /// junction is then neither optimal nor AT-rich, as both are judged from that Tm.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tm_no_answer_reason: Option<String>,
}

/// Evaluates T5-exonuclease / isothermal 50°C Gibson & HiFi assembly overlap junction thermodynamics.
pub fn analyze_gibson_overlap_junction(overlap_seq: &str) -> GibsonJunctionThermodynamics {
    let clean = clean_sequence(overlap_seq);
    // Gibson isothermal buffer: 10 mM MgCl2; ~50 mM monovalent; tens of nM of each fragment end.
    let pm = calculate_primer_metrics(&clean, 50.0, 10.0, 50.0);
    let has_tm = pm.tm_no_answer_reason.is_none();
    let optimal = has_tm && (18..=45).contains(&pm.length) && pm.tm_c >= 48.0 && pm.hairpin_delta_g > -6.0;
    let rec = if pm.length < 15 {
        "Extend homology overlap to 20–30 bp (Tm ≥ 50°C) for reliable T5 exonuclease single-strand annealing.".into()
    } else if let Some(reason) = &pm.tm_no_answer_reason {
        format!("{reason}. Resolve the ambiguity bases before judging this junction for 50°C isothermal assembly.")
    } else if pm.tm_c < 48.0 {
        "AT-rich junction (Tm < 48°C): extend overlap to 35–40 bp so duplex remains stable at 50°C isothermal incubation.".into()
    } else if pm.hairpin_delta_g <= -6.0 {
        "Strong junction secondary hairpin (ΔG ≤ -6 kcal/mol) may block Phusion polymerase gap-filling.".into()
    } else {
        "Junction meets optimal 50°C isothermal exonuclease-polymerase-ligase assembly criteria.".into()
    };

    GibsonJunctionThermodynamics {
        overlap_seq: clean,
        length_bp: pm.length,
        gc_percent: pm.gc_percent,
        tm_c: pm.tm_c,
        hairpin_delta_g: pm.hairpin_delta_g,
        isothermal_50c_optimal: optimal,
        recommendation: rec,
        tm_no_answer_reason: pm.tm_no_answer_reason,
    }
}

/// Executes built-in bioinformatics workflow macros natively in Rust via `aho-corasick`.
pub fn execute_builtin_rust_workflow_macro(
    macro_id: &str,
    doc: &SequenceDocument,
) -> serde_json::Value {
    let seq = clean_sequence(&doc.sequence);
    match macro_id {
        "js-goldengate-domestication" => {
            let patterns = ["GGTCTC", "GAGACC", "CGTCTC", "GAGACG", "GAAGAC", "GTCTTC"];
            let meta = [
                ("BsaI", "+", "GGTCTG (Silent Leu/Val)"),
                ("BsaI", "-", "GGTCTG (Silent Leu/Val)"),
                ("BsmBI", "+", "CGTCTG (Silent Arg/Leu)"),
                ("BsmBI", "-", "CGTCTG (Silent Arg/Leu)"),
                ("BbsI", "+", "GAGGAC (Silent Glu->Glu)"),
                ("BbsI", "-", "GAGGAC (Silent Glu->Glu)"),
            ];
            let ac = AhoCorasickBuilder::new().build(patterns).unwrap();
            let mut sites = Vec::new();
            for mat in ac.find_overlapping_iter(&seq) {
                let idx = mat.pattern().as_usize();
                let (enz, strand, fix) = meta[idx];
                sites.push(serde_json::json!({
                    "enzyme": enz,
                    "strand": strand,
                    "position": mat.start() + 1,
                    "site": patterns[idx],
                    "recommendation": fix,
                }));
            }
            serde_json::json!({
                "plugin": "Golden Gate Domestication Auditor (Rust Aho-Corasick)",
                "domesticationCompatible": sites.is_empty(),
                "internalIllegalSitesCount": sites.len(),
                "sites": sites,
            })
        }
        "js-kozak-rbs-auditor" => {
            let reports: Vec<_> = doc
                .features
                .iter()
                .filter(|f| f.feature_type == "CDS")
                .map(|cds| {
                    let up_start = cds.start.saturating_sub(16);
                    let up_end = (cds.start + 5).min(seq.len());
                    let leader = if up_start < up_end {
                        &seq[up_start..up_end]
                    } else {
                        ""
                    };
                    let has_sd = leader.contains("AGGAGG")
                        || leader.contains("AGGA")
                        || leader.contains("GGAG");
                    let has_kozak = leader.contains("ACCATGG") || leader.contains("GCCATGG");
                    serde_json::json!({
                        "cdsName": cds.name,
                        "startPosition": cds.start,
                        "upstreamWindow": leader,
                        "shineDalgarnoMatch": if has_sd { "Strong Prokaryotic RBS" } else { "Weak/Absent RBS" },
                        "kozakConsensusMatch": if has_kozak { "Strong Kozak (-3 R / +4 G)" } else { "Standard Initiation" },
                    })
                })
                .collect();
            serde_json::json!({
                "plugin": "Translation Initiation Profiler (Rust Engine)",
                "evaluatedCdsCount": reports.len(),
                "cdsReports": reports,
            })
        }
        "js-jaspar-pssm-tf-scanner" => {
            // The engine scan itself: its best hits across every matrix, at their own
            // coordinates, with the bases it scanned; the warnings describe this output, whose
            // list is the scan's first 15.
            let scan = molbiocraft_core::scan_jaspar_pssm_motifs(&seq, 0.85, None);
            let top_hits: Vec<_> = scan.hits.into_iter().take(15).collect();
            let warnings = molbiocraft_core::hmm_pssm_motifs::pssm_scan_warnings(
                scan.scanned_length_bp,
                scan.sequence_length_bp,
                top_hits.len(),
                scan.total_hits,
            );
            serde_json::json!({
                "plugin": "JASPAR PSSM / PWM Transcription Factor Scanner (rust-bio DNAMotif)",
                "motifsEvaluated": scan.motifs_evaluated,
                "totalHitsFound": scan.total_hits,
                "sequenceLengthBp": scan.sequence_length_bp,
                "scannedLengthBp": scan.scanned_length_bp,
                "topHits": top_hits,
                "warnings": warnings,
            })
        }
        _ => {
            let guides = crate::cloning_crispr::find_crispr_guides(&seq, "SpCas9 (NGG)", 25);
            let top: Vec<_> = guides
                .iter()
                .take(12)
                .map(|g| {
                    serde_json::json!({
                        "position": g.start,
                        "strand": if g.strand == 1 { "+" } else { "-" },
                        "spacer": g.spacer_seq,
                        "pam": g.pam_seq,
                        "gcPercent": format!("{:.0}%", g.gc_percent),
                        "onTargetScore": format!("{}/100", g.on_target_score),
                        "status": if g.spacer_seq.contains("TTTT") {
                            "Avoid (U6 PolIII TTTT stop)"
                        } else if (40.0..=70.0).contains(&g.gc_percent) {
                            "Optimal gRNA"
                        } else {
                            "Suboptimal GC"
                        }
                    })
                })
                .collect();
            serde_json::json!({
                "plugin": "CRISPR-SpCas9 gRNA Scanner (Rust Doench 2016 Engine)",
                "totalCandidatesFound": guides.len(),
                "topGuides": top,
            })
        }
    }
}
