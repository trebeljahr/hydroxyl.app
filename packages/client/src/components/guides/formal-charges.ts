/**
 * Every fact the formal-charges guide prints, and where each one comes from.
 *
 * ── THE ARITHMETIC IS CHEM-CORE'S, THE RULE IS THE TEXTBOOK'S ──────────────
 *
 * The rule is the one general-chemistry courses teach, cited to OpenStax
 * Chemistry 2e, a free textbook a student can open: valence electrons, minus
 * lone-pair electrons, minus one per bond. The numbers in the guide's table
 * are not typed: each row reads chem-core's `outerElectronCount`,
 * `lonePairCount` and `totalValence` for one atom of a real molecule, and the
 * unit test holds every row to the rule. If the Lewis view ever drew a
 * different number of pairs, the table would change with it and the test
 * would say whether the arithmetic still closes.
 *
 * ── THE EDITOR'S WORDS ARE THE EDITOR'S ────────────────────────────────────
 *
 * What the canvas writes beside the nitrogen, what the issue list says and
 * what the fix button reads all come from `chemistryIssues` and `issueFixes`
 * on the mistake itself, so the guide quotes exactly what a reader will see
 * when they open the figure in the editor.
 *
 * Figures go through the export path at build time, as the journal-figure-
 * size guide's do; the guide is a server component.
 */

import {
  chemistryIssues,
  issueFixes,
  lonePairCount,
  molecularFormulaUnicode,
  outerElectronCount,
  requireAtom,
  totalValence,
  updateAtom,
} from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";
import { serializeFigure } from "@starter/chem-render";
import type { SketchDocument } from "@starter/shared";

import { prepareFigure } from "@/lib/export/figure";
import type { FigureExportSettings } from "@/state/types";

import {
  acetate,
  acetateDocument,
  ammonia,
  ammoniaDocument,
  ammonium,
  ammoniumDocument,
  fixedAmmonium,
  fixedDocument,
  mistakeDocument,
  unchargedAmmonium,
} from "./formal-charges-examples";

/** The textbook the rule is cited to, read on 2026-10-07. */
export const OPENSTAX_SOURCE = Object.freeze({
  title: "Chemistry 2e",
  publisher: "OpenStax",
  section: "7.4 Formal Charges and Resonance",
  url: "https://openstax.org/books/chemistry-2e/pages/7-4-formal-charges-and-resonance",
  fetched: "2026-10-07",
});

export interface ChargeRow {
  /** "Nitrogen in ammonia". */
  readonly atom: string;
  readonly valenceElectrons: number;
  readonly lonePairElectrons: number;
  readonly bonds: number;
  /** valence − lone-pair electrons − bonds. */
  readonly counted: number;
  /** The charge the structure carries on that atom. */
  readonly drawn: number;
}

function row(atom: string, mol: Molecule, atomId: AtomId): ChargeRow {
  const valenceElectrons = outerElectronCount(requireAtom(mol, atomId).element);
  if (valenceElectrons === undefined) throw new Error(`${atom}: no valence electron count.`);
  const pairs = lonePairCount(mol, atomId);
  if (pairs.kind === "unknown") throw new Error(`${atom}: lone pairs cannot be counted.`);
  const lonePairElectrons = 2 * pairs.pairs;
  const bonds = totalValence(mol, atomId);
  return {
    atom,
    valenceElectrons,
    lonePairElectrons,
    bonds,
    counted: valenceElectrons - lonePairElectrons - bonds,
    drawn: requireAtom(mol, atomId).charge,
  };
}

/** The first atom of `element` in document order. */
function first(mol: Molecule, element: string): AtomId {
  const id = mol.atomIds.find((atomId) => requireAtom(mol, atomId).element === element);
  if (id === undefined) throw new Error(`No ${element} in the molecule.`);
  return id;
}

/** The oxygen with a charge, and the one without, in acetate. */
function acetateOxygens(mol: Molecule): { readonly carbonyl: AtomId; readonly oxide: AtomId } {
  const oxygens = mol.atomIds.filter((id) => requireAtom(mol, id).element === "O");
  const oxide = oxygens.find((id) => requireAtom(mol, id).charge !== 0);
  const carbonyl = oxygens.find((id) => requireAtom(mol, id).charge === 0);
  if (oxide === undefined || carbonyl === undefined) throw new Error("Acetate lost an oxygen.");
  return { carbonyl, oxide };
}

