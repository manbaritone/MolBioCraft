// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! The genbank_to port's Bakta JSON (US-01M7RCMJ, D0227, D0228, D0240) against genbank_to 0.54's own
//! `--bakta-json` output, run with Biopython 1.88 under Python 3.12.7. The fixture's expected file
//! and its one hand change (the version object) are in `fixtures/genbank_to/README.md`; every other
//! Biopython or 0.54 literal here was computed with that venv on 2026-11-19 and is stated where it
//! is used.

use molbiocraft_core::SequenceDocument;
use molbiocraft_formats::genbank_to::{split_genbank_records, GenbankToOptions};
use molbiocraft_formats::genbank_to_bakta::{
    genbank_to_bakta_json, md5_hex, protein_isoelectric_point, protein_molecular_weight,
};
use molbiocraft_formats::parse_genbank_flatfile;
use serde_json::{json, Value};

const ORACLE: &str = include_str!("fixtures/genbank_to/oracle.gbk");
const BAKTA: &str = include_str!("fixtures/genbank_to/expected/oracle.bakta.json");

const NO_VERSION_WARNING: &str =
    "Record OR000003 has no VERSION line, so its accession is used as its id.";

fn docs(text: &str) -> Vec<SequenceDocument> {
    split_genbank_records(text)
        .iter()
        .map(|r| parse_genbank_flatfile(r, "bakta"))
        .collect()
}

fn opts() -> GenbankToOptions {
    GenbankToOptions::default()
}

fn with_table(t: u32) -> GenbankToOptions {
    GenbankToOptions {
        translation_table: Some(t),
        ..GenbankToOptions::default()
    }
}

fn with_gram(g: char) -> GenbankToOptions {
    GenbankToOptions {
        gram: Some(g),
        ..GenbankToOptions::default()
    }
}

/// The port's Bakta JSON for `text`, parsed, and its warnings.
fn bakta(text: &str, o: &GenbankToOptions) -> (Value, Vec<String>) {
    let out = genbank_to_bakta_json(&docs(text), o).expect("the Bakta JSON is written");
    let v: Value = serde_json::from_str(&out.text).expect("the Bakta JSON parses");
    (v, out.warnings)
}

/// The two Biopython floats AC1 compares within 1e-9; every other value must be equal.
const NEAR: [&str; 2] = ["molecular_weight", "isoelectric_point"];

/// Asserts `got` equals `want` as parsed JSON: the same keys, the same array lengths and the same
/// values (type included, so 1 is not 1.0), except `NEAR`'s keys, which are within 1e-9.
fn assert_same(got: &Value, want: &Value, path: &str) {
    match (got, want) {
        (Value::Object(g), Value::Object(w)) => {
            let gk: Vec<&String> = g.keys().collect();
            let wk: Vec<&String> = w.keys().collect();
            let mut gs = gk.clone();
            let mut ws = wk.clone();
            gs.sort();
            ws.sort();
            assert_eq!(gs, ws, "keys differ at {path}");
            for (k, wv) in w {
                let p = format!("{path}.{k}");
                if NEAR.contains(&k.as_str()) {
                    let (a, b) = (g[k].as_f64().unwrap(), wv.as_f64().unwrap());
                    assert!((a - b).abs() <= 1e-9, "{p}: {a} is not within 1e-9 of {b}");
                } else {
                    assert_same(&g[k], wv, &p);
                }
            }
        }
        (Value::Array(g), Value::Array(w)) => {
            assert_eq!(g.len(), w.len(), "array lengths differ at {path}");
            for (i, (a, b)) in g.iter().zip(w).enumerate() {
                assert_same(a, b, &format!("{path}[{i}]"));
            }
        }
        _ => assert_eq!(got, want, "values differ at {path}"),
    }
}

/// The document without its version object, which is checked on its own.
fn without_version(v: &Value) -> Value {
    let mut v = v.clone();
    v.as_object_mut().unwrap().remove("version");
    v
}

fn feature<'a>(v: &'a Value, locus: &str) -> &'a Value {
    v["features"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["locus"] == locus)
        .unwrap_or_else(|| panic!("no feature with locus {locus}"))
}

