// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M7NKEM AC1, AC2 and AC7 (its RPC half): what the importers other than FASTA leave out
//! or cannot read reaches the reader as a sentence, through the dispatcher every transport
//! shares. Wrong implementations, and the case that catches each:
//! - `check_sequence_alphabet` keeping `*` in a DNA sequence (the New Sequence dialog's old
//!   filter), or dropping it without a word: AC1's DNA text must read 16 letters and say so;
//! - foreign letters grouped with "; " when each has one position: AC1 reads "X at 15 and J at
//!   16", and a three-letter list "E at 1, X at 6 and J at 11";
//! - a DNA `*` named as an internal stop (the protein sentence) or listed before the gaps:
//!   the three DNA sentences are compared whole and in order;
//! - a missing `text` or `molecule` read as "" or DNA, or an unknown molecule read as DNA: each
//!   must be refused with its own message;
//! - letterless text answered with no warning, or with gap sentences: it must say it holds no
//!   letters;
//! - the GenBank reader dropping gaps and stops silently, or never comparing the LOCUS length
//!   with ORIGIN: the 20 bp record must carry both sentences, in that order;
//! - a length sentence on every record: the 16 bp record matches and gets none, and a CONTIG
//!   record with no ORIGIN gets none;
//! - EMBL named as GenBank (it is read through the GenBank reader): its sentence must name the
//!   ID line and SQ;
//! - an RNA FASTA header measured in bp: it must say nt, while DNA keeps bp and protein aa.

use molbiocraft_wasm::dispatch_bio_rpc;
use serde_json::{json, Value};

fn check(payload: Value) -> Result<Value, String> {
    dispatch_bio_rpc("check_sequence_alphabet", payload)
}

#[test]
fn check_sequence_alphabet_keeps_letters_and_names_what_it_drops() {
    assert_eq!(
        check(json!({ "text": "ACGT-ACGT*NNACGTXJ", "molecule": "DNA" })).unwrap(),
        json!({
            "sequence": "ACGTACGTNNACGTXJ",
            "warnings": [
                "2 letters are not nucleotide codes and were kept: X at 15 and J at 16.",
                "1 gap character (-) was left out; positions count the letters kept.",
                "1 stop character (*) was left out; positions count the letters kept."
            ],
            "foreign": { "J": 1, "X": 1 }
        })
    );
    assert_eq!(
        check(json!({ "text": "MKV*W", "molecule": "Protein" })).unwrap(),
        json!({
            "sequence": "MKVW",
            "warnings": ["1 internal stop (*) after residue 3 was left out, so the residues on either side read as one chain."],
            "foreign": {}
        })
    );
    assert_eq!(check(json!({ "text": "ACGTACGT" })).unwrap_err(), "Missing required field 'molecule' in RPC payload");
    assert_eq!(check(json!({ "text": "ACGT", "molecule": "XNA" })).unwrap_err(), "molecule 'XNA' is not DNA, RNA or Protein");
    assert_eq!(check(json!({ "molecule": "DNA" })).unwrap_err(), "Missing required field 'text' in RPC payload");
    assert_eq!(
        check(json!({ "text": " --**12\n", "molecule": "DNA" })).unwrap(),
        json!({ "sequence": "", "warnings": ["The text holds no sequence letters."], "foreign": {} })
    );
    // One position per letter reads as one list; a letter with several keeps the "; " groups.
    assert_eq!(
        check(json!({ "text": "EACGTXACGTJ", "molecule": "DNA" })).unwrap()["warnings"],
        json!(["3 letters are not nucleotide codes and were kept: E at 1, X at 6 and J at 11."])
    );
    assert_eq!(
        check(json!({ "text": "EACGTXXACGTJ", "molecule": "DNA" })).unwrap()["warnings"],
        json!(["4 letters are not nucleotide codes and were kept: E at 1; X at 6 and 7; J at 12."])
    );
    // The NEXUS reader's per-letter counts: a protein reads every letter.
    assert_eq!(check(json!({ "text": "EACGTXXACGTJ", "molecule": "DNA" })).unwrap()["foreign"], json!({ "E": 1, "J": 1, "X": 2 }));
    assert_eq!(check(json!({ "text": "EACGTXXACGTJ", "molecule": "Protein" })).unwrap()["foreign"], json!({}));
    assert_eq!(check(json!({ "text": "acgu", "molecule": "RNA" })).unwrap(), json!({ "sequence": "ACGU", "warnings": [], "foreign": {} }));

    // The FASTA reader names a DNA record's stop with the same sentence (one alphabet_warnings).
    let docs = dispatch_bio_rpc("parse_fasta", json!({ "text": ">d\nACGTACGT*ACGTACGTAC\n" })).unwrap();
    assert_eq!(docs[0]["moleculeType"], "DNA", "fixture: {docs}");
    assert_eq!(
        docs[0]["docMetadata"]["Notes"],
        "Warnings:\n- 1 stop character (*) was left out; positions count the letters kept.\n"
    );
}

