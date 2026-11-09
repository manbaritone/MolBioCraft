// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { ComputedDocumentRowMetrics } from '../core/workbenchBatchOperations';
import { SequenceDocument, SequenceDocumentIconKind } from '../types/bio';

/**
 * MolBioCraft Precision Duotone Bio-Engineering Icon System
 *
 * Design principles:
 * - Orthogonal horizontal duplexes, concentric genomic rings, directional barbed
 *   oligos, isometric 3D coordinate triads, and method-specific molecular junctions.
 * - Semantic duotone CSS custom property palette (`--mbc-ico-*`) so icons render
 *   with domain-coded accents at rest and invert cleanly to `currentColor` inside
 *   highlighted menu rows or active pill tabs.
 * - Decorative SVGs always carry `aria-hidden="true"` and `mbc-duotone-icon`.
 */

export type MolBioVisualDocKind =
  | 'circular-plasmid'
  | 'circular-genome'
  | 'linear-dsdna'
  | 'linear-rna'
  | 'primer-fwd'
  | 'primer-rev'
  | 'alignment-nt'
  | 'alignment-aa'
  | 'contig-assembly'
  | 'sanger-trace'
  | 'ngs-reads'
  | 'protein-seq'
  | 'structure-3d'
  | 'phylo-tree';

/**
 * Resolves one of 14 distinct MolBioCraft biological document visual archetypes
 * from a base `SequenceDocumentIconKind` and optional `SequenceDocument` context.
 */
export function resolveSequenceDocumentVisualKind(
  baseKind: SequenceDocumentIconKind,
  doc?: SequenceDocument
): MolBioVisualDocKind {
  if (!doc) {
    switch (baseKind) {
      case 'circular-dna':
        return 'circular-plasmid';
      case 'primer':
        return 'primer-fwd';
      case 'alignment':
        return 'alignment-nt';
      case 'contig':
        return 'contig-assembly';
      case 'trace':
        return 'sanger-trace';
      case 'protein':
        return 'protein-seq';
      case 'tree':
        return 'phylo-tree';
      case 'linear-dna':
      default:
        return 'linear-dsdna';
    }
  }

  const nameLower = doc.name.toLowerCase();
  const folderLower = (doc.folder || '').toLowerCase();
  const descLower = (doc.description || '').toLowerCase();
  const meta = doc.docMetadata || {};
  const oligoType = String(meta['Oligo Type'] ?? '').toLowerCase();
  const readTech = String(meta['Read Technology'] ?? '').toLowerCase();

  if (baseKind === 'tree') {
    return 'phylo-tree';
  }

  const chrom = doc.chromatogram;
  // NGS reads (FASTQ / SAM) keep their qualities in a chromatogram with no trace channels
  if (chrom && !chrom.traceA?.length && !chrom.traceC?.length && !chrom.traceG?.length && !chrom.traceT?.length) {
    return 'ngs-reads';
  }
  if (baseKind === 'trace' || Boolean(chrom)) {
    return 'sanger-trace';
  }

  const isExplicit3dStructure =
    Boolean(String(meta.PDBText ?? '').trim()) ||
    /\.(pdb|cif|mmcif)$/i.test(doc.name.trim()) ||
    /^[0-9][a-z0-9]{3}(?:_[a-z0-9]+)?$/i.test((doc.accession || '').trim()) ||
    /\b(3d structure|pdb structure|mmcif|coordinates)\b/i.test(
      `${doc.name} ${meta['Molecule Type'] ?? ''}`
    );

  if (isExplicit3dStructure) {
    return 'structure-3d';
  }

  if (baseKind === 'protein' || doc.moleculeType === 'Protein') {
    if (
      baseKind === 'alignment' ||
      folderLower.includes('alignment') ||
      /\b(msa|alignment|clustal|mafft|muscle)\b/i.test(`${doc.name} ${doc.description}`)
    ) {
      return 'alignment-aa';
    }
    return 'protein-seq';
  }

  if (baseKind === 'alignment' || folderLower === 'alignments') {
    const isProteinAlign =
      /\b(protein|amino|aa|polypeptide|blosum)\b/i.test(`${doc.name} ${doc.description}`);
    return isProteinAlign ? 'alignment-aa' : 'alignment-nt';
  }

  if (baseKind === 'contig') {
    const isRawReadSet =
      /\b(paired|illumina reads|ion torrent reads|fastq|nanopore reads|short reads|mate-pair)\b/i.test(
        `${doc.name} ${doc.description} ${readTech}`
      ) && !/\b(contig|assembly|consensus)\b/i.test(doc.name);
    return isRawReadSet ? 'ngs-reads' : 'contig-assembly';
  }

  if (
    /\b(paired reads|illumina reads|ion torrent reads|fastq reads)\b/i.test(
      `${nameLower} ${descLower}`
    )
  ) {
    return 'ngs-reads';
  }

  if (baseKind === 'primer' || folderLower.includes('primer')) {
    const isReverse =
      oligoType.includes('reverse') ||
      /\b(rev|reverse|antisense|_r\b|-r\b|3'<-5')\b/i.test(`${doc.name} ${oligoType}`);
    return isReverse ? 'primer-rev' : 'primer-fwd';
  }

  if (
    doc.moleculeType === 'RNA' ||
    /\b(mrna|ssrna|rrna|trna|viral rna)\b/i.test(`${nameLower} ${descLower}`)
  ) {
    return 'linear-rna';
  }

  if (baseKind === 'circular-dna' || doc.topology === 'circular') {
    const isCircularGenome =
      doc.sequence.length >= 25000 ||
      folderLower.startsWith('genomes') ||
      /\b(genome|chromosome|mitochondri|chloroplast|plastid|complete genome)\b/i.test(
        `${doc.name} ${doc.description} ${meta['Replicon type'] || ''}`
      );
    return isCircularGenome ? 'circular-genome' : 'circular-plasmid';
  }

  return 'linear-dsdna';
}

export interface MolBioDocTypeIconProps {
  kind: SequenceDocumentIconKind;
  doc?: SequenceDocument;
  visualOverride?: MolBioVisualDocKind;
  size?: number;
  title?: string;
  className?: string;
}

/**
 * Renders one of 14 distinct MolBioCraft Precision Duotone document-type icons.
 * Always preserves `mbc-doc-svg-icon` class for table and tab compatibility.
 */
