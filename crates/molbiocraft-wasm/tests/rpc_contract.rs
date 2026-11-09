// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Contract check: for every RPC the app actually sends, the dispatcher must read each key of the
//! payload. A key the TypeScript side sends under a name the Rust arm never looks at is silently
//! replaced by a default, which has produced wrong results before (`bins`/`overviewBins`,
//! `bothStrands`/`searchBothStrands`). `ts_rpc_payloads.json` is captured from a full `vitest` run.

use molbiocraft_wasm::{dispatch_bio_rpc, keys_read_by};
use serde_json::{json, Value};

#[test]
fn every_key_the_app_sends_is_read_by_the_dispatcher() {
    let spec: Value =
        serde_json::from_str(include_str!("ts_rpc_payloads.json")).expect("payload capture");
    let obj = spec.as_object().expect("object");
    let mut unread: Vec<String> = Vec::new();
    let mut checked = 0usize;

    let doc = json!({
        "id": "d", "name": "d", "accession": "", "description": "", "moleculeType": "DNA",
        "topology": "linear", "sequence": "ATGAAACCCGGGTTTTAA", "features": [], "primers": [],
        "history": [], "createdAt": "", "updatedAt": "", "folder": ""
    });
    let chrom = json!({
        "baseCalls": "ACGT", "peakLocations": [1, 2, 3, 4], "phredScores": [30, 30, 30, 30],
        "traceA": [1], "traceC": [1], "traceG": [1], "traceT": [1]
    });
    // Real domain objects, so an arm that parses one field before reading the next is not stopped
    // by a filler value the type cannot accept.
    let vector = serde_json::to_value(&molbiocraft_cloning::get_vector_catalog()[0]).unwrap();
    let part = serde_json::to_value(&molbiocraft_cloning::get_modular_vector_parts()[0]).unwrap();
    let cut_sites = serde_json::to_value(molbiocraft_cloning::find_restriction_cut_sites(
        "GAATTCAAAAGGATCCAAAAAAGCGGCCGC",
        molbiocraft_core::Topology::Linear,
        None,
    ))
    .unwrap();
    let snapshot = json!({ "sessionName": "s", "documents": [], "workspace": {} });
    let shapes = [
        json!(null), json!(""), json!("x"), json!(1), json!(true), json!([]), json!({}),
        doc.clone(), json!([doc]), chrom, json!({ "start": 1, "end": 3 }),
        vector, part, cut_sites, snapshot,
    ];

    for (op, keys) in obj {
        let keys: Vec<String> = keys
            .as_array()
            .unwrap()
            .iter()
            .map(|k| k.as_str().unwrap().to_string())
            .collect();
        if keys.is_empty() {
            continue;
        }
        // An arm stops at the first field it cannot parse, so no single filler value works for
        // every payload. Give each key its own value, chosen greedily: start from nulls and keep,
        // for each key in turn, whichever candidate lets the dispatcher read the most keys.
        let mut chosen: Vec<Value> = vec![json!(null); keys.len()];
        let run = |vals: &[Value]| -> Vec<String> {
            let payload = Value::Object(
                keys.iter().cloned().zip(vals.iter().cloned()).collect(),
            );
            keys_read_by(|| dispatch_bio_rpc(op, payload)).1
        };
        let mut read = run(&chosen);
        for _pass in 0..2 {
            for i in 0..keys.len() {
                for shape in &shapes {
                    let mut trial = chosen.clone();
                    trial[i] = shape.clone();
                    let got = run(&trial);
                    if got.len() > read.len() {
                        read = got;
                        chosen = trial;
                    }
                }
            }
        }
        checked += 1;
        for k in &keys {
            if !read.iter().any(|r| r == k) {
                unread.push(format!("{op}: sends '{k}', dispatcher never reads it (reached: {read:?})"));
            }
        }
    }

    assert!(checked > 100, "only {checked} ops checked");
    assert!(unread.is_empty(), "unread RPC payload keys:\n{}", unread.join("\n"));
}

