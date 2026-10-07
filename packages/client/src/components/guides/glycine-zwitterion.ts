/**
 * Every fact the glycine-zwitterion guide prints, and where each one comes
 * from.
 *
 * ── TWO SOURCES, KEPT APART ON PURPOSE ─────────────────────────────────────
 *
 * The EDITOR's facts are chem-core's own queries over the two documents the
 * page draws: the sum formula, both masses, the net charge, and the charge,
 * hydrogen count and lone pairs of the two atoms that change. None is typed
 * into the prose, so the page cannot describe a reading the editor no longer
 * makes.
 *
 * PubChem's facts are the two records' own text, so they are typed — there
 * is nothing to import them from — with the URL and the date they were read.
 * Where the two should agree (the formula, the exact mass, the average mass)
 * the unit test says so.
 *
 * ── WHAT TELLS THE TWO APART IS THE FIDELITY HARNESS'S QUESTION ────────────
 *
 * `diffMolecules` is the comparison the RDKit round trip runs (translate.ts).
 * Neutral glycine and its zwitterion are one of the pairs it is written
 * against: their element counts and net charge are identical, so a check on
 * those two alone passes one as the other. The page prints which of its
 * comparisons differ, from the function itself, never from a SMILES string —
 * RDKit canonicalises both forms to strings that say nothing about whether
 * the comparison saw the difference.
 */

import {
  exactMass,
  implicitHydrogenCount,
  lonePairCount,
  molecularFormula,
  molecularFormulaUnicode,
  molecularWeight,
  netCharge,
  requireAtom,
  requireBond,
} from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";
import { serializeFigure } from "@starter/chem-render";

import { glycineDocument, glycineMolecule } from "@/components/landing/example-document";
import type { GlycineForm } from "@/components/landing/example-document";
import { prepareFigure } from "@/lib/export/figure";
import { diffMolecules } from "@/lib/rdkit/translate";
import type { MoleculeDiff } from "@/lib/rdkit/types";

/** One PubChem compound record, as its page showed it on `fetched`. */
export interface PubChemRecord {
  readonly cid: number;
  /** The record's own title: the page's `<h1>`. */
  readonly title: string;
  readonly url: string;
  readonly molecularFormula: string;
  /** PubChem's "Monoisotopic Mass", in g/mol, as the record prints it. */
  readonly monoisotopicMass: string;
  /** PubChem's "Molecular Weight", in g/mol, as the record prints it. */
  readonly molecularWeight: string;
  readonly inchiKey: string;
}

/**
 * The two PubChem records for glycine, both read on 2026-10-07: each page
 * opened at its URL, and the computed properties read through PUG REST on
 * the same host the same day.
 *
 * CID 750 is titled "Glycine". CID 5257127 is titled "alpha-Glycine", not
 * "glycine zwitterion": that is one of its synonyms, and its record
 * description (from ChEBI) calls it the zwitterion formed by moving a proton
 * from the carboxy group to the amino group. The guide prints both titles as
 * PubChem gives them. Both records list the same InChIKey, which the page
 * reports as a fact about the records.
 */
export const PUBCHEM_GLYCINE = Object.freeze({
  fetched: "2026-10-07",
  neutral: Object.freeze({
    cid: 750,
    title: "Glycine",
    url: "https://pubchem.ncbi.nlm.nih.gov/compound/750",
    molecularFormula: "C2H5NO2",
    monoisotopicMass: "75.032028402",
    molecularWeight: "75.07",
    inchiKey: "DHMQDGOQFOQNFH-UHFFFAOYSA-N",
  } satisfies PubChemRecord),
  zwitterion: Object.freeze({
    cid: 5257127,
    title: "alpha-Glycine",
    url: "https://pubchem.ncbi.nlm.nih.gov/compound/5257127",
    molecularFormula: "C2H5NO2",
    monoisotopicMass: "75.032028402",
    molecularWeight: "75.07",
    inchiKey: "DHMQDGOQFOQNFH-UHFFFAOYSA-N",
  } satisfies PubChemRecord),
  /** The synonym on CID 5257127 that names it as the zwitterion. */
  zwitterionSynonym: "glycine zwitterion",
});

/** What one atom carries in one form: what the skeletal and Lewis panels draw. */
export interface AtomReading {
  readonly charge: number;
  readonly hydrogens: number;
  readonly lonePairs: number;
}

