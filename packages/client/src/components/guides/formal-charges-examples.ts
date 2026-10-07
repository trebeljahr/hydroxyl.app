/**
 * The documents the formal-charges guide draws, and opens in the editor.
 *
 * ── A MODULE OF ITS OWN, FOR `/editor`'S SAKE ──────────────────────────────
 *
 * `EXAMPLES` (`components/landing/example-document.ts`) lists these so each
 * figure's "Open this figure in the editor" link opens it (decision 127), and
 * `/editor` imports that list. So this module holds the documents and nothing
 * else — no export path, no figure rendering — the same split the landing
 * keeps between `example-document.ts` and `example-figure.ts`.
 *
 * ── WHY THESE FOUR MOLECULES ───────────────────────────────────────────────
 *
 * Ammonia and ammonium are the textbook pair for both ideas at once: the lone
 * pair ammonia draws becomes ammonium's fourth N–H bond, and the charge is
 * what that costs. The mistake is ammonium drawn the way a newcomer draws it,
 * four H atoms on a nitrogen and no charge. Its repaired form is not written
 * here by hand: it is chem-core's own one-click fix applied to the mistake,
 * so the figure the guide shows after "click the fix" is what the click does.
 * Acetate puts the charge on an oxygen, where the editor cannot catch a
 * forgotten minus, which is the point the guide makes with it.
 *
 * Ammonia and ammonium keep their hydrogens implicit: the skeletal panel then
 * writes NH₃ and NH₄⁺, which is how they are written in a paper. The mistake
 * draws its hydrogens as atoms, because four drawn bonds are the mistake. They
 * sit at the diagonals so the + of the repaired form has a gap to sit in.
 *
 * Every id is fixed, as the landing's is: the figure is rendered at build time
 * and must come out byte-identical on every build, and panel ids reach the
 * SVG's element ids, so no two figures on the page may share one.
 */

import {
  add,
  applyIssueFix,
  buildMolecule,
  chemistryIssues,
  DEG,
  fromPolar,
  issueFixes,
  ORIGIN,
} from "@starter/chem-core";
import type { Molecule, Vec2 } from "@starter/chem-core";
import { VIEW_KIND_TITLES } from "@starter/chem-render";
import { createDocument, createPanel } from "@starter/shared";
import type { Panel, RepresentationKind, SketchDocument } from "@starter/shared";

function step(from: Vec2, degrees: number): Vec2 {
  return add(from, fromPolar(degrees * DEG, 1));
}

export function ammonia(): Molecule {
  return buildMolecule((b) => {
    b.atom("N", ORIGIN);
  });
}

export function ammonium(): Molecule {
  return buildMolecule((b) => {
    b.atom("N", ORIGIN, { charge: 1 });
  });
}

/** Ammonium drawn without its charge: four bonds on a neutral nitrogen. */
export function unchargedAmmonium(): Molecule {
  return buildMolecule((b) => {
    const n = b.atom("N", ORIGIN);
    for (const degrees of [45, 135, 225, 315]) {
      b.bond(n, b.atom("H", step(ORIGIN, degrees)), 1);
    }
  });
}

/**
 * The mistake after the first fix the editor offers for it.
 *
 * Throws if chem-core stops flagging the mistake or stops offering a fix, so
 * a guide that says "click the fix" fails the build instead of describing a
 * button that is no longer there.
 */
export function fixedAmmonium(): Molecule {
  const mistake = unchargedAmmonium();
  const [issue] = chemistryIssues(mistake);
  if (issue === undefined) throw new Error("The uncharged ammonium no longer has an issue.");
  const [fix] = issueFixes(mistake, issue);
  if (fix === undefined) throw new Error("The uncharged ammonium's issue no longer has a fix.");
  return applyIssueFix(mistake, fix);
}

/** Acetate, CH3COO⁻, laid out as the landing's acetic acid is. */
export function acetate(): Molecule {
  return buildMolecule((b) => {
    const methyl = b.atom("C", ORIGIN);
    const carboxylPos = step(ORIGIN, 30);
    const carboxyl = b.atom("C", carboxylPos);
    const carbonyl = b.atom("O", step(carboxylPos, 90));
    const oxide = b.atom("O", step(carboxylPos, -30), { charge: -1 });
    b.bond(methyl, carboxyl, 1);
    b.bond(carboxyl, carbonyl, 2);
    b.bond(carboxyl, oxide, 1);
  });
}

function guideDocument(
  key: string,
  title: string,
  molecule: Molecule,
  views: readonly RepresentationKind[],
): SketchDocument {
  const panels: Panel[] = views.map((kind) => ({
    ...createPanel(kind, VIEW_KIND_TITLES[kind], "publication"),
    id: `panel-formal-charges-${key}-${kind}`,
  }));
  return createDocument({
    id: `doc-formal-charges-${key}`,
    title,
    molecule,
    stylePreset: "publication",
    panels,
    figure: { columns: views.length },
    now: "2026-01-01T00:00:00.000Z",
  });
}

/**
 * Every figure has both panels, the mistake included. A one-panel figure
 * still gets an "(a)" from chem-render, and a lone letter reads as a figure
 * with something missing.
 */
const BOTH: readonly RepresentationKind[] = ["skeletal", "lewis"];

export function ammoniaDocument(): SketchDocument {
  return guideDocument("ammonia", "Ammonia", ammonia(), BOTH);
}

export function ammoniumDocument(): SketchDocument {
  return guideDocument("ammonium", "Ammonium", ammonium(), BOTH);
}

export function mistakeDocument(): SketchDocument {
  return guideDocument("mistake", "Ammonium without its charge", unchargedAmmonium(), BOTH);
}

export function fixedDocument(): SketchDocument {
  return guideDocument("fixed", "Ammonium", fixedAmmonium(), BOTH);
}

export function acetateDocument(): SketchDocument {
  return guideDocument("acetate", "Acetate", acetate(), BOTH);
}