/// The CDS with no locus whose start is `start` (CDS (c), (d) and (e) carry no locus qualifier).
fn at<'a>(v: &'a Value, contig: &str, start: u64) -> &'a Value {
    v["features"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["contig"] == contig && f["start"] == start)
        .unwrap_or_else(|| panic!("no feature at {contig}:{start}"))
}

#[test]
fn bakta_json_matches_genbank_to() {
    let (got, warnings) = bakta(ORACLE, &opts());
    let want: Value = serde_json::from_str(BAKTA).unwrap();
    assert_same(&without_version(&got), &without_version(&want), "$");

    // The version object, on its own (D0227 (10)); the expected file holds a placeholder for it.
    assert_eq!(
        got["version"],
        json!({"genbank_to": "0.54", "molbiocraft": env!("CARGO_PKG_VERSION")})
    );
    assert_eq!(
        want["version"],
        json!({"genbank_to": "0.54", "molbiocraft": "CARGO_PKG_VERSION"})
    );

    // Features are in (contig, start, stop) order, the five types only (no gene).
    let feats = got["features"].as_array().unwrap();
    let keys: Vec<(String, u64, u64)> = feats
        .iter()
        .map(|f| {
            (
                f["contig"].as_str().unwrap().to_string(),
                f["start"].as_u64().unwrap(),
                f["stop"].as_u64().unwrap(),
            )
        })
        .collect();
    let mut sorted = keys.clone();
    sorted.sort();
    assert_eq!(keys, sorted);
    let types: Vec<&str> = feats.iter().map(|f| f["type"].as_str().unwrap()).collect();
    assert_eq!(types.iter().filter(|t| **t == "CDS").count(), 16);
    for t in ["tRNA", "rRNA", "ncRNA"] {
        assert_eq!(types.iter().filter(|x| **x == t).count(), 1, "{t}");
    }
    assert!(!types.contains(&"gene"));

    // The order is the sort's, not the input's: 0.54 on oracle.gbk with its records reversed
    // (2026-11-19) writes the same features, in the same order, and the sequences reversed.
    let mut reversed: Vec<SequenceDocument> = docs(ORACLE);
    reversed.reverse();
    let rev = genbank_to_bakta_json(&reversed, &opts()).unwrap();
    let rev: Value = serde_json::from_str(&rev.text).unwrap();
    assert_same(&rev["features"], &want["features"], "$.features");
    let ids: Vec<&str> = rev["sequences"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["OR000003", "OR000002.1", "OR000001.1"]);

    // CDS (f), the pseudogene, is kept and marked truncated 'unknown' (D0227 (1)).
    let f = feature(&got, "ORP00006.1");
    assert_eq!(f["truncated"], "unknown");
    // CDS (i): /codon_start=2 gives frame 1, and its protein is translated from that frame.
    let i = feature(&got, "ORT_0009");
    assert_eq!(i["frame"], 1);
    assert_eq!(i["aa"], "CVPIKAFCI");
    assert_eq!(i["start_type"], "TGC");
    // The X-bearing CDS (b) and the '*'-bearing CDS (h) have no seq_stats; their neighbours do.
    assert_eq!(feature(&got, "ORT_0002")["aa"], "MAKXGCHET");
    assert!(feature(&got, "ORT_0002").get("seq_stats").is_none());
    assert_eq!(feature(&got, "ORT_0008")["aa"], "MK*PG");
    assert!(feature(&got, "ORT_0008").get("seq_stats").is_none());
    assert!(feature(&got, "ORT_0007").get("seq_stats").is_some());
    assert!(at(&got, "OR000001.1", 81).get("seq_stats").is_some());

    // OR000003 has no VERSION, so its accession is its id, with the warning the other outputs give.
    assert_eq!(warnings, vec![NO_VERSION_WARNING.to_string()]);
}

