/**
 * The figure the landing page shows, produced by the export path itself.
 *
 * ── NOT A SCREENSHOT, AND NOT A MOCKUP ─────────────────────────────────────
 *
 * The page claims that one drawing yields several views and that the export
 * reports its printed size. A picture saved once would keep making that claim
 * after the renderer changed. So this module builds a real document and runs
 * it through `prepareFigure`, the function behind the SVG download, the PNG
 * and Copy figure. The numbers printed under the figure come out of the same
 * `PreparedFigure`, so they are what the export dialog reports for this
 * document at a single column.
 *
 * It runs at BUILD time. Both pages that show it are server components, so
 * the markup is in the prerendered HTML and no visitor's browser composes it.
 *
 * ── WHY ACETIC ACID ────────────────────────────────────────────────────────
 *
 * Every one of the four views can draw it: it is acyclic, so the condensed
 * formula is available (chem-render refuses that view for rings), and its
 * oxygens give the Lewis panel lone pairs to draw. L-alanine was tried first
 * and dropped: at this size the methyl hydrogens of its explicit-H and Lewis
 * panels crowd the alpha carbon's, which is a fair picture of a dense
 * molecule and a poor first picture of the product.
 *
 * ── THE FONT IS NOT EMBEDDED HERE ──────────────────────────────────────────
 *
 * The downloaded file embeds Arimo so it looks the same in any viewer. Inline
 * in a page, the ~30 KB of base64 would ride along with every visit, and the
 * `font-family` fallback (Arimo, then Arial, which Arimo is metric-compatible
 * with) sets the same glyph widths. Everything else is the file's own output.
 */

import { add, buildMolecule, DEG, fromPolar, ORIGIN } from "@starter/chem-core";
import type { Molecule, Vec2 } from "@starter/chem-core";
import { PRINTED_BOND_LENGTH_CM, serializeFigure, VIEW_KIND_TITLES } from "@starter/chem-render";
import { createDocument, createPanel } from "@starter/shared";
import type { Panel, RepresentationKind, SketchDocument } from "@starter/shared";

import { formatPt, prepareFigure } from "@/lib/export/figure";

/** The views the example lays side by side, in panel order. */
export const EXAMPLE_VIEWS: readonly RepresentationKind[] = [
  "skeletal",
  "explicitH",
  "lewis",
  "condensed",
];

function step(from: Vec2, degrees: number): Vec2 {
  return add(from, fromPolar(degrees * DEG, 1));
}

/** Acetic acid, CH3COOH: the methyl on the left, the carbonyl up, the
 *  hydroxyl continuing the zig-zag to the right. */
export function exampleMolecule(): Molecule {
  return buildMolecule((b) => {
    const methyl = b.atom("C", ORIGIN);
    const carboxylPos = step(ORIGIN, 30);
    const carboxyl = b.atom("C", carboxylPos);
    const carbonyl = b.atom("O", step(carboxylPos, 90));
    const hydroxyl = b.atom("O", step(carboxylPos, -30));
    b.bond(methyl, carboxyl, 1);
    b.bond(carboxyl, carbonyl, 2);
    b.bond(carboxyl, hydroxyl, 1);
  });
}

export function exampleDocument(): SketchDocument {
  const panels: Panel[] = EXAMPLE_VIEWS.map((kind) => ({
    ...createPanel(kind, VIEW_KIND_TITLES[kind], "publication"),
    // Fixed rather than generated: the panel id reaches the SVG's element ids,
    // and a stable one keeps two builds of the page byte-identical.
    id: `panel-example-${kind}`,
  }));
  return createDocument({
    id: "doc-landing-example",
    title: "Acetic acid",
    molecule: exampleMolecule(),
    stylePreset: "publication",
    panels,
    figure: { columns: 2 },
    now: "2026-01-01T00:00:00.000Z",
  });
}

export interface ExampleFigure {
  /** Inline SVG markup with no XML declaration. Its px `width`/`height` are
   *  the scene's own; the page's CSS sizes it to the column instead. */
  readonly svg: string;
  /** "6.1 × 6.4 cm". */
  readonly printedSize: string;
  /** "10.0 pt". */
  readonly labelSize: string;
  /** The Publication style's own bond and label size, before any scaling:
   *  "5.08 mm", "10.0 pt". */
  readonly styleBondLength: string;
  readonly styleLabelSize: string;
  readonly panelCount: number;
}

function cm(value: number): string {
  return value.toFixed(1);
}

/**
 * Throws if the export path refuses the example. That is deliberate: a landing
 * page whose showcase figure cannot be exported would be making a false claim,
 * so the build fails instead of shipping it.
 */
export function exampleFigure(): ExampleFigure {
  const prepared = prepareFigure(exampleDocument(), {
    width: "single",
    customWidthCm: 12,
    dpi: 600,
    style: "publication",
  });
  if (!prepared.ok) {
    throw new Error(`The landing page example cannot be exported: ${prepared.message}`);
  }
  const { figure, size } = prepared.value;
  const svg = serializeFigure(figure, {
    standalone: false,
    indent: false,
    embedFont: false,
    background: null,
  });
  return {
    svg,
    printedSize: `${cm(size.widthCm)} × ${cm(size.heightCm)} cm`,
    labelSize: `${formatPt(size.fontSizePt)} pt`,
    styleBondLength: `${(PRINTED_BOND_LENGTH_CM * 10).toFixed(2)} mm`,
    styleLabelSize: `${formatPt(size.naturalFontSizePt)} pt`,
    panelCount: figure.cells.length,
  };
}
