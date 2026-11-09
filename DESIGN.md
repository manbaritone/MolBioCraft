---
name: MolBioCraft
description: Offline desktop workbench for molecular and evolutionary biology, cool blue light on a ruled grid.
colors:
  signal-blue: "#1a73e8"
  signal-blue-deep: "#1557b0"
  signal-blue-ink: "#174ea6"
  signal-blue-bright: "#419dff"
  signal-blue-night: "#8ab4f8"
  selection-wash: "#d3e3fd"
  selection-ink: "#041e49"
  selection-highlight: "#c2dbff"
  selection-wash-night: "#1c3967"
  selection-highlight-night: "#24497f"
  lab-frost: "#eef3fb"
  bench-mist: "#f0f4f9"
  panel-haze: "#f4f7fc"
  canvas-white: "#ffffff"
  grid-paper: "#f8fbff"
  canvas-muted: "#f5f8fd"
  elevated-ice: "#eaf1fb"
  hover-tint: "#e8eff9"
  pressed-tint: "#d8e2f0"
  slate-rule: "#c4d1e3"
  hairline: "#e1e8f2"
  strong-rule: "#80868b"
  ink: "#1f1f1f"
  ink-secondary: "#444746"
  ink-muted: "#5f6368"
  night-window: "#111317"
  night-toolbar: "#171a1f"
  night-panel: "#15181c"
  night-canvas: "#1a1d22"
  night-grid-paper: "#131519"
  night-elevated: "#22262c"
  night-rule: "#333941"
  night-ink: "#e7e9ec"
  night-ink-secondary: "#c3c8cf"
  night-ink-muted: "#9ba3ae"
  pass-green: "#1e8e3e"
  pass-green-night: "#81c995"
  caution-amber: "#e37400"
  caution-amber-night: "#fdd663"
  fault-red: "#d93025"
  fault-red-night: "#f28b82"
  signal-cyan: "#0284c7"
  signal-cyan-night: "#38bdf8"
  okabe-blue: "#0072b2"
  okabe-bluish-green: "#009e73"
  okabe-orange: "#e69f00"
  okabe-vermilion: "#d55e00"
  okabe-sky-blue: "#56b4e9"
  okabe-reddish-purple: "#cc79a7"
  icon-teal: "#0d9488"
  icon-emerald: "#059669"
  icon-indigo: "#2563eb"
  icon-amber: "#d97706"
  icon-violet: "#7c3aed"
  icon-rose: "#e11d48"
  icon-cyan: "#0284c7"
typography:
  display:
    fontFamily: "Space Grotesk, Space Grotesk Fallback, Google Sans, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "clamp(2.25rem, 1.7rem + 1.5vw, 2.875rem)"
    fontWeight: 700
  headline:
    fontFamily: "Space Grotesk, Space Grotesk Fallback, Google Sans, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 700
  title:
    fontFamily: "Google Sans, Google Sans Fallback, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "0.84375rem"
    fontWeight: 600
  body:
    fontFamily: "Google Sans, Google Sans Fallback, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "0.78125rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Google Sans, Google Sans Fallback, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
  caption:
    fontFamily: "Google Sans, Google Sans Fallback, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 400
  residue:
    fontFamily: "Google Sans Code, Google Sans Code Fallback, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.78125rem"
    fontWeight: 400
  # Brand lockup (D0024): the wordmark's own sizes, logo artwork rather than type roles.
  brand-lockup-start-wordmark:
    fontFamily: "Space Grotesk, Space Grotesk Fallback, Google Sans, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "38px"
    fontWeight: 700
  brand-lockup-about-wordmark:
    fontFamily: "Space Grotesk, Space Grotesk Fallback, Google Sans, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "36px"
    fontWeight: 700
  brand-lockup-about-workbench:
    fontFamily: "Space Grotesk, Space Grotesk Fallback, Google Sans, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 600
  brand-lockup-splash-wordmark:
    fontFamily: "Space Grotesk, Space Grotesk Fallback, Google Sans, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "clamp(2.4rem, 1.6rem + 3vw, 3.6rem)"
    fontWeight: 700
  brand-lockup-splash-workbench:
    fontFamily: "Space Grotesk, Space Grotesk Fallback, Google Sans, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "clamp(1.5rem, 1rem + 1.9vw, 2.2rem)"
    fontWeight: 700
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "6px"
  "3": "10px"
  "4": "14px"
  "5": "20px"
  "6": "28px"