/// A hand-written record (generated sequence, invented names) for the feature rules the fixture
/// cannot reach: a /codon_start of 3 and of 0 (frame -1, so start_type ''), old_locus_tag as the
/// locus, /ribosome_binding_site, /label, a /note holding 'Class:' (kept as 'class') and one that
/// does not, a /truncated CDS that is otherwise whole, two features with the same span (kept in
/// record order), a lower-case /translation, a 'tRNA-' product with no amino acid (0.54's parse
/// raises, so no tRNA field), a complement anticodon position (raises after amino_acid and
/// anti_codon), a tmRNA, a misc_feature (left out), unsorted /db_xref, and a partial CDS.
const EDGE: &str = r#"LOCUS       EDGE1                   240 bp    DNA     linear   BCT 19-NOV-2026
DEFINITION  Bacillus subtilis test record EDGE1.
ACCESSION   ED000001
VERSION     ED000001.1
SOURCE      Bacillus subtilis subsp. subtilis str. 168
  ORGANISM  Bacillus subtilis subsp. subtilis str. 168
            Bacteria; Bacillota; Bacilli; Bacillales; Bacillaceae; Bacillus.
FEATURES             Location/Qualifiers
     CDS             1..30
                     /codon_start=3
                     /old_locus_tag="OLD_1"
                     /product="Putative Hypothetical Protein X"
                     /ribosome_binding_site="AGGAGG"
                     /label="lab1"
                     /note="Class: thing"
                     /note="second note"
                     /truncated
     CDS             1..30
                     /locus_tag="ED_1b"
                     /truncated
     CDS             31..60
                     /codon_start=0
                     /locus_tag="ED_2"
                     /translation="mkt"
     tRNA            91..120
                     /product="tRNA-"
                     /anticodon=(pos:95..97,aa:Gly,seq:ucc)
     tRNA            complement(121..150)
                     /product="tRNA-Gly x"
                     /anticodon=(pos:complement(130..132),aa:Gly,seq:ucc)
     tmRNA           151..180
                     /product="tmRNA"
                     /note="no class here"
     misc_feature    151..160
                     /note="class: ignored"
     CDS             complement(181..210)
                     /locus_tag="ED_7"
                     /protein_id="EDP7.1"
                     /db_xref="Zeta:1"
                     /db_xref="Alpha:2"
     CDS             <211..>240
                     /locus_tag="ED_8"
ORIGIN
        1 atggctaaag acaattacat aacatactaa atgacgtcag cacgaaactt gttggcccag
       61 tgtgaatcgc ttaagggtta agtaagtgtg atgcatacgc ctttacttgc tgtgtccacc
      121 ccatcggact ggcattttta ttacactcag aaacagaact cgggtaattt tgacaggtca
      181 cgcagaggcg cgccctcctg aagtgcgtgg acactcgcta tgaatctctg atttacccac
//
"#;

