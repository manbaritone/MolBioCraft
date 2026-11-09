// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

pub mod epigenetics_codon_kmer;
pub mod genetic_codes;
pub mod genome_index;
pub mod hmm_pssm_motifs;
pub mod iupac;
pub mod types;

pub use hmm_pssm_motifs::{
    scan_fuzzy_subsequence_simd, scan_jaspar_pssm_motifs, segment_genome_hmm_viterbi,
    HmmGenomeSegmentationReport, HmmStateSegment, PssmMotifHit, PssmMotifScanReport,
    PssmProfileSummary, SimdFuzzySubsequenceHit,
};

pub use epigenetics_codon_kmer::{
    analyze_karlin_dinucleotide_islands, compute_kmer_spectrum,
    profile_epigenetic_methylation_sites, scan_non_b_dna_structures, scan_rho_independent_terminators,
    scan_sigma70_promoters, EpigeneticMethylationSummary, GenomicIslandWindow,
    IntrinsicTerminatorHit, KarlinDinucleotideReport, KmerSpectrumReport, NonBDnaMotifHit,
    ProkaryoticPromoterHit,
};
pub use genome_index::{
    compute_genome_track_overview, find_cpg_islands, find_genomic_repeats,
    query_features_in_viewport, scan_genomic_repeats, scan_microsatellite_strs,
    search_genome_motif_fmindex, slice_genome_viewport, CpGIslandRecord, FmIndexSearchHit,
    GenomeTrackOverview, GenomeViewportSlice, GenomicRepeatHit, GenomicRepeatScan,
    MicrosatelliteStrLocus,
};
pub use iupac::{
    analyze_sequence_composition, clean_alpha_sequence, clean_sequence, complement_sequence,
    compute_sequence_stats_fast, convert_dna_rna, iupac_base_matches, iupac_complement_byte,
    mutate_or_shuffle_sequence, reverse_complement_iupac, reverse_only_sequence,
    MutateShuffleResult, SequenceBaseCounts, SequenceComposition, SplitMix64,
};
pub use types::{
    AlignmentMemberSequence, AlignmentOutput, BatchSequenceItem, BatchSequenceStatsEntry,
    ChromatogramData, DocumentAlignmentMeta, FeatureSegment, HistoryTreeNode, InsertedRange,
    MoleculeType, OrfRecord, PrimerRecord, PrimerThermodynamics, RestrictionCutSite,
    RestrictionEnzyme, SequenceDocument, SequenceFeature, SequenceStats, Topology,
};

use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::PathBuf;

// Register a zero-import deterministic SplitMix64 entropy filler on wasm32-unknown-unknown
// so any transitive crate referencing `getrandom` links with ZERO external JS/WASI imports.
#[cfg(target_arch = "wasm32")]
mod wasm_entropy {
    use core::sync::atomic::{AtomicU64, Ordering};
    static WASM_ENTROPY_COUNTER: AtomicU64 = AtomicU64::new(0xD1B5_4A32_D192_ED03);

    fn custom_wasm_getrandom(dest: &mut [u8]) -> Result<(), getrandom::Error> {
        let mut s = WASM_ENTROPY_COUNTER.fetch_add(0x9E37_79B9_7F4A_7C15, Ordering::Relaxed);
        for chunk in dest.chunks_mut(8) {
            s = s.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut z = s;
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            let bytes = (z ^ (z >> 31)).to_le_bytes();
            for (d, &b) in chunk.iter_mut().zip(bytes.iter()) {
                *d = b;
            }
        }
        Ok(())
    }

    getrandom::register_custom_getrandom!(custom_wasm_getrandom);
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum BioEngineError {
    EmptySequence(String),
    InvalidFilename(String),
    WindowsReservedDeviceName(String),
    PathTooLong(String),
    FileLocked { path: String, attempts: u32 },
    PermissionDenied(String),
    ReadOnlyFilesystem(String),
    ParseFailure(String),
    IoFailure(String),
}

impl fmt::Display for BioEngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BioEngineError::EmptySequence(msg) => write!(f, "[ERR_EMPTY_SEQUENCE] {}", msg),
            BioEngineError::InvalidFilename(msg) => write!(f, "[ERR_INVALID_FILENAME] {}", msg),
            BioEngineError::WindowsReservedDeviceName(msg) => {
                write!(f, "[ERR_WINDOWS_RESERVED_NAME] {}", msg)
            }
            BioEngineError::PathTooLong(msg) => write!(f, "[ERR_PATH_TOO_LONG] {}", msg),
            BioEngineError::FileLocked { path, attempts } => write!(
                f,
                "[ERR_FILE_LOCKED] File '{}' remained locked after {} retries",
                path, attempts
            ),
            BioEngineError::PermissionDenied(msg) => write!(f, "[ERR_PERMISSION_DENIED] {}", msg),
            BioEngineError::ReadOnlyFilesystem(msg) => {
                write!(f, "[ERR_READ_ONLY_FILESYSTEM] {}", msg)
            }
            BioEngineError::ParseFailure(msg) => write!(f, "[ERR_CORRUPT_PACKET] {}", msg),
            BioEngineError::IoFailure(msg) => write!(f, "[ERR_IO_FAILURE] {}", msg),
        }
    }
}

