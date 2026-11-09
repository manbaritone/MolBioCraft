// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! The NCBI genetic codes (tables 1–33), generated from NCBI's `gc.prt` as distributed in
//! Biopython (`Bio.Data.CodonTable`). Codons are indexed in TCAG order: index =
//! 16·i(first) + 4·i(second) + i(third) with T=0, C=1, A=2, G=3. Each entry: (id, amino acids,
//! start codons ('M' = start), name). In tables 27, 28 and 31 some codons are both stop and
//! sense; like Biopython / NCBI translation they are listed (and translated) as sense codons.

pub const NCBI_GENETIC_CODES: &[(u8, &[u8; 64], &[u8; 64], &str)] = &[
    (1, b"FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"---M---------------M---------------M----------------------------", "Standard"),
    (2, b"FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSS**VVVVAAAADDEEGGGG", b"--------------------------------MMMM---------------M------------", "Vertebrate Mitochondrial"),
    (3, b"FFLLSSSSYY**CCWWTTTTPPPPHHQQRRRRIIMMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"----------------------------------MM---------------M------------", "Yeast Mitochondrial"),
    (4, b"FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"--MM---------------M------------MMMM---------------M------------", "Mold Mitochondrial"),
    (5, b"FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSSSSVVVVAAAADDEEGGGG", b"---M----------------------------MMMM---------------M------------", "Invertebrate Mitochondrial"),
    (6, b"FFLLSSSSYYQQCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"-----------------------------------M----------------------------", "Ciliate Nuclear"),
    (9, b"FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNNKSSSSVVVVAAAADDEEGGGG", b"-----------------------------------M---------------M------------", "Echinoderm Mitochondrial"),
    (10, b"FFLLSSSSYY**CCCWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"-----------------------------------M----------------------------", "Euplotid Nuclear"),
    (11, b"FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"---M---------------M------------MMMM---------------M------------", "Bacterial"),
    (12, b"FFLLSSSSYY**CC*WLLLSPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"-------------------M---------------M----------------------------", "Alternative Yeast Nuclear"),
    (13, b"FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSSGGVVVVAAAADDEEGGGG", b"---M------------------------------MM---------------M------------", "Ascidian Mitochondrial"),
    (14, b"FFLLSSSSYYY*CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNNKSSSSVVVVAAAADDEEGGGG", b"-----------------------------------M----------------------------", "Alternative Flatworm Mitochondrial"),
    (15, b"FFLLSSSSYY*QCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"-----------------------------------M----------------------------", "Blepharisma Macronuclear"),
    (16, b"FFLLSSSSYY*LCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"-----------------------------------M----------------------------", "Chlorophycean Mitochondrial"),
    (21, b"FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNNKSSSSVVVVAAAADDEEGGGG", b"-----------------------------------M---------------M------------", "Trematode Mitochondrial"),
    (22, b"FFLLSS*SYY*LCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"-----------------------------------M----------------------------", "Scenedesmus obliquus Mitochondrial"),
    (23, b"FF*LSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"--------------------------------M--M---------------M------------", "Thraustochytrium Mitochondrial"),
    (24, b"FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSSKVVVVAAAADDEEGGGG", b"---M---------------M---------------M---------------M------------", "Pterobranchia Mitochondrial"),
    (25, b"FFLLSSSSYY**CCGWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"---M-------------------------------M---------------M------------", "Candidate Division SR1"),
    (26, b"FFLLSSSSYY**CC*WLLLAPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"-------------------M---------------M----------------------------", "Pachysolen tannophilus Nuclear"),
    (27, b"FFLLSSSSYYQQCCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"-----------------------------------M----------------------------", "Karyorelict Nuclear"),
    (28, b"FFLLSSSSYYQQCCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"-----------------------------------M----------------------------", "Condylostoma Nuclear"),
    (29, b"FFLLSSSSYYYYCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"-----------------------------------M----------------------------", "Mesodinium Nuclear"),
    (30, b"FFLLSSSSYYEECC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"-----------------------------------M----------------------------", "Peritrich Nuclear"),
    (31, b"FFLLSSSSYYEECCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"-----------------------------------M----------------------------", "Blastocrithidia Nuclear"),
    (32, b"FFLLSSSSYY*WCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", b"---M---------------M------------MMMM---------------M------------", "Balanophoraceae Plastid"),
    (33, b"FFLLSSSSYYY*CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSSKVVVVAAAADDEEGGGG", b"---M---------------M---------------M---------------M------------", "Cephalodiscidae Mitochondrial"),
];

fn base_index(b: u8) -> Option<usize> {
    match b.to_ascii_uppercase() {
        b'T' | b'U' => Some(0),
        b'C' => Some(1),
        b'A' => Some(2),
        b'G' => Some(3),
        _ => None,
    }
}

/// Bases an IUPAC nucleotide code stands for.
fn iupac_bases(b: u8) -> &'static [u8] {
    match b.to_ascii_uppercase() {
        b'A' => b"A", b'C' => b"C", b'G' => b"G", b'T' | b'U' => b"T",
        b'R' => b"AG", b'Y' => b"CT", b'S' => b"CG", b'W' => b"AT", b'K' => b"GT", b'M' => b"AC",
        b'B' => b"CGT", b'D' => b"AGT", b'H' => b"ACT", b'V' => b"ACG", b'N' => b"ACGT",
        _ => b"",
    }
}

/// The table for an NCBI id. An id that names no table falls back to the Standard code (table 1);
/// [`resolve_genetic_code`] reads a requested id and says when that fallback owes a warning (D0005).
pub fn genetic_code(table_id: u8) -> &'static (u8, &'static [u8; 64], &'static [u8; 64], &'static str) {
    NCBI_GENETIC_CODES.iter().find(|t| t.0 == table_id).unwrap_or(&NCBI_GENETIC_CODES[0])
}

/// The table a requested genetic-code id is read with, and the warning owed (D0005, TD-06) when the
/// request names no NCBI table. The id is taken whole, as requested: 300 is not clamped to 255, and
/// 258 does not wrap to table 2.
/// - An id that names an NCBI table reads as that table, with no warning.
/// - 0 is the unset id: [`crate::translation_orf`] has always read it as the Standard code
///   (table 1), and it reads so here, with no warning.
/// - Any other id (one NCBI skips inside its numbering, 7, 8 and 17-20, or one past 33) reads as
///   table 1, and [`unknown_genetic_code_warning`] names the id.
pub fn resolve_genetic_code(requested: u64) -> (u8, Option<String>) {
    let standard = NCBI_GENETIC_CODES[0].0;
    if requested == 0 {
        return (standard, None);
    }
    match NCBI_GENETIC_CODES.iter().find(|t| u64::from(t.0) == requested) {
        Some(t) => (t.0, None),
        None => (standard, Some(unknown_genetic_code_warning(requested))),
    }
}

/// The warning owed (D0005) when a requested genetic code names no NCBI table and the Standard code
/// (table 1) is read in its place: one plain sentence naming the request as it was given (an id, or
/// the text of a request that is not one) and the table used.
pub fn unknown_genetic_code_warning(requested: impl std::fmt::Display) -> String {
    let (used, _, _, name) = NCBI_GENETIC_CODES[0];
    format!("Unknown genetic code {requested}: translated with the {name} code (table {used}).")
}

/// Translates one codon. Ambiguous codons (IUPAC) translate when every base they stand for gives
/// the same amino acid (e.g. CTN → L), otherwise 'X' — as Biopython / NCBI do.
pub fn translate_codon(codon: &[u8], table_id: u8) -> u8 {
    if codon.len() < 3 {
        return b'X';
    }
    let t = genetic_code(table_id);
    if let (Some(a), Some(b), Some(c)) = (base_index(codon[0]), base_index(codon[1]), base_index(codon[2])) {
        return t.1[16 * a + 4 * b + c];
    }
    let mut aa: Option<u8> = None;
    for &x in iupac_bases(codon[0]) {
        for &y in iupac_bases(codon[1]) {
            for &z in iupac_bases(codon[2]) {
                let v = t.1[16 * base_index(x).unwrap() + 4 * base_index(y).unwrap() + base_index(z).unwrap()];
                match aa {
                    None => aa = Some(v),
                    Some(p) if p != v => return b'X',
                    _ => {}
                }
            }
        }
    }
    aa.unwrap_or(b'X')
}

/// Whether `codon` is a start codon of the table (unambiguous bases only).
pub fn is_start_codon(codon: &[u8], table_id: u8) -> bool {
    if codon.len() < 3 {
        return false;
    }
    let t = genetic_code(table_id);
    match (base_index(codon[0]), base_index(codon[1]), base_index(codon[2])) {
        (Some(a), Some(b), Some(c)) => t.2[16 * a + 4 * b + c] == b'M',
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// D0005 / TD-06: a requested id that names no NCBI table - one NCBI skips inside its numbering
    /// (7, 8, 17-20), one past 33, or one past 255 that a narrowing to u8 would clamp to 255 or wrap
    /// onto a real table (258 to table 2, 267 to table 11) - reads every codon, ambiguous ones too,
    /// and every start codon as the Standard code (table 1) does, and the warning names that id as
    /// requested and table 1. 0 is the unset id and reads as table 1 with no warning, as
    /// translation_orf has always read it. Every NCBI id reads as itself and warns of nothing.
    #[test]
    fn unknown_table_warns_and_uses_table_1() {
        let mut codons: Vec<[u8; 3]> = Vec::new();
        for a in *b"TCAG" {
            for b in *b"TCAG" {
                for c in *b"TCAG" {
                    codons.push([a, b, c]);
                }
            }
        }
        // ambiguous codons: CTN is L in table 1 but T in table 3, AGR is R in table 1 but S in
        // table 5, TGR is X in table 1 but W in table 2
        codons.extend([*b"CTN", *b"AGR", *b"TGR", *b"TAR", *b"YTR"]);
        let read = [(b"CTN", 1), (b"CTN", 3), (b"AGR", 1), (b"AGR", 5), (b"TGR", 1), (b"TGR", 2)].map(|(c, t)| translate_codon(c, t));
        assert_eq!(&read, b"LTRSXW");
        let table_11 = NCBI_GENETIC_CODES.iter().find(|t| t.0 == 11).unwrap();
        assert!(table_11.1 == NCBI_GENETIC_CODES[0].1 && table_11.2 != NCBI_GENETIC_CODES[0].2, "fixture: table 11 differs only in starts");
        let reads_as = |id: u8, other: u8| {
            codons.iter().all(|c| {
                translate_codon(c, id) == translate_codon(c, other) && is_start_codon(c, id) == is_start_codon(c, other)
            })
        };
        let warning = |id: u64| format!("Unknown genetic code {id}: translated with the Standard code (table 1).");

        for id in [7u64, 8, 17, 18, 19, 20, 34, 99, 255, 256, 258, 267, 300, 1_000, u64::MAX] {
            let (used, warned) = resolve_genetic_code(id);
            assert_eq!((used, warned.as_deref()), (1, Some(warning(id).as_str())), "{id}");
            assert!(reads_as(used, 1), "table {id} should read as table 1");
            if let Ok(narrow) = u8::try_from(id) {
                // the table lookup itself falls back to table 1 for an id it does not hold
                assert!(reads_as(narrow, 1), "table {id} should read as table 1");
                assert_eq!(genetic_code(narrow).0, 1, "{id}");
            }
        }
        // the id is read whole: a narrowing would name 255 for 300, and would read 258 and 267 as
        // the tables they wrap to, where TGA is Trp (table 2) or the starts differ (table 11)
        assert_eq!((258u64 as u8, 267u64 as u8, 300u64.min(255)), (2, 11, 255), "fixture");
        assert!(!reads_as(2, 1) && !reads_as(11, 1), "fixture");
        assert_eq!(crate::translation_orf::translate_sequence("ATGTGATAA", 0, 2), "MW*", "fixture");
        assert_eq!(crate::translation_orf::translate_sequence("ATGTGATAA", 0, resolve_genetic_code(258).0), "M**");
        assert_eq!(unknown_genetic_code_warning("\"2\""), "Unknown genetic code \"2\": translated with the Standard code (table 1).");

        // 0 is unset: it reads as table 1, as translation_orf reads it, and warns of nothing
        assert_eq!(resolve_genetic_code(0), (1, None));
        assert!(reads_as(0, 1));
        assert_eq!(crate::translation_orf::translate_sequence("ATGTGATAA", 0, 0), "M**");

        // the fallback is table 1 and no other: every other NCBI table reads some codon or start
        // codon above differently (table 11 only by its extra starts), and none of them warns
        assert_eq!(resolve_genetic_code(1), (1, None));
        for &(id, ..) in &NCBI_GENETIC_CODES[1..] {
            assert!(!reads_as(id, 1), "fixture: table {id} reads like table 1");
            assert_eq!(resolve_genetic_code(u64::from(id)), (id, None), "{id}");
        }
        // what the reader gets: TGA is a stop and TTG, CTG and ATG are the only starts, as in table 1
        assert_eq!(translate_codon(b"TGA", 99), b'*');
        let starts: Vec<&[u8]> = codons[..64].iter().filter(|c| is_start_codon(&c[..], 99)).map(|c| &c[..]).collect();
        assert_eq!(starts, [&b"TTG"[..], b"CTG", b"ATG"]);
    }
}