/// genbank_to 0.54's --bakta-json on `EDGE` (written to a file as above), version object removed.
const EDGE_BAKTA: &str = r#"{"genome":{"genus":"Bacillus","species":"subtilis","strain":"subsp. subtilis str. 168","complete":false,"gram":"+","translation_table":11},"stats":{"no_sequences":1,"size":240,"gc":0.4625,"n_ratio":0.0,"n50":240,"coding_ratio":0.5},"features":[{"type":"CDS","contig":"ED000001.1","start":1,"stop":30,"strand":1,"product":"Putative Hypothetical Protein X","locus":"OLD_1","nt":"ATGGCTAAAGACAATTACATAACATACTAA","frame":2,"aa":"G*RQLHNIL","aa_hexdigest":"be4db17145d4d85863207d3e81bf6603","hypothetical":true,"start_type":"GGC","rbs_motif":"AGGAGG","truncated":"5-prime-3-prime","label":"lab1","class":"Class: thing"},{"type":"CDS","contig":"ED000001.1","start":1,"stop":30,"strand":1,"locus":"ED_1b","nt":"ATGGCTAAAGACAATTACATAACATACTAA","aa":"MAKDNYITY","aa_hexdigest":"8e0b267c57e4f8399ac251d7ef6e224f","seq_stats":{"molecular_weight":1118.2594000000001,"isoelectric_point":5.587011528015137},"start_type":"ATG","rbs_motif":"NA","truncated":"unknown"},{"type":"CDS","contig":"ED000001.1","start":31,"stop":60,"strand":1,"locus":"ED_2","nt":"ATGACGTCAGCACGAAACTTGTTGGCCCAG","frame":-1,"aa":"mkt","aa_hexdigest":"1eb0fa9e4ae6caeb56fd88cf422d6be4","seq_stats":{"molecular_weight":378.4875,"isoelectric_point":8.500108146667483},"start_type":"","rbs_motif":"NA","truncated":"5-prime-3-prime"},{"type":"tRNA","contig":"ED000001.1","start":91,"stop":120,"strand":1,"product":"tRNA-","nt":"ATGCATACGCCTTTACTTGCTGTGTCCACC"},{"type":"tRNA","contig":"ED000001.1","start":121,"stop":150,"strand":-1,"product":"tRNA-Gly x","nt":"CTGAGTGTAATAAAAATGCCAGTCCGATGG","amino_acid":"Gly","anti_codon":"ucc"},{"type":"tmRNA","contig":"ED000001.1","start":151,"stop":180,"strand":1,"product":"tmRNA","nt":"AAACAGAACTCGGGTAATTTTGACAGGTCA"},{"type":"CDS","contig":"ED000001.1","start":181,"stop":210,"strand":-1,"locus":"ED_7","db_xrefs":["Alpha:2","Zeta:1"],"nt":"CCACGCACTTCAGGAGGGCGCGCCTCTGCG","aa":"PRTSGGRASA","aa_hexdigest":"17dbba3a96f8d7a932c8470ef931498c","seq_stats":{"molecular_weight":959.0188,"isoelectric_point":11.999967765808105},"start_type":"CCA","rbs_motif":"NA","truncated":"5-prime-3-prime"},{"type":"CDS","contig":"ED000001.1","start":211,"stop":240,"strand":1,"locus":"ED_8","nt":"ACACTCGCTATGAATCTCTGATTTACCCAC","aa":"TLAMNL*FTH","aa_hexdigest":"b047c6eb5ef94c6d524b28f20f84df88","start_type":"ACA","rbs_motif":"NA","truncated":"5-prime-3-prime"}],"sequences":[{"id":"ED000001.1","description":"Bacillus subtilis test record EDGE1","sequence":"ATGGCTAAAGACAATTACATAACATACTAAATGACGTCAGCACGAAACTTGTTGGCCCAGTGTGAATCGCTTAAGGGTTAAGTAAGTGTGATGCATACGCCTTTACTTGCTGTGTCCACCCCATCGGACTGGCATTTTTATTACACTCAGAAACAGAACTCGGGTAATTTTGACAGGTCACGCAGAGGCGCGCCCTCCTGAAGTGCGTGGACACTCGCTATGAATCTCTGATTTACCCAC","length":240,"complete":false,"type":"sequence","topology":"linear","simple_id":"ED000001","name":"EDGE1"}]}"#;

/// A CDS with no /translation whose DNA holds 'J', which Biopython cannot translate.
const JREC: &str = r#"LOCUS       JREC                     30 bp    DNA     linear   BCT 19-NOV-2026
DEFINITION  J.
ACCESSION   JR000001
VERSION     JR000001.1
FEATURES             Location/Qualifiers
     CDS             1..30
                     /locus_tag="J_1"
ORIGIN
        1 atgjjjgtta tggaacaagg acgctgttaa
//
"#;

#[test]
fn bakta_features_follow_genbank_to_on_edge_cases() {
    let (got, _) = bakta(EDGE, &opts());
    let want: Value = serde_json::from_str(EDGE_BAKTA).unwrap();
    assert_same(&without_version(&got), &want, "$");

    // 0.54 stops with Biopython's TranslationError ("Codon 'JJJ' is invalid") and writes nothing.
    let err = genbank_to_bakta_json(&docs(JREC), &opts()).unwrap_err();
    assert_eq!(
        err,
        "CDS J_1 in JR000001.1 holds the codon 'JJJ', which Biopython cannot translate, so genbank_to writes no Bakta JSON."
    );
}

