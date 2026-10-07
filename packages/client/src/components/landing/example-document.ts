/**
 * The sketches a link can open in the editor, starting with the landing
 * page's acetic acid.
 *
 * ── ONE FUNCTION FOR THE FIGURE AND FOR THE EDITOR ─────────────────────────
 *
 * The landing page draws its figure from `exampleDocument()` at build time
 * (see `example-figure.ts`), and "Open this example in the editor" opens the
 * same function's output in the browser (decision 127). One source means the
 * visitor edits exactly what they just saw: a second, hand-kept copy for the
 * editor would drift the first time someone retuned the figure.
 *
 * It is apart from `example-figure.ts` because the editor needs the document
 * and nothing else. That module is the landing's build-time rendering, with a
 * contract of its own — it throws so a bad figure fails the build — that has
 * no business in `/editor`'s import graph.
 *
 * ── WHY ACETIC ACID ────────────────────────────────────────────────────────
 *
 * Every one of the four views can draw it: it is acyclic, so the condensed
 * formula is available (chem-render refuses that view for rings), and its
 * oxygens give the Lewis panel lone pairs to draw. L-alanine was tried first
 * and dropped: at this size the methyl hydrogens of its explicit-H and Lewis
 * panels crowd the alpha carbon's, which is a fair picture of a dense
 * molecule and a poor first picture of the product.
 */

import { add, buildMolecule, DEG, fromPolar, ORIGIN } from "@starter/chem-core";
import type { Molecule, Vec2 } from "@starter/chem-core";
import { VIEW_KIND_TITLES } from "@starter/chem-render";
import { createDocument, createPanel, withFigureLayout } from "@starter/shared";
import type { Panel, RepresentationKind, SketchDocument } from "@starter/shared";

import {
  acetateDocument,
  ammoniaDocument,
  ammoniumDocument,
  fixedDocument,
  mistakeDocument,
} from "@/components/guides/formal-charges-examples";

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

/**
 * The landing example as a document.
 *
 * Its id is FIXED, and that is right for the figure and wrong for the editor.
 * The figure is rendered at build time and must come out byte-identical on
 * every build. The editor must never store it under this id: it is the same
 * string in every visitor's browser, so it names nobody's sketch — the same
 * reason `doc_startup` is not a document identity (decision 85). `/editor`
 * therefore opens a `copyOf` it, under an id minted in the mount effect.
 */
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

/** The `?example=` value the landing figure links with. */
export const LANDING_EXAMPLE = "landing";

/**
 * The same four panels in one row: the journal-figure-size guide's figure
 * that is too wide for a column. The panel ids change too: they reach the
 * SVG's element ids, and two inline figures on one page must not share them.
 */
export function exampleOneRowDocument(): SketchDocument {
  const doc = exampleDocument();
  return withFigureLayout(
    {
      ...doc,
      panels: doc.panels.map((panel) => ({ ...panel, id: `${panel.id}-row` })),
    },
    { columns: EXAMPLE_VIEWS.length },
  );
}

/** Which of glycine's two drawings: the neutral amino acid, or the
 *  zwitterion with NH3+ and CO2−. */
export type GlycineForm = "neutral" | "zwitterion";

/**
 * Glycine, H2N–CH2–COOH, drawn as the glycine-forms guide draws it: the
 * nitrogen on the left, the zig-zag running right, the carbonyl up.
 *
 * The zwitterion is the SAME graph with two formal charges, +1 on the
 * nitrogen and −1 on the hydroxyl oxygen. No hydrogen is moved by hand,
 * because hydrogens are implicit: chem-core reads the charges and gives the
 * nitrogen three and the oxygen none. That one fact is the guide's subject.
 *
 * The atoms go in the order N, Cα, C, O(carbonyl), O(hydroxyl), so the two
 * forms share atom ids and the guide's spec can find each atom by position.
 */
export function glycineMolecule(form: GlycineForm): Molecule {
  const zwitterion = form === "zwitterion";
  return buildMolecule((b) => {
    const nitrogen = b.atom("N", ORIGIN, zwitterion ? { charge: 1 } : {});
    const alphaPos = step(ORIGIN, -30);
    const alpha = b.atom("C", alphaPos);
    const carboxylPos = step(alphaPos, 30);
    const carboxyl = b.atom("C", carboxylPos);
    const carbonyl = b.atom("O", step(carboxylPos, 90));
    const hydroxyl = b.atom("O", step(carboxylPos, -30), zwitterion ? { charge: -1 } : {});
    b.bond(nitrogen, alpha, 1);
    b.bond(alpha, carboxyl, 1);
    b.bond(carboxyl, carbonyl, 2);
    b.bond(carboxyl, hydroxyl, 1);
  });
}

/** The two views the glycine-forms guide shows: the skeletal panel carries
 *  the charges, the Lewis panel the lone pairs that go with them. */
export const GLYCINE_VIEWS: readonly RepresentationKind[] = ["skeletal", "lewis"];

/**
 * One form of glycine as a two-panel document. The ids are fixed, for the
 * same byte-identical-build reason as `exampleDocument`, and they differ by
 * form, because both figures sit inline on one page.
 */
export function glycineDocument(form: GlycineForm): SketchDocument {
  const panels: Panel[] = GLYCINE_VIEWS.map((kind) => ({
    ...createPanel(kind, VIEW_KIND_TITLES[kind], "publication"),
    id: `panel-glycine-${form}-${kind}`,
  }));
  return createDocument({
    id: `doc-guide-glycine-${form}`,
    title: form === "neutral" ? "Glycine" : "Glycine zwitterion",
    molecule: glycineMolecule(form),
    stylePreset: "publication",
    panels,
    figure: { columns: GLYCINE_VIEWS.length },
    now: "2026-01-01T00:00:00.000Z",
  });
}

/**
 * Every name `?example=` accepts: the landing figure, and every figure of
 * every guide, released or not (`components/guides/guides.ts` names them).
 *
 * A guide figure gets its own name even where it draws the same document as
 * the landing. The name belongs to the figure on the page, so retuning the
 * landing example can never change what a guide's link opens without the
 * guide's own figure changing with it.
 */
const EXAMPLES: Readonly<Record<string, () => SketchDocument>> = {
  [LANDING_EXAMPLE]: exampleDocument,
  "journal-figure-size-two-per-row": exampleDocument,
  "journal-figure-size-one-row": exampleOneRowDocument,
  "glycine-forms-neutral": () => glycineDocument("neutral"),
  "glycine-forms-zwitterion": () => glycineDocument("zwitterion"),
  "formal-charges-ammonia": ammoniaDocument,
  "formal-charges-ammonium": ammoniumDocument,
  "formal-charges-mistake": mistakeDocument,
  "formal-charges-fixed": fixedDocument,
  "formal-charges-acetate": acetateDocument,
};

/**
 * The example a `?example=` value names, or null for a name nobody defined.
 *
 * `Object.hasOwn`, not `name in EXAMPLES`: the value comes from a URL, and
 * `?example=toString` must be an unknown example rather than a call into
 * `Object.prototype`.
 */
export function exampleNamed(name: string): SketchDocument | null {
  return Object.hasOwn(EXAMPLES, name) ? EXAMPLES[name]!() : null;
}
