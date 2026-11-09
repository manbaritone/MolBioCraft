#!/usr/bin/env python3
# Copyright 2026 MolBioCraft Contributors
# SPDX-License-Identifier: CC-BY-NC-4.0
"""Record which sample sequences equal a record of a vendor sample export, and the check that covers each.

A one-off script, kept for provenance (US-01M6TGZ8 AC4). It was run once, while the export was
still on the operator's disk, and its output is sdlc-studio/decisions/sample-export-overlap.tsv.

It reads the sample library as the WASM engine builds it from sample_library_data.rs,
sample_genomes_data.rs and sample_alignments_data.rs (`get_sample_library`, through Node), so a
sequence the data files build in code is compared as the app shows it. Every document sequence and
every alignment member is normalised (uppercase, U read as T, gaps and whitespace removed) and
compared, by SHA-256, with every record of the export FASTA file named on the command line, normalised
the same way.

One row is written per matching sequence, tab-separated, with no header:

    <MolBioCraft id>    <SHA-256 of the normalised sequence>    <check>

The id is the document id, or `<document id>/<member id>` for an alignment member. The check is the
unit and acceptance criterion whose test compares the sequence with a fetched public record, or
`replaced` (a later unit rebuilds the sequence) or `dropped`. A matching sequence that no rule below
assigns is an error: the script names it and writes nothing.

Nothing from the export reaches the output: no sequence, no record name and no path. The export is
read only to hash its records.

Usage: map_sample_export_overlap.py EXPORT_FASTA [--wasm public/molbiocraft_wasm.wasm]
                                    [--out sdlc-studio/decisions/sample-export-overlap.tsv]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

# The library, as the engine builds it, read through the engine's scratch-buffer RPC.
DUMP_JS = r"""
import fs from 'node:fs';
const exp = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(process.argv[1])), {}).exports;
const op = new TextEncoder().encode('get_sample_library');
const at = exp.mbc_wasm_scratch_ptr(op.length + 16);
new Uint8Array(exp.memory.buffer).set(op, at);
const out = exp.mbc_wasm_invoke_scratch(op.length, 0);
const text = new TextDecoder().decode(new Uint8Array(exp.memory.buffer, out, exp.mbc_wasm_last_len()));
if (exp.mbc_wasm_last_is_err() !== 0) { console.error(text); process.exit(1); }
process.stdout.write(text);
"""

# This story's AC1 test: each of these equals the fetched NCBI record or CDS region it cites.
THIS_STORY_AC1 = "US-01M6TGZ8 AC1"
AC1_DOCUMENTS = {
    "doc-genome-virus-hiv", "doc-genome-virus-ebola", "doc-genome-virus-sars-cov-2",
    "doc-genome-virus-sars", "doc-genome-virus-hpv", "doc-genome-virus-phage-lambda",
    "doc-genome-virus-phage-t7", "doc-genome-human-chrm", "doc-genome-drosophila-chrm",
    "doc-puc19", "doc-contig-yghj-reference", "doc-contig-yghj-divergent",
}
# US-01M6TDFV's checks against fetched records: AC1 the sequencing primers, AC4 the five protein
# records, AC6 the yadF CDS.
TDFV_AC4_PROTEINS = {
    "doc-prot-receptor-kinase-3c4w", "doc-prot-ferredoxin-isc", "doc-prot-narh-nitrate-reductase",
    "doc-prot-1d66-gal4-dna", "doc-prot-1a4y-rnase-angiogenin",
}


def check_for(doc_id: str, member_id: str | None) -> str | None:
    """The check that covers one matching sequence, or None when no rule assigns it."""
    if member_id is None:
        if doc_id in AC1_DOCUMENTS:
            return THIS_STORY_AC1
        if doc_id.startswith("doc-primer-seq-"):
            return "US-01M6TDFV AC1"
        if doc_id in TDFV_AC4_PROTEINS:
            return "US-01M6TDFV AC4"
        if doc_id == "doc-cloning-yadf-cds":
            return "US-01M6TDFV AC6"
        # An alignment document whose own sequence matches holds its first row, ungapped, and
        # US-01M6TDSV rebuilds every stored alignment and tree from its members' fetched records
        # (AC1, AC4). The COI
        # contig and its reads, and the yghJ read sets, become seeded simulations of their NCBI
        # references (US-01M6TDSV AC5).
        if doc_id.startswith(("doc-aln-", "doc-tree-", "doc-contig-")):
            return "replaced"
        return None
    # Every member of every sample alignment is identified by an exact match to a fetched NCBI
    # record, or dropped (US-01M6TGKH AC1, AC2).
    if doc_id.startswith("doc-aln-"):
        return "US-01M6TGKH AC1"
    # The tree documents are rebuilt from the rebuilt alignments (US-01M6TDSV AC4), and the contig
    # rows are simulated reads (US-01M6TDSV AC5).
    if doc_id.startswith(("doc-tree-", "doc-contig-")):
        return "replaced"
    return None


def normalise(seq: str) -> str:
    """Uppercase, U read as T, gaps and whitespace removed."""
    return re.sub(r"[\s.\-]", "", seq).upper().replace("U", "T")


def sha256(seq: str) -> str:
    return hashlib.sha256(seq.encode("ascii")).hexdigest()


def export_hashes(path: Path) -> set[str]:
    """The SHA-256 of every normalised record of a FASTA file. Fails on a file that holds none."""
    hashes: set[str] = set()
    chunks: list[str] | None = None
    with path.open(encoding="utf-8", errors="strict") as fh:
        for line in fh:
            if line.startswith(">"):
                if chunks is not None:
                    hashes.add(sha256(normalise("".join(chunks))))
                chunks = []
            elif chunks is not None:
                chunks.append(line)
    if chunks is not None:
        hashes.add(sha256(normalise("".join(chunks))))
    hashes.discard(sha256(""))
    if not hashes:
        sys.exit(f"error: the export file holds no FASTA record with a sequence: {path}")
    return hashes


def library(wasm: Path) -> list[dict]:
    if not wasm.is_file():
        sys.exit(f"error: no WASM engine at {wasm} (run npm run wasm:build)")
    run = subprocess.run(
        ["node", "--input-type=module", "-e", DUMP_JS, str(wasm)],
        capture_output=True, text=True, check=False,
    )
    if run.returncode != 0:
        sys.exit(f"error: the engine did not return the sample library: {run.stderr.strip()}")
    docs = json.loads(run.stdout)
    if not docs:
        sys.exit("error: the engine returned an empty sample library")
    return docs


def overlap(docs: list[dict], hashes: set[str]) -> tuple[list[tuple[str, str, str]], list[str]]:
    """The rows for every matching sequence, and the ids of matches no rule assigns."""
    rows: list[tuple[str, str, str]] = []
    unassigned: list[str] = []

    def consider(doc_id: str, member_id: str | None, seq: str) -> None:
        norm = normalise(seq)
        if not norm:
            return
        digest = sha256(norm)
        if digest not in hashes:
            return
        name = doc_id if member_id is None else f"{doc_id}/{member_id}"
        check = check_for(doc_id, member_id)
        if check is None:
            unassigned.append(name)
        else:
            rows.append((name, digest, check))

    for doc in docs:
        consider(doc["id"], None, doc.get("sequence") or "")
        for member in (doc.get("alignmentMeta") or {}).get("sequences") or []:
            consider(doc["id"], member["id"], member.get("sequence") or "")
    return rows, unassigned


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("export_fasta", type=Path, help="the export's FASTA file of every sample sequence")
    ap.add_argument("--wasm", type=Path, default=REPO / "public" / "molbiocraft_wasm.wasm")
    ap.add_argument("--out", type=Path, default=REPO / "sdlc-studio" / "decisions" / "sample-export-overlap.tsv")
    args = ap.parse_args()
    if not args.export_fasta.is_file():
        sys.exit(f"error: no export file at {args.export_fasta}")

    rows, unassigned = overlap(library(args.wasm), export_hashes(args.export_fasta))
    if unassigned:
        sys.exit("error: no check is assigned to these matching sequences: " + ", ".join(unassigned))
    if not rows:
        sys.exit("error: no sample sequence equals an export record; check the export file")
    names = [r[0] for r in rows]
    if len(set(names)) != len(names):
        sys.exit("error: a sample id repeats in the overlap")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("".join("\t".join(r) + "\n" for r in rows), encoding="utf-8")
    counts: dict[str, int] = {}
    for _, _, check in rows:
        counts[check] = counts.get(check, 0) + 1
    print(f"{len(rows)} sequences written to {args.out}")
    for check, n in sorted(counts.items()):
        print(f"  {check}: {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