#[test]
fn md5_matches_rfc_1321() {
    // RFC 1321, appendix A.5 ("Test suite").
    let suite = [
        ("", "d41d8cd98f00b204e9800998ecf8427e"),
        ("a", "0cc175b9c0f1b6a831c399e269772661"),
        ("abc", "900150983cd24fb0d6963f7d28e17f72"),
        ("message digest", "f96b697d7cb7938d525a2f31aaf161d0"),
        (
            "abcdefghijklmnopqrstuvwxyz",
            "c3fcd3d76192e4007dfb496cca67e13b",
        ),
        (
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
            "d174ab98d277d9f5a5611c2c9f419d9f",
        ),
        (
            "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
            "57edf4a22be3c955ac49da2e2107b67a",
        ),
    ];
    for (text, digest) in suite {
        assert_eq!(md5_hex(text.as_bytes()), digest, "md5({text:?})");
    }
    // Padding edges: 55, 56 and 64 bytes need one, two and two blocks (Python's hashlib).
    assert_eq!(md5_hex(&[b'a'; 55]), "ef1772b6dff9a122358552954ad0df65");
    assert_eq!(md5_hex(&[b'a'; 56]), "3b0c8ac703f828b04c6c197006d17218");
    assert_eq!(md5_hex(&[b'a'; 64]), "014842d480b571495a4a0363793f7367");

    // Every feature's aa_hexdigest is the MD5 of its aa, on the fixture and on EDGE.
    for (text, proteins) in [(ORACLE, 16), (EDGE, 5)] {
        let (got, _) = bakta(text, &opts());
        let mut n = 0;
        for f in got["features"].as_array().unwrap() {
            if let Some(aa) = f.get("aa") {
                assert_eq!(f["aa_hexdigest"], md5_hex(aa.as_str().unwrap().as_bytes()));
                n += 1;
            } else {
                assert!(f.get("aa_hexdigest").is_none());
            }
        }
        assert_eq!(n, proteins);
    }
}

/// NP_040581.1, the phage lambda terminase large subunit (NC_001416.1, 641 aa).
const TERMINASE: &str = "MNISNSQVNRLRHFVRAGLRSLFRPEPQTAVEWADANYYLPKESAYQEGRWETLPFQRAIMNAMGSDYIREVNVVKSARVGYSKMLLGVYAYFIEHKQRNTLIWLPTDGDAENFMKTHVEPTIRDIPSLLALAPWYGKKHRDNTLTMKRFTNGRGFWCLGGKAAKNYREKSVDVAGYDELAAFDDDIEQEGSPTFLGDKRIEGSVWPKSIRGSTPKVRGTCQIERAASESPHFMRFHVACPHCGEEQYLKFGDKETPFGLKWTPDDPSSVFYLCEHNACVIRQQELDFTDARYICEKTGIWTRDGILWFSSSGEEIEPPDSVTFHIWTAYSPFTTWVQIVKDWMKTKGDTGKRKTFVNTTLGETWEAKIGERPDAEVMAERKEHYSAPVPDRVAYLTAGIDSQLDRYEMRVWGWGPGEESWLIDRQIIMGRHDDEQTLLRVDEAINKTYTRRNGAEMSISRICWDTGGIDPTIVYERSKKHGLFRVIPIKGASVYGKPVASMPRKRNKNGVYLTEIGTDTAKEQIYNRFTLTPEGDEPLPGAVHFPNNPDIFDLTEAQQLTAEEQVEKWVDGRKKILWDSKKRRNEALDCFVYALAALRISISRWQLDLSALLASLQEEDGAATNKKTLADYARALSGEDE";