/** The table's rows: the right answers first, then the mistake. */
export function chargeRows(): readonly ChargeRow[] {
  const nh3 = ammonia();
  const nh4 = ammonium();
  const ac = acetate();
  const { carbonyl, oxide } = acetateOxygens(ac);
  const mistake = unchargedAmmonium();
  return [
    row("Nitrogen in ammonia, NH₃", nh3, first(nh3, "N")),
    row("Nitrogen in ammonium, NH₄⁺", nh4, first(nh4, "N")),
    row("C=O oxygen in acetate", ac, carbonyl),
    row("C–O oxygen in acetate", ac, oxide),
    row("Nitrogen with four bonds and no charge drawn", mistake, first(mistake, "N")),
  ];
}

/** "+1", "0", "−1", with a real minus sign. */
export function signed(charge: number): string {
  if (charge === 0) return "0";
  return charge > 0 ? `+${charge}` : `−${-charge}`;
}

export interface MistakeReport {
  /** "N · atom 1", as the issue list names the atom (`issueAtomName`). */
  readonly atomName: string;
  /** The few words the canvas writes beside the atom. */
  readonly canvasLabel: string;
  /** The issue list's sentence, capitalised as the list shows it. */
  readonly listMessage: string;
  /** The status bar's red counter. */
  readonly counter: string;
  /** Every fix button the list shows, first first. */
  readonly fixTitles: readonly string[];
  /** Issues left once the first fix is applied: zero, or the guide is wrong. */
  readonly issuesAfterFix: number;
  readonly chargeAfterFix: string;
}

export function mistakeReport(): MistakeReport {
  const mistake = unchargedAmmonium();
  const issues = chemistryIssues(mistake);
  const [issue] = issues;
  if (issue === undefined || issues.length !== 1) {
    throw new Error(`The uncharged ammonium should carry one issue, not ${issues.length}.`);
  }
  const fixed = fixedAmmonium();
  const atom = requireAtom(mistake, issue.atomId);
  return {
    atomName: `${atom.element} · atom ${mistake.atomIds.indexOf(issue.atomId) + 1}`,
    canvasLabel: issue.label,
    listMessage: issue.message[0]!.toUpperCase() + issue.message.slice(1),
    counter: "1 chemistry error",
    fixTitles: issueFixes(mistake, issue).map((fix) => fix.title),
    issuesAfterFix: chemistryIssues(fixed).length,
    chargeAfterFix: signed(requireAtom(fixed, first(fixed, "N")).charge),
  };
}

/**
 * What acetate becomes when its minus is left off: the oxygen with one bond
 * takes a hydrogen, and the formula moves from the ion to acetic acid.
 */
export function forgottenMinus(): { readonly ion: string; readonly neutral: string; readonly issues: number } {
  const ac = acetate();
  const neutral = updateAtom(ac, acetateOxygens(ac).oxide, { charge: 0 });
  return {
    ion: molecularFormulaUnicode(ac),
    neutral: molecularFormulaUnicode(neutral),
    issues: chemistryIssues(neutral).length,
  };
}

export interface GuideFigureSvg {
  /** Inline SVG with no XML declaration. */
  readonly svg: string;
  readonly widthCm: number;
}

const SINGLE_COLUMN: FigureExportSettings = {
  width: "single",
  customWidthCm: 12,
  dpi: 600,
  style: "publication",
  pngBackground: "white",
};

function rendered(name: string, doc: SketchDocument): GuideFigureSvg {
  const prepared = prepareFigure(doc, SINGLE_COLUMN);
  if (!prepared.ok) {
    throw new Error(`The formal-charges guide's ${name} figure cannot be exported: ${prepared.message}`);
  }
  return {
    svg: serializeFigure(prepared.value.figure, {
      standalone: false,
      indent: false,
      embedFont: false,
      background: null,
    }),
    widthCm: prepared.value.size.widthCm,
  };
}

export interface GuideFigures {
  readonly ammonia: GuideFigureSvg;
  readonly ammonium: GuideFigureSvg;
  readonly mistake: GuideFigureSvg;
  readonly fixed: GuideFigureSvg;
  readonly acetate: GuideFigureSvg;
}

export function guideFigures(): GuideFigures {
  return {
    ammonia: rendered("ammonia", ammoniaDocument()),
    ammonium: rendered("ammonium", ammoniumDocument()),
    mistake: rendered("mistake", mistakeDocument()),
    fixed: rendered("fixed", fixedDocument()),
    acetate: rendered("acetate", acetateDocument()),
  };
}