/// One RPC through the linear-memory scratch ABI exactly as `invokeRustBioSync` drives it in the
/// browser: op and JSON payload written at `mbc_wasm_scratch_ptr`, `mbc_wasm_invoke_scratch`, then
/// the `mbc_wasm_last_len` bytes at the returned pointer parsed as the reply.
fn wasm_reply(op: &str, payload: &Value) -> Value {
    use molbiocraft_wasm::{
        mbc_wasm_invoke_scratch, mbc_wasm_last_is_err, mbc_wasm_last_len, mbc_wasm_scratch_ptr,
    };
    let body = serde_json::to_vec(payload).unwrap();
    let ptr = mbc_wasm_scratch_ptr(op.len() + body.len() + 16);
    // SAFETY: the scratch buffer holds at least the bytes requested above.
    unsafe {
        std::ptr::copy_nonoverlapping(op.as_ptr(), ptr, op.len());
        std::ptr::copy_nonoverlapping(body.as_ptr(), ptr.add(op.len()), body.len());
    }
    let out = mbc_wasm_invoke_scratch(op.len(), body.len());
    // SAFETY: the reply is `mbc_wasm_last_len` bytes at `out`, valid until the next call.
    let text = unsafe { std::slice::from_raw_parts(out, mbc_wasm_last_len()) }.to_vec();
    assert_eq!(mbc_wasm_last_is_err(), 0, "{op}: {}", String::from_utf8_lossy(&text));
    serde_json::from_slice(&text).expect("JSON reply")
}

/// D0005: a result's `warnings` reaches the TypeScript caller in the WASM RPC reply exactly as the
/// engine wrote them, and a result with none carries an empty list rather than no field. BLAST hits
/// are the one exception, kept as they were: their warnings ride on each hit and are left out when
/// empty (`src/__tests__/blastTruncationWarning.test.tsx` pins that).
#[test]
fn warnings_pass_through_the_rpc_reply() {
    use molbiocraft_align::{
        run_multiple_sequence_alignment, run_multiple_sequence_alignment_with_algorithm,
        MsaInputDoc,
    };
    let seq = "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGC";
    let docs = json!([
        { "id": "a", "name": "eGFP", "sequence": seq },
        { "id": "b", "name": "eGFP-mut", "sequence": seq.replace("GGCGAG", "GGTGAG") },
        { "id": "c", "name": "fragment", "sequence": &seq[..40] },
    ]);
    let engine_docs: Vec<MsaInputDoc> = serde_json::from_value(docs.clone()).unwrap();
    let cut = "MSA input truncated to the length cap of 60 residues: eGFP (87 residues), eGFP-mut (87 residues). Only the first 60 residues of each were aligned.";
    for algorithm in ["", "MAFFT"] {
        let reply = wasm_reply("run_msa", &json!({ "docs": docs, "maxSeqLen": 60, "algorithm": algorithm }));
        assert_eq!(reply["warnings"], json!([cut]), "{algorithm:?}: {reply}");
        // the dispatcher passes the engine's result through whole, warnings and all
        let engine = if algorithm.is_empty() {
            run_multiple_sequence_alignment(&engine_docs, 60)
        } else {
            run_multiple_sequence_alignment_with_algorithm(&engine_docs, 60, algorithm)
        };
        assert_eq!(reply, serde_json::to_value(engine).unwrap(), "{algorithm:?}");
        // nothing cut: the field is still there, as an empty list
        let whole = wasm_reply("run_msa", &json!({ "docs": docs, "maxSeqLen": 2400, "algorithm": algorithm }));
        assert_eq!(whole["warnings"], json!([]), "{algorithm:?}: {whole}");
    }

    // the fold report: a 610-nt sequence is folded over its first 600 nt and says so
    let rna: String = seq.repeat(8).chars().take(610).collect();
    let fold = wasm_reply("predict_secondary_structure", &json!({ "seq": rna, "moleculeType": "RNA" }));
    assert_eq!(
        fold["warnings"],
        json!(["Folding capped at 600 nt: only nucleotides 1-600 of the 610-nt sequence were folded."])
    );
    let short = wasm_reply("predict_secondary_structure", &json!({ "seq": &seq[..40], "moleculeType": "RNA" }));
    assert_eq!(short["warnings"], json!([]), "{short}");

    // BLAST: every hit of a query past the cap carries the cap warning; the hits of a query within
    // the cap carry no `warnings` key
    let mut x = 0x5eed_7e57u64;
    let subject: String = (0..12_000)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            b"ACGT"[(x % 4) as usize] as char
        })
        .collect();
    let blast = |query: &str| {
        wasm_reply("run_local_blast", &json!({
            "querySeq": query, "program": "blastn", "databaseName": "db",
            "docs": [{ "id": "s", "name": "s", "accession": "", "description": "", "sequence": subject, "organism": "" }],
        }))
    };
    let over = blast(&subject[..10_001]);
    let hits = over.as_array().unwrap();
    assert!(!hits.is_empty(), "fixture: the query finds its subject");
    for h in hits {
        assert_eq!(h["warnings"], json!(["Query truncated: blastn has a query cap of 10000 nt, so only query 1-10000 of 10001 nt was searched; query coverage is against all 10001 nt."]), "{h}");
    }
    let within = blast(&subject[..600]);
    let hits = within.as_array().unwrap();
    assert!(!hits.is_empty(), "fixture: the query finds its subject");
    assert!(hits.iter().all(|h| h.get("warnings").is_none()), "{within}");
}

