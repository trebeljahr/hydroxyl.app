/**
 * Document -> scene. The seam where the persisted format meets the renderer.
 *
 * THE DISAGREEMENT THIS FILE USED TO RESOLVE IS GONE (decision 10).
 * `@starter/shared` no longer declares its own display-flag set; it imports
 * chem-render's, so `RepresentationDisplay` IS `DisplayFlags` and the
 * translation below is a pass-through rather than a lossy projection. What
 * remains is the SHAPE difference, and it is a real one worth keeping:
 *
 *     shared      { kind: ViewKind; display: DisplayFlags }
 *                 — one struct, flags stored for EVERY panel whatever its
 *                   kind, so flipping a panel between skeletal and sumFormula
 *                   and back does not lose the chemist's settings.
 *
 *     chem-render { kind: StructuralViewKind; flags: DisplayFlags }
 *                 | { kind: TextViewKind }
 *                 — a discriminated union, so "lone pairs on a sum formula"
 *                   is unrepresentable at the point of drawing.
 *
 * Both are right for their job, and converting one to the other is this
 * function. The two `Representation` types are still imported under explicit
 * aliases: they remain different types, and with one of them auto-imported
 * the mistake compiles anywhere the fields happen not to be touched.
 */

import {
  RENDER_STYLES,
  buildAnnotatedScene,
  buildScene,
  isStructuralViewKind,
  representation,
  representationAvailability,
} from "@starter/chem-render";
import type {
  AnnotatedScene,
  RenderScene,
  RenderStyle,
  RenderStyleName,
  Representation as RenderRepresentation,
  ViewKind,
} from "@starter/chem-render";
import type {
  Panel,
  PanelId,
  Representation as DocumentRepresentation,
  RepresentationKind,
  SketchDocument,
  StylePresetId,
} from "@starter/shared";

/**
 * Compile-time guards for the two unions the packages declare INDEPENDENTLY
 * and currently keep in agreement by hand.
 *
 * `StylePresetId` (shared) and `RenderStyleName` (chem-render) are both
 * "publication" | "screen"; `RepresentationKind` (shared) and `ViewKind`
 * (chem-render) are both the same six view names. Neither package imports the
 * other's, and both are right not to — a file format that could not name a
 * style the current renderer has not got is a worse format.
 *
 * But the agreement is what makes `RENDER_STYLES[doc.stylePreset]` and the
 * `kind` pass-through below total. Adding a preset or a view kind on one side
 * alone would otherwise surface as an `undefined` style handed to `buildScene`
 * — a blank canvas with no error anywhere near the cause. Mutual assignability
 * is cheap insurance, in the style of `ASSEMBLERS_ARE_COMPLETE` in
 * shared/src/document.ts: a divergence fails to compile, here, with both names
 * in the message.
 */
type StylePresetsMatchRenderStyles = StylePresetId extends RenderStyleName
  ? RenderStyleName extends StylePresetId
    ? true
    : never
  : never;
const STYLE_PRESETS_MATCH_RENDER_STYLES: StylePresetsMatchRenderStyles = true;
void STYLE_PRESETS_MATCH_RENDER_STYLES;

type DocumentKindsMatchViewKinds = RepresentationKind extends ViewKind
  ? ViewKind extends RepresentationKind
    ? true
    : never
  : never;
const DOCUMENT_KINDS_MATCH_VIEW_KINDS: DocumentKindsMatchViewKinds = true;
void DOCUMENT_KINDS_MATCH_VIEW_KINDS;

/**
 * The render style a document's preset selects — for the canvas, and for an
 * export whose style choice is "As shown on the canvas" (decision 50; exports
 * default to Publication). One function, so the two cannot resolve a preset
 * differently.
 */
export function renderStyleFor(doc: SketchDocument): RenderStyle {
  return RENDER_STYLES[doc.stylePreset];
}

/** Every preset, in the order the UI offers them. */
export const STYLE_PRESETS: readonly StylePresetId[] = Object.freeze(["screen", "publication"]);

/** How the top bar, the palette and the export dialog name a preset. */
export const STYLE_PRESET_TITLES: Readonly<Record<StylePresetId, string>> = Object.freeze({
  screen: "Screen",
  publication: "Publication",
});

/**
 * A panel's stored representation as the renderer wants it.
 *
 * Text kinds take `representation(kind)` with no flags at all — passing flags
 * to a text kind is a compile error over in chem-render, deliberately, and
 * routing around that with a cast would put back exactly the dead state the
 * discriminated union removes.
 */
export function toRenderRepresentation(
  panelRepresentation: DocumentRepresentation,
): RenderRepresentation {
  const { kind, display } = panelRepresentation;
  if (!isStructuralViewKind(kind)) return representation(kind);
  // A total pass-through since decision 10 — `display` is chem-render's own
  // `DisplayFlags`. Enumerating the fields here again would be the drift the
  // unification removed, and the first flag added would be dropped silently.
  return representation(kind, display);
}

/**
 * The panel to draw: the named one, else the first structural one, else the
 * first one at all, else nothing.
 *
 * A `panelId` that names no panel is NOT an error. A panel id reaches the
 * canvas from React state that an undo, a panel removal or a document swap can
 * invalidate a frame before the canvas re-renders — an ordinary UI race, not a
 * corrupt document. Falling back is the same call `buildScene` makes when a
 * bond's endpoint atom has gone missing mid-edit: draw what is there rather
 * than blanking the canvas over a stale reference.
 *
 * Preferring a STRUCTURAL panel when none is named matters because
 * `DEFAULT_PANELS` opens skeletal first and sum-formula second, and the
 * editor canvas is for drawing structures — defaulting to the text panel would
 * put "C6H6" where the molecule should be, with nothing to click.
 */
