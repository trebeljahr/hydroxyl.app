/**
 * Document -> scene. The seam where the persisted format meets the renderer.
 *
 * THE CONTRACT DISAGREEMENT THIS FILE EXISTS TO RESOLVE:
 *
 *   @starter/shared and @starter/chem-render BOTH export a type called
 *   `Representation`, and they are NOT the same type.
 *
 *     shared      { kind: RepresentationKind; display: RepresentationDisplay }
 *                 display = showCarbonLabels, aromaticCircles, showLonePairs,
 *                           showStereoDescriptors
 *
 *     chem-render { kind: StructuralViewKind; flags: DisplayFlags }
 *                 | { kind: TextViewKind }
 *                 flags   = showCarbonLabels, showImplicitHydrogens,
 *                           showLonePairs, showCharges, showStereoBonds,
 *                           showAtomIndices
 *
 * That is not an oversight to be tidied away by making one import the other.
 * The document's version is the PERSISTED TRUTH: it is what a saved file
 * carries, it stores flags for every panel regardless of kind so flipping a
 * panel between skeletal and sumFormula does not lose the chemist's settings,
 * and its shape is frozen by `SCHEMA_VERSION`. The renderer's version is the
 * DRAWING VOCABULARY: a discriminated union that makes "lone pairs on a sum
 * formula" unrepresentable, and free to grow a flag the moment a new pass can
 * honour it — without that being a file-format change. Translating between
 * them is a real, lossy step, and this is where it happens once.
 *
 * `showCarbonLabels`, `aromaticCircles` and `showLonePairs` exist on both
 * sides and are mapped; everything else in `DisplayFlags` comes from
 * chem-render's per-kind defaults via the `representation(kind, partialFlags)`
 * factory, which layers over `DEFAULT_FLAGS_BY_KIND`.
 *
 * `aromaticCircles` was dropped here until `chem-render-bond-geometry` gave
 * the renderer a circle to draw. It is mapped now, and it cost exactly the one
 * line this header predicted.
 *
 * DROPPED, deliberately, because chem-render still has no counterpart:
 *
 *   - `showStereoDescriptors` — the R/S and E/Z letters set beside a centre.
 *     `DisplayFlags.showStereoBonds` is a different thing entirely: wedges are
 *     geometry, descriptors are computed annotations. It belongs to
 *     `stereochemistry-perception-and-marks`, at which point it becomes one
 *     more line below and nothing else moves. Until then, setting it in the
 *     document is silently a no-op on screen, which is a truthful "not
 *     implemented yet" rather than a wrong picture.
 *
 * The two `Representation` types are imported under explicit aliases below.
 * A bare import of both is a collision waiting for whoever edits this file
 * next: with one of them auto-imported, the mistake compiles anywhere the
 * fields happen not to be touched.
 */

import {
  RENDER_STYLES,
  buildScene,
  isStructuralViewKind,
  representation,
} from "@starter/chem-render";
import type {
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

/** The render style a document's preset selects. */
export function renderStyleFor(doc: SketchDocument): RenderStyle {
  return RENDER_STYLES[doc.stylePreset];
}

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
  return representation(kind, {
    showCarbonLabels: display.showCarbonLabels,
    showLonePairs: display.showLonePairs,
    aromaticCircles: display.aromaticCircles,
  });
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
function panelToDraw(doc: SketchDocument, panelId?: PanelId): Panel | undefined {
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