impl std::error::Error for BioEngineError {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformDiagnostics {
    pub os: String,
    pub arch: String,
    pub case_sensitive_fs: bool,
    pub app_support_dir: String,
    pub logs_dir: String,
    pub cache_dir: String,
}

#[cfg(target_os = "macos")]
pub fn resolve_platform_app_support_dir() -> Result<PathBuf, BioEngineError> {
    let home = std::env::var("HOME").map_err(|_| {
        BioEngineError::IoFailure("Unable to read HOME environment variable on macOS".into())
    })?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("org.molbiocraft.desktop"))
}

#[cfg(target_os = "windows")]
pub fn resolve_platform_app_support_dir() -> Result<PathBuf, BioEngineError> {
    let appdata = std::env::var("APPDATA").map_err(|_| {
        BioEngineError::IoFailure("Unable to read APPDATA environment variable on Windows".into())
    })?;
    Ok(PathBuf::from(appdata).join("MolBioCraft"))
}

#[cfg(target_os = "linux")]
pub fn resolve_platform_app_support_dir() -> Result<PathBuf, BioEngineError> {
    if let Ok(xdg_cfg) = std::env::var("XDG_CONFIG_HOME") {
        if !xdg_cfg.trim().is_empty() {
            return Ok(PathBuf::from(xdg_cfg).join("molbiocraft"));
        }
    }
    let home = std::env::var("HOME").map_err(|_| {
        BioEngineError::IoFailure("Unable to read HOME or XDG_CONFIG_HOME on Linux".into())
    })?;
    Ok(PathBuf::from(home).join(".config").join("molbiocraft"))
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub fn resolve_platform_app_support_dir() -> Result<PathBuf, BioEngineError> {
    Ok(PathBuf::from("/workspace/.config/molbiocraft"))
}

pub fn query_platform_diagnostics() -> Result<PlatformDiagnostics, BioEngineError> {
    let support = resolve_platform_app_support_dir()?;
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/user".into());
        let bundle = "org.molbiocraft.desktop";
        return Ok(PlatformDiagnostics {
            os: "macos".into(),
            arch: std::env::consts::ARCH.into(),
            case_sensitive_fs: false,
            app_support_dir: support.display().to_string(),
            logs_dir: PathBuf::from(&home)
                .join("Library/Logs")
                .join(bundle)
                .display()
                .to_string(),
            cache_dir: PathBuf::from(&home)
                .join("Library/Caches")
                .join(bundle)
                .display()
                .to_string(),
        });
    }
    #[cfg(target_os = "windows")]
    {
        let local =
            std::env::var("LOCALAPPDATA").unwrap_or_else(|_| support.display().to_string());
        return Ok(PlatformDiagnostics {
            os: "windows".into(),
            arch: std::env::consts::ARCH.into(),
            case_sensitive_fs: false,
            app_support_dir: support.display().to_string(),
            logs_dir: PathBuf::from(&local)
                .join("MolBioCraft")
                .join("Logs")
                .display()
                .to_string(),
            cache_dir: PathBuf::from(&local)
                .join("MolBioCraft")
                .join("Cache")
                .display()
                .to_string(),
        });
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        return Ok(PlatformDiagnostics {
            os: std::env::consts::OS.into(),
            arch: std::env::consts::ARCH.into(),
            case_sensitive_fs: true,
            app_support_dir: support.display().to_string(),
            logs_dir: "/workspace/.local/state/molbiocraft/logs".into(),
            cache_dir: "/workspace/.cache/molbiocraft".into(),
        });
    }
}

