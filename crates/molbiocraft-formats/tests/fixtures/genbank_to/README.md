# genbank_to oracle fixture

`oracle.gbk` is written by hand for the genbank_to port (EP-01M7RC9C, US-01M7RC3P). It holds no
third-party data: its sequences are generated (a fixed linear congruential filler with each CDS
written in from the protein it is meant to encode), and its names, accessions and products are
invented. US-01M7RC3P is the only story that edits it; the later genbank_to stories read it as is.

## Oracle

genbank_to 0.54 (Rob Edwards, MIT licence, https://github.com/linsalrob/genbank_to,
`pip install genbank_to==0.54`) with Biopython 1.88 under Python 3.12.7, run on 2026-11-19.
The port in `src/genbank_to.rs` follows GenBankToLib/genbank.py and main.py of that release.

The command lines, run in an empty folder with `oracle.gbk` given by its path:

```
genbank_to -g oracle.gbk -n oracle.fna
genbank_to -g oracle.gbk -o oracle.keep.orfs
genbank_to -g oracle.gbk -o oracle.drop.orfs --pseudo
genbank_to -g oracle.gbk -a oracle.keep.faa
genbank_to -g oracle.gbk -a oracle.drop.faa --pseudo
genbank_to -g oracle.gbk -f oracle.functions.tsv
genbank_to -g oracle.gbk -f oracle.pf.tsv --pseudo
```

0.54 inverts `--pseudo` for `-a` and `-o` (it passes the flag as `skip_pseudo`), so their default run
keeps CDS (f), the /pseudo CDS, and `--pseudo` drops it. `-f` drops it either way (`oracle.pf.tsv`
equals `oracle.functions.tsv`). `-c` is not run: 0.54 raises AttributeError ('ExactPosition' object
has no attribute 'position') under Biopython 1.88, so the complex headers are stated literally in
`complex_headers_follow_d0227` (D0227 (5)).

## Expected files and every line changed by hand