#[test]
fn protein_stats_match_biopython() {
    assert_eq!(TERMINASE.len(), 641);
    let mw = protein_molecular_weight(TERMINASE).unwrap();
    let pi = protein_isoelectric_point(TERMINASE);
    assert!((mw - 73300.88919999999).abs() <= 1e-9, "{mw}");
    assert!((pi - 6.100608634948729).abs() <= 1e-9, "{pi}");

    // Biopython 1.88's molecular_weight(seq, seq_type="protein") and IsoelectricPoint(seq).pi():
    // N-terminal pKs (P, E, M, V, T), C-terminal D and E, O and U weights, lower case read as upper.
    let cases = [
        ("PETER", 630.6481, 4.532079887390137),
        ("EKD", 390.389, 4.669914436340332),
        ("AUOKD", 719.6889, 6.13152904510498),
        ("C", 121.1582, 5.518122673034666),
        ("DDDD", 478.3649, 4.0500284194946286),
        ("RRRR", 642.7581, 11.999967765808105),
        ("MKTAYIAKQR", 1209.4613, 10.288976860046386),
        ("mkt", 378.4875, 8.500108146667483),
        ("VHHE", 520.5389, 6.016089057922362),
        ("TCYD", 500.52270000000004, 4.297164344787597),
    ];
    for (aa, w, p) in cases {
        let got_w = protein_molecular_weight(aa).unwrap();
        let got_p = protein_isoelectric_point(aa);
        assert!((got_w - w).abs() <= 1e-9, "{aa}: weight {got_w} vs {w}");
        assert!((got_p - p).abs() <= 1e-9, "{aa}: pI {got_p} vs {p}");
    }
    // Python 3.12's sum() is compensated (Neumaier): it gives 1118.2594000000001 here, where a plain
    // left-to-right sum gives 1118.2594 (and 73300.88920000035 for the terminase, within 1e-9, so
    // only this exact check tells the two apart).
    assert_eq!(
        protein_molecular_weight("MAKDNYITY").unwrap(),
        1118.2594000000001
    );

    // A letter outside Biopython's protein weights makes molecular_weight refuse ...
    for aa in ["MAKXGCHET", "MK*PG", "MBK", "MZK", "MJK"] {
        assert_eq!(protein_molecular_weight(aa), None, "{aa}");
    }
    // ... and that feature gets no seq_stats (CDS (b) holds an X), while its neighbours do.
    let (got, _) = bakta(ORACLE, &opts());
    let b = feature(&got, "ORT_0002");
    assert!(b["aa"].as_str().unwrap().contains('X'));
    assert!(b.get("seq_stats").is_none());
    let a = feature(&got, "ORP00001.1");
    assert_eq!(a["seq_stats"]["molecular_weight"], 1209.4613);
}

/// A 30 bp record with `header` between LOCUS and FEATURES and one CDS.
fn meta(name: &str, topology: &str, header: &str) -> String {
    format!(
        "LOCUS       {name:<16}         30 bp    DNA     {topology:<8} BCT 19-NOV-2026\n{header}FEATURES             Location/Qualifiers\n     CDS             1..30\n                     /locus_tag=\"{name}_1\"\nORIGIN\n        1 atgacgcgct cattcccttg tcggagataa\n//\n"
    )
}

const META_A: &str = "DEFINITION  Unknownia foo strain X1 chromosome.\nACCESSION   MA000001\nVERSION     MA000001.1\nSOURCE      Unknownia foo bar X1\n  ORGANISM  Unknownia foo bar X1\n            Bacteria; Unknownia.\nCOMMENT     This is a COMPLETE assembly.\n";
const META_B: &str = "DEFINITION  Bacillus subtilis strain Y, Complete Genome.\nACCESSION   MB000001\nVERSION     MB000001.1\nSOURCE      Bacillus subtilis\n  ORGANISM  Bacillus subtilis\n            Bacteria; Bacillota; Bacillus.\n";
const META_C: &str =
    "DEFINITION  Test plasmid pX contig 4.\nACCESSION   MC000001\nVERSION     MC000001.1\n";
const META_D: &str = "ACCESSION   MD000001\nVERSION     MD000001.1\nCOMMENT     Nothing here.\n";