pub fn sanitize_workspace_path(raw_path: &str) -> Result<PathBuf, BioEngineError> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() || trimmed.contains('\0') {
        return Err(BioEngineError::InvalidFilename(
            "File path cannot be empty or contain NUL bytes".into(),
        ));
    }

    let candidate = PathBuf::from(trimmed);
    for comp in candidate.components() {
        if matches!(comp, std::path::Component::ParentDir) {
            return Err(BioEngineError::PermissionDenied(format!(
                "Parent-directory path traversal ('..') is prohibited in Tauri IPC: '{}'",
                trimmed
            )));
        }
    }

    if let Some(stem) = candidate.file_stem().and_then(|s| s.to_str()) {
        let upper = stem.to_ascii_uppercase();
        let is_reserved = matches!(
            upper.as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        );
        if is_reserved {
            return Err(BioEngineError::WindowsReservedDeviceName(format!(
                "Filename '{}' uses a reserved Windows DOS device stem",
                trimmed
            )));
        }
    }

    let normalized_slashes = trimmed.replace('\\', "/");
    let lower = normalized_slashes.to_ascii_lowercase();
    if lower.starts_with("/proc/")
        || lower.starts_with("/sys/")
        || lower.starts_with("/volumes/molbiocraft")
    {
        return Err(BioEngineError::ReadOnlyFilesystem(format!(
            "Target path '{}' resides on a read-only or virtual OS filesystem",
            trimmed
        )));
    }
    if lower.starts_with("/system/")
        || lower.starts_with("/usr/")
        || lower.starts_with("/etc/")
        || lower.starts_with("/sbin/")
        || lower.starts_with("c:/windows")
        || lower.starts_with("c:/program files")
    {
        return Err(BioEngineError::PermissionDenied(format!(
            "Target path '{}' resides inside a protected OS system directory",
            trimmed
        )));
    }

    Ok(candidate)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn atomic_write_with_lock_retry(
    path: &std::path::Path,
    data: &[u8],
) -> Result<(), BioEngineError> {
    use std::fs::{self, OpenOptions};
    use std::io::{self, Write};
    use std::thread;
    use std::time::Duration;

    let parent = path.parent().unwrap_or_else(|| std::path::Path::new("."));
    fs::create_dir_all(parent).map_err(|e| match e.kind() {
        io::ErrorKind::PermissionDenied => BioEngineError::PermissionDenied(format!(
            "Cannot create directory {:?}: {}",
            parent, e
        )),
        _ if e.raw_os_error() == Some(30) => BioEngineError::ReadOnlyFilesystem(format!(
            "Read-only filesystem at {:?}: {}",
            parent, e
        )),
        _ => BioEngineError::IoFailure(e.to_string()),
    })?;

    let tmp_path = path.with_extension("mbc_tmp");
    let max_attempts = 4u32;

    for attempt in 1..=max_attempts {
        let write_and_rename = (|| -> io::Result<()> {
            {
                let mut file = OpenOptions::new()
                    .write(true)
                    .create(true)
                    .truncate(true)
                    .open(&tmp_path)?;
                file.write_all(data)?;
                file.sync_all()?;
            }
            fs::rename(&tmp_path, path)?;
            Ok(())
        })();

        match write_and_rename {
            Ok(()) => return Ok(()),
            Err(e) => {
                let is_locked = matches!(e.raw_os_error(), Some(32) | Some(33))
                    || e.kind() == io::ErrorKind::WouldBlock;
                if is_locked && attempt < max_attempts {
                    thread::sleep(Duration::from_millis(50 * (1 << (attempt - 1))));
                    continue;
                }
                let _ = fs::remove_file(&tmp_path);
                if is_locked {
                    return Err(BioEngineError::FileLocked {
                        path: path.display().to_string(),
                        attempts: attempt,
                    });
                }
                if e.kind() == io::ErrorKind::PermissionDenied {
                    return Err(BioEngineError::PermissionDenied(e.to_string()));
                }
                if e.raw_os_error() == Some(30) {
                    return Err(BioEngineError::ReadOnlyFilesystem(e.to_string()));
                }
                return Err(BioEngineError::IoFailure(e.to_string()));
            }
        }
    }
    Ok(())
}