export const MolBioDocTypeIcon: React.FC<MolBioDocTypeIconProps> = ({
  kind,
  doc,
  visualOverride,
  size = 16,
  title,
  className = '',
}) => {
  const visual = visualOverride ?? resolveSequenceDocumentVisualKind(kind, doc);
  const svgClass = `mbc-doc-svg-icon mbc-duotone-icon ${className}`.trim();

  switch (visual) {
    case 'circular-plasmid':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          className={svgClass}
          data-visual-kind={visual}
          aria-hidden="true"
        >
          {title ? <title>{title}</title> : null}
          <circle
            cx="8"
            cy="8"
            r="5.35"
            fill="var(--mbc-ico-teal, #0d9488)"
            fillOpacity="0.14"
            stroke="var(--mbc-ico-teal, #0d9488)"
            strokeWidth="1.65"
          />
          {/* Highlighted directional CDS feature arc */}
          <path
            d="M8 2.65A5.35 5.35 0 0 1 13.15 6.55"
            stroke="var(--mbc-ico-indigo, #2563eb)"
            strokeWidth="2.35"
            strokeLinecap="round"
          />
          <path
            d="m11.7 5.95 1.75 1.15.45-1.95"
            stroke="var(--mbc-ico-indigo, #2563eb)"
            strokeWidth="1.35"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Origin tick at 12 o'clock */}
          <path
            d="M8 1.2v2.1"
            stroke="var(--mbc-ico-teal, #0d9488)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'circular-genome':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          className={svgClass}
          data-visual-kind={visual}
          aria-hidden="true"
        >
          {title ? <title>{title}</title> : null}
          <circle
            cx="8"
            cy="8"
            r="5.8"
            fill="var(--mbc-ico-emerald, #059669)"
            fillOpacity="0.14"
            stroke="var(--mbc-ico-emerald, #059669)"
            strokeWidth="1.6"
          />
          <circle
            cx="8"
            cy="8"
            r="3.35"
            stroke="var(--mbc-ico-indigo, #2563eb)"
            strokeWidth="1.3"
            strokeDasharray="2.2 1.4"
          />
          <path
            d="M8 1.3v1.6M8 13.1v1.6M1.3 8h1.6M13.1 8h1.6"
            stroke="var(--mbc-ico-emerald, #059669)"
            strokeWidth="1.35"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'linear-rna':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          className={svgClass}
          data-visual-kind={visual}
          aria-hidden="true"
        >
          {title ? <title>{title}</title> : null}
          <rect
            x="1.4"
            y="4.2"
            width="13.2"
            height="7.6"
            rx="2"
            fill="var(--mbc-ico-rose, #e11d48)"
            fillOpacity="0.12"
          />
          <path
            d="M1.8 6.8c1.5-2.1 3.1-2.1 4.6 0s3.1 2.1 4.6 0 2.3-1.4 3.2-.3"
            stroke="var(--mbc-ico-rose, #e11d48)"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          {/* Ribonucleotide single-strand comb ticks */}
          <path
            d="M3.4 6.5v3.6M6.4 6.9v3.4M9.4 7.3v3.2M12.4 6.6v3.6"
            stroke="var(--mbc-ico-rose, #e11d48)"
            strokeWidth="1.35"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'primer-fwd':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          className={svgClass}
          data-visual-kind={visual}
          aria-hidden="true"
        >
          {title ? <title>{title}</title> : null}
          <rect
            x="1.5"
            y="4"
            width="13"
            height="8"
            rx="2"
            fill="var(--mbc-ico-violet, #7c3aed)"
            fillOpacity="0.13"
          />
          {/* 5' stem tick + barbed 3' right half-arrow */}
          <path
            d="M2.6 6.4v3.4h10.8L9.6 5.6"
            stroke="var(--mbc-ico-violet, #7c3aed)"
            strokeWidth="1.85"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="2.6" cy="6.1" r="1.05" fill="var(--mbc-ico-violet, #7c3aed)" />
        </svg>
      );

    case 'primer-rev':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          className={svgClass}
          data-visual-kind={visual}
          aria-hidden="true"
        >
          {title ? <title>{title}</title> : null}
          <rect
            x="1.5"
            y="4"
            width="13"
            height="8"
            rx="2"
            fill="var(--mbc-ico-amber, #d97706)"
            fillOpacity="0.14"
          />
          {/* 3'<-5' reverse barbed left half-arrow */}
          <path
            d="M13.4 9.6V6.2H2.6l3.8 4.2"
            stroke="var(--mbc-ico-amber, #d97706)"
            strokeWidth="1.85"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="13.4" cy="9.9" r="1.05" fill="var(--mbc-ico-amber, #d97706)" />
        </svg>
      );

    case 'alignment-nt':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          className={svgClass}
          data-visual-kind={visual}
          aria-hidden="true"
        >
          {title ? <title>{title}</title> : null}
          {/* Conserved alignment column highlight */}
          <rect
            x="6.2"
            y="1.6"
            width="3.4"
            height="12.8"
            rx="0.9"
            fill="var(--mbc-ico-indigo, #2563eb)"
            fillOpacity="0.16"
          />
          <rect x="1.5" y="2.6" width="13" height="2.2" rx="0.9" fill="var(--mbc-ico-teal, #0d9488)" />
          <rect x="1.5" y="6.9" width="8.6" height="2.2" rx="0.9" fill="var(--mbc-ico-indigo, #2563eb)" />
          <rect x="11.6" y="6.9" width="2.9" height="2.2" rx="0.9" fill="var(--mbc-ico-indigo, #2563eb)" />
          <rect x="3.4" y="11.2" width="11.1" height="2.2" rx="0.9" fill="var(--mbc-ico-emerald, #059669)" />
        </svg>
      );

    case 'alignment-aa':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          className={svgClass}
          data-visual-kind={visual}
          aria-hidden="true"
        >
          {title ? <title>{title}</title> : null}
          <rect
            x="5.6"
            y="1.6"
            width="4.2"
            height="12.8"
            rx="0.9"
            fill="var(--mbc-ico-cyan, #0284c7)"
            fillOpacity="0.18"
          />
          <rect x="1.5" y="2.6" width="13" height="2.2" rx="0.9" fill="var(--mbc-ico-cyan, #0284c7)" />
          <rect x="1.5" y="6.9" width="10.4" height="2.2" rx="0.9" fill="var(--mbc-ico-violet, #7c3aed)" />
          <rect x="2.8" y="11.2" width="11.7" height="2.2" rx="0.9" fill="var(--mbc-ico-cyan, #0284c7)" />
          <path d="M13.2 6.8 14.7 8l-1.5 1.2-1.4-1.2 1.4-1.2Z" fill="var(--mbc-ico-amber, #d97706)" />
        </svg>
      );

    case 'contig-assembly':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          className={svgClass}
          data-visual-kind={visual}
          aria-hidden="true"
        >
          {title ? <title>{title}</title> : null}
          {/* Coverage depth curve */}
          <path
            d="M1.6 6.3C3.4 6.1 4.6 2.2 8 2.2s4.6 3.9 6.4 4.1v1.1H1.6V6.3Z"
            fill="var(--mbc-ico-indigo, #2563eb)"
            fillOpacity="0.22"
          />
          <path
            d="M1.6 6.3C3.4 6.1 4.6 2.2 8 2.2s4.6 3.9 6.4 4.1"
            stroke="var(--mbc-ico-indigo, #2563eb)"
            strokeWidth="1.45"
            strokeLinecap="round"
          />
          {/* Tiled assembled read bricks */}
          <rect x="1.5" y="8.6" width="7.2" height="1.9" rx="0.8" fill="var(--mbc-ico-teal, #0d9488)" />
          <rect x="6.4" y="11.5" width="8.1" height="1.9" rx="0.8" fill="var(--mbc-ico-indigo, #2563eb)" />
          <rect x="10.1" y="8.6" width="4.4" height="1.9" rx="0.8" fill="var(--mbc-ico-emerald, #059669)" />
        </svg>
      );

    case 'sanger-trace':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          className={svgClass}
          data-visual-kind={visual}
          aria-hidden="true"
        >
          {title ? <title>{title}</title> : null}
          <rect
            x="1.2"
            y="2"
            width="13.6"
            height="12"
            rx="2"
            fill="var(--mbc-ico-cyan, #0284c7)"
            fillOpacity="0.1"
          />
          <path
            d="M1.5 12.6C2.6 12.6 3.2 4.3 4.3 4.3S5.8 12.6 7.1 12.6"
            stroke="var(--mbc-ico-emerald, #059669)"
            strokeWidth="1.55"
            strokeLinecap="round"
          />
          <path
            d="M5.1 12.6C6.3 12.6 7.1 3.1 8.2 3.1s1.8 9.5 3 9.5"
            stroke="var(--mbc-ico-indigo, #2563eb)"
            strokeWidth="1.55"
            strokeLinecap="round"
          />
          <path
            d="M9.2 12.6c1.1 0 1.8-7.4 2.8-7.4s1.5 7.4 2.5 7.4"
            stroke="var(--mbc-ico-rose, #e11d48)"
            strokeWidth="1.55"
            strokeLinecap="round"
          />
          <path
            d="M1.4 13.1h13.2"
            stroke="currentColor"
            strokeOpacity="0.35"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'ngs-reads':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          className={svgClass}
          data-visual-kind={visual}
          aria-hidden="true"
        >
          {title ? <title>{title}</title> : null}
          <rect
            x="1.4"
            y="2.4"
            width="13.2"
            height="11.2"
            rx="2"
            fill="var(--mbc-ico-indigo, #2563eb)"
            fillOpacity="0.11"
          />
          {/* Top mate-pair R1 -> ... <- R2 */}
          <path
            d="M2.2 5.6h4.4l-1.5-1.5M13.8 5.6H9.4l1.5-1.5"
            stroke="var(--mbc-ico-indigo, #2563eb)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Bottom mate-pair R1 -> ... <- R2 */}
          <path
            d="M2.2 10.6h4.4l-1.5 1.5M13.8 10.6H9.4l1.5 1.5"
            stroke="var(--mbc-ico-teal, #0d9488)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M7.3 5.6h1.4M7.3 10.6h1.4"
            stroke="currentColor"
            strokeOpacity="0.45"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'protein-seq':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          className={svgClass}
          data-visual-kind={visual}
          aria-hidden="true"
        >
          {title ? <title>{title}</title> : null}
          {/* Alpha-helix duotone cylinder + directional beta-strand ribbon */}
          <rect
            x="1.6"
            y="4.2"
            width="6.2"
            height="7.6"
            rx="2.6"
            fill="var(--mbc-ico-cyan, #0284c7)"
            fillOpacity="0.18"
            stroke="var(--mbc-ico-cyan, #0284c7)"
            strokeWidth="1.55"
          />
          <path
            d="M3.2 5.4c1.6 1.2 1.6 4 3 5.2"
            stroke="var(--mbc-ico-cyan, #0284c7)"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <path
            d="M7.8 8h5.8m0 0-2.3-2.5M13.6 8l-2.3 2.5"
            stroke="var(--mbc-ico-violet, #7c3aed)"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'structure-3d':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          className={svgClass}
          data-visual-kind={visual}
          aria-hidden="true"
        >
          {title ? <title>{title}</title> : null}
          {/* Isometric 3D macromolecular structure polyhedron */}
          <path
            d="M8 1.7 13.8 5v6L8 14.3 2.2 11V5L8 1.7Z"
            fill="var(--mbc-ico-cyan, #0284c7)"
            fillOpacity="0.16"
            stroke="var(--mbc-ico-cyan, #0284c7)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M8 1.9V8m0 0 5.6 2.9M8 8 2.4 10.9"
            stroke="var(--mbc-ico-violet, #7c3aed)"
            strokeWidth="1.35"
            strokeLinecap="round"
          />
          <circle cx="8" cy="8" r="1.55" fill="var(--mbc-ico-cyan, #0284c7)" />
        </svg>
      );

    case 'phylo-tree':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          className={svgClass}
          data-visual-kind={visual}
          aria-hidden="true"
        >
          {title ? <title>{title}</title> : null}
          <path
            d="M1.6 8.6h3.2M4.8 4v8.8M4.8 4h7.4M4.8 12.8h4.1M8.9 10.2v4.1M8.9 10.2h3.3M8.9 14.3h3.3"
            stroke="var(--mbc-ico-amber, #d97706)"
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="13.2" cy="4" r="1.25" fill="var(--mbc-ico-teal, #0d9488)" />
          <circle cx="13.2" cy="10.2" r="1.25" fill="var(--mbc-ico-indigo, #2563eb)" />
          <circle cx="13.2" cy="14.3" r="1.25" fill="var(--mbc-ico-amber, #d97706)" />
        </svg>
      );

    case 'linear-dsdna':
    default:
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          className={svgClass}
          data-visual-kind={visual}
          aria-hidden="true"
        >
          {title ? <title>{title}</title> : null}
          {/* Orthogonal horizontal base-paired dsDNA duplex track */}
          <rect
            x="1.6"
            y="4.8"
            width="12.8"
            height="6.4"
            rx="1.2"
            fill="var(--mbc-ico-indigo, #2563eb)"
            fillOpacity="0.13"
          />
          <path
            d="M1.6 4.8h12.8"
            stroke="var(--mbc-ico-indigo, #2563eb)"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <path
            d="M1.6 11.2h12.8"
            stroke="var(--mbc-ico-teal, #0d9488)"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <path
            d="M3.6 5.2v5.6M6.5 5.2v5.6M9.5 5.2v5.6M12.4 5.2v5.6"
            stroke="var(--mbc-ico-indigo, #2563eb)"
            strokeOpacity="0.72"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </svg>
      );
  }
};

/* ========================================================================= */
/* 2. MENU, SUB-MENU & STUDIO OPERATION GLYPH SYSTEM                          */
/* ========================================================================= */

export type MolBioMenuGlyphKind =
  | 'new-session'
  | 'open-session'
  | 'save-session'
  | 'new-sequence'
  | 'new-folder'
  | 'import-file'
  | 'import-clipboard'
  | 'import-sanger'
  | 'import-ngs'
  | 'import-db'
  | 'export-file'
  | 'print-pdf'
  | 'rename'
  | 'duplicate'
  | 'favorite'
  | 'put-back'
  | 'trash'
  | 'preferences'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'select-all'
  | 'find'
  | 'goto-pos'
  | 'nav-back'
  | 'nav-forward'
  | 'split-lr'
  | 'split-tb'
  | 'panel-sidebar'
  | 'panel-inspector'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'circular-view'
  | 'linear-view'
  | 'theme-contrast'
  | 'filter'
  | 'columns'
  | 'extract-region'
  | 'reverse-complement'
  | 'dna-to-rna'
  | 'translate-protein'
  | 'circularize'
  | 'linearize'
  | 'set-origin'
  | 'align-msa'
  | 'align-pairwise'
  | 'dotplot'
  | 'map-to-ref'
  | 'denovo-assemble'
  | 'synteny-genome'
  | 'consensus'
  | 'trim-reads'
  | 'tree-cladogram'
  | 'tree-bayesian'
  | 'ancestors'
  | 'subst-models'
  | 'codon-rscu'
  | 'evo-distance'
  | 'selection-dnds'
  | 'molecular-clock'
  | 'primer-design'
  | 'primer-map'
  | 'oligo-thermo'
  | 'crispr-cas9'
  | 'pcr-amplicon'
  | 'clone-restriction'
  | 'clone-golden-gate'
  | 'clone-gibson'
  | 'clone-infusion'
  | 'clone-gateway'
  | 'clone-topo'
  | 'clone-tagc'
  | 'clone-parts'
  | 'clone-soe-pcr'
  | 'mutagenesis'
  | 'anneal-oligos'
  | 'digest-scissors'
  | 'agarose-gel'
  | 'silent-mutation'
  | 'dna-calc'
  | 'blast-search'
  | 'workflow-pipeline'
  | 'detect-features'
  | 'find-orfs'
  | 'motif-jaspar'
  | 'variants-snp'
  | 'cpg-repeats'
  | 'structure-3d'
  | 'database-ncbi'
  | 'database-uniprot'
  | 'vector-catalog'
  | 'text-document'
  | 'import-folder'
  | 'help-shortcuts'
  | 'help-about'
  | 'submenu-folder';

/**
 * Deterministic semantic icon resolver mapping any MolBioCraft menu item ID and label
 * across main menus, sub-menus, toolbar dropdowns, home dropdowns, and row context menus
 * to a distinct Precision Duotone SVG glyph.
 */