#[test]
fn bakta_genome_metadata_follows_genbank_to() {
    let (fixture, _) = bakta(ORACLE, &opts());
    // 0.54 on oracle.gbk: genus, species and strain split 'Escherichia coli K-12'; Escherichia is in
    // bacteria.py's gram_negative; a complete genome; table 11.
    assert_eq!(
        fixture["genome"],
        json!({"genus": "Escherichia", "species": "coli", "strain": "K-12", "complete": true, "gram": "-", "translation_table": 11})
    );

    let a = meta("METAA", "linear", META_A);
    let b = meta("METAB", "linear", META_B);
    let c = meta("METAC", "linear", META_C);
    let d = meta("METAD", "circular", META_D);

    // 0.54 on each record as its own file (the venv, 2026-11-19), A to C with another filler
    // sequence; no value asserted here reads the sequence except D's, which is this one.
    // A: a genus in neither set gives '?', the strain is the rest of the name, and a COMMENT holding
    // 'COMPLETE' (any case) makes the genome and the sequence complete; 'chromosome' names its type.
    let (va, wa) = bakta(&a, &opts());
    assert_eq!(
        va["genome"],
        json!({"genus": "Unknownia", "species": "foo", "strain": "bar X1", "complete": true, "gram": "?", "translation_table": 11})
    );
    assert_eq!(va["sequences"][0]["complete"], true);
    assert_eq!(va["sequences"][0]["type"], "chromosome");
    assert_eq!(
        wa,
        vec!["Genus Unknownia is in neither of genbank_to's Gram stain lists, so the Gram stain is '?'.".to_string()]
    );
    // B: Bacillus gives '+', no strain gives NA, and 'Complete Genome' in the description makes the
    // genome complete but not the sequence, whose type is 'sequence'.
    let (vb, wb) = bakta(&b, &opts());
    assert_eq!(
        vb["genome"],
        json!({"genus": "Bacillus", "species": "subtilis", "strain": "NA", "complete": true, "gram": "+", "translation_table": 11})
    );
    assert_eq!(vb["sequences"][0]["complete"], false);
    assert_eq!(vb["sequences"][0]["type"], "sequence");
    assert!(wb.is_empty());
    // C: no organism gives NA three times and '?'; nothing says complete; 'plasmid' is checked
    // before 'contig'.
    let (vc, wc) = bakta(&c, &opts());
    assert_eq!(
        vc["genome"],
        json!({"genus": "NA", "species": "NA", "strain": "NA", "complete": false, "gram": "?", "translation_table": 11})
    );
    assert_eq!(vc["sequences"][0]["complete"], false);
    assert_eq!(vc["sequences"][0]["type"], "plasmid");
    assert_eq!(vc["sequences"][0]["name"], "METAC");
    assert_eq!(
        wc,
        vec!["The first record names no organism, so the Gram stain is '?'.".to_string()]
    );
    // C then D: the genome is still C's, but any circular record makes it complete; D is complete
    // from its topology, not its COMMENT, and with no DEFINITION its description is '' (Biopython).
    let (vcd, _) = bakta(&format!("{c}{d}"), &opts());
    assert_eq!(
        vcd["genome"],
        json!({"genus": "NA", "species": "NA", "strain": "NA", "complete": true, "gram": "?", "translation_table": 11})
    );
    assert_eq!(
        vcd["sequences"][1],
        json!({"id": "MD000001.1", "description": "", "sequence": "ATGACGCGCTCATTCCCTTGTCGGAGATAA", "length": 30, "complete": true, "type": "sequence", "topology": "circular", "simple_id": "MD000001", "name": "METAD"})
    );
    // The genome is the first record's: B then A is Bacillus.
    let (vba, _) = bakta(&format!("{b}{a}"), &opts());
    assert_eq!(vba["genome"]["genus"], "Bacillus");
    assert_eq!(vba["genome"]["complete"], true);
    // The record filter selects the first record: OR000002.1 alone has no organism, and is circular.
    let only2 = GenbankToOptions {
        records: vec!["OR000002".to_string()],
        ..GenbankToOptions::default()
    };
    let (v2, _) = bakta(ORACLE, &only2);
    assert_eq!(v2["genome"]["genus"], "NA");
    assert_eq!(v2["genome"]["complete"], true);
    assert_eq!(v2["stats"]["no_sequences"], 1);
    assert_eq!(v2["sequences"][0]["type"], "plasmid");

    // The Gram option overrides the genus lists, '?' included, and owes no warning.
    for (text, g) in [
        (ORACLE.to_string(), '+'),
        (b.clone(), '-'),
        (a.clone(), '+'),
        (c.clone(), '-'),
    ] {
        let (v, w) = bakta(&text, &with_gram(g));
        assert_eq!(v["genome"]["gram"], g.to_string());
        assert!(
            w.is_empty() || w == vec![NO_VERSION_WARNING.to_string()],
            "{w:?}"
        );
    }
    let err = genbank_to_bakta_json(&docs(ORACLE), &with_gram('x')).unwrap_err();
    assert_eq!(
        err,
        "Gram stain x is not one genbank_to accepts: give '+' or '-'."
    );
    // No record, after the filter, is refused as 0.54 refuses an empty file.
    let none = GenbankToOptions {
        records: vec!["NOPE".to_string()],
        ..GenbankToOptions::default()
    };
    let err = genbank_to_bakta_json(&docs(ORACLE), &none).unwrap_err();
    assert_eq!(err, "No GenBank records to write as Bakta JSON.");

    // 0.54's stats on oracle.gbk: three records, 900 bp, n50 720, CDS (f) inside the coding mask.
    let (s, _) = bakta(ORACLE, &opts());
    assert_eq!(
        s["stats"],
        json!({"no_sequences": 3, "size": 900, "gc": 0.4330357142857143, "n_ratio": 0.0044444444444444444, "n50": 720, "coding_ratio": 0.6011111111111112})
    );
    // n50 is where the longest-first running total reaches half: EDGE (240 bp) and eight 30 bp
    // records give 240, where shortest-first would give 30 (0.54 on that file, 2026-11-19).
    let (vn, _) = bakta(&format!("{EDGE}{}", c.repeat(8)), &opts());
    assert_eq!(
        vn["stats"],
        json!({"no_sequences": 9, "size": 480, "gc": 0.48125, "n_ratio": 0.0, "n50": 240, "coding_ratio": 0.75})
    );
}

