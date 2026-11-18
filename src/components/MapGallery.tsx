// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The Map Gallery (US-01M7DVS2): one labelled card for each row checked in the document table that
 * the table shows, in the table's order. The App shows it in the main view's place while the split
 * pane, when shown, stays beside it (D0192); it is App state and nothing about it is saved.
 *
 * A card draws its record as the split pane draws its document: the restriction scan is the pane's
 * own (`scanDocumentForMap`), a circle is drawn exactly where `circularMapUnavailableReason` allows
 * one and a linear feature bar otherwise, View › Tracks' Features and Restriction Sites apply, no
 * ORFs or primers are drawn, and every scanned site is drawn (per-site choices are not applied, as
 * in the pane). A circle starts at its document's main-view rotation and is laid out at card size
 * (`measuredBox`), so its callout note says which labels the card left out.
 *
 * The gallery lists at most SPLIT_PICKER_CAP cards and, on opening, draws maps for the first
 * GALLERY_MAPS_DRAWN_FIRST cards that have one, each mounting a full map and a scan; a card with no
 * map takes no drawn slot. Draw next draws GALLERY_DRAW_STEP more, the next in card order (US-01M7DV75).
 * Both limits are said by subsetNote, the second counted over the records that have a map. A record
 * longer than GALLERY_DRAW_ON_OPEN_MAX_BP is drawn by neither, only by its own card's Draw map. An
 * undrawn card keeps its name, length, topology and Open in viewer.
 *
 * Fit each map fits each map to its card. Common scale draws every map at one scale k, in screen
 * pixels per base: a circle's circumference and a bar's length are its record's length times k, the
 * largest k at which every listed map fits its card, and the record that sets k is named. A circle
 * that would be smaller than GALLERY_MIN_CIRCLE_DIAMETER_PX is drawn at it, and its card says it is
 * not to scale. Each map says its drawn length in `data-drawn-px`.
 *
 * Each card keeps its own selection, rotation (its own CircularMapRotationControl) and compare choice
 * (US-01M7DV6R), held by its record's id, as the split pane holds its selection, so they move with the
 * record when the table's sort reorders the cards and stay when other rows are checked or unchecked.
 * A card writes none of the App's selection, zoom or rotation and is handed no zoom, and a wheel or
 * pinch over it is kept from its map (holdCardGesture), so it zooms and moves nothing; its state lives
 * only while the gallery is shown. Compare in split hands the two
 * chosen records, in card order, to the App.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { RotateCw, X } from 'lucide-react';
import { restrictionSiteCountsByName } from '../core/bioEngine';
import { buildCommandDocumentContext, circularMapUnavailableReason } from '../core/commandAvailability';
import { isContigSummaryRecord } from '../core/contigSummary';
import { computeDocumentTableMetrics, getDocumentColumnDisplayValue } from '../core/workbenchBatchOperations';
import type { RestrictionCutSite, RestrictionEnzyme, SequenceDocument } from '../types/bio';
import {
  CIRCULAR_MAP_BACKBONE_R,
  CIRCULAR_MAP_LABEL_FLOOR_PX,
  CIRCULAR_MAP_OUTER_RING_R,
  CircularMapRotationControl,
  CircularPlasmidMap,
  fitCircularMapScale,
  RESTRICTION_FULL_SCAN_MAX_BP,
  RING_INNER_TRACK_R,
  restrictionScopeWords,
  subsetNote,
  type ChosenScanCollection,
} from './CircularPlasmidMap';
import { ResultWarnings } from './ResultWarnings';
import { scanDocumentForMap, SPLIT_PICKER_CAP, type SplitRange } from './SplitDocumentPane';

/**
 * How many cards the gallery draws a map for on opening, the first in its order that have one; and
 * how many more each Draw next draws. Both are set from the timings in US-01M7DV75's Measurements:
 * the most maps of the costliest record drawn without asking (a 100,000 bp linear record, every
 * enzyme's sites drawn) that were measured to draw within one second.
 */