export function resolveMenuGlyphKind(
  nodeId: string,
  label: string,
  isSubmenu = false
): MolBioMenuGlyphKind {
  const key = `${nodeId} ${label}`.toLowerCase();

  // Cloning method-specific glyphs first (so every cloning strategy has its own visual identity!)
  if (key.includes('golden gate') || key.includes('type iis') || key.includes('bsai')) {
    return 'clone-golden-gate';
  }
  if (key.includes('gibson') || key.includes('nebuilder') || key.includes('hifi')) {
    return 'clone-gibson';
  }
  if (key.includes('in-fusion') || key.includes('infusion')) {
    return 'clone-infusion';
  }
  if (key.includes('gateway') || key.includes('bp/lr') || key.includes('attb')) {
    return 'clone-gateway';
  }
  if (key.includes('topo')) {
    return 'clone-topo';
  }
  if (key.includes('ta / gc') || key.includes('ta/gc') || key.includes('ta cloning')) {
    return 'clone-tagc';
  }
  if (key.includes('modular') || key.includes('parts cloning') || key.includes('architect')) {
    return 'clone-parts';
  }
  if (key.includes('overlap extension') || key.includes('soe')) {
    return 'clone-soe-pcr';
  }
  if (key.includes('restriction') || key.includes('ligation') || key.includes('sticky')) {
    return 'clone-restriction';
  }
  if (key.includes('silent mut') || key.includes('noncutter') || key.includes('non-cutter')) {
    return 'silent-mutation';
  }
  if (key.includes('mutagen') || key.includes('shuffle') || key.includes('mutate')) {
    return 'mutagenesis';
  }
  if (key.includes('anneal oligo')) {
    return 'anneal-oligos';
  }
  if (key.includes('agarose') || key.includes('gel')) {
    return 'agarose-gel';
  }
  if (key.includes('digest') || key.includes('enzyme')) {
    return 'digest-scissors';
  }
  if (key.includes('dna calc') || key.includes('molar') || key.includes('molecular weight')) {
    return 'dna-calc';
  }

  // Primers & CRISPR
  if (key.includes('crispr') || key.includes('cas9') || key.includes('cas12') || key.includes('off-target')) {
    return 'crispr-cas9';
  }
  if (key.includes('saved primer') || key.includes('map primer') || key.includes('test primer')) {
    return 'primer-map';
  }
  if (key.includes('biophysics') || key.includes('hairpin') || key.includes('dimer') || key.includes('thermodynam')) {
    return 'oligo-thermo';
  }
  if (key.includes('extract pcr') || key.includes('amplicon') || key.includes('in silico pcr')) {
    return 'pcr-amplicon';
  }
  if (key.includes('primer') || key.includes('oligo')) {
    return 'primer-design';
  }

  // Alignments, Mapping, Assembly & Trimming
  if (key.includes('dotplot') || key.includes('k-mer')) {
    return 'dotplot';
  }
  if (key.includes('map to ref') || key.includes('minimap') || key.includes('reference map')) {
    return 'map-to-ref';
  }
  if (key.includes('de novo') || key.includes('spades') || key.includes('velvet') || key.includes('contig')) {
    return 'denovo-assemble';
  }
  if (key.includes('whole genome') || key.includes('whole-genome') || key.includes('synteny') || key.includes('mauve')) {
    return 'synteny-genome';
  }
  if (key.includes('trim') || key.includes('bbduk') || key.includes('adapter')) {
    return 'trim-reads';
  }
  if (key.includes('consensus')) {
    return 'consensus';
  }
  if (key.includes('pairwise') || key.includes('needleman') || key.includes('smith-waterman')) {
    return 'align-pairwise';
  }
  if (key.includes('align') || key.includes('mafft') || key.includes('clustal') || key.includes('muscle') || key.includes('poa')) {
    return 'align-msa';
  }

  // Phylogenetics & Evolution
  if (key.includes('mrbayes') || key.includes('bayesian') || key.includes('posterior')) {
    return 'tree-bayesian';
  }
  if (key.includes('ancest')) {
    return 'ancestors';
  }
  if (key.includes('rscu') || key.includes('codon usage') || key.includes('genetic code')) {
    return 'codon-rscu';
  }
  if (key.includes('substitution model') || key.includes('rate matrix') || key.includes('bic') || key.includes('aic') || key.includes('gamma')) {
    return 'subst-models';
  }
  if (key.includes('distance') || key.includes('diversity')) {
    return 'evo-distance';
  }
  if (key.includes('dn/ds') || key.includes('selection') || key.includes('tajima') || key.includes('neutrality')) {
    return 'selection-dnds';
  }
  if (key.includes('clock') || key.includes('reltime') || key.includes('timetree')) {
    return 'molecular-clock';
  }
  if (
    key.includes('tree') ||
    key.includes('phylogen') ||
    key.includes('phyml') ||
    key.includes('raxml') ||
    key.includes('fasttree') ||
    key.includes('neighbor-joining') ||
    key.includes('upgma') ||
    key.includes('parsimony')
  ) {
    return 'tree-cladogram';
  }

  // Sequence Manipulation & Genomics / Structure
  if (key.includes('3d') || key.includes('pdb') || key.includes('coiled-coil') || key.includes('transmembrane') || key.includes('secondary structure')) {
    return 'structure-3d';
  }
  if (key.includes('reverse complement')) {
    return 'reverse-complement';
  }
  if (key.includes('dna') && key.includes('rna')) {
    return 'dna-to-rna';
  }
  if (key.includes('translat')) {
    return 'translate-protein';
  }
  if (key.includes('circularize') || key.includes('toggle circular')) {
    return 'circularize';
  }
  if (key.includes('linearize')) {
    return 'linearize';
  }
  if (key.includes('set origin') || key.includes('change origin') || key.includes('origin')) {
    return 'set-origin';
  }
  if (key.includes('extract')) {
    return 'extract-region';
  }
  if (key.includes('orf') || key.includes('glimmer') || key.includes('reading frame')) {
    return 'find-orfs';
  }
  if (key.includes('motif') || key.includes('jaspar') || key.includes('tfbs')) {
    return 'motif-jaspar';
  }
  if (key.includes('variant') || key.includes('snp') || key.includes('freebayes') || key.includes('missense')) {
    return 'variants-snp';
  }
  if (key.includes('cpg') || key.includes('repeat') || key.includes('str') || key.includes('16s')) {
    return 'cpg-repeats';
  }
  if (key.includes('annotat') || key.includes('detect feature') || key.includes('plasmid feature')) {
    return 'detect-features';
  }

  // BLAST, Pipelines, Vectors & Databases
  if (key.includes('blast')) {
    return 'blast-search';
  }
  if (key.includes('workflow') || key.includes('pipeline') || key.includes('lineage') || key.includes('history')) {
    return 'workflow-pipeline';
  }
  if (key.includes('uniprot')) {
    return 'database-uniprot';
  }
  if (key.includes('ncbi') || key.includes('entrez') || key.includes('refseq') || key.includes('genbank submit') || key.includes('database')) {
    return 'database-ncbi';
  }
  if (key.includes('vector') || key.includes('plasmid')) {
    return 'vector-catalog';
  }

  // File / Import / Export / Session
  if (key.includes('sanger') || key.includes('.ab1') || key.includes('chromatogram')) {
    return 'import-sanger';
  }
  if (key.includes('fastq') || key.includes('ngs')) {
    return 'import-ngs';
  }
  if (key.includes('text document') || key.includes('flatfile document')) {
    return 'text-document';
  }
  if (key.includes('import folder')) {
    return 'import-folder';
  }
  if (key.includes('from clipboard')) {
    return 'import-clipboard';
  }
  if (key.includes('new session') || key.includes('sample library') || key.includes('sample project') || key.includes('welcome') || key.includes('home')) {
    return 'new-session';
  }
  if (key.includes('open session') || key.includes('open .mbc') || key.includes('restore') || key.includes('autosave') || key.includes('open folder')) {
    return 'open-session';
  }
  if (key.includes('save') || key.includes('.mbc')) {
    return 'save-session';
  }
  if (key.includes('new folder') || key.includes('move to folder') || key.includes('folder color')) {
    return 'new-folder';
  }
  if (key.includes('new sequence') || key.includes('blank sequence')) {
    return 'new-sequence';
  }
  if (key.includes('print') || key.includes('pdf') || key.includes('svg')) {
    return 'print-pdf';
  }
  if (key.includes('export') || key.includes('download') || key.includes('.gb') || key.includes('.fasta') || key.includes('.embl') || key.includes('.gff3') || key.includes('.csv') || key.includes('flatfile')) {
    return 'export-file';
  }
  if (key.includes('import') || key.includes('open file')) {
    return 'import-file';
  }
  if (key.includes('favorite') || key.includes('bookmark')) {
    return 'favorite';
  }
  if (key.includes('put back')) {
    return 'put-back';
  }
  if (key.includes('delete') || key.includes('erase') || key.includes('trash') || key.includes('remove') || key.includes('close')) {
    return 'trash';
  }
  if (key.includes('duplicate')) {
    return 'duplicate';
  }
  if (key.includes('rename')) {
    return 'rename';
  }
  if (key.includes('preference') || key.includes('setting')) {
    return 'preferences';
  }
  if (key.includes('quit') || key.includes('exit')) {
    return 'quit';
  }

  // Edit & View
  if (key.includes('undo')) return 'undo';
  if (key.includes('redo')) return 'redo';
  if (/\bcut\b/.test(key)) return 'cut';
  if (key.includes('copy')) return 'copy';
  if (key.includes('paste')) return 'paste';
  if (key.includes('select all') || key.includes('clear selection') || key.includes('next feature')) return 'select-all';
  if (key.includes('go to') || key.includes('position')) return 'goto-pos';
  if (key.includes('find') || key.includes('search')) return 'find';
  if (key.includes('navigate back') || /\bback\b/.test(key)) return 'nav-back';
  if (key.includes('navigate forward') || /\bforward\b/.test(key)) return 'nav-forward';
  if (key.includes('left / right') || key.includes('left/right') || key.includes('side-by-side')) return 'split-lr';
  if (key.includes('top / bottom') || key.includes('top/bottom') || key.includes('stacked')) return 'split-tb';
  if (key.includes('project explorer') || key.includes('left sidebar') || key.includes('document table')) return 'panel-sidebar';
  if (key.includes('inspector') || key.includes('controls') || key.includes('right')) return 'panel-inspector';
  if (key.includes('zoom in')) return 'zoom-in';
  if (key.includes('zoom out')) return 'zoom-out';
  if (key.includes('reset zoom') || key.includes('100%')) return 'zoom-reset';
  if (key.includes('circular')) return 'circular-view';
  if (key.includes('linear')) return 'linear-view';
  if (key.includes('dark') || key.includes('light') || key.includes('theme') || key.includes('color') || key.includes('appearance')) return 'theme-contrast';
  if (key.includes('filter')) return 'filter';
  if (key.includes('column')) return 'columns';
  if (key.includes('shortcut') || key.includes('keyboard')) return 'help-shortcuts';
  if (key.includes('about') || key.includes('license') || key.includes('documentation') || key.includes('guide')) return 'help-about';

  return isSubmenu ? 'submenu-folder' : 'detect-features';
}

