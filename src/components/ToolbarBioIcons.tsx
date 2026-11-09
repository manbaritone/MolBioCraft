// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';

export interface BioIconProps {
  size?: number;
  className?: string;
}

/** Add ▾ — Precision duotone rounded hexagon/circle '+' construct badge */
export const BioAddIcon: React.FC<BioIconProps> = ({ size = 21, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className={`mbc-bio-icon mbc-duotone-icon ${className}`.trim()}
  >
    <rect
      x="3.25"
      y="3.25"
      width="17.5"
      height="17.5"
      rx="5.5"
      fill="currentColor"
      fillOpacity="0.14"
      stroke="currentColor"
      strokeWidth="1.85"
    />
    <path
      d="M12 8v8M8 12h8"
      stroke="currentColor"
      strokeWidth="2.05"
      strokeLinecap="round"
    />
  </svg>
);

/** Import ▾ — Duotone sequence dock tray with downward incoming arrow */
export const BioImportIcon: React.FC<BioIconProps> = ({ size = 21, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className={`mbc-bio-icon mbc-duotone-icon ${className}`.trim()}
  >
    <rect
      x="3.75"
      y="14.5"
      width="16.5"
      height="5.5"
      rx="2"
      fill="currentColor"
      fillOpacity="0.14"
    />
    <path
      d="M4 15.25v2.5A2.25 2.25 0 0 0 6.25 20h11.5A2.25 2.25 0 0 0 20 17.75v-2.5"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 3.75v10.25m0 0-3.75-3.75M12 14l3.75-3.75"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Export ▾ — Duotone sequence dock tray with upward outgoing arrow */
export const BioExportIcon: React.FC<BioIconProps> = ({ size = 21, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className={`mbc-bio-icon mbc-duotone-icon ${className}`.trim()}
  >
    <rect
      x="3.75"
      y="14.5"
      width="16.5"
      height="5.5"
      rx="2"
      fill="currentColor"
      fillOpacity="0.14"
    />
    <path
      d="M4 15.25v2.5A2.25 2.25 0 0 0 6.25 20h11.5A2.25 2.25 0 0 0 20 17.75v-2.5"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 14V3.75m0 0L8.25 7.5M12 3.75 15.75 7.5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Session ▾ — Duotone project workspace binder with base-paired duplex emblem */
export const BioSessionIcon: React.FC<BioIconProps> = ({ size = 21, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className={`mbc-bio-icon mbc-duotone-icon ${className}`.trim()}
  >
    <path
      d="M3.5 7.25A2.25 2.25 0 0 1 5.75 5h3.9c.6 0 1.17.26 1.56.72l1.08 1.28h5.96A2.25 2.25 0 0 1 20.5 9.25v8.5A2.25 2.25 0 0 1 18.25 20H5.75A2.25 2.25 0 0 1 3.5 17.75v-10.5Z"
      fill="currentColor"
      fillOpacity="0.15"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinejoin="round"
    />
    <path
      d="M7.75 11.75h8.5M7.75 15.75h8.5"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
    <path
      d="M10 12.1v3.3M14 12.1v3.3"
      stroke="currentColor"
      strokeOpacity="0.65"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

/** BLAST — Homology search lens inspecting base-paired tracks + high-scoring hit starburst */
export const BioBlastIcon: React.FC<BioIconProps> = ({ size = 21, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className={`mbc-bio-icon mbc-duotone-icon ${className}`.trim()}
  >
    <circle
      cx="10.25"
      cy="11"
      r="6.5"
      fill="currentColor"
      fillOpacity="0.14"
      stroke="currentColor"
      strokeWidth="1.9"
    />
    <path
      d="M7.3 9.4h5.9M7.3 12.6h5.9M9.3 9.7v2.6M11.3 9.7v2.6"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
    />
    <path
      d="m15 15.75 4.75 4.75"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
    />
    <path
      d="M18.6 2.6v4.4M16.4 4.8h4.4"
      stroke="var(--mbc-ico-rose, #e11d48)"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

/** Workflows ▾ — Directed acyclic bio-compute pipeline DAG (2 inputs -> compute node) */
export const BioWorkflowsIcon: React.FC<BioIconProps> = ({ size = 21, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className={`mbc-bio-icon mbc-duotone-icon ${className}`.trim()}
  >
    <circle
      cx="5.5"
      cy="6.5"
      r="2.75"
      fill="currentColor"
      fillOpacity="0.18"
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <circle
      cx="5.5"
      cy="17.5"
      r="2.75"
      fill="currentColor"
      fillOpacity="0.18"
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <rect
      x="14.25"
      y="8.5"
      width="6.5"
      height="7"
      rx="2"
      fill="currentColor"
      fillOpacity="0.18"
      stroke="currentColor"
      strokeWidth="1.85"
    />
    <path
      d="M8.3 7.6 14 10.6M8.3 16.4 14 13.4"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

/** Align/Assemble ▾ — Stacked gapped alignment tracks with conserved column highlight */
export const BioAlignAssembleIcon: React.FC<BioIconProps> = ({
  size = 21,
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className={`mbc-bio-icon mbc-duotone-icon ${className}`.trim()}
  >
    <rect
      x="9.5"
      y="3.25"
      width="5"
      height="17.5"
      rx="1.4"
      fill="currentColor"
      fillOpacity="0.16"
    />
    <path
      d="M3.5 6.25h17M3.5 12h11.25M17.25 12h3.25M6 17.75h14.5"
      stroke="currentColor"
      strokeWidth="2.15"
      strokeLinecap="round"
    />
  </svg>
);

/** Tree ▾ — Rooted rectangular phylogenetic cladogram with duotone taxon leaf nodes */
export const BioTreeIcon: React.FC<BioIconProps> = ({ size = 21, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className={`mbc-bio-icon mbc-duotone-icon ${className}`.trim()}
  >
    <path
      d="M3 12.75h3.75M6.75 6.5v11.75h7.25M6.75 6.5H13M13 4.25v4.75M13 4.25h5.25M13 9h5.25M14 15.5v4.75M14 15.5h4.25M14 20.25h4.25"
      stroke="currentColor"
      strokeWidth="1.95"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="19.75" cy="4.25" r="1.55" fill="currentColor" />
    <circle cx="19.75" cy="9" r="1.55" fill="currentColor" fillOpacity="0.65" />
    <circle cx="19.75" cy="15.5" r="1.55" fill="currentColor" />
  </svg>
);

/** Primers ▾ — Opposing 5'->3' forward and 3'<-5' reverse barbed oligos with 5' anchor nodes */
export const BioPrimersIcon: React.FC<BioIconProps> = ({ size = 21, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className={`mbc-bio-icon mbc-duotone-icon ${className}`.trim()}
  >
    <rect
      x="3.5"
      y="6.25"
      width="17"
      height="11.5"
      rx="3"
      fill="currentColor"
      fillOpacity="0.12"
    />
    <path
      d="M4.5 9.5h15l-4-4"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="4.5" cy="9.5" r="1.4" fill="currentColor" />
    <path
      d="M19.5 14.5h-15l4 4"
      stroke="var(--mbc-ico-amber, #d97706)"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="19.5" cy="14.5" r="1.4" fill="var(--mbc-ico-amber, #d97706)" />
  </svg>
);

/** Cloning ▾ — Sticky-end vector overhang junction seating a ligated donor insert arc */
export const BioCloningIcon: React.FC<BioIconProps> = ({ size = 21, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className={`mbc-bio-icon mbc-duotone-icon ${className}`.trim()}
  >
    <circle
      cx="12"
      cy="12"
      r="8.25"
      fill="currentColor"
      fillOpacity="0.1"
    />
    <path
      d="M19.85 13.75a8.25 8.25 0 1 1-7.6-9.98"
      stroke="currentColor"
      strokeWidth="2.05"
      strokeLinecap="round"
    />
    {/* Sticky-end overhang notch + ligated teal insert segment */}
    <path
      d="M14.8 4.25A8.25 8.25 0 0 1 20.1 10.6"
      stroke="var(--mbc-ico-teal, #0d9488)"
      strokeWidth="2.8"
      strokeLinecap="round"
    />
    <path
      d="M12.2 2.2v3.1M19.1 10.8h3"
      stroke="var(--mbc-ico-teal, #0d9488)"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
  </svg>
);

/** Vectors — Annotated circular plasmid vector map with directional feature arcs & origin tick */
export const BioVectorsIcon: React.FC<BioIconProps> = ({ size = 21, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className={`mbc-bio-icon mbc-duotone-icon ${className}`.trim()}
  >
    <circle
      cx="12"
      cy="12"
      r="8.25"
      fill="currentColor"
      fillOpacity="0.12"
      stroke="currentColor"
      strokeWidth="1.85"
    />
    <circle
      cx="12"
      cy="12"
      r="4.5"
      stroke="currentColor"
      strokeOpacity="0.42"
      strokeWidth="1.25"
      strokeDasharray="2.4 1.8"
    />
    <path
      d="M12 3.75A8.25 8.25 0 0 1 20.1 10.4"
      stroke="var(--mbc-ico-indigo, #2563eb)"
      strokeWidth="2.85"
      strokeLinecap="round"
    />
    <path
      d="M10.1 20.03A8.25 8.25 0 0 1 4.18 14.6"
      stroke="var(--mbc-ico-emerald, #059669)"
      strokeWidth="2.55"
      strokeLinecap="round"
    />
    <path
      d="M12 1.8v2.6"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
  </svg>
);