export const GALLERY_MAPS_DRAWN_FIRST = 4;
export const GALLERY_DRAW_STEP = 4;

/**
 * The longest record, in bases, whose map is drawn without being asked for: the length the
 * workbench still scans whole for cut sites (RESTRICTION_FULL_SCAN_MAX_BP). A longer one is drawn
 * only by its card's Draw map.
 */
export const GALLERY_DRAW_ON_OPEN_MAX_BP = RESTRICTION_FULL_SCAN_MAX_BP;

/** The box a card's circle is laid out at, in pixels: the 680x540 map view at 0.44. */
export const GALLERY_CARD_MAP_BOX = { width: 300, height: 238 } as const;

/** The backbone diameter, in pixels, of a circle fitted to a card: the backbone at the card box's fit scale. */
export const GALLERY_CARD_CIRCLE_DIAMETER_PX = 2 * CIRCULAR_MAP_BACKBONE_R * fitCircularMapScale(GALLERY_CARD_MAP_BOX.width, GALLERY_CARD_MAP_BOX.height);

/**
 * The smallest circle a card draws under Common scale, in pixels across its backbone: the circle at
 * which a label at the floor (CIRCULAR_MAP_LABEL_FLOOR_PX) is as tall as the ring's band, from its
 * inner track (RING_INNER_TRACK_R) to its outer ring (CIRCULAR_MAP_OUTER_RING_R), in units of the
 * 680x540 view. A smaller circle would carry labels taller than the band they label.
 */
export const GALLERY_MIN_CIRCLE_DIAMETER_PX = (2 * CIRCULAR_MAP_BACKBONE_R * CIRCULAR_MAP_LABEL_FLOOR_PX) / (CIRCULAR_MAP_OUTER_RING_R - RING_INNER_TRACK_R);

/** The sentence a card shows for a record that has no map, or null when it has one. */
export function galleryNoMapReason(doc: SequenceDocument): string | null {
  if (typeof doc.docMetadata?.Newick === 'string') return 'A tree has no sequence map.';
  if ((doc.alignmentMeta?.sequences?.length ?? 0) > 1) return 'An alignment has no sequence map.';
  if (doc.docMetadata?.['Document Type'] === 'Text Document') return 'A text document has no sequence map.';
  // A contig summary holds no bases either; it is named as what it is, before the bare rule.
  if (isContigSummaryRecord(doc)) return 'A contig summary has no sequence map.';
  if (doc.sequence.length === 0) return 'This record has no bases to draw.';
  return null;
}

export interface MapGalleryProps {
  /** The checked rows the document table shows, in its order, uncapped: their count is the M the notes count against. */
  docs: SequenceDocument[];
  /** The Project Explorer labels from the root to a record's folder. */
  folderPath: (doc: SequenceDocument) => string[];
  /** A record's main-view rotation in degrees (0 when it has none). */
  rotationOf: (docId: string) => number;
  /** View › Tracks' Features and Restriction Sites. */
  tracks: { showFeatures: boolean; showRestrictionSites: boolean };
  enzymes: RestrictionEnzyme[];
  scanCollection: ChosenScanCollection | null;
  /** A card's Open in viewer, by the record's id. */
  onOpen: (docId: string) => void;
  /** Compare in split: the two chosen records' ids, the first in card order first. */
  onCompare: (mainDocId: string, paneDocId: string) => void;
  onClose: () => void;
}

/**
 * A card's own view (US-01M7DV6R): its selection, its rotation once turned (until then its record's
 * main-view rotation), whether its rotate control is open, and its compare choice.
 */
interface CardView {
  range: SplitRange | null;
  rotation: number | null;
  rotateOpen: boolean;
  chosen: boolean;
}
const FRESH_CARD: CardView = { range: null, rotation: null, rotateOpen: false, chosen: false };

/** Compare in split's reason while it is off: the number of shown cards chosen. */
export const compareChoiceReason = (n: number) => `Choose exactly two cards to compare (now ${n}).`;

/** A bar's box, in pixels: as wide as a card's circle box (App.css draws it at this width). */
const BAR_W = GALLERY_CARD_MAP_BOX.width;
const BAR_H = 44;