export const MolBioMenuGlyph: React.FC<{
  glyph: MolBioMenuGlyphKind;
  size?: number;
  className?: string;
}> = ({ glyph, size = 15, className = '' }) => {
  const cls = `mbc-duotone-icon mbc-menu-svg-glyph ${className}`.trim();

  switch (glyph) {
    // --- Distinct Cloning Method Glyphs ---
    case 'clone-restriction':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          {/* Staggered sticky-end 5'/3' overhang step junction */}
          <path d="M1.5 5h5.8v6h7.2" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M1.5 11h3.2V5h9.8" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1.8 1.8" />
          <rect x="4.7" y="5" width="2.6" height="6" fill="var(--mbc-ico-teal, #0d9488)" fillOpacity="0.22" />
        </svg>
      );

    case 'clone-golden-gate':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          {/* Type IIS outward recognition site + golden seamless 4-nt fusion diamond */}
          <rect x="1.4" y="5.2" width="3.6" height="5.6" rx="1" fill="var(--mbc-ico-amber, #d97706)" fillOpacity="0.24" stroke="var(--mbc-ico-amber, #d97706)" strokeWidth="1.4" />
          <path d="M5.2 8h2.3M10.5 8h4" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.75" strokeLinecap="round" />
          <path d="M9 5.3 11.4 8 9 10.7 6.6 8 9 5.3Z" fill="var(--mbc-ico-amber, #d97706)" fillOpacity="0.28" stroke="var(--mbc-ico-amber, #d97706)" strokeWidth="1.45" />
        </svg>
      );

    case 'clone-gibson':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          {/* Overlapping exonuclease-chewed homologous strands annealing seamlessly */}
          <path d="M1.5 5.4h8.6l-2.1 2.4" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14.5 10.6H5.9L8 8.2" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="5.4" y="5.4" width="5.2" height="5.2" rx="1" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.16" />
        </svg>
      );

    case 'clone-infusion':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          {/* 15-bp terminal micro-homology dovetail lock */}
          <path d="M1.5 5.2h5.2l2 2.8-2 2.8H1.5" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.18" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.55" strokeLinejoin="round" />
          <path d="M14.5 5.2H9.3l2 2.8-2 2.8h5.2" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'clone-gateway':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          {/* Site-specific attB x attP recombination crossover */}
          <path d="M2 4.5c3.5 0 4.5 7 8 7h4" stroke="var(--mbc-ico-violet, #7c3aed)" strokeWidth="1.75" strokeLinecap="round" />
          <path d="M2 11.5c3.5 0 4.5-7 8-7h4" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="6" cy="8" r="1.9" fill="var(--mbc-ico-violet, #7c3aed)" fillOpacity="0.22" stroke="var(--mbc-ico-violet, #7c3aed)" strokeWidth="1.2" />
        </svg>
      );

    case 'clone-topo':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          {/* Topoisomerase covalent clamp nodes at duplex ends */}
          <path d="M1.6 6h4.2M10.2 6h4.2M1.6 10h4.2M10.2 10h4.2" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.65" strokeLinecap="round" />
          <circle cx="6.2" cy="6" r="1.45" fill="var(--mbc-ico-amber, #d97706)" />
          <circle cx="9.8" cy="10" r="1.45" fill="var(--mbc-ico-teal, #0d9488)" />
        </svg>
      );

    case 'clone-tagc':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          {/* Single 3'-A / 5'-T overhang tooth */}
          <rect x="1.5" y="5" width="5.8" height="6" rx="1" fill="var(--mbc-ico-teal, #0d9488)" fillOpacity="0.18" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.5" />
          <path d="M7.3 6.6h2.2v2.8H14.5V5H9.5" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'clone-parts':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          {/* 3 modular genetic part bricks [Promoter][CDS][Term] */}
          <rect x="1.4" y="5" width="3.8" height="6" rx="1" fill="var(--mbc-ico-teal, #0d9488)" fillOpacity="0.22" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.45" />
          <rect x="6.1" y="5" width="3.8" height="6" rx="1" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.22" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.45" />
          <rect x="10.8" y="5" width="3.8" height="6" rx="1" fill="var(--mbc-ico-amber, #d97706)" fillOpacity="0.22" stroke="var(--mbc-ico-amber, #d97706)" strokeWidth="1.45" />
        </svg>
      );

    case 'clone-soe-pcr':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M1.5 5.2h7.8M6.7 10.8h7.8" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.75" strokeLinecap="round" />
          <path d="M7.2 5.4v5.2M8.8 5.4v5.2" stroke="var(--mbc-ico-amber, #d97706)" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );

    case 'mutagenesis':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M1.5 10.8h13" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M8.7 2.2 6.1 7h3.3l-1.9 4.5" stroke="var(--mbc-ico-rose, #e11d48)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="8" cy="10.8" r="1.7" fill="var(--mbc-ico-rose, #e11d48)" />
        </svg>
      );

    case 'anneal-oligos':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M2 4.8h11.5l-2.4-2.2" stroke="var(--mbc-ico-violet, #7c3aed)" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 11.2H2.5l2.4 2.2" stroke="var(--mbc-ico-amber, #d97706)" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5.2 6v4M8 6v4M10.8 6v4" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );

    case 'digest-scissors':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <circle cx="4.1" cy="4.6" r="2" fill="var(--mbc-ico-rose, #e11d48)" fillOpacity="0.18" stroke="var(--mbc-ico-rose, #e11d48)" strokeWidth="1.45" />
          <circle cx="4.1" cy="11.4" r="2" fill="var(--mbc-ico-rose, #e11d48)" fillOpacity="0.18" stroke="var(--mbc-ico-rose, #e11d48)" strokeWidth="1.45" />
          <path d="M5.7 5.8 14 12M5.7 10.2 14 4" stroke="var(--mbc-ico-rose, #e11d48)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );

    case 'agarose-gel':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="2" y="1.8" width="12" height="12.4" rx="1.8" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.14" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.5" />
          <path d="M4.2 4.6h2.6M4.2 7.4h2.6M4.2 10.8h2.6M9.2 6h2.6M9.2 9.6h2.6" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.65" strokeLinecap="round" />
        </svg>
      );

    case 'silent-mutation':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M8 1.8 13.4 4v4.2c0 3.1-2.2 5.2-5.4 6.2-3.2-1-5.4-3.1-5.4-6.2V4L8 1.8Z" fill="var(--mbc-ico-teal, #0d9488)" fillOpacity="0.16" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="m5.6 8.1 1.7 1.7 3.2-3.4" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'dna-calc':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="2.5" y="1.8" width="11" height="12.4" rx="1.8" fill="var(--mbc-ico-cyan, #0284c7)" fillOpacity="0.14" stroke="var(--mbc-ico-cyan, #0284c7)" strokeWidth="1.5" />
          <rect x="4.6" y="4" width="6.8" height="2.4" rx="0.6" fill="var(--mbc-ico-cyan, #0284c7)" />
          <circle cx="5.5" cy="9" r="0.9" fill="var(--mbc-ico-cyan, #0284c7)" />
          <circle cx="8" cy="9" r="0.9" fill="var(--mbc-ico-cyan, #0284c7)" />
          <circle cx="10.5" cy="9" r="0.9" fill="var(--mbc-ico-cyan, #0284c7)" />
          <circle cx="5.5" cy="11.6" r="0.9" fill="var(--mbc-ico-cyan, #0284c7)" />
          <path d="M8 11.6h2.6" stroke="var(--mbc-ico-cyan, #0284c7)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    // --- Primers & CRISPR ---
    case 'primer-design':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M2 6.2h11.5L10.3 3" stroke="var(--mbc-ico-violet, #7c3aed)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 10.2H2.5L5.7 13.4" stroke="var(--mbc-ico-amber, #d97706)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'primer-map':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M1.5 11.6h13" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M3 7.2h9.5L9.6 4" stroke="var(--mbc-ico-violet, #7c3aed)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 7.6v3.5M7.8 7.6v3.5M10.6 7.6v3.5" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
      );

    case 'oligo-thermo':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          {/* Stem-loop hairpin thermodynamic glyph */}
          <circle cx="8" cy="4.6" r="2.7" fill="var(--mbc-ico-rose, #e11d48)" fillOpacity="0.16" stroke="var(--mbc-ico-rose, #e11d48)" strokeWidth="1.55" />
          <path d="M6.4 7v6.6M9.6 7v6.6" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.55" strokeLinecap="round" />
          <path d="M6.6 9.3h2.8M6.6 11.6h2.8" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );

    case 'crispr-cas9':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          {/* sgRNA scaffold loop + Cas cleavage target */}
          <ellipse cx="8" cy="8.2" rx="5.8" ry="4.6" fill="var(--mbc-ico-violet, #7c3aed)" fillOpacity="0.16" stroke="var(--mbc-ico-violet, #7c3aed)" strokeWidth="1.45" />
          <path d="M2.2 9.4h11.6" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M10.4 4.2v7.2" stroke="var(--mbc-ico-rose, #e11d48)" strokeWidth="1.65" strokeLinecap="round" strokeDasharray="1.6 1.4" />
        </svg>
      );

    case 'pcr-amplicon':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="3" y="6.2" width="10" height="3.6" rx="1" fill="var(--mbc-ico-teal, #0d9488)" fillOpacity="0.22" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.5" />
          <path d="M2 3.8h4.6L4.9 2.1M14 12.2H9.4l1.7 1.7" stroke="var(--mbc-ico-violet, #7c3aed)" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    // --- Alignment, Mapping & Assembly ---
    case 'align-msa':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M1.8 3.6c2.2 0 3 2.2 5.2 2.2h7.2M1.8 8h12.4M1.8 12.4c2.2 0 3-2.2 5.2-2.2h7.2" stroke="var(--mbc-ico-emerald, #059669)" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );

    case 'align-pairwise':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M1.6 5h12.8M1.6 11h12.8" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4.2 5.4v5.2M8 5.4v5.2M11.8 5.4v5.2" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.45" strokeLinecap="round" />
        </svg>
      );

    case 'dotplot':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="2" y="2" width="12" height="12" rx="1.6" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.12" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.5" />
          <path d="M3.6 12.4 12.4 3.6" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="5.2" cy="6.2" r="0.9" fill="var(--mbc-ico-amber, #d97706)" />
          <circle cx="10.4" cy="10.6" r="0.9" fill="var(--mbc-ico-amber, #d97706)" />
        </svg>
      );

    case 'map-to-ref':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="1.5" y="2.3" width="13" height="2.4" rx="0.9" fill="var(--mbc-ico-indigo, #2563eb)" />
          <path d="M8 9.2V5.6m0 0L6.3 7.3M8 5.6l1.7 1.7" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M2 11.2h5.2M8.8 11.2H14M4.4 13.5h7.2" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.65" strokeLinecap="round" />
        </svg>
      );

    case 'denovo-assemble':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M1.6 4.2h6.2M8.2 7.2h6.2M4 10.2h6.8M2.2 13.2h11.6" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.75" strokeLinecap="round" />
          <rect x="4" y="9.2" width="6.8" height="2" rx="0.8" fill="var(--mbc-ico-teal, #0d9488)" fillOpacity="0.3" />
        </svg>
      );

    case 'synteny-genome':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M1.6 3.2h12.8M1.6 12.8h12.8" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M3.2 3.6 11.8 12.4M11.8 3.6 3.2 12.4" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    case 'consensus':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M2 3.2h12M2 6.2h9.2" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M8 7.8v2.8m0 0-1.6-1.5M8 10.6l1.6-1.5" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="1.6" y="12" width="12.8" height="2.3" rx="1" fill="var(--mbc-ico-teal, #0d9488)" />
        </svg>
      );

    case 'trim-reads':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M1.6 9.5h8.4" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="2" strokeLinecap="round" />
          <path d="M10.4 9.5h4" stroke="var(--mbc-ico-rose, #e11d48)" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="1.5 1.7" />
          <path d="M10.1 3v10" stroke="var(--mbc-ico-rose, #e11d48)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    // --- Phylogenetics & Evolutionary Analysis ---
    case 'tree-cladogram':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M1.6 8.4h3.2M4.8 3.8v9M4.8 3.8h8.8M4.8 12.8h4.2M9 10v4.2M9 10h4.6M9 14.2h4.6" stroke="var(--mbc-ico-amber, #d97706)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'tree-bayesian':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M1.6 8.4h3.2M4.8 4v8.6M4.8 4h8.6M4.8 12.6h8.6" stroke="var(--mbc-ico-violet, #7c3aed)" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="4.8" cy="8.4" r="2" fill="var(--mbc-ico-amber, #d97706)" fillOpacity="0.28" stroke="var(--mbc-ico-amber, #d97706)" strokeWidth="1.3" />
        </svg>
      );

    case 'ancestors':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M2 8h3.4M5.4 3.8v8.4M5.4 3.8h8.2M5.4 12.2h8.2" stroke="var(--mbc-ico-amber, #d97706)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="5.4" cy="8" r="2.3" fill="var(--mbc-ico-teal, #0d9488)" />
        </svg>
      );

    case 'subst-models':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="2" y="2" width="12" height="12" rx="1.8" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.14" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.5" />
          <path d="M6 2.2v11.6M10 2.2v11.6M2.2 6h11.6M2.2 10h11.6" stroke="var(--mbc-ico-indigo, #2563eb)" strokeOpacity="0.65" strokeWidth="1.2" />
        </svg>
      );

    case 'codon-rscu':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="2.2" y="8.2" width="2.8" height="5.4" rx="0.8" fill="var(--mbc-ico-teal, #0d9488)" />
          <rect x="6.6" y="3.4" width="2.8" height="10.2" rx="0.8" fill="var(--mbc-ico-indigo, #2563eb)" />
          <rect x="11" y="5.8" width="2.8" height="7.8" rx="0.8" fill="var(--mbc-ico-amber, #d97706)" />
        </svg>
      );

    case 'evo-distance':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <circle cx="3.2" cy="8" r="1.8" fill="var(--mbc-ico-teal, #0d9488)" />
          <circle cx="12.8" cy="8" r="1.8" fill="var(--mbc-ico-amber, #d97706)" />
          <path d="M5.4 8h5.2" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.65" strokeLinecap="round" strokeDasharray="1.6 1.5" />
        </svg>
      );

    case 'selection-dnds':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M8 2.4v11.2M3 5.2h10" stroke="var(--mbc-ico-amber, #d97706)" strokeWidth="1.55" strokeLinecap="round" />
          <path d="m3.4 5.6-1.6 3.6h3.2L3.4 5.6ZM12.6 5.6 11 9.2h3.2l-1.6-3.6Z" fill="var(--mbc-ico-teal, #0d9488)" fillOpacity="0.28" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      );

    case 'molecular-clock':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <circle cx="8" cy="8" r="5.8" fill="var(--mbc-ico-amber, #d97706)" fillOpacity="0.14" stroke="var(--mbc-ico-amber, #d97706)" strokeWidth="1.55" />
          <path d="M8 4.6V8l2.5 1.8" stroke="var(--mbc-ico-amber, #d97706)" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    // --- Sequence Manipulation, Annotation & Genomics ---
    case 'extract-region':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M1.6 11.8h3.4M11 11.8h3.4" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.7" strokeLinecap="round" />
          <rect x="4.6" y="4.2" width="6.8" height="3.2" rx="1" fill="var(--mbc-ico-teal, #0d9488)" fillOpacity="0.24" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.55" />
          <path d="M8 11.6V8.4" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.45" strokeLinecap="round" />
        </svg>
      );

    case 'reverse-complement':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M2 5.4h12l-2.4-2.3" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 10.6H2l2.4 2.3" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'dna-to-rna':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M1.6 5.2h5.2M1.6 9.8h5.2" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.65" strokeLinecap="round" />
          <path d="M8.6 7.5c1.1-2 2.2-2 3.3 0s1.7 1.6 2.5 0" stroke="var(--mbc-ico-rose, #e11d48)" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );

    case 'translate-protein':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="1.5" y="2.6" width="13" height="2.4" rx="0.8" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.22" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.35" />
          <circle cx="4" cy="11.2" r="2" fill="var(--mbc-ico-cyan, #0284c7)" />
          <circle cx="8" cy="11.2" r="2" fill="var(--mbc-ico-violet, #7c3aed)" />
          <circle cx="12" cy="11.2" r="2" fill="var(--mbc-ico-teal, #0d9488)" />
        </svg>
      );

    case 'circularize':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M13.2 8A5.2 5.2 0 1 1 9.6 3" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.75" strokeLinecap="round" />
          <path d="m8.8 1.6 2 1.6-2 1.6" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'linearize':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M2 8h12M2 5.8v4.4M14 5.8v4.4" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );

    case 'set-origin':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <circle cx="8" cy="9" r="5" fill="var(--mbc-ico-teal, #0d9488)" fillOpacity="0.14" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.6" />
          <path d="M8 1.4v3.4" stroke="var(--mbc-ico-amber, #d97706)" strokeWidth="2" strokeLinecap="round" />
          <circle cx="8" cy="4" r="1.35" fill="var(--mbc-ico-amber, #d97706)" />
        </svg>
      );

    case 'detect-features':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M2 6h8.2L13.5 9l-3.3 3H2V6Z" fill="var(--mbc-ico-teal, #0d9488)" fillOpacity="0.2" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.55" strokeLinejoin="round" />
          <path d="M12.6 2.1v2.6M11.3 3.4h2.6" stroke="var(--mbc-ico-amber, #d97706)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    case 'find-orfs':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="2" y="5.5" width="9.8" height="5" rx="1" fill="var(--mbc-ico-emerald, #059669)" fillOpacity="0.22" stroke="var(--mbc-ico-emerald, #059669)" strokeWidth="1.5" />
          <path d="m11.8 5.5 2.6 2.5-2.6 2.5" stroke="var(--mbc-ico-emerald, #059669)" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'motif-jaspar':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="2" y="9" width="2.4" height="4.8" rx="0.6" fill="var(--mbc-ico-emerald, #059669)" />
          <rect x="5.4" y="4.5" width="2.4" height="9.3" rx="0.6" fill="var(--mbc-ico-indigo, #2563eb)" />
          <rect x="8.8" y="2.4" width="2.4" height="11.4" rx="0.6" fill="var(--mbc-ico-amber, #d97706)" />
          <rect x="12.2" y="6.8" width="2.4" height="7" rx="0.6" fill="var(--mbc-ico-rose, #e11d48)" />
        </svg>
      );

    case 'variants-snp':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M1.6 11.8h12.8" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M8 5.8v5.6" stroke="var(--mbc-ico-rose, #e11d48)" strokeWidth="1.65" strokeLinecap="round" />
          <circle cx="8" cy="4.1" r="2" fill="var(--mbc-ico-rose, #e11d48)" fillOpacity="0.24" stroke="var(--mbc-ico-rose, #e11d48)" strokeWidth="1.45" />
        </svg>
      );

    case 'cpg-repeats':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M1.6 12h12.8" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.75" strokeLinecap="round" />
          <path d="M4.6 6.4V12M8 5.2V12M11.4 6.4V12" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.4" />
          <circle cx="4.6" cy="5.2" r="1.35" fill="var(--mbc-ico-teal, #0d9488)" />
          <circle cx="8" cy="3.8" r="1.35" fill="var(--mbc-ico-indigo, #2563eb)" />
          <circle cx="11.4" cy="5.2" r="1.35" fill="var(--mbc-ico-teal, #0d9488)" />
        </svg>
      );

    case 'structure-3d':
      return <MolBioDocTypeIcon kind="protein" visualOverride="structure-3d" size={size} />;

    // --- BLAST, Workflows, Databases & Vectors ---
    case 'blast-search':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <circle cx="6.8" cy="7.2" r="4.5" fill="var(--mbc-ico-amber, #d97706)" fillOpacity="0.14" stroke="var(--mbc-ico-amber, #d97706)" strokeWidth="1.6" />
          <path d="m10.2 10.6 3.5 3.5" stroke="var(--mbc-ico-amber, #d97706)" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M12.6 1.8v3M11.1 3.3h3" stroke="var(--mbc-ico-rose, #e11d48)" strokeWidth="1.45" strokeLinecap="round" />
        </svg>
      );

    case 'workflow-pipeline':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <circle cx="3.2" cy="4.4" r="1.9" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.22" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.45" />
          <circle cx="3.2" cy="11.6" r="1.9" fill="var(--mbc-ico-teal, #0d9488)" fillOpacity="0.22" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.45" />
          <circle cx="12.6" cy="8" r="2.1" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.25" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.5" />
          <path d="M5.1 5.1 10.5 7.4M5.1 10.9l5.4-2.3" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );

    case 'database-ncbi':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <ellipse cx="8" cy="3.5" rx="5.2" ry="1.9" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.22" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.45" />
          <path d="M2.8 3.5v8.8c0 1.05 2.33 1.9 5.2 1.9s5.2-.85 5.2-1.9V3.5" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.45" />
          <path d="M2.8 7.9c0 1.05 2.33 1.9 5.2 1.9s5.2-.85 5.2-1.9" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.35" />
        </svg>
      );

    case 'database-uniprot':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M8 1.6 13.4 3.8v4.3c0 3.2-2.2 5.3-5.4 6.3-3.2-1-5.4-3.1-5.4-6.3V3.8L8 1.6Z" fill="var(--mbc-ico-cyan, #0284c7)" fillOpacity="0.18" stroke="var(--mbc-ico-cyan, #0284c7)" strokeWidth="1.5" />
          <circle cx="8" cy="7.8" r="2.1" fill="var(--mbc-ico-cyan, #0284c7)" />
        </svg>
      );

    case 'vector-catalog':
      return <MolBioDocTypeIcon kind="circular-dna" visualOverride="circular-plasmid" size={size} />;

    // --- File / Session / Import / Export ---
    case 'new-session':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.14" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.5" />
          <path d="M8 5.5v5M5.5 8h5" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );

    case 'open-session':
    case 'submenu-folder':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M1.8 4.4A1.6 1.6 0 0 1 3.4 2.8h3.1l1.3 1.5h4.8a1.6 1.6 0 0 1 1.6 1.6v5.7a1.6 1.6 0 0 1-1.6 1.6H3.4a1.6 1.6 0 0 1-1.6-1.6V4.4Z" fill="var(--mbc-ico-amber, #d97706)" fillOpacity="0.16" stroke="var(--mbc-ico-amber, #d97706)" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );

    case 'save-session':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M3.2 2.2h7.6l3 3v7.6a1.4 1.4 0 0 1-1.4 1.4H3.2a1.4 1.4 0 0 1-1.4-1.4V3.6a1.4 1.4 0 0 1 1.4-1.4Z" fill="var(--mbc-ico-teal, #0d9488)" fillOpacity="0.14" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.5" strokeLinejoin="round" />
          <rect x="4.8" y="9.2" width="6.4" height="4.8" rx="0.8" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.35" />
        </svg>
      );

    case 'new-sequence':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M1.6 6.2h9.2M1.6 10.6h9.2" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M4 6.6v3.6M7.6 6.6v3.6" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.25" />
          <path d="M12.6 2.2v4.4M10.4 4.4h4.4" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );

    case 'new-folder':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M1.8 4.4A1.6 1.6 0 0 1 3.4 2.8h3l1.3 1.5h4.9a1.6 1.6 0 0 1 1.6 1.6v5.7a1.6 1.6 0 0 1-1.6 1.6H3.4a1.6 1.6 0 0 1-1.6-1.6V4.4Z" fill="var(--mbc-ico-teal, #0d9488)" fillOpacity="0.15" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.5" />
          <path d="M8 6.8v4M6 8.8h4" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.55" strokeLinecap="round" />
        </svg>
      );

    case 'text-document':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M3.4 1.8h6.2l3 3v8.4a1.4 1.4 0 0 1-1.4 1.4H3.4a1.4 1.4 0 0 1-1.4-1.4V3.2a1.4 1.4 0 0 1 1.4-1.4Z" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.13" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.45" strokeLinejoin="round" />
          <path d="M5 7h6M5 9.6h6M5 12h3.8" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );

    case 'import-folder':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M1.8 4.4A1.6 1.6 0 0 1 3.4 2.8h3l1.3 1.5h4.9a1.6 1.6 0 0 1 1.6 1.6v5.7a1.6 1.6 0 0 1-1.6 1.6H3.4a1.6 1.6 0 0 1-1.6-1.6V4.4Z" fill="var(--mbc-ico-amber, #d97706)" fillOpacity="0.16" stroke="var(--mbc-ico-amber, #d97706)" strokeWidth="1.45" />
          <path d="M8 5.6v4.6m0 0-1.9-1.9M8 10.2l1.9-1.9" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'import-file':
    case 'import-db':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M2.4 10.6v1.8a1.6 1.6 0 0 0 1.6 1.6h8a1.6 1.6 0 0 0 1.6-1.6v-1.8" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M8 2.2v7.6m0 0L5.3 7.1M8 9.8l2.7-2.7" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'import-clipboard':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="3" y="3" width="10" height="11" rx="1.6" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.13" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.5" />
          <rect x="5.6" y="1.6" width="4.8" height="2.4" rx="0.8" fill="var(--mbc-ico-indigo, #2563eb)" />
          <path d="M5.4 7.8h5.2M5.4 10.6h3.6" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.45" strokeLinecap="round" />
        </svg>
      );

    case 'import-sanger':
      return <MolBioDocTypeIcon kind="trace" visualOverride="sanger-trace" size={size} />;

    case 'import-ngs':
      return <MolBioDocTypeIcon kind="contig" visualOverride="ngs-reads" size={size} />;

    case 'export-file':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M2.4 10.6v1.8a1.6 1.6 0 0 0 1.6 1.6h8a1.6 1.6 0 0 0 1.6-1.6v-1.8" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M8 9.8V2.2m0 0L5.3 4.9M8 2.2l2.7 2.7" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'print-pdf':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="3" y="2" width="10" height="12" rx="1.6" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.12" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.5" />
          <circle cx="8" cy="8" r="2.6" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.45" />
        </svg>
      );

    case 'favorite':
      return <MolBioStarIcon active size={size} />;

    case 'put-back':
    case 'undo':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M3.2 6.2h6.4a3.6 3.6 0 1 1 0 7.2H6.4" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
          <path d="M5.6 3.6 2.8 6.2l2.8 2.6" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'redo':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M12.8 6.2H6.4a3.6 3.6 0 1 0 0 7.2h3.2" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
          <path d="m10.4 3.6 2.8 2.6-2.8 2.6" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'trash':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M2.8 4.4h10.4M6 4.4V2.8h4v1.6m1.8 0-.7 8.4a1.4 1.4 0 0 1-1.4 1.3H6.3a1.4 1.4 0 0 1-1.4-1.3L4.2 4.4" stroke="var(--mbc-ico-rose, #e11d48)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'duplicate':
    case 'copy':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="5.2" y="5.2" width="8.4" height="8.4" rx="1.5" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3.4 10.6H2.8a1.2 1.2 0 0 1-1.2-1.2V3a1.4 1.4 0 0 1 1.4-1.4h6.4a1.2 1.2 0 0 1 1.2 1.2v.6" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
        </svg>
      );

    case 'cut':
      return <MolBioMenuGlyph glyph="digest-scissors" size={size} className={className} />;

    case 'paste':
      return <MolBioMenuGlyph glyph="import-clipboard" size={size} className={className} />;

    case 'rename':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="1.8" y="4.4" width="12.4" height="7.2" rx="1.5" stroke="currentColor" strokeWidth="1.45" />
          <path d="M6.2 2.8v10.4M4.6 2.8h3.2M4.6 13.2h3.2" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    case 'select-all':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.8" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.5" strokeDasharray="2.2 1.8" />
          <rect x="5" y="5" width="6" height="6" rx="1" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.24" />
        </svg>
      );

    case 'find':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <circle cx="7" cy="7" r="4.4" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="1.6" />
          <path d="m10.4 10.4 3.4 3.4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );

    case 'goto-pos':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <circle cx="8" cy="8" r="4.8" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.5" />
          <path d="M8 1.5v2.4M8 12.1v2.4M1.5 8h2.4M12.1 8h2.4" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="8" r="1.4" fill="var(--mbc-ico-teal, #0d9488)" />
        </svg>
      );

    case 'nav-back':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M13.2 8H3.2m0 0 3.8-3.8M3.2 8 7 11.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'nav-forward':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M2.8 8h10m0 0L9 4.2M12.8 8 9 11.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'split-lr':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="1.8" y="2.4" width="12.4" height="11.2" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 2.6v10.8" stroke="currentColor" strokeWidth="1.5" />
          <rect x="2.5" y="3.1" width="4.8" height="9.8" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.2" />
        </svg>
      );

    case 'split-tb':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="1.8" y="2.4" width="12.4" height="11.2" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
          <path d="M2 8h12" stroke="currentColor" strokeWidth="1.5" />
          <rect x="2.5" y="3.1" width="11" height="4.3" fill="var(--mbc-ico-teal, #0d9488)" fillOpacity="0.2" />
        </svg>
      );

    case 'panel-sidebar':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="1.8" y="2.4" width="12.4" height="11.2" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 2.6v10.8" stroke="currentColor" strokeWidth="1.45" />
          <rect x="2.5" y="3.1" width="2.9" height="9.8" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.22" />
        </svg>
      );

    case 'panel-inspector':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="1.8" y="2.4" width="12.4" height="11.2" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 2.6v10.8" stroke="currentColor" strokeWidth="1.45" />
          <rect x="10.6" y="3.1" width="2.9" height="9.8" fill="var(--mbc-ico-teal, #0d9488)" fillOpacity="0.22" />
        </svg>
      );

    case 'zoom-in':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 5v4M5 7h4m1.5 3.5 3.3 3.3" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
        </svg>
      );

    case 'zoom-out':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 7h4m1.5 3.5 3.3 3.3" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
        </svg>
      );

    case 'zoom-reset':
    case 'circular-view':
      return <MolBioDocTypeIcon kind="circular-dna" visualOverride="circular-plasmid" size={size} />;

    case 'linear-view':
      return <MolBioDocTypeIcon kind="linear-dna" visualOverride="linear-dsdna" size={size} />;

    case 'theme-contrast':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.55" />
          <path d="M8 2.5a5.5 5.5 0 0 1 0 11v-11Z" fill="currentColor" fillOpacity="0.45" />
        </svg>
      );

    case 'filter':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M2 3h12L9.4 8.2v4.3l-2.8 1.2V8.2L2 3Z" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );

    case 'columns':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="1.6" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 2.8v10.4M10 2.8v10.4M2.2 5.6h11.6" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );

    case 'preferences':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M2 4.8h12M2 11.2h12" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
          <circle cx="5.6" cy="4.8" r="1.8" fill="var(--mbc-ico-indigo, #2563eb)" />
          <circle cx="10.4" cy="11.2" r="1.8" fill="var(--mbc-ico-teal, #0d9488)" />
        </svg>
      );

    case 'quit':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <path d="M6.4 2.4H3.6A1.6 1.6 0 0 0 2 4v8a1.6 1.6 0 0 0 1.6 1.6h2.8M10.4 5.2 13.6 8l-3.2 2.8M6.2 8h7.2" stroke="var(--mbc-ico-rose, #e11d48)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'help-shortcuts':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <rect x="1.6" y="3.4" width="12.8" height="9.2" rx="1.8" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4.2 6.4h1.4M7.3 6.4h1.4M10.4 6.4h1.4M4.8 9.8h6.4" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
        </svg>
      );

    case 'help-about':
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} data-glyph={glyph} aria-hidden="true">
          <circle cx="8" cy="8" r="5.8" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.14" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.55" />
          <path d="M8 7.2v3.8" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.65" strokeLinecap="round" />
          <circle cx="8" cy="4.8" r="0.95" fill="var(--mbc-ico-teal, #0d9488)" />
        </svg>
      );
  }
};