/// `n` with its digits grouped in threes by commas (`2400` -> `"2,400"`), as a researcher reads a
/// length or a count in a result's `warnings` (D0005).
pub fn format_thousands(n: usize) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (idx, ch) in digits.chars().enumerate() {
        if idx > 0 && (digits.len() - idx).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

pub fn compute_sequence_stats(seq: &str) -> SequenceStats {
    compute_sequence_stats_fast(seq)
}

pub fn reverse_complement(seq: &str) -> String {
    reverse_complement_iupac(seq, false)
}

pub fn compute_batch_sequence_stats(
    items: &[BatchSequenceItem],
) -> Result<Vec<BatchSequenceStatsEntry>, BioEngineError> {
    if items.is_empty() {
        return Err(BioEngineError::EmptySequence(
            "Batch sequence request must contain at least one document".into(),
        ));
    }
    for item in items {
        if item.sequence.trim().is_empty() {
            return Err(BioEngineError::EmptySequence(format!(
                "Document '{}' ({}) contains an empty sequence",
                item.name, item.id
            )));
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        use rayon::prelude::*;
        let results: Vec<BatchSequenceStatsEntry> = items
            .par_iter()
            .map(|item| BatchSequenceStatsEntry {
                id: item.id.clone(),
                name: item.name.clone(),
                stats: compute_sequence_stats_fast(&item.sequence),
            })
            .collect();
        return Ok(results);
    }

    #[cfg(target_arch = "wasm32")]
    {
        let results = items
            .iter()
            .map(|item| BatchSequenceStatsEntry {
                id: item.id.clone(),
                name: item.name.clone(),
                stats: compute_sequence_stats_fast(&item.sequence),
            })
            .collect();
        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_sequence_stats_and_iupac_reverse_complement() {
        let stats = compute_sequence_stats("GAATTCATGGTG");
        assert_eq!(stats.length, 12);
        assert_eq!(reverse_complement("GAATTC"), "GAATTC");
        assert_eq!(reverse_complement("ATGRYSWKM"), "KMWSRYCAT");
    }

    #[test]
    fn indexes_large_genome_with_rust_bio_fmindex_and_interval_tree() {
        let genome = "ATGCGATCGATCGGAATTCATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCTACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTCTTCAAGGACGACGGCAACTACAAGACCCGCGCCGAGGTGAAGTTCGAGGGCGACACCCTGGTGAACCGCATCGAGCTGAAGGGCATCGACTTCAAGGAGGACGGCAACATCCTGGGGCACAAGCTGGAGTACAACTACAACAGCCACAACGTCTATATCATGGCCGACAAGCAGAAGAACGGCATCAAGGTGAACTTCAAGATCCGCCACAACATCGAGGACGGCAGCGTGCAGCTCGCCGACCACTACCAGCAGAACACCCCCATCGGCGACGGCCCCGTGCTGCTGCCCGACAACCACTACCTGAGCACCCAGTCCGCCCTGAGCAAAGACCCCAACGAGAAGCGCGATCACATGGTCCTGCTGGAGTTCGTGACCGCCGCCGGGATCACTCTCGGCATGGACGAGCTGTACAAGTAA";
        let hits = search_genome_motif_fmindex(genome, "GAATTC", true, 20);
        assert!(!hits.is_empty());
        assert_eq!(hits[0].start, 14);

        let feats = vec![
            SequenceFeature {
                id: "f1".into(),
                name: "eGFP_CDS".into(),
                feature_type: "CDS".into(),
                start: 20,
                end: 740,
                strand: 1,
                color: "#10b981".into(),
                notes: None,
                qualifiers: None,
                segments: None,
                cleavage_site: None,
            },
            SequenceFeature {
                id: "f2".into(),
                name: "Upstream_Tag".into(),
                feature_type: "tag".into(),
                start: 1,
                end: 15,
                strand: 1,
                color: "#3b82f6".into(),
                notes: None,
                qualifiers: None,
                segments: None,
                cleavage_site: None,
            },
        ];

        let vp = slice_genome_viewport(genome, &feats, 18, 78, false, false);
        assert_eq!(vp.top_strand.len(), 61);
        assert_eq!(vp.bottom_strand.len(), 61);
        assert_eq!(vp.overlapping_feature_indices, vec![0]);

        let tracks = compute_genome_track_overview(genome, 32);
        assert_eq!(tracks.bin_count, 32);
        assert!(tracks.mean_gc_percent > 55.0);
    }

    /// D0005: the repeat scan reads the first 250,000 bp of a longer sequence, and its result names
    /// the scanned length in `warnings`, with or without hits; a sequence of 250,000 bp written in
    /// 60-bp lines is scanned whole and warns of nothing.
    #[test]
    fn repeat_scan_cap_is_reported_as_a_warning() {
        let mut x = 0x2e9e_a75eu64;
        let mut bases: Vec<u8> = (0..260_000)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                b"ACGT"[(x % 4) as usize]
            })
            .collect();
        // a 30-bp direct repeat inside the scanned 250,000 bp, and one wholly past it
        let arm: Vec<u8> = bases[100_000..100_030].to_vec();
        bases[1_000..1_030].copy_from_slice(&arm);
        bases[2_000..2_030].copy_from_slice(&arm);
        bases[252_000..252_030].copy_from_slice(&arm);
        bases[256_000..256_030].copy_from_slice(&arm);
        let seq = String::from_utf8(bases).unwrap();
        // 60-bp lines, as a FASTA file holds them: more characters than bases
        let lines = |s: &str| -> String { s.as_bytes().chunks(60).map(|l| format!("{}\n", std::str::from_utf8(l).unwrap())).collect() };
        let pair_at = |hits: &[GenomicRepeatHit], gap: usize| hits.iter().any(|h| h.repeat_type == "Direct Repeat" && h.arm2_start_bp - h.arm1_start_bp == gap && h.arm_length_bp >= 30);

        let over = scan_genomic_repeats(&lines(&seq), 20, 80);
        let cut = "Repeat scan covered only the first 250,000 bp of the 260,000-bp sequence; repeats past base 250,000 are not reported.";
        assert_eq!(over.warnings, [cut]);
        assert_eq!((over.scanned_length_bp, over.sequence_length_bp), (250_000, 260_000));
        // the warning is true: the repeat inside the scanned length is found, the one past it is not,
        // though the scan finds it when it is given that stretch
        assert!(pair_at(&over.hits, 1_000), "{:?}", over.hits);
        assert!(over.hits.iter().all(|h| h.arm2_end_bp <= 250_000), "{:?}", over.hits);
        assert!(pair_at(&scan_genomic_repeats(&seq[250_000..], 20, 80).hits, 4_000), "fixture: the repeat past the cap is findable");
        // the RPC op's hits are the scan's hits
        assert_eq!(serde_json::to_value(find_genomic_repeats(&seq, 20, 80)).unwrap(), serde_json::to_value(&over.hits).unwrap());
        // the scan's JSON: these four fields, by these names (BG-01M6S1P2 makes it the RPC reply)
        let json = serde_json::to_value(&over).unwrap();
        let mut keys: Vec<&str> = json.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["hits", "scannedLengthBp", "sequenceLengthBp", "totalHits", "warnings"]);
        assert_eq!(json["warnings"], serde_json::json!([cut]));

        // a scan past the cap that finds nothing still says what it did not read
        let bare = scan_genomic_repeats(&seq, 32, 80);
        assert!(bare.hits.is_empty(), "fixture: no 32-bp repeat: {:?}", bare.hits);
        assert_eq!(bare.warnings, [cut]);

        // 250,000 bp is scanned whole, without a warning, and the JSON carries an empty list
        let at_cap = scan_genomic_repeats(&lines(&seq[..250_000]), 20, 80);
        assert_eq!((at_cap.scanned_length_bp, at_cap.sequence_length_bp), (250_000, 250_000));
        assert!(at_cap.warnings.is_empty(), "{:?}", at_cap.warnings);
        assert_eq!(serde_json::to_value(&at_cap).unwrap()["warnings"], serde_json::json!([]));
    }

    #[test]
    fn groups_digits_in_threes_for_warnings() {
        for (n, text) in [(0, "0"), (7, "7"), (999, "999"), (1000, "1,000"), (2400, "2,400"), (250_000, "250,000"), (1_234_567, "1,234,567")] {
            assert_eq!(format_thousands(n), text, "{n}");
        }
    }

    #[test]
    fn preserves_dinucleotide_composition_in_eulerian_shuffle() {
        let seq = "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAG";
        let res = mutate_or_shuffle_sequence(seq, "shuffle-dinucleotide", 2.0, 42);
        assert_eq!(res.original_length_bp, seq.len());
        assert!(res.dinucleotide_correlation > 0.99);
        assert!((res.gc_original_pct - res.gc_output_pct).abs() < 0.01);
    }

    #[test]
    fn sanitizes_paths_and_runs_parallel_batch_stats() {
        assert!(sanitize_workspace_path("../etc/passwd").is_err());
        assert!(sanitize_workspace_path("CON.gb").is_err());
        assert!(sanitize_workspace_path("/tmp/molbiocraft/pET28a.gb").is_ok());

        let batch = vec![
            BatchSequenceItem {
                id: "1".into(),
                name: "pUC19".into(),
                sequence: "GAATTCATGGTG".into(),
            },
            BatchSequenceItem {
                id: "2".into(),
                name: "eGFP".into(),
                sequence: "ATGGTGAGCAAGGGCGAGGAG".into(),
            },
        ];
        let out = compute_batch_sequence_stats(&batch).unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].stats.length, 12);
    }
}