export interface GlycineFigure {
  /** Inline SVG with no XML declaration, for the page to size in CSS cm. */
  readonly svg: string;
  readonly widthCm: number;
}

export interface FormReading {
  readonly form: GlycineForm;
  /** As the status bar shows it: "C₂H₅NO₂". */
  readonly formulaUnicode: string;
  /** Hill order in ASCII, for the comparison with PubChem. */
  readonly formula: string;
  /** Four decimals, as the status bar shows it. */
  readonly exactMass: string;
  /** Two decimals, as PubChem prints it. */
  readonly molecularWeight: string;
  readonly netCharge: number;
  readonly bondOrders: readonly number[];
  readonly nitrogen: AtomReading;
  /** The oxygen with only single bonds: OH in one form, O− in the other. */
  readonly hydroxylOxygen: AtomReading;
  readonly figure: GlycineFigure;
}

function lonePairs(mol: Molecule, id: AtomId): number {
  const count = lonePairCount(mol, id);
  if (count.kind === "unknown") {
    throw new Error(`The glycine guide cannot count the lone pairs on ${id}: ${count.reason}.`);
  }
  return count.pairs;
}

function reading(mol: Molecule, id: AtomId): AtomReading {
  return {
    charge: requireAtom(mol, id).charge,
    hydrogens: implicitHydrogenCount(mol, id),
    lonePairs: lonePairs(mol, id),
  };
}

function bondsOf(mol: Molecule, id: AtomId): number[] {
  return mol.bondIds
    .map((b) => requireBond(mol, b))
    .filter((b) => b.from === id || b.to === id)
    .map((b) => b.order);
}

/** The one atom of `element` whose bonds pass `test`, found by chemistry
 *  rather than by position, so a re-ordered builder cannot point the guide
 *  at the carbonyl. */
function onlyAtom(mol: Molecule, element: string, test: (orders: number[]) => boolean): AtomId {
  const found = mol.atomIds.filter(
    (id) => requireAtom(mol, id).element === element && test(bondsOf(mol, id)),
  );
  if (found.length !== 1 || found[0] === undefined) {
    throw new Error(`The glycine guide expects one such ${element}, and found ${found.length}.`);
  }
  return found[0];
}

export function nitrogenOf(mol: Molecule): AtomId {
  return onlyAtom(mol, "N", () => true);
}

export function hydroxylOxygenOf(mol: Molecule): AtomId {
  return onlyAtom(mol, "O", (orders) => orders.every((o) => o === 1));
}

function figureOf(form: GlycineForm): GlycineFigure {
  const prepared = prepareFigure(glycineDocument(form), {
    width: "single",
    customWidthCm: 12,
    dpi: 600,
    style: "publication",
    pngBackground: "white",
  });
  if (!prepared.ok) {
    // A guide whose figure cannot be exported would be showing a picture the
    // editor does not make. Fail the build instead.
    throw new Error(`The glycine guide's ${form} figure cannot be exported: ${prepared.message}`);
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

export function formReading(form: GlycineForm): FormReading {
  const mol = glycineMolecule(form);
  return {
    form,
    formulaUnicode: molecularFormulaUnicode(mol),
    formula: molecularFormula(mol),
    exactMass: exactMass(mol).toFixed(4),
    molecularWeight: molecularWeight(mol).toFixed(2),
    netCharge: netCharge(mol),
    bondOrders: mol.bondIds.map((id) => requireBond(mol, id).order).sort((a, b) => a - b),
    nitrogen: reading(mol, nitrogenOf(mol)),
    hydroxylOxygen: reading(mol, hydroxylOxygenOf(mol)),
    figure: figureOf(form),
  };
}

/** What the round-trip comparison reports between the two forms. */
export function formsDiff(): readonly MoleculeDiff[] {
  return diffMolecules(glycineMolecule("neutral"), glycineMolecule("zwitterion"));
}

/** A formal charge as a chemist writes it: "0", "+1", "−1". */
export function signed(n: number): string {
  if (n === 0) return "0";
  return n > 0 ? `+${String(n)}` : `−${String(-n)}`;
}

/** A sorted multiset of formal charges, or "none". */
export function chargeList(charges: readonly number[]): string {
  return charges.length === 0 ? "none" : charges.map(signed).join(", ");
}