export function resolveMenuItemIcon(
  nodeId: string,
  label: string,
  isSubmenu = false,
  size = 15
): React.ReactNode {
  const glyph = resolveMenuGlyphKind(nodeId, label, isSubmenu);
  return <MolBioMenuGlyph glyph={glyph} size={size} />;
}

/* ========================================================================= */
/* 3. TABLE ATTRIBUTE DATA MICRO-ICONS, METERS, STARS, STATUS & HEADERS      */
/* ========================================================================= */

export const MolBioStarIcon: React.FC<{
  active: boolean;
  size?: number;
  className?: string;
}> = ({ active, size = 14, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    className={`mbc-duotone-icon mbc-star-svg ${active ? 'is-active' : ''} ${className}`.trim()}
    aria-hidden="true"
  >
    <path
      d="m8 1.7 1.92 3.89 4.29.62-3.1 3.03.73 4.27L8 11.49l-3.84 2.02.73-4.27-3.1-3.03 4.29-.62L8 1.7Z"
      fill={active ? 'var(--mbc-ico-amber, #f59e0b)' : 'none'}
      fillOpacity={active ? 0.92 : 0}
      stroke={active ? 'var(--mbc-ico-amber, #d97706)' : 'currentColor'}
      strokeOpacity={active ? 1 : 0.45}
      strokeWidth="1.45"
      strokeLinejoin="round"
    />
  </svg>
);

export const MolBioStatusBadgeIcon: React.FC<{
  ok: boolean;
  size?: number;
}> = ({ ok, size = 14 }) =>
  ok ? (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className="mbc-duotone-icon mbc-status-svg is-ok"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="var(--mbc-ico-emerald, #059669)"
        fillOpacity="0.16"
        stroke="var(--mbc-ico-emerald, #059669)"
        strokeWidth="1.5"
      />
      <path
        d="m5.3 8.2 1.85 1.85 3.65-3.85"
        stroke="var(--mbc-ico-emerald, #059669)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className="mbc-duotone-icon mbc-status-svg is-warn"
      aria-hidden="true"
    >
      <path
        d="M8 2.1 14.3 13H1.7L8 2.1Z"
        fill="var(--mbc-ico-amber, #d97706)"
        fillOpacity="0.18"
        stroke="var(--mbc-ico-amber, #d97706)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M8 6.2v3.3"
        stroke="var(--mbc-ico-amber, #d97706)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11.3" r="0.85" fill="var(--mbc-ico-amber, #d97706)" />
    </svg>
  );

export const MolBioSortChevron: React.FC<{ direction: 'asc' | 'desc' }> = ({
  direction,
}) => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 12 12"
    fill="none"
    className="mbc-sort-chevron-svg"
    aria-hidden="true"
  >
    {direction === 'asc' ? (
      <path
        d="M2.5 7.8 6 4.2l3.5 3.6"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ) : (
      <path
        d="M2.5 4.2 6 7.8l3.5-3.6"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )}
  </svg>
);