/// D0005 / TD-06 (US-01M6P2QH AC1) end to end, through the scratch ABI `invokeRustBioSync` drives:
/// `translate_sequence` replies `{ protein, warnings }` and `find_orfs` `{ orfs, warnings }`, the
/// list always present. A `tableId` that names no NCBI genetic code translates with the Standard
/// code (table 1), and the warning names the id as the caller sent it, 300 as 300 and not the 255 a
/// narrowing to u8 gives. A unit changing either reply must keep both keys: the TypeScript readers
/// in src/core/bioEngine.ts (`translateSequence`, `findORFsWithWarnings`) type the replies by them.
#[test]
fn an_unknown_genetic_code_reaches_the_caller_as_a_warning() {
    let warning = |id: u64| format!("Unknown genetic code {id}: translated with the Standard code (table 1).");
    let translate = |id: u64| wasm_reply("translate_sequence", &json!({ "dna": "ATGTGATAA", "frameOffset": 0, "tableId": id }));
    // fixture: table 2 reads TGA as Trp, table 1 as a stop
    assert_eq!(translate(1), json!({ "protein": "M**", "warnings": [] }));
    assert_eq!(translate(2), json!({ "protein": "MW*", "warnings": [] }));
    for id in [99, 300] {
        assert_eq!(translate(id), json!({ "protein": "M**", "warnings": [warning(id)] }), "{id}");
    }

    // ATG AAA AAA AAA AAA AAA TGA AAA TAA: table 1 ends the ORF at TGA, table 2 reads TGA as W
    let orfs = |id: u64| {
        let payload = json!({ "seq": "ATGAAAAAAAAAAAAAAATGAAAATAA", "minLengthAa": 5, "allowAlternativeStart": false, "tableId": id, "circular": false });
        wasm_reply("find_orfs", &payload)
    };
    let standard = orfs(1);
    assert_eq!(standard["warnings"], json!([]), "{standard}");
    assert_eq!(standard["orfs"][0]["proteinSeq"], "MKKKKK", "fixture: {standard}");
    assert_eq!(orfs(2)["orfs"][0]["proteinSeq"], "MKKKKKWK", "fixture");
    for id in [99, 300] {
        let reply = orfs(id);
        assert_eq!(reply["orfs"], standard["orfs"], "{id}");
        assert_eq!(reply["warnings"], json!([warning(id)]), "{id}");
    }
}

