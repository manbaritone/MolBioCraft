// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  MoreVertical,
  Upload,
  X,
} from 'lucide-react';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { SequenceDocument } from '../types/bio';
import { MolBioCraftLogo } from './MolBioCraftLogo';
import {
  MolBioMenuGlyph,
  MolBioSidebarNodeIcon,
  MolBioStatusBadgeIcon,
} from './MolBioIcons';
import { BioAddIcon, BioImportIcon } from './ToolbarBioIcons';
import { SequenceDocKindIcon } from './WorkbenchSmartTable';
import { BASE_COLOR, qualityColor } from '../core/basePalette';

export type HomeTopDropdownId = 'new' | 'open' | 'import' | 'sidebar-more' | null;

interface ProjectFirstPageHomeProps {
  sidebarOpen: boolean;
  sessionActive: boolean;
  sessionName: string;
  documents: SequenceDocument[];
  hasLocalAutosave: boolean;
  openDropdown: HomeTopDropdownId;
  onToggleDropdown: (id: Exclude<HomeTopDropdownId, null>, e: React.MouseEvent<HTMLElement>, minWidth?: number) => void;
  onOpenSampleProject: () => void;
  onStartBlankProject: () => void;
  onOpenMbcSession: () => void;
  onRestoreAutosave: () => void;
  onOpenFilePicker: () => void;
  onOpenSampleDocumentById: (sampleId: string, targetTab?: 'sequence-view' | 'primers-pcr' | 'sanger-contig' | 'annotations-table') => void;
  onResumeActiveSession: () => void;
  onOpenShortcuts: () => void;
  onOpenAbout?: () => void;
  isFileDragActive?: boolean;
  onWindowChromeMouseDown?: (e: React.MouseEvent<HTMLElement>) => void;
}