const unitOf = (doc: SequenceDocument) => (doc.moleculeType === 'Protein' ? 'aa' : 'bp');
const lengthWords = (doc: SequenceDocument) => `${doc.sequence.length.toLocaleString('en-US')} ${unitOf(doc)}`;

/** Whether a record's map is a circle, by the rule the split pane draws by. */
const drawsCircle = (doc: SequenceDocument) => circularMapUnavailableReason(buildCommandDocumentContext(doc) ?? doc) === null;

/**
 * Common scale's k, in screen pixels per base: the largest at which every map fits its card (a
 * circle's circumference within the fitted circle's, a bar's length within the bar's box), with the
 * first record in card order that sets it. Null when no card has a map.
 */
export function galleryCommonScale(maps: { doc: SequenceDocument; circle: boolean }[]): { k: number; setter: SequenceDocument } | null {
  let best: { k: number; setter: SequenceDocument } | null = null;
  for (const { doc, circle } of maps) {
    const k = (circle ? Math.PI * GALLERY_CARD_CIRCLE_DIAMETER_PX : BAR_W) / Math.max(1, doc.sequence.length);
    if (!best || k < best.k) best = { k, setter: doc };
  }
  return best;
}

/** How a card's map is drawn under Common scale: a circle's fraction of its fitted size, or a bar's length. */
interface CardScale {
  drawnScale: number;
  barPx: number;
  notToScale: boolean;
}

/** A linear record's feature bar: the backbone, its features as boxes and its cut sites as ticks, `drawnPx` long. */
const FeatureBar: React.FC<{ doc: SequenceDocument; sites: RestrictionCutSite[]; tracks: MapGalleryProps['tracks']; drawnPx: number }> = ({ doc, sites, tracks, drawnPx }) => {
  const len = Math.max(1, doc.sequence.length);
  const x = (pos: number) => ((pos - 1) / len) * drawnPx;
  const boxes = tracks.showFeatures
    ? doc.features.flatMap((f) => {
        // A feature across the origin of a circular record is drawn as its two parts.
        const parts = f.end >= f.start ? [[f.start, f.end]] : [[f.start, len], [1, f.end]];
        return parts.map(([s, e], i) => (
          <rect key={`${f.id}-${i}`} data-map-part="feature-box" x={x(s)} y={14} width={Math.max(1, x(e + 1) - x(s))} height={16} fill={f.color || '#3b82f6'} opacity={0.85}>
            <title>{`${f.name} (${f.start.toLocaleString()}..${f.end.toLocaleString()})`}</title>
          </rect>
        ));
      })
    : [];
  return (
    <svg className="mbc-map-gallery-bar" viewBox={`0 0 ${BAR_W} ${BAR_H}`} role="img" aria-label={`Linear map of ${doc.name}`} preserveAspectRatio="none" data-drawn-px={drawnPx.toFixed(2)}>
      <line x1={0} x2={drawnPx} y1={22} y2={22} stroke="var(--mbc-text-muted)" strokeWidth={2} />
      {boxes}
      {tracks.showRestrictionSites &&
        sites.map((s) => <line key={s.id} data-map-part="cut-site" x1={x(s.cutTop)} x2={x(s.cutTop)} y1={6} y2={38} stroke="var(--mbc-danger, #dc2626)" strokeWidth={1} />)}
    </svg>
  );
};

/** The gestures a card's map would zoom or pan by: a wheel and WebKit's pinch. */
const CARD_GESTURES = ['wheel', 'gesturestart', 'gesturechange', 'gestureend'] as const;

/**
 * Keeps a wheel or pinch over a card from its map (US-01M7DV6R AC1), so the map neither zooms nor
 * moves: a plain wheel is left to scroll the gallery, and a pinch (a ctrl- or meta-flagged wheel, or a
 * gesture event) is kept from zooming the page. Capture-phase and non-passive, so it runs before the
 * map's own listener and may prevent the default.
 */
