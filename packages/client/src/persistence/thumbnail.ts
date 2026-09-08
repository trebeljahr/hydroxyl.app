/**
 * The recents grid's preview, generated at save time with no DOM.
 *
 * `buildDocumentScene` and `serializeScene` are both pure and both already
 * measured (build 0.037 ms on a 300-heavy-atom chain, build + serialize
 * 0.72 ms), so a thumbnail costs less than the IndexedDB write it rides
 * along with, and nothing has to rasterise anything.
 *
 * NO SCALING HAPPENS HERE. The scene arrives in final px with y already
 * flipped and `bounds` already grown by the style's margin — `modelToPx` in
 * chem-render/src/style.ts is the only function in the repo that scales or
 * negates, and a thumbnail is not an exception to that. The card sizes the
 * fragment with CSS instead, which is what `viewBox` is for.
 *
 * SCENE PRIMITIVE IDS DERIVE FROM THE SOURCE ID, so the same molecule
 * serialises to the same bytes every time. That is what makes a golden test on
 * a thumbnail stable, and it is why the store can skip a write when the SVG
 * has not changed.
 *
 * BIG DOCUMENTS GET NO THUMBNAIL. A fused polycyclic of several hundred atoms
 * serialises to hundreds of kilobytes, and storing that per document is how a
 * library exhausts its quota to draw a 160-pixel card. Past the cap the grid
 * falls back to the formula, which is the information the card is really for.
 */

import { serializeScene } from "@starter/chem-render";
import type { SketchDocument } from "@starter/shared";

import { buildDocumentScene } from "@/canvas/scene-bridge";

/** Above this many atoms the preview is not worth its bytes. */
export const THUMBNAIL_ATOM_LIMIT = 120;

/** And a hard ceiling on the markup, for the pathological case that slips
 *  under the atom cap — a hundred atoms all carrying long labels. */
export const THUMBNAIL_MAX_CHARS = 64_000;

/** An inline SVG fragment for `doc`, or null when one is not worth storing. */
export function documentThumbnail(doc: SketchDocument): string | null {
  if (doc.molecule.atomIds.length === 0) return null;
  if (doc.molecule.atomIds.length > THUMBNAIL_ATOM_LIMIT) return null;
  let svg: string;
  try {
    // Not standalone: the fragment is embedded in the card, so an XML
    // declaration in the middle of an HTML document would be a parse error.
    // Not indented: nobody reads it and the whitespace is pure quota.
    svg = serializeScene(buildDocumentScene(doc), { standalone: false, indent: false });
  } catch {
    // A preview is a nicety. A renderer that cannot draw this molecule must
    // never be the reason the molecule does not get saved.
    return null;
  }
  return svg.length > THUMBNAIL_MAX_CHARS ? null : svg;
}
