/**
 * The documents the multi-panel guide draws and opens in the editor: aspirin
 * in four lettered, captioned panels, with the column count set and left
 * empty. `EXAMPLES` in `components/landing/example-document.ts` names them.
 */

import { normalizeBondLength, readMolblock } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import { createDocument, createPanel } from "@starter/shared";
import type { Panel, RepresentationKind, SketchDocument } from "@starter/shared";

/**
 * Aspirin exactly as the insert box draws it: the structure dictionary's
 * molblock, read and scaled the way `dictionaryMolecule` reads it.
 *
 * A COPY, HELD TO THE ORIGINAL BY A TEST. The multi-panel guide tells the
 * reader to type "aspirin" into the insert box, and its figure has to be what
 * that gives them. Importing `@starter/chem-core/dictionary` here would do it
 * with no copy, but `/editor` imports this module through `EXAMPLES`, and
 * the dictionary's ~80 kB is kept out of the editor until the insert box
 * opens. So the one entry is copied, and `multi-panel-figure.test.ts` fails the day the generated
 * dictionary's aspirin stops matching it.
 */
export const ASPIRIN_MOLBLOCK = `aspirin
     RDKit          2D

 13 13  0  0  0  0  0  0  0  0999 V2000
   -2.6640    0.3130    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
   -1.7990   -0.1888    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
   -1.8012   -1.1888    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
   -0.9320    0.3096    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
   -0.0672   -0.1922    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
   -0.0690   -1.1922    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.7960   -1.6940    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.6630   -1.1956    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.6650   -0.1956    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.8000    0.3062    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.8020    1.3060    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
   -0.0630    1.8078    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
    1.6690    1.8042    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0
  2  3  2  0
  2  4  1  0
  4  5  1  0
  5  6  2  0
  6  7  1  0
  7  8  2  0
  8  9  1  0
  9 10  2  0
 10 11  1  0
 11 12  2  0
 11 13  1  0
 10  5  1  0
M  END
`;

export function aspirinMolecule(): Molecule {
  return normalizeBondLength(readMolblock(ASPIRIN_MOLBLOCK).molecule);
}

/**
 * The multi-panel guide's four panels, in order, with the caption the guide
 * tells the reader to type under each.
 *
 * (d) is the sum formula, not the condensed formula, because aspirin has a
 * ring and chem-render refuses a condensed formula for a ring.
 */
export const MULTI_PANEL_VIEWS: readonly {
  readonly kind: RepresentationKind;
  readonly caption: string;
}[] = [
  { kind: "skeletal", caption: "Skeletal formula" },
  { kind: "explicitH", caption: "Explicit hydrogens" },
  { kind: "lewis", caption: "Lewis structure" },
  { kind: "sumFormula", caption: "Sum formula" },
];

/** The column count the multi-panel guide sets: two rows of two. */
export const MULTI_PANEL_COLUMNS = 2;

function multiPanelPanels(suffix: string): Panel[] {
  return MULTI_PANEL_VIEWS.map(({ kind, caption }) => ({
    ...createPanel(kind, caption, "publication"),
    // Fixed for the same reason as the landing's: they reach the SVG's
    // element ids. The suffix keeps the guide's two inline figures apart.
    id: `panel-aspirin-${kind}${suffix}`,
  }));
}

/** Aspirin in four lettered, captioned panels, two to a row: the finished
 *  figure of the multi-panel guide. */
export function multiPanelDocument(): SketchDocument {
  return createDocument({
    id: "doc-multi-panel-example",
    title: "Aspirin",
    molecule: aspirinMolecule(),
    stylePreset: "publication",
    panels: multiPanelPanels(""),
    figure: { columns: MULTI_PANEL_COLUMNS },
    now: "2026-01-01T00:00:00.000Z",
  });
}

/** The same four panels with the column count left empty, so chem-render
 *  picks it: the layout the guide's step 8 changes. */
export function multiPanelAutomaticDocument(): SketchDocument {
  return createDocument({
    id: "doc-multi-panel-example",
    title: "Aspirin",
    molecule: aspirinMolecule(),
    stylePreset: "publication",
    panels: multiPanelPanels("-auto"),
    now: "2026-01-01T00:00:00.000Z",
  });
}