const holdCardGesture = (event: Event) => {
  event.stopPropagation();
  const wheel = event as WheelEvent;
  if (event.type !== 'wheel' || wheel.ctrlKey || wheel.metaKey) event.preventDefault();
};

/** A drawn card's map, with its scan's warnings and the scope of a partial scan. */
const CardMap: React.FC<{
  doc: SequenceDocument;
  props: MapGalleryProps;
  view: CardView;
  onView: (patch: Partial<CardView>) => void;
  circle: boolean;
  /** Common scale's drawing of this map, or null under Fit each map. */
  scale: CardScale | null;
}> = ({ doc, props, view, onView, circle, scale }) => {
  const { enzymes, scanCollection, tracks, rotationOf } = props;
  const rotationDeg = view.rotation ?? rotationOf(doc.id);
  const { scan, restrictionScope } = useMemo(() => scanDocumentForMap(doc, enzymes, scanCollection), [doc, enzymes, scanCollection]);
  const scope = doc.moleculeType === 'Protein' ? null : restrictionScopeWords(restrictionScope, doc.sequence.length);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    for (const type of CARD_GESTURES) box.addEventListener(type, holdCardGesture, { capture: true, passive: false });
    return () => { for (const type of CARD_GESTURES) box.removeEventListener(type, holdCardGesture, { capture: true }); };
  }, []);
  return (
    <div className="mbc-map-gallery-map" ref={boxRef}>
      <ResultWarnings warnings={scan.warnings} label="Restriction scan warnings" />
      {scope && <p className="mbc-map-gallery-scope">{scope.detail}</p>}
      {scale?.notToScale && (
        <p className="mbc-map-gallery-not-to-scale">Drawn larger than the common scale, at the smallest circle a card draws: not to scale.</p>
      )}
      {circle && (
        <button
          type="button"
          className="mbc-btn mbc-map-gallery-rotate"
          aria-label={`Rotate ${doc.name}`}
          aria-expanded={view.rotateOpen}
          onClick={() => onView({ rotateOpen: !view.rotateOpen })}
        >
          <RotateCw size={12} aria-hidden="true" /> Rotate
        </button>
      )}
      {circle && view.rotateOpen && (
        <CircularMapRotationControl rotationDeg={rotationDeg} onRotate={(deg) => onView({ rotation: deg })} onClose={() => onView({ rotateOpen: false })} />
      )}
      {circle ? (
        // No zoomLevel or onZoomChange: a card's circle is fitted to its card, and holdCardGesture keeps a wheel or pinch from it.
        <CircularPlasmidMap
          doc={doc}
          cutSites={scan.sites}
          siteCounts={restrictionSiteCountsByName(scan)}
          orfs={[]}
          selectedRange={view.range}
          onSelectRange={(range) => onView({ range })}
          showOrfs={false}
          showPrimers={false}
          showFeatures={tracks.showFeatures}
          showRestrictionSites={tracks.showRestrictionSites}
          showUniqueCuttersOnly={false}
          restrictionScope={restrictionScope}
          measuredBox={GALLERY_CARD_MAP_BOX}
          rotationDeg={rotationDeg}
          drawnScale={scale?.drawnScale ?? 1}
        />
      ) : (
        <FeatureBar doc={doc} sites={scan.sites} tracks={tracks} drawnPx={scale?.barPx ?? BAR_W} />
      )}
    </div>
  );
};