components:
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.canvas-white}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "6px 13px"
  button-primary-hover:
    backgroundColor: "{colors.signal-blue-deep}"
  button-primary-night:
    backgroundColor: "{colors.signal-blue-night}"
    textColor: "{colors.selection-ink}"
  button-secondary:
    backgroundColor: "{colors.canvas-white}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "6px 13px"
  button-secondary-hover:
    backgroundColor: "{colors.selection-wash}"
  toolbar-button:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: "30px"
  toolbar-button-hover:
    backgroundColor: "{colors.hover-tint}"
  toolbar-button-pressed:
    backgroundColor: "{colors.pressed-tint}"
  document-tab:
    textColor: "{colors.ink-secondary}"
    typography: "{typography.body}"
    height: "38px"
  document-tab-active:
    backgroundColor: "{colors.canvas-white}"
    textColor: "{colors.ink}"
  search-field:
    backgroundColor: "{colors.panel-haze}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    height: "27px"
    padding: "0 6px 0 10px"
  chip-accent:
    backgroundColor: "{colors.selection-wash}"
    textColor: "{colors.signal-blue-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
  panel-card:
    backgroundColor: "{colors.canvas-white}"
    rounded: "{rounded.lg}"
    padding: "13px 14px"
  menubar:
    backgroundColor: "{colors.canvas-white}"
    textColor: "{colors.ink}"
    height: "30px"
  tab-bar:
    height: "38px"
  action-toolbar:
    # The 40px minimum height (--mbc-toolbar-h); the bar renders 41px with its 1px bottom rule.
    height: "40px"
  statusbar:
    backgroundColor: "{colors.bench-mist}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.caption}"
    height: "27px"
---

# Design System: MolBioCraft

## Overview

**Creative North Star: "Benchlight Workstation"**

MolBioCraft is a well-lit lab bench rendered as software: cool blue light falling on frosted slate, with a faint engineering grid under the work. The interface is an instrument, not a brochure. Chrome stays quiet and exact so that plasmid maps, trees, gels, chromatograms and structures carry the color and the attention. The palette is the one researchers already trust from their operating system and their figures: a single confident blue, a ladder of cool near-white surfaces, and a small, disciplined set of status and data colors.

The mood is precise, calm and bright. The start screen breathes: a centered brand block, two cards, a drop zone. The studios are dense and orderly: 30px menubar, 38px tab bar, an action toolbar 41px tall (a 40px minimum-height row plus its 1px bottom rule), 27px status bar, compact 24–32px controls, and every pixel between them given to the figure. Brand lives in the details rather than in decoration: the blue phoenix emblem, the Space Grotesk wordmark, the 2px spectrum hairline under the menubar, the multi-tone icon set, and the ruled grid paper beneath the canvas.

Both themes are first-class. Night mode is not an inversion: it lowers the surfaces to graphite, lifts the accent to a softer sky blue, and keeps the same structure, rules and hierarchy.

**Key Characteristics:**
- One accent blue for action, focus and selection. Everything else is neutral or carries data.
- Cool, low-chroma surface ladder (window → toolbar → panel → canvas) separated by 1px slate rules, not shadows.
- A ruled grid-paper canvas (26px cells, 130px majors) under the start screen and drawing surfaces.
- Multi-tone SVG iconography and figures, with an Okabe-Ito colorblind-safe alternative for data.
- Compact desktop density with fixed chrome heights and a keyboard-first command surface.
- Google Sans for the interface, Space Grotesk for the brand voice, Google Sans Code for residues and coordinates.

## Colors

A cool, Google-blue workstation palette: one saturated accent on a ladder of blue-tinted near-whites, with status and data hues kept for meaning.

### Primary
- **Signal Blue** (`signal-blue`): the only action color. Primary buttons, the focus ring (2px solid), active tab top rule, links, selected toggles and the grid's tint. In night mode it becomes **Night Sky Blue** (`signal-blue-night`), with dark Selection Ink text on primary buttons.
- **Deep Signal Blue** (`signal-blue-deep`): hover and pressed state of primary buttons, and the border of the start screen's primary button.
- **Signal Ink** (`signal-blue-ink`): blue text on light washes, such as accent chips, the version badge, eyebrow labels and inline action text.
- **Selection Wash** (`selection-wash`, `selection-highlight`): selected rows, selected list items, sequence selection. In night mode, `selection-wash-night` and `selection-highlight-night`.