export function panelToDraw(doc: SketchDocument, panelId?: PanelId): Panel | undefined {
  if (panelId !== undefined) {
    const named = doc.panels.find((panel) => panel.id === panelId);
    if (named !== undefined) return named;
  }
  return (
    doc.panels.find((panel) =>
      isStructuralViewKind(panel.representation.kind),
    ) ?? doc.panels[0]
  );
}

/**
 * The scene for `doc`, drawn through the given panel's representation.
 *
 * Everything that comes back is in FINAL PX WITH Y ALREADY FLIPPED — see the
 * header of @starter/chem-render. The editor viewport pans and zooms within
 * that space and must never re-scale by a bond length or flip again.
 */
export function buildDocumentScene(
  doc: SketchDocument,
  panelId?: PanelId,
): RenderScene {
  const panel = panelToDraw(doc, panelId);
  // A document with no panels at all is legal — `sketchDocumentSchema` permits
  // an empty array — and still has a molecule worth drawing.
  const rep =
    panel === undefined
      ? representation("skeletal")
      : toRenderRepresentation(panel.representation);
  return buildScene(doc.molecule, renderStyleFor(doc), rep);
}

/**
 * The panel the EDITOR CANVAS draws, given the switcher's active panel.
 *
 * The active panel wins only when the canvas can honestly edit through it: a
 * STRUCTURAL view whose availability holds (or whose only complaint is that
 * nothing has been drawn yet — an empty canvas is where drawing starts).
 * Otherwise the canvas keeps the default structural panel, and the switcher
 * says why:
 *
 *   - a text view has no atoms to click, and the drawing tools would sprout
 *     atoms onto a canvas that only shows "C6H6";
 *   - an unavailable view either throws (an unknown element) or draws a
 *     picture its own availability check calls wrong.
 *
 * The view flag commands and Fit act on THIS panel, so a toggle always edits
 * the panel that is on screen rather than a different one.
 */
export function canvasPanelFor(
  doc: SketchDocument,
  activePanelId: PanelId | null,
): Panel | undefined {
  if (activePanelId !== null) {
    const active = doc.panels.find((panel) => panel.id === activePanelId);
    if (active !== undefined && canvasCanDraw(doc, active)) return active;
  }
  return panelToDraw(doc);
}

/** Why the canvas is not showing `panel`, or null when it can. */
export function canvasRefusal(doc: SketchDocument, panel: Panel): string | null {
  const { kind } = panel.representation;
  if (!isStructuralViewKind(kind)) {
    return "A text view has no atoms to edit, so the canvas keeps the structure. The figure export shows this panel.";
  }
  const availability = representationAvailability(doc.molecule, kind);
  if (availability.available || availability.reason === "empty-molecule") return null;
  return availability.message;
}

function canvasCanDraw(doc: SketchDocument, panel: Panel): boolean {
  return canvasRefusal(doc, panel) === null;
}

/**
 * The canvas's scene and its annotation report, memoised on the document.
 *
 * ONE BUILD FOR BOTH READERS (decision 62). The canvas draws `scene`; the
 * status bar says which annotations `annotations.unplaced` could not place.
 * Both call this, so the report is the drawing's own and the annotation pass
 * runs once per document change, not once per consumer per render. Keyed on
 * the `SketchDocument` object for the same reason `EditorCanvas`'s memo is:
 * the store hands out a new one only when the saved document changed. A
 * `WeakMap`, like `@/editor/derived`, so undo/redo between two documents
 * keeps hitting, and an entry dies with its document.
 */
const canvasSceneCache = new WeakMap<SketchDocument, Map<PanelId | null, AnnotatedScene>>();

export function canvasAnnotatedScene(
  doc: SketchDocument,
  activePanelId: PanelId | null,
): AnnotatedScene {
  let byPanel = canvasSceneCache.get(doc);
  if (byPanel === undefined) {
    byPanel = new Map();
    canvasSceneCache.set(doc, byPanel);
  }
  const cached = byPanel.get(activePanelId);
  if (cached !== undefined) return cached;
  const panel = panelToDraw(doc, canvasPanelFor(doc, activePanelId)?.id);
  const rep =
    panel === undefined ? representation("skeletal") : toRenderRepresentation(panel.representation);
  const built = buildAnnotatedScene(doc.molecule, renderStyleFor(doc), rep);
  byPanel.set(activePanelId, built);
  return built;
}

/**
 * Testing hook: how many scenes are cached FOR ONE DOCUMENT, in the habit of
 * chem-core's `ringComputations`.
 *
 * A `WeakMap` cannot be counted from outside, and "this cache is bounded" is
 * the claim the file makes about a long editing session. The crash in manual
 * notes 3 is a retention report, and a cache that grew per EDIT rather than
 * per panel would have exactly its shape, so the claim is worth a test rather
 * than a comment. `src/state/editing-session.test.ts` is that test; nothing
 * else should reach for this.
 */
export function canvasSceneCacheSize(doc: SketchDocument): number {
  return canvasSceneCache.get(doc)?.size ?? 0;
}

/** The scene the editor canvas shows. */
export function buildCanvasScene(
  doc: SketchDocument,
  activePanelId: PanelId | null,
): RenderScene {
  return canvasAnnotatedScene(doc, activePanelId).scene;
}