| Expected file | From | Lines changed by hand |
| --- | --- | --- |
| `expected/oracle.fna` | `-n oracle.fna` | none |
| `expected/oracle.orfs` | `-o oracle.keep.orfs` | D0227 (1): the two lines `>ORP00006.1` and `ATGACCCAGCCGCTGCTGCATCGTGCTTAA` (CDS (f)) removed. The result equals `-o oracle.drop.orfs --pseudo` byte for byte. |
| `expected/oracle.pseudo.orfs` | `-o oracle.keep.orfs` | none (Include pseudogenes keeps CDS (f), as 0.54's default run does) |
| `expected/oracle.faa` | `-a oracle.keep.faa` | D0227 (1): the two lines `>ORP00006.1` and `MTQPLLHRA*` (CDS (f)) removed (equal to `-a oracle.drop.faa --pseudo`). D0227 (6): line 12, CDS (h) `ORT_0008` with /transl_table=4, `MK*PG*` changed to `MKWPG*`. |
| `expected/oracle.pseudo.faa` | `-a oracle.keep.faa` | D0227 (6): line 14, CDS (h) `ORT_0008`, `MK*PG*` changed to `MKWPG*`. |
| `expected/oracle.functions.tsv` | `-f oracle.functions.tsv` | none |
| `expected/oracle.pseudo.functions.tsv` | `-f oracle.functions.tsv` | D0227 (1): line 6, `OR000001.1<TAB>ORP00006.1<TAB>Zeta pseudo protein` (CDS (f)), added after the CDS (e) line, since Include pseudogenes keeps CDS (f) in the functions too. |

D0227 (4) and (8) change no line here: the joined outputs carry no record filter, and the fixture's
locations carry no partial marks and no order().

## The fixture's cases

- OR000001.1 (linear, 720 bp): ORGANISM 'Escherichia coli K-12', DEFINITION ending 'complete
  genome.', a two-line COMMENT, VERSION 'OR000001.1  GI:900001'. CDS features in file order:
  - (a) 1..33: protein_id ORP00001.1, /translation, /gene, product, db_xrefs GI:123456 then GeneID:7;
  - (b) complement(41..70): locus_tag ORT_0002 only, no /translation, a GCN and an NNN codon;
  - (c) join(81..110,121..150): db_xref GeneID:3 only, no product;
  - (d) complement(join(161..190,201..230)): no protein_id, locus_tag or db_xref;
  - (e) 241..270: no id qualifier;
  - (f) 281..310: /pseudo and protein_id ORP00006.1;
  - (g) 321..340: 20 bp, no /translation;
  - (h) 351..368: /transl_table=4, no /translation, an internal TGA;
  - (i) 381..410: /codon_start=2, no /translation;
  - (j) 421..450: two /product values;
  - (k) 461..490: product 'hypothetical protein';
  - (l) 501..530: product 'COG0001 test family.';
  - (m) 541..570: db_xrefs GeneID:9 then GI:55;
  - and a gene (1..33, and 581..665), a tRNA (/product 'tRNA-Leu',
    /anticodon=(pos:615..617,aa:Leu,seq:taa)), an rRNA and an ncRNA.
- OR000002.1: circular, 120 bp, no SOURCE/ORGANISM block, DEFINITION 'Test plasmid pOR2, complete
  sequence.', two CDS (one on the complement strand).
- OR000003: ACCESSION OR000003 and no VERSION line, one CDS.

## The import (D0229) and the 'MolBioCraft name:' line

`parse_genbank_flatfile` keeps `doc_metadata` 'Version' (the VERSION line's first token),
'Organism' and 'Comment' (the COMMENT lines joined by '\n', as Biopython joins them, without a
structured comment table's lines). The `COMMENT     MolBioCraft name: <name>` line US-01M6P2KY's
export writes (D0202) is a COMMENT line like any other: 'Comment' keeps it verbatim, as Biopython
keeps it in `annotations["comment"]`, and it still names the document. A record exported by the app
and read back therefore has a 'Comment' that begins 'MolBioCraft name: '.

Biopython 1.88 right-strips each header line and drops every one left empty before it reads the
header (`Bio/GenBank/Scanner.py`, `lines = [_f for _f in lines if _f]`), and reads each COMMENT
line from column 13 (`line[12:]`). So a 12-space line and a truly empty line inside a COMMENT are
no lines of 'Comment' and do not end it, and spaces after column 12 on the first line are kept.
`oracle.gbk` holds no such COMMENT, and its expected files are 0.54's output, so the case is an
inline record in `genbank_to_oracle.rs` (`import_comment_drops_blank_lines_as_biopython_does`),
asserted against the exact string Biopython 1.88 gives for it. A second test
(`import_comment_matches_biopython_on_real_files`) compares 'Comment' with Biopython 1.88's
`annotations["comment"]` for the seven test-data GenBank files whose COMMENT holds a blank or
empty line (ncbi/NC_045512.gb, ncbi/V01555.gb and five Biopython test files), written as literals
on 2026-11-19; it skips a file the git-ignored test-data folder does not hold.

'Organism' is the ORGANISM name as Biopython 1.88's ORGANISM branch reads it: the lineage begins at
the first continuation line that holds a ';' or that is, stripped, exactly 'Bacteria.', 'Archaea.',
'Eukaryota.', 'Unclassified.', 'Viruses.', 'cellular organisms.', 'other sequences.' or
'unclassified sequences.'; a lone '.' before the lineage is a placeholder; an empty line is no line.
`oracle.gbk` holds none of these cases, so `import_organism_matches_biopython` asserts inline records
(one per kingdom-only line, and near misses) against Biopython 1.88's `annotations["organism"]`,
plus ncbi/X02514.gb ('Unknown.') and every record of the 59 test-data files whose first line is a
LOCUS line, written as literals on 2026-11-19 (Biopython refuses invalid_product.gb and
no_origin_no_end.gb past the header, so theirs is its header reading's). `organism_placeholder_is_not_a_name`
pins the '.' placeholder: an empty ORGANISM line then '.' is '' in Biopython, so no 'Organism'.

With no VERSION and no ACCESSION line the record id is the LOCUS name, as Biopython's `SeqRecord.id`
is. Where a 'MolBioCraft name:' line renames the document, the import keeps the LOCUS name as
`doc_metadata` 'LOCUS name' (only then), and the id reads it: `record_id_falls_back_to_the_locus_name`
checks the ids and file names 0.54 writes for such a record ('Long_name', not 'Long name').

## Real-world check (not committed)

On phage lambda, the NCBI GenBank record NC_001416.1 (not committed), the port's `.fna`, `.faa`, `.orfs` and functions outputs are byte-identical to 0.54's `-n`, `-a`, `-o`
and `-f` (2026-11-19). The record has no /pseudo CDS and no /transl_table other than 11, so no
D0227 difference applies there.