export const MolBioColumnHeaderIcon: React.FC<{ colId: string }> = ({ colId }) => {
  switch (colId) {
    case 'favorite':
      return <MolBioStarIcon active size={12} />;
    case 'topology':
      return <MolBioMenuGlyph glyph="circularize" size={11} className="mbc-th-col-icon" />;
    case 'type':
      return <MolBioMenuGlyph glyph="new-sequence" size={11} className="mbc-th-col-icon" />;
    case 'gc':
    case 'gcPrimerBind':
      return <MolBioMenuGlyph glyph="codon-rscu" size={11} className="mbc-th-col-icon" />;
    case 'annotations':
      return <MolBioMenuGlyph glyph="detect-features" size={11} className="mbc-th-col-icon" />;
    case 'pairwiseIdentity':
    case 'identicalSites':
    case 'alignmentMethod':
      return <MolBioMenuGlyph glyph="align-pairwise" size={11} className="mbc-th-col-icon" />;
    case 'meanCoverage':
    case 'pctHq':
      return <MolBioMenuGlyph glyph="map-to-ref" size={11} className="mbc-th-col-icon" />;
    case 'tm':
    case 'hairpin':
    case 'primerDimer':
      return <MolBioMenuGlyph glyph="oligo-thermo" size={11} className="mbc-th-col-icon" />;
    case 'oligoType':
      return <MolBioMenuGlyph glyph="primer-design" size={11} className="mbc-th-col-icon" />;
    case 'treeBuilder':
    case 'noNodes':
    case 'noTips':
    case 'height':
      return <MolBioMenuGlyph glyph="tree-cladogram" size={11} className="mbc-th-col-icon" />;
    case 'pdbName':
      return <MolBioMenuGlyph glyph="structure-3d" size={11} className="mbc-th-col-icon" />;
    case 'accession':
      return <MolBioMenuGlyph glyph="database-ncbi" size={11} className="mbc-th-col-icon" />;
    default:
      return null;
  }
};

function parsePercentNumber(raw: string): number | null {
  const m = raw.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

const TaxonomyMicroIcon: React.FC<{ text: string }> = ({ text }) => {
  const lower = text.toLowerCase();
  if (/\b(virus|phage|sars|coronavir|influenza|hiv|dengue|bacteriophage)\b/.test(lower)) {
    // Icosahedral viral capsid micro-icon
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="mbc-attr-micro-svg" aria-hidden="true">
        <path d="M8 1.8 13.4 5v6L8 14.2 2.6 11V5L8 1.8Z" fill="var(--mbc-ico-rose, #e11d48)" fillOpacity="0.18" stroke="var(--mbc-ico-rose, #e11d48)" strokeWidth="1.5" />
      </svg>
    );
  }
  if (/\b(arabidopsis|oryza|zea|nicotiana|solanum|plant|viridiplantae|chloroplast)\b/.test(lower)) {
    // Botanical leaf micro-icon
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="mbc-attr-micro-svg" aria-hidden="true">
        <path d="M13.4 2.6C7.2 2.6 3.2 6.2 3.2 12.2c6 0 9.6-4 10.2-9.6ZM3.2 12.8 9.5 6.5" fill="var(--mbc-ico-emerald, #059669)" fillOpacity="0.2" stroke="var(--mbc-ico-emerald, #059669)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (/\b(escherichia|bacillus|pseudomonas|staphylococcus|streptococcus|mycobacterium|thermophilus|bacteria|prokaryot)\b/.test(lower)) {
    // Bacterial capsule micro-icon
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="mbc-attr-micro-svg" aria-hidden="true">
        <rect x="2.2" y="4.8" width="11.6" height="6.4" rx="3.2" fill="var(--mbc-ico-teal, #0d9488)" fillOpacity="0.18" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.5" />
        <circle cx="6.2" cy="8" r="1.1" fill="var(--mbc-ico-teal, #0d9488)" />
      </svg>
    );
  }
  if (/\b(homo sapiens|human|hominid|primate)\b/.test(lower)) {
    // Human sister-chromatid karyotype micro-icon
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="mbc-attr-micro-svg" aria-hidden="true">
        <path d="M5.2 2.4c1.2 2.4 1.6 4 2.8 5.6-1.2 1.6-1.6 3.2-2.8 5.6M10.8 2.4C9.6 4.8 9.2 6.4 8 8c1.2 1.6 1.6 3.2 2.8 5.6" stroke="var(--mbc-ico-violet, #7c3aed)" strokeWidth="1.65" strokeLinecap="round" />
        <circle cx="8" cy="8" r="1.35" fill="var(--mbc-ico-indigo, #2563eb)" />
      </svg>
    );
  }
  // Eukaryote nucleated cell micro-icon
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="mbc-attr-micro-svg" aria-hidden="true">
      <circle cx="8" cy="8" r="5.4" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.14" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.45" />
      <circle cx="8" cy="8" r="2.1" fill="var(--mbc-ico-indigo, #2563eb)" />
    </svg>
  );
};

export interface MolBioAttributeCellValueProps {
  colId: string;
  rawValue: string;
  doc: SequenceDocument;
  metrics: ComputedDocumentRowMetrics;
}

/**
 * Renders rich inline micro-icons, percentage meters, and semantic attribute badges
 * inside Document Table cells while keeping the exact underlying text readable and intact.
 */