#[test]
fn bakta_translation_table_option() {
    // Table 4 reads CDS (h)'s internal TGA as W (0.54 --translation-table 4), so it has seq_stats;
    // table 11, the default, reads it as '*', which is internal and kept.
    let (t4, _) = bakta(ORACLE, &with_table(4));
    let h4 = feature(&t4, "ORT_0008");
    assert_eq!(h4["aa"], "MKWPG");
    assert_eq!(h4["aa_hexdigest"], "763bf3f1ad955367509af79323f7d4cf");
    assert_eq!(h4["seq_stats"]["molecular_weight"], 617.76);
    assert!(
        (h4["seq_stats"]["isoelectric_point"].as_f64().unwrap() - 8.500108146667483).abs() <= 1e-9
    );
    assert_eq!(t4["genome"]["translation_table"], 4);
    let (t11, _) = bakta(ORACLE, &with_table(11));
    assert_eq!(feature(&t11, "ORT_0008")["aa"], "MK*PG");
    let (def, _) = bakta(ORACLE, &opts());
    assert_eq!(t11, def);

    // 0.54's set is {1-6, 9-14, 16, 21-31, 33}; any other table is refused and nothing is written.
    let accepted: Vec<u32> = (0..=40)
        .filter(|t| genbank_to_bakta_json(&docs(ORACLE), &with_table(*t)).is_ok())
        .collect();
    let mut want: Vec<u32> = (1..=6)
        .chain(9..=14)
        .chain([16])
        .chain(21..=31)
        .chain([33])
        .collect();
    want.sort();
    assert_eq!(accepted, want);
    for t in [7, 15, 32, 99, 0] {
        let err = genbank_to_bakta_json(&docs(ORACLE), &with_table(t)).unwrap_err();
        assert_eq!(
            err,
            format!("Translation table {t} is not one genbank_to accepts.")
        );
    }
}