const GB_20: &str = "LOCUS       short                     20 bp    DNA     linear   SYN 01-JAN-2026\nDEFINITION  short.\nFEATURES             Location/Qualifiers\nORIGIN\n        1 acgt-acgt- acgt\n//\n";

fn notes(doc: &Value) -> Value {
    doc["docMetadata"]["Notes"].clone()
}

#[test]
fn flatfile_imports_name_length_gaps_and_foreign_letters() {
    let short = dispatch_bio_rpc("parse_genbank", json!({ "text": GB_20 })).unwrap();
    assert_eq!(short["sequence"], "ACGTACGTACGT");
    assert_eq!(
        notes(&short),
        "Warnings:\n- The LOCUS line declares 20 bp but ORIGIN holds 12 bases.\n- 2 gap characters (-) were left out; positions count the letters kept.\n"
    );

    let gb_16 = "LOCUS       mixed                     16 bp    DNA     linear   SYN 01-JAN-2026\nORIGIN\n        1 acgt-acgt* nnac gtxj\n//\n";
    let mixed = dispatch_bio_rpc("parse_genbank", json!({ "text": gb_16 })).unwrap();
    assert_eq!(mixed["sequence"], "ACGTACGTNNACGTXJ");
    assert_eq!(
        notes(&mixed),
        "Warnings:\n- 2 letters are not nucleotide codes and were kept: X at 15 and J at 16.\n- 1 gap character (-) was left out; positions count the letters kept.\n- 1 stop character (*) was left out; positions count the letters kept.\n"
    );

    let embl = "ID   short; SV 1; linear; DNA; STD; SYN; 20 BP.\nXX\nDE   short.\nXX\nSQ   Sequence 20 BP;\n     acgt-acgt- acgt                                                    12\n//\n";
    let embl = dispatch_bio_rpc("parse_embl", json!({ "text": embl })).unwrap();
    assert_eq!(embl["sequence"], "ACGTACGTACGT");
    assert_eq!(
        notes(&embl),
        "Warnings:\n- The ID line declares 20 bp but SQ holds 12 bases.\n- 2 gap characters (-) were left out; positions count the letters kept.\n"
    );

    // A protein record counts residues.
    let prot = "LOCUS       prot                       5 aa            linear   SYN 01-JAN-2026\nORIGIN\n        1 mkv*w\n//\n";
    let prot = dispatch_bio_rpc("parse_genbank", json!({ "text": prot })).unwrap();
    assert_eq!(prot["moleculeType"], "Protein", "fixture: {prot}");
    assert_eq!(
        notes(&prot),
        "Warnings:\n- The LOCUS line declares 5 aa but ORIGIN holds 4 residues.\n- 1 internal stop (*) after residue 3 was left out, so the residues on either side read as one chain.\n"
    );

    // A CONTIG summary has no bases to read, which is not a short read; an EMBL CON record
    // (no SQ block) neither.
    let contig = "LOCUS       contig                    20 bp    DNA     linear   CON 01-JAN-2026\nCONTIG      join(AB000001.1:1..20)\n//\n";
    let contig = dispatch_bio_rpc("parse_genbank", json!({ "text": contig })).unwrap();
    assert_eq!(contig["docMetadata"]["Is Contig Summary"], true, "fixture: {contig}");
    assert_eq!(notes(&contig), Value::Null);
    let con = "ID   con; SV 1; linear; DNA; CON; SYN; 20 BP.\nXX\nCO   join(AB000001.1:1..20)\n//\n";
    let con = dispatch_bio_rpc("parse_embl", json!({ "text": con })).unwrap();
    assert_eq!(notes(&con), Value::Null, "{con}");

    // A record whose ORIGIN matches its LOCUS and holds only nucleotide letters gets no note.
    let clean = "LOCUS       clean                     12 bp    DNA     linear   SYN 01-JAN-2026\nORIGIN\n        1 acgtacgtac gt\n//\n";
    assert_eq!(notes(&dispatch_bio_rpc("parse_genbank", json!({ "text": clean })).unwrap()), Value::Null);
}

#[test]
fn fasta_export_measures_rna_in_nt() {
    let header = |fasta: &str| {
        let docs = dispatch_bio_rpc("parse_fasta", json!({ "text": fasta })).unwrap();
        let out = dispatch_bio_rpc("export_fasta", json!({ "doc": docs[0] })).unwrap();
        out.as_str().unwrap().lines().next().unwrap().to_string()
    };
    assert!(header(">r\nACGUACGUAC\n").ends_with("| 10 nt"), "{}", header(">r\nACGUACGUAC\n"));
    assert!(header(">d\nACGTACGTAC\n").ends_with("| 10 bp"), "{}", header(">d\nACGTACGTAC\n"));
    assert!(header(">p\nMKVLWMKVLW\n").ends_with("| 10 aa"), "{}", header(">p\nMKVLWMKVLW\n"));
}