export const MolBioAttributeCellValue: React.FC<MolBioAttributeCellValueProps> = ({
  colId,
  rawValue,
  doc,
}) => {
  if (!rawValue || rawValue === '-' || rawValue === '—') {
    return <span className="mbc-attr-empty">{rawValue || '-'}</span>;
  }

  // 1. Topology attribute cell: Circular ring vs Linear capped duplex badge
  if (colId === 'topology') {
    const isCirc = rawValue.toLowerCase().includes('circular');
    return (
      <span className={`mbc-attr-pill ${isCirc ? 'tone-teal' : 'tone-indigo'}`}>
        {isCirc ? (
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="mbc-attr-micro-svg" aria-hidden="true">
            <circle cx="8" cy="8" r="5.2" stroke="currentColor" strokeWidth="1.9" />
            <path d="M8 1.5v2.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="mbc-attr-micro-svg" aria-hidden="true">
            <path d="M2 6h12M2 10h12M4.8 6.3v3.4M8 6.3v3.4M11.2 6.3v3.4" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
          </svg>
        )}
        <span className="mbc-attr-pill-text">{rawValue}</span>
      </span>
    );
  }

  // 2. Molecule Type attribute cell: Distinct biological molecule micro-icon + label
  if (colId === 'type') {
    const lower = rawValue.toLowerCase();
    const tone =
      lower.includes('rna')
        ? 'tone-rose'
        : lower.includes('protein') || lower.includes('amino') || lower.includes('3d')
        ? 'tone-cyan'
        : lower.includes('oligo') || lower.includes('primer')
        ? 'tone-violet'
        : lower.includes('tree')
        ? 'tone-amber'
        : lower.includes('plasmid') || lower.includes('circular')
        ? 'tone-teal'
        : 'tone-indigo';

    const visualOverride: MolBioVisualDocKind = lower.includes('rna')
      ? 'linear-rna'
      : lower.includes('3d') || lower.includes('pdb')
      ? 'structure-3d'
      : lower.includes('protein') || lower.includes('amino')
      ? 'protein-seq'
      : lower.includes('oligo') || lower.includes('primer')
      ? 'primer-fwd'
      : lower.includes('tree')
      ? 'phylo-tree'
      : lower.includes('trace') || lower.includes('chromatogram')
      ? 'sanger-trace'
      : lower.includes('contig')
      ? 'contig-assembly'
      : lower.includes('align')
      ? 'alignment-nt'
      : doc.topology === 'circular'
      ? 'circular-plasmid'
      : 'linear-dsdna';

    return (
      <span className={`mbc-attr-inline ${tone}`}>
        <MolBioDocTypeIcon kind="linear-dna" visualOverride={visualOverride} size={13} />
        <span className="mbc-attr-text">{rawValue}</span>
      </span>
    );
  }

  // 3. Percentage metric columns (% GC, % Pairwise Identity, % Identical Sites, % HQ, %GC Primer Bind)
  if (
    colId === 'gc' ||
    colId === 'pairwiseIdentity' ||
    colId === 'identicalSites' ||
    colId === 'pctHq' ||
    colId === 'gcPrimerBind'
  ) {
    const pct = parsePercentNumber(rawValue);
    if (pct !== null) {
      const meterTone =
        colId === 'gc' || colId === 'gcPrimerBind'
          ? 'tone-teal'
          : colId === 'pctHq'
          ? 'tone-emerald'
          : 'tone-indigo';
      return (
        <span className="mbc-attr-meter-wrap">
          <span className={`mbc-attr-meter ${meterTone}`} aria-hidden="true">
            <span
              className="mbc-attr-meter-fill"
              style={{ width: `${Math.round(pct)}%` }}
            />
          </span>
          <span className="mbc-attr-num">{rawValue}</span>
        </span>
      );
    }
  }

  // 4. Annotations count
  if (colId === 'annotations') {
    const num = Number(rawValue);
    if (Number.isFinite(num) && num > 0) {
      return (
        <span className="mbc-attr-inline tone-teal mbc-attr-right">
          <MolBioMenuGlyph glyph="detect-features" size={12} />
          <span className="mbc-attr-num">{rawValue}</span>
        </span>
      );
    }
  }

  // 5. Oligo Type
  if (colId === 'oligoType') {
    const isRev = rawValue.toLowerCase().includes('rev');
    const isCrispr = rawValue.toLowerCase().includes('crispr') || rawValue.toLowerCase().includes('guide');
    return (
      <span className={`mbc-attr-pill ${isCrispr ? 'tone-violet' : isRev ? 'tone-amber' : 'tone-violet'}`}>
        {isCrispr ? (
          <MolBioMenuGlyph glyph="crispr-cas9" size={12} />
        ) : (
          <MolBioDocTypeIcon
            kind="primer"
            visualOverride={isRev ? 'primer-rev' : 'primer-fwd'}
            size={12}
          />
        )}
        <span className="mbc-attr-pill-text">{rawValue}</span>
      </span>
    );
  }

  // 6. Thermodynamic attributes (Tm, Hairpin, Primer-Dimer)
  if (colId === 'tm' || colId === 'hairpin' || colId === 'primerDimer') {
    return (
      <span className="mbc-attr-inline mbc-attr-right">
        <MolBioMenuGlyph glyph="oligo-thermo" size={12} />
        <span className="mbc-attr-num">{rawValue}</span>
      </span>
    );
  }

  // 7. Organism & Taxonomy
  if (colId === 'organism' || colId === 'taxonomy') {
    return (
      <span className="mbc-attr-inline">
        <TaxonomyMicroIcon text={rawValue} />
        <span className={colId === 'organism' ? 'mbc-attr-italic' : 'mbc-attr-text'}>
          {rawValue}
        </span>
      </span>
    );
  }

  // 8. PDB 3D Structure Identifier
  if (colId === 'pdbName') {
    return (
      <span className="mbc-attr-pill tone-cyan">
        <MolBioDocTypeIcon kind="protein" visualOverride="structure-3d" size={12} />
        <span className="mbc-attr-pill-text">{rawValue}</span>
      </span>
    );
  }

  // 9. Alignment Method, Tree Builder, Sequencing / Read Technology
  if (colId === 'alignmentMethod') {
    return (
      <span className="mbc-attr-inline">
        <MolBioMenuGlyph glyph="align-msa" size={12} />
        <span className="mbc-attr-text">{rawValue}</span>
      </span>
    );
  }

  if (colId === 'treeBuilder') {
    return (
      <span className="mbc-attr-inline">
        <MolBioMenuGlyph glyph="tree-cladogram" size={12} />
        <span className="mbc-attr-text">{rawValue}</span>
      </span>
    );
  }

  if (colId === 'sequencingTechnology' || colId === 'readTechnology') {
    const isSanger = /sanger|capillary|abi/i.test(rawValue);
    return (
      <span className="mbc-attr-inline">
        <MolBioDocTypeIcon
          kind={isSanger ? 'trace' : 'contig'}
          visualOverride={isSanger ? 'sanger-trace' : 'ngs-reads'}
          size={12}
        />
        <span className="mbc-attr-text">{rawValue}</span>
      </span>
    );
  }

  // 10. Mean Coverage
  if (colId === 'meanCoverage') {
    return (
      <span className="mbc-attr-inline mbc-attr-right">
        <MolBioDocTypeIcon kind="contig" visualOverride="contig-assembly" size={12} />
        <span className="mbc-attr-num">{rawValue}</span>
      </span>
    );
  }

  // 11. Forward Read boolean attribute
  if (colId === 'isForwardRead') {
    const isFwd = /true|yes|fwd|forward|1/i.test(rawValue);
    return (
      <span className={`mbc-attr-pill ${isFwd ? 'tone-violet' : 'tone-amber'}`}>
        <MolBioDocTypeIcon
          kind="primer"
          visualOverride={isFwd ? 'primer-fwd' : 'primer-rev'}
          size={11}
        />
        <span className="mbc-attr-pill-text">{rawValue}</span>
      </span>
    );
  }

  return <>{rawValue}</>;
};

// strand 0 is a record that states no direction (an INSDC point feature such as a promoter
// recorded at a single base); it gets a neutral pill rather than being forced onto a strand.
export const MolBioStrandBadge: React.FC<{ strand: 1 | -1 | 0 }> = ({ strand }) => (
  <span className={`mbc-attr-pill ${strand === 1 ? 'tone-indigo' : strand === -1 ? 'tone-amber' : 'tone-slate'}`}>
    {strand === 0 ? (
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="mbc-attr-micro-svg" aria-hidden="true">
        <path d="M2.2 8h11.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ) : strand === 1 ? (
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="mbc-attr-micro-svg" aria-hidden="true">
        <path d="M2.2 8h11.6m0 0-3.4-3.4M13.8 8l-3.4 3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ) : (
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="mbc-attr-micro-svg" aria-hidden="true">
        <path d="M13.8 8H2.2m0 0 3.4-3.4M2.2 8l3.4 3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )}
    <span className="mbc-attr-pill-text">
      {strand === 1 ? 'Forward (+)' : strand === -1 ? 'Reverse (-)' : 'No direction'}
    </span>
  </span>
);

export const MolBioFeatureTypeBadge: React.FC<{ featureType: string }> = ({
  featureType,
}) => {
  const lower = featureType.toLowerCase();
  const tone =
    lower.includes('promoter') || lower.includes('enhancer')
      ? 'tone-teal'
      : lower.includes('cds') || lower.includes('gene')
      ? 'tone-indigo'
      : lower.includes('primer')
      ? 'tone-violet'
      : lower.includes('rep_origin') || lower.includes('ori')
      ? 'tone-amber'
      : lower.includes('terminator') || lower.includes('regulatory')
      ? 'tone-rose'
      : 'tone-cyan';

  return (
    <span className={`mbc-attr-pill ${tone}`}>
      <MolBioMenuGlyph
        glyph={
          lower.includes('primer')
            ? 'primer-map'
            : lower.includes('ori')
            ? 'set-origin'
            : lower.includes('cds')
            ? 'find-orfs'
            : 'detect-features'
        }
        size={11}
      />
      <span className="mbc-attr-pill-text">{featureType}</span>
    </span>
  );
};

/* ========================================================================= */
/* 4. SIDEBAR TREE NODE & VIEWER STUDIO TAB ICONS                            */
/* ========================================================================= */

export const MolBioSidebarNodeIcon: React.FC<{
  nodeKey: string;
  isOpen?: boolean;
  accentColor?: string;
  size?: number;
}> = ({ nodeKey, isOpen = false, accentColor, size = 14 }) => {
  const k = nodeKey.toLowerCase();
  const style = accentColor
    ? ({ '--mbc-ico-teal': accentColor, '--mbc-ico-indigo': accentColor } as React.CSSProperties)
    : undefined;

  if (k === 'favorites') {
    return <MolBioStarIcon active size={size} className="folder-icon" />;
  }
  if (k === 'deleted items') {
    return <MolBioMenuGlyph glyph="trash" size={size} className="folder-icon" />;
  }
  if (k === 'operations') {
    return <MolBioMenuGlyph glyph="workflow-pipeline" size={size} className="folder-icon" />;
  }
  if (k === 'sample documents') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="mbc-duotone-icon folder-icon" aria-hidden="true">
        <path d="M1.8 4.2A1.5 1.5 0 0 1 3.3 2.7h3l1.3 1.4h5.1a1.5 1.5 0 0 1 1.5 1.5v6.1a1.5 1.5 0 0 1-1.5 1.5H3.3a1.5 1.5 0 0 1-1.5-1.5V4.2Z" fill="var(--mbc-ico-teal, #0d9488)" fillOpacity="0.18" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.45" />
        <circle cx="8.2" cy="8.7" r="2.2" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.35" />
      </svg>
    );
  }
  if (k === 'alignments') {
    return (
      <span style={style} className="mbc-sidebar-icon-slot">
        <MolBioDocTypeIcon kind="alignment" visualOverride="alignment-nt" size={size} />
      </span>
    );
  }
  if (k === 'cloning') {
    return (
      <span style={style} className="mbc-sidebar-icon-slot">
        <MolBioMenuGlyph glyph="clone-restriction" size={size} />
      </span>
    );
  }
  if (k === 'contig assembly') {
    return (
      <span style={style} className="mbc-sidebar-icon-slot">
        <MolBioDocTypeIcon kind="contig" visualOverride="contig-assembly" size={size} />
      </span>
    );
  }
  if (k === 'genomes') {
    return (
      <span style={style} className="mbc-sidebar-icon-slot">
        <MolBioDocTypeIcon kind="circular-dna" visualOverride="circular-genome" size={size} />
      </span>
    );
  }
  if (k.includes('bacteria')) {
    return <TaxonomyMicroIcon text="bacteria" />;
  }
  if (k.includes('human')) {
    return <TaxonomyMicroIcon text="human" />;
  }
  if (k.includes('eukaryote')) {
    return <TaxonomyMicroIcon text="eukaryote" />;
  }
  if (k.includes('plant')) {
    return <TaxonomyMicroIcon text="plant" />;
  }
  if (k.includes('virus')) {
    return <TaxonomyMicroIcon text="virus" />;
  }
  if (k === 'plasmids & vectors' || k === 'vector-catalog') {
    return (
      <span style={style} className="mbc-sidebar-icon-slot">
        <MolBioDocTypeIcon kind="circular-dna" visualOverride="circular-plasmid" size={size} />
      </span>
    );
  }
  if (k === 'primers') {
    return (
      <span style={style} className="mbc-sidebar-icon-slot">
        <MolBioMenuGlyph glyph="primer-design" size={size} />
      </span>
    );
  }
  if (k === 'protein documents') {
    return (
      <span style={style} className="mbc-sidebar-icon-slot">
        <MolBioDocTypeIcon kind="protein" visualOverride="protein-seq" size={size} />
      </span>
    );
  }
  if (k === 'tree documents') {
    return (
      <span style={style} className="mbc-sidebar-icon-slot">
        <MolBioDocTypeIcon kind="tree" visualOverride="phylo-tree" size={size} />
      </span>
    );
  }

  // NCBI, UniProt & Reference Sub-Databases
  if (k === 'ncbi') {
    return <MolBioMenuGlyph glyph="database-ncbi" size={size} className="folder-icon" />;
  }
  if (k === 'ncbi-gene') {
    return <MolBioMenuGlyph glyph="find-orfs" size={size} className="folder-icon" />;
  }
  if (k === 'ncbi-nucleotide') {
    return <MolBioDocTypeIcon kind="linear-dna" visualOverride="linear-dsdna" size={size} />;
  }
  if (k === 'ncbi-protein') {
    return <MolBioDocTypeIcon kind="protein" visualOverride="protein-seq" size={size} />;
  }
  if (k === 'ncbi-pubmed') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="mbc-duotone-icon folder-icon" aria-hidden="true">
        <rect x="2.6" y="2" width="10.8" height="12" rx="1.6" fill="var(--mbc-ico-indigo, #2563eb)" fillOpacity="0.14" stroke="var(--mbc-ico-indigo, #2563eb)" strokeWidth="1.45" />
        <path d="M5.2 5.4h5.6M5.2 8h5.6M5.2 10.6h3.6" stroke="var(--mbc-ico-teal, #0d9488)" strokeWidth="1.35" strokeLinecap="round" />
      </svg>
    );
  }
  if (k === 'ncbi-structure') {
    return <MolBioDocTypeIcon kind="protein" visualOverride="structure-3d" size={size} />;
  }
  if (k === 'ncbi-taxonomy') {
    return <MolBioDocTypeIcon kind="tree" visualOverride="phylo-tree" size={size} />;
  }
  if (k === 'uniprot') {
    return <MolBioMenuGlyph glyph="database-uniprot" size={size} className="folder-icon" />;
  }
  if (k === 'local-blast-dbs') {
    return <MolBioMenuGlyph glyph="blast-search" size={size} className="folder-icon" />;
  }
  if (k === 'modular-parts') {
    return <MolBioMenuGlyph glyph="clone-parts" size={size} className="folder-icon" />;
  }
  if (k === 'auto-annotate' || k === 'standard-features') {
    return <MolBioMenuGlyph glyph="detect-features" size={size} className="folder-icon" />;
  }

  // Default custom project folder (open/closed duotone)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      style={style}
      className="mbc-duotone-icon folder-icon"
      aria-hidden="true"
    >
      <path
        d="M1.8 4.2A1.5 1.5 0 0 1 3.3 2.7h3.1l1.3 1.5h5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H3.3a1.5 1.5 0 0 1-1.5-1.5V4.2Z"
        fill="var(--mbc-ico-indigo, #2563eb)"
        fillOpacity={isOpen ? 0.24 : 0.13}
        stroke="var(--mbc-ico-indigo, #2563eb)"
        strokeWidth="1.45"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export const MolBioViewerTabIcon: React.FC<{
  tabId: string;
  size?: number;
}> = ({ tabId, size = 13 }) => {
  switch (tabId) {
    case 'sequence-view':
      return <MolBioDocTypeIcon kind="circular-dna" visualOverride="circular-plasmid" size={size} />;
    case 'annotations-table':
      return <MolBioMenuGlyph glyph="detect-features" size={size} />;
    case 'text-view':
      return <MolBioMenuGlyph glyph="print-pdf" size={size} />;
    case 'vector-library':
      return <MolBioMenuGlyph glyph="clone-parts" size={size} />;
    case 'cloning-gel':
      return <MolBioMenuGlyph glyph="clone-restriction" size={size} />;
    case 'primers-pcr':
      return <MolBioMenuGlyph glyph="primer-design" size={size} />;
    case 'sequence-alignment':
      return <MolBioMenuGlyph glyph="align-msa" size={size} />;
    case 'phylogenetics':
      return <MolBioMenuGlyph glyph="tree-cladogram" size={size} />;
    case 'sanger-contig':
      return <MolBioDocTypeIcon kind="trace" visualOverride="sanger-trace" size={size} />;
    case 'genomics-ngs':
      return <MolBioDocTypeIcon kind="protein" visualOverride="structure-3d" size={size} />;
    case 'history-hybrid':
      return <MolBioDocTypeIcon kind="protein" visualOverride="protein-seq" size={size} />;
    case 'guided-pipelines':
    default:
      return <MolBioMenuGlyph glyph="workflow-pipeline" size={size} />;
  }
};