export const ProjectFirstPageHome: React.FC<ProjectFirstPageHomeProps> = ({
  sidebarOpen,
  sessionActive,
  sessionName,
  documents,
  hasLocalAutosave,
  openDropdown,
  onToggleDropdown,
  onOpenSampleProject,
  onStartBlankProject,
  onOpenMbcSession,
  onRestoreAutosave,
  onOpenFilePicker,
  onOpenSampleDocumentById,
  onResumeActiveSession,
  onOpenShortcuts,
  isFileDragActive = false,
  onWindowChromeMouseDown,
}) => {
  const [showcaseVisible, setShowcaseVisible] = useState<boolean>(true);

  return (
    <main
      className={`mbc-home-layout ${sidebarOpen ? '' : 'sidebar-collapsed'}`}
      aria-label="MolBioCraft Project First Page"
    >
      {/* Left Project Folder Sidebar */}
      {sidebarOpen && (
        <aside className="mbc-home-sidebar" aria-label="Project Folder Explorer" onContextMenu={(event) => event.preventDefault()}>
          {!sessionActive ? (
            <div className="mbc-home-sidebar-empty">
              <div
                className="mbc-home-sidebar-head"
                data-tauri-drag-region
                onMouseDown={onWindowChromeMouseDown}
              >
                <strong>No folder opened</strong>
                <div className="toolbar-dropdown-anchor">
                  <button
                    type="button"
                    className={`nav-cluster-icon-btn ${openDropdown === 'sidebar-more' ? 'active' : ''}`}
                    aria-label="Project folder options"
                    aria-haspopup="menu"
                    aria-expanded={openDropdown === 'sidebar-more'}
                    onClick={(e) => onToggleDropdown('sidebar-more', e, 210)}
                  >
                    <MoreVertical size={14} />
                  </button>
                </div>
              </div>

              <p className="mbc-home-sidebar-desc">
                Project files and subfolders will be shown here.
              </p>

              <button
                type="button"
                className="mbc-home-primary-btn"
                onClick={onOpenMbcSession}
              >
                Open Folder / Session...
              </button>

              <button
                type="button"
                className="mbc-home-link-btn"
                onClick={onOpenFilePicker}
              >
                Open File...
              </button>

              <div className="mbc-home-sidebar-divider" />

              <p className="mbc-home-sidebar-desc">
                Organize circular plasmids, linear amplicons, primers, alignments, and{' '}
                <code>.ab1</code> chromatogram traces in a unified project workspace.
              </p>

              <button
                type="button"
                className="mbc-home-link-btn"
                onClick={onOpenShortcuts}
              >
                Keyboard Shortcuts &amp; Reference
              </button>
            </div>
          ) : (
            <div className="mbc-home-sidebar-active">
              <div
                className="mbc-home-sidebar-head"
                data-tauri-drag-region
                onMouseDown={onWindowChromeMouseDown}
              >
                <strong>{sessionName}</strong>
                <span className="folder-count">{documents.length} files</span>
              </div>
              <button
                type="button"
                className="mbc-home-primary-btn"
                onClick={onResumeActiveSession}
              >
                <span>Return to Active Workspace</span>
                <ChevronRight size={14} strokeWidth={2.4} aria-hidden="true" />
              </button>
              <div className="mbc-home-sidebar-filelist">
                {documents.slice(0, 10).map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    className="mbc-home-file-row"
                    onClick={() =>
                      onOpenSampleDocumentById(
                        doc.id,
                        doc.chromatogram ? 'sanger-contig' : 'sequence-view'
                      )
                    }
                  >
                    <SequenceDocKindIcon
                      kind={
                        doc.chromatogram
                          ? 'trace'
                          : doc.moleculeType === 'Protein'
                          ? 'protein'
                          : doc.topology === 'circular'
                          ? 'circular-dna'
                          : 'linear-dna'
                      }
                      doc={doc}
                    />
                    <span className="folder-label">{doc.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      )}

      {/* Right Welcome & Capabilities Main Pane */}
      <section className="mbc-home-main">
        {/* Top Quick Action Bar: New ▾ | Open ▾ | Import ▾ */}
        <div
          className="mbc-home-quickbar"
          role="toolbar"
          aria-label="Project Quick Actions"
          data-tauri-drag-region
          onMouseDown={onWindowChromeMouseDown}
        >
          <div className="toolbar-dropdown-anchor">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={openDropdown === 'new'}
              className={`mbc-home-qbtn ${openDropdown === 'new' ? 'active' : ''}`}
              onClick={(e) => onToggleDropdown('new', e, 225)}
              onMouseEnter={(e) => {
                if (openDropdown && openDropdown !== 'new' && openDropdown !== 'sidebar-more') {
                  onToggleDropdown('new', e, 225);
                }
              }}
            >
              <BioAddIcon size={19} className="mbc-icon blue" />
              <span>
                New <ChevronDown size={13} strokeWidth={2.3} aria-hidden="true" />
              </span>
            </button>
          </div>

          <div className="toolbar-dropdown-anchor">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={openDropdown === 'open'}
              className={`mbc-home-qbtn ${openDropdown === 'open' ? 'active' : ''}`}
              onClick={(e) => onToggleDropdown('open', e, 215)}
              onMouseEnter={(e) => {
                if (openDropdown && openDropdown !== 'open' && openDropdown !== 'sidebar-more') {
                  onToggleDropdown('open', e, 215);
                }
              }}
            >
              <MolBioMenuGlyph glyph="open-session" size={19} className="mbc-icon amber" />
              <span>
                Open <ChevronDown size={13} strokeWidth={2.3} aria-hidden="true" />
              </span>
            </button>
          </div>

          <div className="toolbar-dropdown-anchor">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={openDropdown === 'import'}
              className={`mbc-home-qbtn ${openDropdown === 'import' ? 'active' : ''}`}
              onClick={(e) => onToggleDropdown('import', e, 220)}
              onMouseEnter={(e) => {
                if (openDropdown && openDropdown !== 'import' && openDropdown !== 'sidebar-more') {
                  onToggleDropdown('import', e, 220);
                }
              }}
            >
              <BioImportIcon size={19} className="mbc-icon teal" />
              <span>
                Import <ChevronDown size={13} strokeWidth={2.3} aria-hidden="true" />
              </span>
            </button>
          </div>

          {sessionActive && (
            <button
              type="button"
              className="btn-primary-sm"
              style={{ marginInlineStart: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={onResumeActiveSession}
            >
              <span>
                Resume &ldquo;{sessionName}&rdquo; ({documents.length} files)
              </span>
              <ChevronRight size={14} strokeWidth={2.4} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="mbc-home-scroll">
          {/* Hero Brand Lockup + Concise About Summary */}
          <div className="mbc-home-hero">
            <div className="mbc-home-brand-lockup">
              <div className="mbc-home-logo-halo">
                <MolBioCraftLogo size={96} decorative={false} />
              </div>
              <div className="mbc-home-brand-copy">
                <div className="mbc-home-title-row">
                  <h1 className="mbc-home-title mbc-logo-wordmark">MolBioCraft</h1>
                  <span className="mbc-home-version-pill">Version 1.0.0</span>
                </div>
                <p className="mbc-home-hero-tagline">
                  Molecular &amp; Evolutionary Biology Workbench
                </p>
                <div className="mbc-home-about-meta">
                  <span>
                    CC BY-NC 4.0 (SPDX: CC-BY-NC-4.0) — Open-Source Research Workbench
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Two-Column Recent Projects & Recent Files Row */}
          <div className="mbc-home-recents-wrap">
            <div className="mbc-home-recents-grid">
              <div className="mbc-home-recent-col">
                <h2>Start a project</h2>
                <ul className="mbc-home-recent-list">
                  <li>
                    <button
                      type="button"
                      className="mbc-home-recent-link sample-highlight"
                      onClick={onOpenSampleProject}
                    >
                      <MolBioSidebarNodeIcon nodeKey="Sample Documents" size={16} />
                      <span>
                        <strong>Sample Project</strong>
                        <small>
                          {SAMPLE_LIBRARY.length} plasmids, genomes, alignments, traces, proteins &amp; trees
                        </small>
                      </span>
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="mbc-home-recent-link"
                      onClick={onStartBlankProject}
                    >
                      <MolBioMenuGlyph glyph="new-sequence" size={16} />
                      <span>
                        <strong>Blank Research Project</strong>
                        <small>Empty workspace for your files and sequences</small>
                      </span>
                    </button>
                  </li>
                  {hasLocalAutosave && (
                    <li>
                      <button
                        type="button"
                        className="mbc-home-recent-link"
                        onClick={onRestoreAutosave}
                      >
                        <MolBioMenuGlyph glyph="save-session" size={16} />
                        <span>
                          <strong>Restore Autosaved Project</strong>
                          <small>Resume most recent local .mbc workbench draft</small>
                        </span>
                      </button>
                    </li>
                  )}
                  <li>
                    <button
                      type="button"
                      className="mbc-home-recent-link"
                      onClick={onOpenMbcSession}
                    >
                      <MolBioMenuGlyph glyph="open-session" size={16} />
                      <span>
                        <strong>Open Project Session</strong>
                        <small>Browse disk for a saved MolBioCraft project</small>
                      </span>
                    </button>
                  </li>
                </ul>
              </div>

              <div className="mbc-home-recent-col">
                <h2>Sample files</h2>
                <ul className="mbc-home-recent-list">
                  <li>
                    <button
                      type="button"
                      className="mbc-home-recent-link"
                      onClick={() =>
                        onOpenSampleDocumentById('doc-pet28-egfp', 'sequence-view')
                      }
                    >
                      <SequenceDocKindIcon kind="circular-dna" />
                      <span>
                        <strong>pET-28a(+)-eGFP.gb</strong>
                        <small>6,061 bp circular T7lac bacterial expression plasmid</small>
                      </span>
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="mbc-home-recent-link"
                      onClick={() =>
                        onOpenSampleDocumentById('doc-puc19', 'sequence-view')
                      }
                    >
                      <SequenceDocKindIcon kind="circular-dna" />
                      <span>
                        <strong>pUC19_Standard_Vector.gb</strong>
                        <small>2,686 bp circular high-copy lacZ&alpha; cloning vector</small>
                      </span>
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="mbc-home-recent-link"
                      onClick={() =>
                        onOpenSampleDocumentById('doc-sanger-ab1-fwd', 'sanger-contig')
                      }
                    >
                      <SequenceDocKindIcon kind="trace" />
                      <span>
                        <strong>eGFP_Clone3_Sanger_Fwd.ab1</strong>
                        <small>320 bp 4-dye capillary chromatogram with Phred Q-scores</small>
                      </span>
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="mbc-home-recent-link"
                      onClick={onOpenFilePicker}
                    >
                      <BioImportIcon size={15} className="mbc-icon blue" />
                      <span>
                        <strong>Open Sequence File</strong>
                        <small>Open any sequence, trace or structure file from disk</small>
                      </span>
                    </button>
                  </li>
                </ul>
              </div>
            </div>

            <button
              type="button"
              className={`mbc-home-dropzone ${isFileDragActive ? 'drag-active' : ''}`}
              onClick={onOpenFilePicker}
              aria-label="Drag and drop sequence, chromatogram, structure, or session files into window or click to browse"
            >
              <span className="mbc-home-dropzone-icon" aria-hidden="true">
                <Upload size={17} />
              </span>
              <span className="mbc-home-dropzone-copy">
                <strong>
                  {isFileDragActive
                    ? 'Release to Open Files in MolBioCraft'
                    : 'Drag & drop files anywhere in this window'}
                </strong>
                <span>
                  Supports Session (.mbc), GenBank / EMBL (.gb, .gbk, .embl), FASTA / FASTQ (.fa, .fasta, .fq), Sanger Traces (.ab1, .scf), Alignments (.aln, .phy, .sto, .nex), Read Alignments &amp; Variants (.sam, .bam, .vcf), Annotations (.gff3, .bed), Trees (.nwk, .tre) &amp; 3D Structures (.pdb, .cif)
                </span>
              </span>
              <span className="mbc-home-dropzone-cta">Browse Files&hellip;</span>
            </button>
          </div>

          {/* Dismissible 2x2 Interactive Workbench Capabilities Showcase Container */}
          {showcaseVisible && (
            <section
              className="mbc-showcase-box"
              aria-label="Workbench Capabilities Overview"
            >
              <div className="mbc-showcase-header">
                <span className="mbc-showcase-eyebrow">WORKBENCH CAPABILITIES</span>
                <button
                  type="button"
                  className="mbc-showcase-close"
                  aria-label="Dismiss capabilities overview"
                  onClick={() => setShowcaseVisible(false)}
                >
                  <X size={14} />
                </button>
              </div>

              <div className="mbc-showcase-grid">
                {/* Card 1: Multifile Project Info Table */}
                <div
                  className="mbc-showcase-card"
                  role="button"
                  tabIndex={0}
                  onClick={onOpenSampleProject}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenSampleProject();
                    }
                  }}
                >
                  <div className="mbc-showcase-card-text">
                    <h3>Multifile Project Info Table</h3>
                    <p>
                      Sort, filter, batch-annotate, simulate digests, and manage circular plasmids, amplicons, and traces across project folders.
                    </p>
                  </div>
                  <div className="mbc-showcase-preview" aria-hidden="true">
                    <div className="mbc-mini-bar-row">
                      <span className="mbc-mini-pill">
                        Annotate &amp; Simulate <ChevronDown size={11} strokeWidth={2.3} />
                      </span>
                      <span className="mbc-mini-pill">
                        Manage files <ChevronDown size={11} strokeWidth={2.3} />
                      </span>
                    </div>
                    <table className="mbc-mini-preview-table">
                      <thead>
                        <tr>
                          <th>File</th>
                          <th>Size</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>
                            <SequenceDocKindIcon kind="circular-dna" /> pET-28a(+)-eGFP
                          </td>
                          <td>6,061 bp</td>
                          <td className="ok-check">
                            <MolBioStatusBadgeIcon ok size={13} />
                          </td>
                        </tr>
                        <tr>
                          <td>
                            <SequenceDocKindIcon kind="circular-dna" /> pUC19_Vector
                          </td>
                          <td>2,686 bp</td>
                          <td className="ok-check">
                            <MolBioStatusBadgeIcon ok size={13} />
                          </td>
                        </tr>
                        <tr>
                          <td>
                            <SequenceDocKindIcon kind="linear-dna" /> Insert_mCherry
                          </td>
                          <td>814 bp</td>
                          <td className="ok-check">
                            <MolBioStatusBadgeIcon ok size={13} />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Card 2: Rich Feature & Segment Tooltips */}
                <div
                  className="mbc-showcase-card"
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    onOpenSampleDocumentById('doc-pet28-egfp', 'annotations-table')
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenSampleDocumentById('doc-pet28-egfp', 'annotations-table');
                    }
                  }}
                >
                  <div className="mbc-showcase-card-text">
                    <h3>Interactive Feature &amp; Codon Inspector</h3>
                    <p>
                      Inspect CDS reading frames, codon counts, translated kDa molecular mass, directional strand arrows, and feature qualifiers.
                    </p>
                  </div>
                  <div className="mbc-showcase-preview" aria-hidden="true">
                    <svg viewBox="0 0 240 34" className="mbc-mini-feature-svg">
                      {/* Plasmid double-stranded DNA backbone */}
                      <line x1="8" y1="21" x2="232" y2="21" stroke="#94a3b8" strokeWidth="1.6" />
                      <line x1="8" y1="24.5" x2="232" y2="24.5" stroke="#cbd5e1" strokeWidth="1.4" />
                      {/* Upstream T7lac promoter bent arrow */}
                      <path
                        d="M 22 21 V 9 H 42 M 38 5.5 L 43 9 L 38 12.5"
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {/* Directional eGFP CDS block arrow */}
                      <path
                        d="M 56 13 H 178 L 192 19 L 178 25 H 56 Z"
                        fill="#16a34a"
                        fillOpacity="0.18"
                        stroke="#16a34a"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                      {/* Codon triplet blocks */}
                      {[66, 98, 130].map((cx, idx) => (
                        <rect
                          key={idx}
                          x={cx}
                          y={15.8}
                          width={24}
                          height={6.4}
                          rx={2}
                          fill="#16a34a"
                          fillOpacity="0.28"
                        />
                      ))}
                      {/* Downstream terminator stem-loop */}
                      <line x1="212" y1="21" x2="212" y2="11" stroke="#dc2626" strokeWidth="1.6" />
                      <circle cx="212" cy="8.5" r="3.2" fill="none" stroke="#dc2626" strokeWidth="1.5" />
                    </svg>
                    <div className="mbc-mini-tooltip-card">
                      <div className="mbc-mini-tt-head">
                        <span className="feat-dot" style={{ background: '#16a34a' }} />
                        <strong>eGFP</strong>
                        <span className="mbc-mini-type-tag">
                          CDS <ArrowRight size={10} strokeWidth={2.4} />
                        </span>
                      </div>
                      <div className="mbc-mini-tt-coords">
                        5,192 .. 5,911 = <strong>720 bp</strong> &middot; 240 codons &middot; 26.9 kDa
                      </div>
                      <div className="mbc-mini-tt-note">
                        Enhanced green fluorescent protein reporter (F64L / S65T)
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card 3: Primer Specificity & Binding Alerts */}
                <div
                  className="mbc-showcase-card"
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    onOpenSampleDocumentById('doc-pet28-egfp', 'primers-pcr')
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenSampleDocumentById('doc-pet28-egfp', 'primers-pcr');
                    }
                  }}
                >
                  <div className="mbc-showcase-card-text">
                    <h3>Primer Specificity &amp; Binding Alerts</h3>
                    <p>
                      Detect off-target secondary hybridization sites automatically alongside SantaLucia salt-corrected Tm, GC%, and mass in Daltons.
                    </p>
                  </div>
                  <div className="mbc-showcase-preview" aria-hidden="true">
                    <svg viewBox="0 0 240 34" className="mbc-mini-primer-svg">
                      {/* Template duplex strands */}
                      <line x1="10" y1="17" x2="230" y2="17" stroke="#94a3b8" strokeWidth="1.6" />
                      <line x1="10" y1="21" x2="230" y2="21" stroke="#cbd5e1" strokeWidth="1.5" />
                      {/* Forward primer 5'->3' half-arrow */}
                      <path
                        d="M 18 6 L 28 11 H 78 L 71 6.5"
                        fill="none"
                        stroke="#0d9488"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {/* Primary Reverse primer 3'<-5' half-arrow with 5' adapter overhang */}
                      <path
                        d="M 218 31 L 207 26.5 H 148 L 155 31"
                        fill="none"
                        stroke="#7c3aed"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {/* Secondary off-target binding site warning highlight */}
                      <path
                        d="M 126 26.5 H 92 L 98 30.5"
                        fill="none"
                        stroke="#d97706"
                        strokeWidth="1.7"
                        strokeDasharray="3 2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <div className="mbc-mini-tooltip-card">
                      <div className="mbc-mini-tt-head">
                        <strong style={{ color: '#7c3aed', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <span>eGFP_Rev_Primer</span>
                          <ArrowLeft size={11} strokeWidth={2.4} />
                        </strong>
                        <span className="mbc-mini-tm-pill">Tm = 58.4&deg;C</span>
                      </div>
                      <div className="mbc-mini-tt-coords">
                        20-mer &middot; 50.0% GC &middot; 6,153.0 Da
                      </div>
                      <div className="mbc-mini-alert-strip">
                        <MolBioStatusBadgeIcon ok={false} size={12} />
                        <span>Primer has 2 binding sites on template</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card 4: Integrated 4-Dye Sanger Trace View */}
                <div
                  className="mbc-showcase-card"
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    onOpenSampleDocumentById('doc-sanger-ab1-fwd', 'sanger-contig')
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenSampleDocumentById('doc-sanger-ab1-fwd', 'sanger-contig');
                    }
                  }}
                >
                  <div className="mbc-showcase-card-text">
                    <h3>Integrated 4-Dye Sanger Trace View</h3>
                    <p>
                      Verify <code>.ab1</code> capillary chromatograms with Standard or Autoscaled peaks, Phred Q-bars, Parameters tab, and variant calls.
                    </p>
                  </div>
                  <div className="mbc-showcase-preview" aria-hidden="true">
                    <div className="mbc-mini-bar-row" style={{ justifyContent: 'space-between' }}>
                      <span className="mbc-mini-pill">
                        <strong>Trace</strong> | Parameters
                      </span>
                      <span className="mbc-mini-pill">
                        Standard | <strong>Autoscaled</strong>
                      </span>
                    </div>
                    <svg viewBox="0 0 240 68" className="mbc-mini-trace-svg">
                      {[
                        { b: 'G', c: BASE_COLOR.G, x: 24, h: 28 },
                        { b: 'A', c: BASE_COLOR.A, x: 62, h: 34 },
                        { b: 'A', c: BASE_COLOR.A, x: 100, h: 32 },
                        { b: 'T', c: BASE_COLOR.T, x: 138, h: 31 },
                        { b: 'T', c: BASE_COLOR.T, x: 176, h: 29 },
                        { b: 'C', c: BASE_COLOR.C, x: 214, h: 35 },
                      ].map((pk, i) => (
                        <g key={i}>
                          <rect x={pk.x - 5} y={2} width={10} height={8} rx={1.5} fill={qualityColor(35)} />
                          <text
                            x={pk.x}
                            y={21}
                            textAnchor="middle"
                            fontSize="10.5"
                            fontWeight="700"
                            fill={pk.c}
                          >
                            {pk.b}
                          </text>
                          <path
                            d={`M ${pk.x - 18} 64 C ${pk.x - 9} 64, ${pk.x - 6} ${64 - pk.h}, ${pk.x} ${64 - pk.h} C ${pk.x + 6} ${64 - pk.h}, ${pk.x + 9} 64, ${pk.x + 18} 64`}
                            fill={pk.c}
                            fillOpacity="0.16"
                            stroke={pk.c}
                            strokeWidth="1.7"
                          />
                        </g>
                      ))}
                    </svg>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </section>
    </main>
  );
};