/// BG-01M6S1P2 AC6, through the scratch ABI `invokeRustBioSync` drives: `find_genomic_repeats`
/// replies with the engine's whole scan object (`scan_genomic_repeats`), not its bare hit list, so
/// the repeats, the scanned length, the number found and the warnings all reach the Genomics
/// studio. On US-01M6P244's fixture shape (260 kb, so the scan stops at 250,000 bp) the only
/// warning is the cut; a list cut short adds its own sentence after it; a short sequence whose
/// repeats all fit carries an empty list.
#[test]
fn the_repeat_scan_reply_is_the_engine_scan_object() {
    use molbiocraft_core::scan_genomic_repeats;
    let mut x = 0x2e9e_a75eu64;
    let mut bases: Vec<u8> = (0..260_000)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            b"ACGT"[(x % 4) as usize]
        })
        .collect();
    // two 30-bp arms, each copied twice into the first 10,000 bp
    let (arm_a, arm_b) = (bases[100_000..100_030].to_vec(), bases[150_000..150_030].to_vec());
    bases[1_000..1_030].copy_from_slice(&arm_a);
    bases[2_000..2_030].copy_from_slice(&arm_a);
    bases[5_000..5_030].copy_from_slice(&arm_b);
    bases[9_000..9_030].copy_from_slice(&arm_b);
    let seq = String::from_utf8(bases).unwrap();
    let cut = "Repeat scan covered only the first 250,000 bp of the 260,000-bp sequence; repeats past base 250,000 are not reported.";
    let reply = |seq: &str, max_hits: usize| wasm_reply("find_genomic_repeats", &json!({ "seq": seq, "minArmBp": 20, "maxHits": max_hits }));

    let whole = reply(&seq, 80);
    assert_eq!(whole, serde_json::to_value(scan_genomic_repeats(&seq, 20, 80)).unwrap());
    let mut keys: Vec<&str> = whole.as_object().expect("an object, not a bare hit list").keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(keys, ["hits", "scannedLengthBp", "sequenceLengthBp", "totalHits", "warnings"]);
    assert_eq!((whole["scannedLengthBp"].as_u64(), whole["sequenceLengthBp"].as_u64()), (Some(250_000), Some(260_000)));
    assert_eq!(whole["warnings"], json!([cut]), "{}", whole["warnings"]);
    let hits = whole["hits"].as_array().unwrap();
    assert_eq!(whole["totalHits"].as_u64(), Some(hits.len() as u64));
    // a hit covering both copies of an arm, planted 0-based at `arm1` and `arm2`
    let pairs = |h: &Value, arm1: u64, arm2: u64| {
        let at = |k: &str| h[k].as_u64().unwrap();
        h["repeatType"] == "Direct Repeat" && at("arm1StartBp") <= arm1 + 1 && at("arm1EndBp") >= arm1 + 30 && at("arm2StartBp") <= arm2 + 1 && at("arm2EndBp") >= arm2 + 30
    };
    assert!(hits.iter().any(|h| pairs(h, 1_000, 2_000)) && hits.iter().any(|h| pairs(h, 5_000, 9_000)), "{hits:?}");

    // the same scan with a one-hit list: the cut, then the list cap
    let one = reply(&seq, 1);
    assert_eq!(one["hits"].as_array().map(Vec::len), Some(1));
    assert_eq!(one["totalHits"], whole["totalHits"]);
    let found = whole["totalHits"].as_u64().unwrap();
    assert!(found > 1, "fixture: {found} repeats");
    assert_eq!(one["warnings"], json!([cut, format!("Repeat list capped: it shows the 1 longest of the {found} repeats found.")]));

    // a short sequence scanned whole, every repeat listed: no warning, and the list still there
    let short = reply(&seq[..10_000], 80);
    assert_eq!(short["warnings"], json!([]), "{short}");
    assert_eq!((short["scannedLengthBp"].as_u64(), short["sequenceLengthBp"].as_u64()), (Some(10_000), Some(10_000)));
    assert_eq!(short["totalHits"].as_u64(), short["hits"].as_array().map(|h| h.len() as u64));
    assert!(short["hits"].as_array().unwrap().iter().any(|h| pairs(h, 5_000, 9_000)), "{short}");
}