export type MolBioPrefsToggleKind =
  | 'dna-enzymes'
  | 'dna-features'
  | 'dna-primers'
  | 'dna-orfs'
  | 'rna-features'
  | 'rna-orfs'
  | 'protein-regions'
  | 'protein-sites'
  | 'protein-bonds';

export const MolBioPrefsToggleIcon: React.FC<{
  kind: MolBioPrefsToggleKind;
  size?: number;
}> = ({ kind, size = 22 }) => {
  switch (kind) {
    case 'dna-enzymes':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          className="prefs-square-svg"
          data-prefs-icon="dna-enzymes"
          aria-hidden="true"
        >
          <circle
            cx="5.5"
            cy="6.3"
            r="3"
            fill="currentColor"
            fillOpacity="0.2"
            stroke="currentColor"
            strokeWidth="1.85"
          />
          <circle
            cx="5.5"
            cy="17.7"
            r="3"
            fill="currentColor"
            fillOpacity="0.2"
            stroke="currentColor"
            strokeWidth="1.85"
          />
          <path
            d="M8.1 8 19.6 16.8M8.1 16 19.6 7.2"
            stroke="currentColor"
            strokeWidth="1.95"
            strokeLinecap="round"
          />
          <circle cx="12.7" cy="12" r="1.25" fill="currentColor" />
          <path
            d="M20.6 4.2v3.2M20.6 16.6v3.2"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'dna-features':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          className="prefs-square-svg"
          data-prefs-icon="dna-features"
          aria-hidden="true"
        >
          <path
            d="M2.5 5.2h13.1V3.4L21.5 8.4l-5.9 5V11.6H2.5V5.2Z"
            fill="currentColor"
            fillOpacity="0.24"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M2.5 16.5h19M2.5 20h19"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <path
            d="M6 16.5V20M10 16.5V20M14 16.5V20M18 16.5V20"
            stroke="currentColor"
            strokeWidth="1.45"
            strokeLinecap="round"
            opacity="0.75"
          />
        </svg>
      );

    case 'dna-primers':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          className="prefs-square-svg"
          data-prefs-icon="dna-primers"
          aria-hidden="true"
        >
          <rect x="3" y="8.2" width="13.5" height="2.5" rx="0.8" fill="currentColor" fillOpacity="0.22" />
          <path
            d="M2.5 8.2h18l-4.6-4.4"
            stroke="currentColor"
            strokeWidth="2.05"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M6.6 10.7v2.6M10.2 10.7v2.6M13.8 10.7v2.6M17.4 10.7v2.6"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
            opacity="0.65"
          />
          <rect x="7.5" y="13.3" width="13.5" height="2.5" rx="0.8" fill="currentColor" fillOpacity="0.22" />
          <path
            d="M21.5 15.8h-18l4.6 4.4"
            stroke="currentColor"
            strokeWidth="2.05"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'dna-orfs':
      return (
        <span className="prefs-square-codon-stack" data-prefs-icon="dna-orfs" aria-hidden="true">
          <span className="prefs-square-codon">ATG</span>
          <svg
            width={24}
            height={6}
            viewBox="0 0 24 6"
            fill="none"
            className="prefs-square-codon-bar"
            aria-hidden="true"
          >
            <rect
              x="1.2"
              y="1.1"
              width="5"
              height="3.8"
              rx="0.8"
              fill="currentColor"
              fillOpacity="0.3"
              stroke="currentColor"
              strokeWidth="1.15"
            />
            <rect
              x="7.7"
              y="1.1"
              width="5"
              height="3.8"
              rx="0.8"
              fill="currentColor"
              fillOpacity="0.2"
              stroke="currentColor"
              strokeWidth="1.15"
            />
            <path
              d="M14.2 1.1h4.5V0.3L22.8 3l-4.1 2.7V4.9h-4.5V1.1Z"
              fill="currentColor"
              fillOpacity="0.34"
              stroke="currentColor"
              strokeWidth="1.15"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      );

    case 'rna-features':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          className="prefs-square-svg"
          data-prefs-icon="rna-features"
          aria-hidden="true"
        >
          <path
            d="M2.5 5.2h13.1V3.4L21.5 8.4l-5.9 5V11.6H2.5V5.2Z"
            fill="currentColor"
            fillOpacity="0.24"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <circle cx="3.6" cy="18" r="1.65" fill="currentColor" />
          <path
            d="M5.2 18c1.6-2.4 3.2-2.4 4.8 0s3.2 2.4 4.8 0 3.2-2.4 4.8 0c.7 1 1.4 1.4 2 1.2"
            stroke="currentColor"
            strokeWidth="1.85"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'rna-orfs':
      return (
        <span className="prefs-square-codon-stack" data-prefs-icon="rna-orfs" aria-hidden="true">
          <span className="prefs-square-codon">AUG</span>
          <svg
            width={24}
            height={6}
            viewBox="0 0 24 6"
            fill="none"
            className="prefs-square-codon-bar"
            aria-hidden="true"
          >
            <rect
              x="1.2"
              y="1.1"
              width="5"
              height="3.8"
              rx="0.8"
              fill="currentColor"
              fillOpacity="0.3"
              stroke="currentColor"
              strokeWidth="1.15"
            />
            <rect
              x="7.7"
              y="1.1"
              width="5"
              height="3.8"
              rx="0.8"
              fill="currentColor"
              fillOpacity="0.2"
              stroke="currentColor"
              strokeWidth="1.15"
            />
            <path
              d="M14.2 1.1h4.5V0.3L22.8 3l-4.1 2.7V4.9h-4.5V1.1Z"
              fill="currentColor"
              fillOpacity="0.34"
              stroke="currentColor"
              strokeWidth="1.15"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      );

    case 'protein-regions':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          className="prefs-square-svg"
          data-prefs-icon="protein-regions"
          aria-hidden="true"
        >
          <path d="M2 12h20" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" />
          <rect
            x="3"
            y="5.5"
            width="8.2"
            height="13"
            rx="2.2"
            fill="currentColor"
            fillOpacity="0.24"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M5.8 8.5v7M8.4 8.5v7"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.78"
          />
          <rect
            x="13.5"
            y="6.8"
            width="7.5"
            height="10.4"
            rx="2.2"
            fill="currentColor"
            fillOpacity="0.16"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <circle cx="17.25" cy="12" r="1.45" fill="currentColor" />
        </svg>
      );

    case 'protein-sites':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          className="prefs-square-svg"
          data-prefs-icon="protein-sites"
          aria-hidden="true"
        >
          <path
            d="M12 3.2 17.6 8.6 12 14 6.4 8.6 12 3.2Z"
            fill="currentColor"
            fillOpacity="0.24"
            stroke="currentColor"
            strokeWidth="1.85"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="8.6" r="1.7" fill="currentColor" />
          <path d="M12 14v5" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" />
          <path d="M2.5 19.2h19" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" />
          <circle cx="6.5" cy="19.2" r="1.5" fill="currentColor" opacity="0.8" />
          <circle cx="12" cy="19.2" r="1.85" fill="currentColor" />
          <circle cx="17.5" cy="19.2" r="1.5" fill="currentColor" opacity="0.8" />
        </svg>
      );

    case 'protein-bonds':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          className="prefs-square-svg"
          data-prefs-icon="protein-bonds"
          aria-hidden="true"
        >
          <path d="M2.5 18.8h19" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" />
          <path
            d="M5.5 18.8V11a6.5 6.2 0 0 1 13 0v7.8"
            fill="currentColor"
            fillOpacity="0.16"
            stroke="currentColor"
            strokeWidth="1.95"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="10.1" cy="5.4" r="1.55" fill="currentColor" />
          <circle cx="13.9" cy="5.4" r="1.55" fill="currentColor" />
          <circle cx="5.5" cy="18.8" r="1.85" fill="currentColor" />
          <circle cx="18.5" cy="18.8" r="1.85" fill="currentColor" />
        </svg>
      );
  }
};