### Neutral
- **Lab Frost** (`lab-frost`): the window background behind everything.
- **Bench Mist** (`bench-mist`): toolbars, tab bar and status bar, the chrome band.
- **Panel Haze** (`panel-haze`): side panels, inspectors and the search field.
- **Canvas White** (`canvas-white`) and **Grid Paper** (`grid-paper`): the working surface, and the ruled canvas the grid sits on.
- **Elevated Ice** (`elevated-ice`), **Hover Tint** (`hover-tint`), **Pressed Tint** (`pressed-tint`): raised controls and the hover and pressed states of quiet buttons.
- **Slate Rule** (`slate-rule`), **Hairline** (`hairline`), **Strong Rule** (`strong-rule`): the 1px borders that separate every region. Hairlines sit inside panels, Slate Rules between panels, and Strong Rules on secondary-button outlines.
- **Ink** (`ink`), **Secondary Ink** (`ink-secondary`), **Muted Ink** (`ink-muted`): primary text, supporting text, and metadata or status-bar text.
- **Night ladder** (`night-window` → `night-toolbar` → `night-panel` → `night-canvas` → `night-elevated`, with `night-rule` and the `night-ink` set): the same ladder in graphite for the dark theme.

### Status
- **Pass Green** (`pass-green`), **Caution Amber** (`caution-amber`), **Fault Red** (`fault-red`): QC verdicts, validation and errors. Each has a lifted night value.
- **Signal Cyan** (`signal-cyan`): informational highlights and in-progress states that must not read as the primary action.