/// BG-01M6S17Y AC1, through the scratch ABI `invokeRustBioSync` drives: the
/// `align_pairwise_banded_sparse` reply is the alignment's fields with `warnings` beside them, and
/// an input over the `maxLen` cap is named in it with its whole length and the length aligned. The
/// reply is the engine's `align_pairwise_banded_sparse_with_warnings`, unchanged; with nothing cut
/// the list is there, empty. Lengths are counted here from the inputs.
#[test]
fn the_banded_alignment_reply_says_what_its_input_cap_cut() {
    use molbiocraft_align::poa_and_banded::align_pairwise_banded_sparse_with_warnings;
    let mut x = 0xBA5Du64;
    let mut dna = |n: usize| -> String {
        (0..n)
            .map(|_| {
                x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                b"ACGT"[((x >> 33) % 4) as usize] as char
            })
            .collect()
    };
    let (a, b) = (dna(380), dna(25_010));
    let payload = |max_len: Option<usize>| {
        let mut p = json!({ "seq1": a, "seq2": b, "mode": "global", "k": 6, "w": 24, "matchScore": 2, "mismatchScore": -3, "gapOpen": -5, "gapExtend": -2 });
        if let Some(m) = max_len {
            p["maxLen"] = json!(m);
        }
        p
    };
    let cut = |cap: &str, whole: &str| {
        format!("Banded alignment input truncated to the length cap of {cap} residues: sequence 2 ({whole} residues). Only its first {cap} residues were aligned.")
    };
    assert_eq!((a.len(), b.len()), (380, 25_010), "fixture: only sequence 2 is over a cap of 400");

    let reply = wasm_reply("align_pairwise_banded_sparse", &payload(Some(400)));
    assert_eq!(reply["warnings"], json!([cut("400", "25,010")]), "{}", reply["warnings"]);
    assert_eq!(reply, serde_json::to_value(align_pairwise_banded_sparse_with_warnings(&a, &b, "global", 6, 24, 2, -3, -5, -2, 400)).unwrap());
    assert_eq!(reply["alignedSeq2"].as_str().map(|s| s.replace('-', "")), Some(b[..400].to_string()), "the first 400 residues were aligned");
    // no maxLen in the payload: the dispatcher's default, 25,000, is the cap named
    let default_cap = wasm_reply("align_pairwise_banded_sparse", &payload(None));
    assert_eq!(default_cap["warnings"], json!([cut("25,000", "25,010")]), "{}", default_cap["warnings"]);
    // nothing cut: the field is still there, as an empty list
    let whole = wasm_reply("align_pairwise_banded_sparse", &payload(Some(30_000)));
    assert_eq!(whole["warnings"], json!([]), "{}", whole["warnings"]);
}

/// BG-01M6S17Y AC2, through the scratch ABI: `analyze_sequence_composition` lists at most 4,096
/// Dam and 4,096 Dcm sites, and its reply now says so with the whole count when a list is cut, and
/// carries an empty `warnings` when neither is. The sites are counted here from the sequence.
#[test]
fn the_composition_reply_says_when_its_site_lists_are_capped() {
    let seq = "GATCAAAA".repeat(4_200) + &"CCAGGTTT".repeat(10);
    let count = |pat: &[u8]| seq.as_bytes().windows(pat.len()).filter(|w| *w == pat).count();
    assert_eq!((count(b"GATC"), count(b"CCAGG") + count(b"CCTGG")), (4_200, 10), "fixture");
    let reply = wasm_reply("analyze_sequence_composition", &json!({ "seq": seq }));
    assert_eq!(reply["damSites"].as_array().map(Vec::len), Some(4_096));
    assert_eq!(reply["dcmSites"].as_array().map(Vec::len), Some(10));
    assert_eq!(reply["warnings"], json!(["Dam site list capped: it lists the first 4,096 of the 4,200 Dam (GATC) sites in the sequence."]));
    let short = wasm_reply("analyze_sequence_composition", &json!({ "seq": "GATCCAGG" }));
    assert_eq!(short["warnings"], json!([]), "{short}");
}