export const MapGallery: React.FC<MapGalleryProps> = (props) => {
  const { docs, folderPath, onOpen, onCompare, onClose } = props;
  const fitNoteId = useId();
  const commonNoteId = useId();
  const shown = docs.slice(0, SPLIT_PICKER_CAP);
  // A card with no map takes no drawn slot, so the note counts maps drawn against the records that have one.
  const noMapReasons = docs.map(galleryNoMapReason);
  const withMap = noMapReasons.filter((r) => r === null).length;
  // The cards that have a map, in card order, each with its kind.
  const maps = useMemo(
    () => docs.slice(0, SPLIT_PICKER_CAP).filter((d) => galleryNoMapReason(d) === null).map((doc) => ({ doc, circle: drawsCircle(doc) })),
    [docs],
  );
  // Drawn: the first GALLERY_MAPS_DRAWN_FIRST cards with a map, then each Draw next's step, but never a
  // record longer than GALLERY_DRAW_ON_OPEN_MAX_BP unless its own Draw map was pressed (by record id).
  const [stepped, setStepped] = useState(0);
  const [asked, setAsked] = useState<ReadonlySet<string>>(() => new Set());
  const tooLong = (d: SequenceDocument) => d.sequence.length > GALLERY_DRAW_ON_OPEN_MAX_BP;
  const later = maps.slice(GALLERY_MAPS_DRAWN_FIRST).filter((m) => !tooLong(m.doc));
  const steps = Math.min(stepped, later.length);
  const drawnIds = new Set([
    ...maps.slice(0, GALLERY_MAPS_DRAWN_FIRST).filter((m) => !tooLong(m.doc)),
    ...later.slice(0, steps),
    ...maps.filter((m) => asked.has(m.doc.id)),
  ].map((m) => m.doc.id));
  const [commonScale, setCommonScale] = useState(false);
  const common = commonScale ? galleryCommonScale(maps) : null;
  const scaleOf = (doc: SequenceDocument, circle: boolean): CardScale | null => {
    if (!common) return null;
    const px = doc.sequence.length * common.k;
    if (!circle) return { drawnScale: 1, barPx: px, notToScale: false };
    const diameter = Math.max(px / Math.PI, GALLERY_MIN_CIRCLE_DIAMETER_PX);
    return { drawnScale: Math.min(1, diameter / GALLERY_CARD_CIRCLE_DIAMETER_PX), barPx: BAR_W, notToScale: px / Math.PI < GALLERY_MIN_CIRCLE_DIAMETER_PX };
  };
  const circleOf = new Map(maps.map((m) => [m.doc.id, m.circle]));
  // Each card's own view, by its record's id (US-01M7DV6R); a record never shown has none.
  const [views, setViews] = useState<Readonly<Record<string, CardView>>>({});
  const viewOf = (id: string) => views[id] ?? FRESH_CARD;
  const setView = (id: string, patch: Partial<CardView>) => setViews((v) => ({ ...v, [id]: { ...(v[id] ?? FRESH_CARD), ...patch } }));
  // The choices of the cards shown, in card order: a record whose row was unchecked is not counted.
  const chosen = shown.filter((d) => viewOf(d.id).chosen);
  const compareReason = chosen.length === 2 ? null : compareChoiceReason(chosen.length);
  return (
    <section className={commonScale ? 'mbc-map-gallery mbc-map-gallery--common' : 'mbc-map-gallery'} aria-label="Map Gallery">
      <div className="mbc-map-gallery-head">
        <h2>Map Gallery</h2>
        <div className="mbc-map-gallery-size" role="radiogroup" aria-label="Map size">
          <label>
            <input type="radio" name={`${fitNoteId}-size`} aria-label="Fit each map" aria-describedby={fitNoteId} checked={!commonScale} onChange={() => setCommonScale(false)} />
            Fit each map
          </label>
          {!commonScale && <span id={fitNoteId} className="mbc-map-gallery-size-note">Each map fitted to its card; sizes are not to scale</span>}
          <label>
            <input type="radio" name={`${fitNoteId}-size`} aria-label="Common scale" aria-describedby={commonNoteId} checked={commonScale} onChange={() => setCommonScale(true)} />
            Common scale
          </label>
          {commonScale && (
            <span id={commonNoteId} className="mbc-map-gallery-size-note">
              {common ? `Common scale: ${common.setter.name}, ${lengthWords(common.setter)}, fills its card` : 'Common scale: no card has a map to draw'}
            </span>
          )}
        </div>
        <button type="button" className="mbc-zoom-btn" title="Close Map Gallery" aria-label="Close Map Gallery" onClick={onClose}>
          <X size={13} />
        </button>
      </div>
      <div className="mbc-map-gallery-compare">
        <button
          type="button"
          className="mbc-btn"
          aria-label="Compare in split"
          disabled={compareReason !== null}
          title={compareReason ?? undefined}
          onClick={() => { if (chosen.length === 2) onCompare(chosen[0].id, chosen[1].id); }}
        >
          Compare in split
        </button>
        {compareReason && <span className="mbc-map-gallery-compare-note">{compareReason}</span>}
        <span className="mbc-map-gallery-unsaved">Card selections and rotations are not saved.</span>
      </div>
      <ResultWarnings warnings={subsetNote('The gallery shows', shown.length, docs.length, 'records', 'first')} label="Map Gallery cards" />
      <ResultWarnings warnings={subsetNote('The gallery draws maps for', drawnIds.size, withMap, 'records with a map', 'first')} label="Map Gallery maps" />
      {later.length > steps && (
        <button type="button" className="mbc-btn mbc-map-gallery-next" onClick={() => setStepped(steps + GALLERY_DRAW_STEP)}>
          Draw next {GALLERY_DRAW_STEP}
        </button>
      )}
      {docs.length === 0 && <p className="mbc-help-where" role="status">No record is checked in the document table. Check the rows to show their maps here.</p>}
      <div className="mbc-map-gallery-grid">
        {shown.map((doc, i) => {
          const noMap = noMapReasons[i];
          const metrics = computeDocumentTableMetrics(doc);
          return (
            <article key={doc.id} className="mbc-map-gallery-card" aria-label={doc.name}>
              <h3 className="mbc-map-gallery-name">{doc.name}</h3>
              <dl className="mbc-map-gallery-meta">
                <dt>Length</dt>
                <dd className="mbc-map-gallery-length">{getDocumentColumnDisplayValue(doc, metrics, 'length')}</dd>
                <dt>Topology</dt>
                <dd className="mbc-map-gallery-topology">{getDocumentColumnDisplayValue(doc, metrics, 'topology')}</dd>
                <dt>Molecule</dt>
                <dd className="mbc-map-gallery-molecule">{doc.moleculeType}</dd>
                <dt>Accession</dt>
                <dd className="mbc-map-gallery-accession">{doc.accession || '-'}</dd>
                <dt>Folder</dt>
                <dd className="mbc-map-gallery-folder">{folderPath(doc).join(' › ')}</dd>
              </dl>
              {noMap ? (
                <p className="mbc-map-gallery-nomap">{noMap}</p>
              ) : drawnIds.has(doc.id) ? (
                <CardMap
                  doc={doc}
                  props={props}
                  view={viewOf(doc.id)}
                  onView={(patch) => setView(doc.id, patch)}
                  circle={circleOf.get(doc.id) ?? false}
                  scale={scaleOf(doc, circleOf.get(doc.id) ?? false)}
                />
              ) : tooLong(doc) ? (
                <div className="mbc-map-gallery-ask">
                  <p className="mbc-map-gallery-undrawn">
                    {`${lengthWords(doc)} is longer than ${GALLERY_DRAW_ON_OPEN_MAX_BP.toLocaleString('en-US')} ${unitOf(doc)}, so its map is drawn only when asked.`}
                  </p>
                  <button type="button" className="mbc-btn" aria-label={`Draw map of ${doc.name}`} onClick={() => setAsked((a) => new Set(a).add(doc.id))}>
                    Draw map
                  </button>
                </div>
              ) : (
                <p className="mbc-map-gallery-pending">Not drawn yet: Draw next draws the maps in card order.</p>
              )}
              <div className="mbc-map-gallery-actions">
                <label className="mbc-map-gallery-choose">
                  <input
                    type="checkbox"
                    aria-label={`Choose ${doc.name} to compare`}
                    checked={viewOf(doc.id).chosen}
                    onChange={(e) => setView(doc.id, { chosen: e.target.checked })}
                  />
                  Compare
                </label>
                <button type="button" className="mbc-btn" aria-label={`Open ${doc.name} in viewer`} onClick={() => onOpen(doc.id)}>
                  Open in viewer
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