### Data and iconography
- **Okabe-Ito set** (`okabe-*`): the colorblind-safe palette for traces, tracks and categorical data. It is selectable everywhere a figure is colored.
- **Icon palette** (`icon-teal`, `icon-emerald`, `icon-indigo`, `icon-amber`, `icon-violet`, `icon-rose`, `icon-cyan`): the multi-tone tool and file-type icons, such as the blue New, amber Open and teal Import icons in the ribbon.
- **Spectrum hairline**: the signature gradient (#4285f4 → #419dff → #6fcb88 → #fbbc04 → #f86b55) drawn as a 2px rule under the menubar and in progress fills.

### Named Rules
**The One Blue Rule.** Signal Blue is the only color that means "act here". Never use a status or icon hue for a primary action, and never introduce a second accent.

**The Data Owns the Hue Rule.** Saturated color belongs to figures, icons and verdicts. Chrome, panels and containers stay on the neutral ladder.

**The Spectrum Is a Signature Rule.** The spectrum gradient appears only as a thin rule or a progress fill, never as a surface, a text fill or a button background.

## Typography

**Display Font:** Space Grotesk (with Helvetica Neue / Arial fallback)
**Body Font:** Google Sans (with Arial / Helvetica Neue fallback)
**Label/Mono Font:** Google Sans Code (with Menlo / Consolas fallback)

**Character:** Google Sans carries the interface with open, highly legible forms at small sizes. Space Grotesk's engineered geometry gives the brand and section voice a technical edge. Google Sans Code keeps residues, coordinates and numeric columns aligned on its 0.6 em advance.

### Hierarchy
- **Display** (Space Grotesk 700, clamp 36–46px): reserved for display headlines. The MolBioCraft wordmark does not use it; the wordmark takes the brand-lockup sizes below.
- **Headline** (Space Grotesk 700, 15px): the start screen tagline and section heads that speak with the brand voice.
- **Title** (Google Sans 600, 13.5px): card titles, dialog titles, panel headers.
- **Body** (Google Sans 400, 12.5px, line-height 1.45): all running UI text, table cells and descriptions. Descriptions wrap at the card width and never run edge to edge on the canvas.
- **Label** (Google Sans 600, 12px): buttons, form labels, tab labels. Eyebrow labels such as "WORKBENCH CAPABILITIES" use Label in uppercase with wide tracking, in Signal Ink.
- **Caption** (Google Sans 400, 11px): status bar, metadata and units.
- **Residue** (Google Sans Code 400, 12.5px): nucleotide and amino-acid sequence, coordinates (`5,192 .. 5,911`), lengths and table numerics.

### Brand Lockup
The MolBioCraft wordmark and its "Workbench" line are logo artwork, not type roles. They keep their own sizes (the `brand-lockup-*` entries in the front matter), which the stylesheet reads from `--brand-lockup-*` tokens that nothing else uses:
- **Start screen:** the wordmark at 38px (Space Grotesk 700).
- **About:** the wordmark at 36px (Space Grotesk 700), with the "Workbench" line beneath it at 17px (Space Grotesk 600).
- **Splash:** the wordmark at `clamp(2.4rem, 1.6rem + 3vw, 3.6rem)` (38.4–57.6px) and the "Workbench" line at `clamp(1.5rem, 1rem + 1.9vw, 2.2rem)` (24–35.2px), both Space Grotesk 700.

### Named Rules
**The Mono Means Measured Rule.** Google Sans Code is used only for sequence, coordinates and measured numbers. Never set prose or labels in it.

**The Wordmark Is Space Grotesk Rule.** The MolBioCraft name is always set in Space Grotesk 700. Never re-set it in Google Sans or another face.

## Layout

A fixed desktop chrome stack around one flexible canvas:
- menubar 30px, with the 2px spectrum hairline beneath it;
- tab and search bar 38px;
- action toolbar 40px minimum height, which renders 41px with its 1px bottom rule; a single row of icon-beside-label buttons;
- the work area;
- status bar 27px.

The start screen's New / Open / Import strip is the one place icons stack over their labels.

A collapsible left sidebar holds the project tree, and an optional right inspector holds properties. Chrome heights do not change per studio. The bars read them from `--mbc-menubar-h`, `--mbc-tabbar-h`, `--mbc-toolbar-h` (a minimum height) and `--mbc-statusbar-h`, which hold the heights above.

Controls come in three heights: 24px (sm), 28px (md, the default) and 32px (lg). Spacing follows a compact six-step scale (4, 6, 10, 14, 20, 28px). Use 4–6px inside controls, 10–14px between related controls and card padding, and 20–28px between sections.

The canvas sits on grid paper: 26px cells with 130px major lines, tinted with Signal Blue at about 7% and 12% opacity. The start screen centers its content in an 860px column on that grid. Studios use the full width and align figures and tables to the panel edges.

Density is deliberate. Studios favor showing more data at a glance over generous whitespace. The start screen is the one place that breathes.

## Elevation & Depth

Depth comes mostly from tone, not shadow. The surface ladder (window → toolbar → panel → canvas) and 1px Slate Rules separate regions. Shadows are soft, cool and reserved for things that genuinely float.

### Shadow Vocabulary
- **Rest** (`box-shadow: 0 1px 2px rgba(15, 23, 42, 0.10)`): cards on the grid canvas, raised chips.
- **Raised** (`box-shadow: 0 2px 6px rgba(15, 23, 42, 0.12), 0 1px 2px rgba(15, 23, 42, 0.08)`): popovers, dropdown menus, hover lift on cards.
- **Floating** (`box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16), 0 2px 6px rgba(15, 23, 42, 0.10)`): modal dialogs, the command palette, operation windows.

### Named Rules
**The Rules Before Shadows Rule.** Panels, toolbars and docked regions never carry a shadow. They are separated by a 1px rule and a tone step. Shadows belong only to things that float above the layout.

## Shapes

Gently rounded, never soft:
- 4px (xs) for tiny chips and inline tags;
- 6px (sm) for buttons, inputs and toolbar buttons;
- 8px (md) for menus and popovers;
- 12px (lg) for cards and dialogs;
- full pill (999px) for the search field, the version badge and status-bar chips.

Document tabs round only their top corners (6px). Borders are 1px throughout. The one exception is the drop zone, whose 1.5px dashed Signal Blue outline marks it as a target, not a container.

The phoenix emblem sits in a rounded-square app tile. It is never cropped to a circle and never recolored.

## Components

### Buttons
Crisp, compact and unmistakable. One primary per region.
- **Shape:** gently rounded (6px), 1px border, Label type.
- **Primary:** Signal Blue fill with white text, padding 6px 13px. In night mode, a Night Sky Blue fill with Selection Ink text.
- **Hover / Focus:** hover deepens to Deep Signal Blue over 120ms. Focus shows a 2px solid Signal Blue ring. Never remove the ring.
- **Secondary:** a Canvas White fill with a Strong Rule border and Ink text. Hover shifts to the Selection Wash with a Signal Blue border.
- **Toolbar:** transparent at rest, with a multi-tone icon beside a Label in the action toolbar (a 40px minimum-height row, 41px rendered with its 1px bottom rule; icon over label only on the start screen's New / Open / Import strip). Hover takes Hover Tint, pressed or active takes Pressed Tint.

### Chips
- **Style:** a pill with a Selection Wash fill and Signal Ink text, used for the version badge, feature-type tags such as "CDS" and keyboard hints.
- **State:** the status-bar chips use a thin outline (accent for navigation, amber for licence or notice). Selected filter chips take the Selection Wash with a Signal Blue border.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Canvas White at 88% over the grid (night: #1a1d23 at 90%).
- **Shadow Strategy:** Rest on the canvas, Raised on hover. See Elevation & Depth.
- **Border:** 1px pale blue rule (#d3e2f8; night #354153).
- **Internal Padding:** 13px 14px. Lists inside cards use a 10px row rhythm with icon, title and one-line description.

### Inputs / Fields
- **Style:** a 1px Slate Rule border, a Canvas White or Panel Haze fill, 6px radius and 28px height. The global search is a 27px pill with a leading search icon and a trailing shortcut hint.
- **Focus:** a 2px solid Signal Blue ring. The border may take Signal Blue.
- **Error / Disabled:** errors take a Fault Red border plus a message beneath. Disabled fields drop to Muted Ink on Canvas Muted.

### Navigation
- **Menubar:** 30px, Google Sans 12px, Ink on Canvas White, with the spectrum hairline beneath it. On macOS the native AppKit menu replaces it.
- **Document tabs:** 38px tall, top-rounded (6px). Inactive tabs are transparent with Secondary Ink text. The active tab takes Canvas White with a 2px Signal Blue top rule and joins the canvas below.
- **Sidebar:** Panel Haze, with a header row, a primary action and text-button links in Signal Ink.
- **Status bar:** 27px, Bench Mist, Caption type in Muted Ink. It shows session state at the left and shortcut hints and chips at the right.

### Studio Canvas (signature)
The working surface every studio draws on: grid paper beneath the multi-tone SVG figure (plasmid map, tree, gel, chromatogram, structure), a panel-side inspector of properties in Body and Residue type, and figure controls in the toolbar above. The figure is the hero. Chrome around it stays neutral so the figure's colors read as data.

## Do's and Don'ts

### Do:
- **Do** keep Signal Blue (#1a73e8, night #8ab4f8) as the single accent for action, focus and selection.
- **Do** keep the blue phoenix emblem and the Space Grotesk 700 MolBioCraft wordmark exactly as they are, in both themes.
- **Do** separate regions with 1px rules and a tone step on the surface ladder before reaching for a shadow.
- **Do** keep the chrome heights (menubar 30, tab bar 38, action toolbar 40px minimum and 41px rendered with its bottom rule, status bar 27px) and the 24 / 28 / 32px control heights for every new bar and control.
- **Do** use the radius scale (4, 6, 8, 12, pill) and the spacing scale (4, 6, 10, 14, 20, 28px) instead of one-off values.
- **Do** offer the Okabe-Ito palette wherever a figure encodes categories by color.
- **Do** set sequence, coordinates and measured numbers in Google Sans Code.
- **Do** give every interactive element the 2px Signal Blue focus ring.
- **Do** design every new surface in both light and night themes.

### Don't:
- **Don't** introduce a new accent hue, a new font family, or a recolored or redrawn logo.
- **Don't** use the spectrum gradient as a fill, background, text color or button surface. It is a 2px rule or a progress fill only.
- **Don't** put shadows on docked panels, toolbars or tabs.
- **Don't** use status hues (green, amber, red) or icon hues for buttons or decoration.
- **Don't** set prose, labels or buttons in the monospace face.
- **Don't** invent per-component radii (7px, 10px) or spacing outside the scale.
- **Don't** let chrome compete with the figure. No colored panel fills and no tinted toolbars beyond the neutral ladder.