/// US-01M6TDCD AC5: the proprietary alignment-file and plasmid-file readers are gone from the
/// dispatcher that the WASM build, the Tauri IPC command and /api/v1/rpc/<op> all call. Calling the
/// alignment reader's operation is an unknown operation, and a byte stream that opens with the
/// plasmid reader's packet cookie yields an empty sequence; ABIF and SCF traces are still read. The
/// operation name, the alignment header and the cookie are written as bytes, so no tracked text
/// names the package. The
/// cookie stream is one the removed reader decoded into a 16-base sequence, so a reader left in
/// place, or a fallback that reads its bases, fails here.
#[test]
fn removed_readers_answer_unknown_operation_and_empty_sequence() {
    let op = String::from_utf8(vec![0x70, 0x61, 0x72, 0x73, 0x65, 0x5f, 0x6d, 0x65, 0x67, 0x61]).unwrap();
    let header = String::from_utf8(vec![0x23, 0x6d, 0x65, 0x67, 0x61]).unwrap();
    let alignment = json!({ "text": format!("{header}\n!Title t;\n!Format DataType=DNA;\n\n#one ACGTACGTAC\n#two ACGTTCGTAC\n") });
    assert_eq!(
        dispatch_bio_rpc(&op, alignment),
        Err(format!("Unknown MolBioCraft Rust bioinformatics RPC operation: '{op}'"))
    );

    let be32 = |n: usize| (n as u32).to_be_bytes();
    let cookie: [u8; 8] = [0x53, 0x6e, 0x61, 0x70, 0x47, 0x65, 0x6e, 0x65];
    let mut cookie_body = cookie.to_vec();
    cookie_body.extend([0, 1, 0, 15, 0, 19]);
    let mut seq_body = vec![0x03u8];
    seq_body.extend(b"ACGTACGTACGTGGCC");
    let mut packets = vec![0x09u8];
    packets.extend(be32(cookie_body.len()));
    packets.extend(&cookie_body);
    packets.push(0x00);
    packets.extend(be32(seq_body.len()));
    packets.extend(&seq_body);
    let doc = wasm_reply("parse_binary_packet", &json!({ "bytes": packets, "fileName": "construct.dna" }));
    assert_eq!(doc["sequence"], json!(""), "{doc}");
    assert_eq!(doc["chromatogram"], Value::Null, "{doc}");
    assert_eq!(doc["features"], json!([]), "{doc}");

    // ABIF: a directory of one PBAS entry, its four bases held inline in the entry.
    let mut abif = vec![0u8; 128 + 28];
    abif[0..4].copy_from_slice(b"ABIF");
    abif[18..22].copy_from_slice(&1i32.to_be_bytes());
    abif[26..30].copy_from_slice(&be32(128));
    let entry = &mut abif[128..156];
    entry[0..4].copy_from_slice(b"PBAS");
    entry[4..8].copy_from_slice(&1i32.to_be_bytes());
    entry[8..10].copy_from_slice(&2i16.to_be_bytes());
    entry[10..12].copy_from_slice(&1i16.to_be_bytes());
    entry[12..16].copy_from_slice(&4i32.to_be_bytes());
    entry[16..20].copy_from_slice(&4i32.to_be_bytes());
    entry[20..24].copy_from_slice(b"ACGT");
    let doc = wasm_reply("parse_binary_packet", &json!({ "bytes": abif, "fileName": "read.ab1" }));
    assert_eq!(doc["sequence"], json!("ACGT"), "{doc}");
    assert_eq!(doc["chromatogram"]["baseCalls"], json!("ACGT"), "{doc}");

    // SCF v3: two called bases over four 2-byte samples per channel.
    let (samples, bases, samples_offset) = (4usize, 2usize, 128usize);
    let bases_offset = samples_offset + samples * 2 * 4;
    let mut scf = vec![0u8; bases_offset + bases * 12];
    scf[0..4].copy_from_slice(b".scf");
    scf[4..8].copy_from_slice(&be32(samples));
    scf[8..12].copy_from_slice(&be32(samples_offset));
    scf[12..16].copy_from_slice(&be32(bases));
    scf[24..28].copy_from_slice(&be32(bases_offset));
    scf[36..40].copy_from_slice(b"3.00");
    scf[40..44].copy_from_slice(&be32(2));
    scf[bases_offset..bases_offset + 4].copy_from_slice(&be32(1));
    scf[bases_offset + 4..bases_offset + 8].copy_from_slice(&be32(3));
    for k in 0..4 {
        for i in 0..bases {
            scf[bases_offset + 4 * bases + k * bases + i] = 30;
        }
    }
    scf[bases_offset + 8 * bases] = b'A';
    scf[bases_offset + 8 * bases + 1] = b'C';
    let doc = wasm_reply("parse_binary_packet", &json!({ "bytes": scf, "fileName": "read.scf" }));
    assert_eq!(doc["sequence"], json!("AC"), "{doc}");
    assert_eq!(doc["chromatogram"]["peakLocations"], json!([1, 3]), "{doc}");
}
