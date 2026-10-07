/**
 * Every number the skeletal-formula guide prints, and where each one comes
 * from.
 *
 * ── CHEM-CORE COUNTS, THE SOURCES ARE CITED ────────────────────────────────
 *
 * The carbons, the bonds drawn to each, its hydrogens and the formula are
 * chem-core's own answers for the molecule the figure draws, so the table
 * cannot disagree with the panel beside it. The drawing rules are IUPAC's
 * 2008 graphical representation standards, cited by section; the formula is
 * checked against PubChem's record in the unit test, so a dictionary change
 * that altered the molecule would fail there rather than print a wrong count.
 *
 * ── THE FIGURE IS THE EXPORT PATH'S OWN OUTPUT ─────────────────────────────
 *
 * `prepareFigure` at a single column, Publication style, as the journal guide
 * does it. It runs at build time; the guide is a server component.
 */

import {
  bondsAt,
  chemistryIssues,
  explicitValence,
  implicitHydrogenCount,
  molecularFormula,
  molecularFormulaUnicode,
  atomNumbering,
} from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";
import { serializeFigure } from "@starter/chem-render";

import { prepareFigure } from "@/lib/export/figure";
import type { FigureExportSettings } from "@/state/types";

import {
  carboxylCarbon,
  fiveBondCarbonMolecule,
  skeletalFormulaDocument,
} from "./skeletal-formula-examples";

/**
 * IUPAC's graphical representation standards, in G. P. Moss's web version,
 * which states that its recommendations are identical to the published text.
 * Read on 2026-10-07. Each section anchor is the page's own.
 */
export const IUPAC_DRAWING = Object.freeze({
  title: "Graphical Representation Standards for Chemical Structure Diagrams (IUPAC Recommendations 2008)",
  citation: "J. Brecher, Pure Appl. Chem. 2008, 80, 277–410",
  url: "https://iupac.qmul.ac.uk/drawing/drawing.html",
  doi: "https://doi.org/10.1351/pac200880020277",
  fetched: "2026-10-07",
  /** GR-1.4, "Terminal single bonds". The one sentence quoted verbatim. */
  quote: "terminal single bonds are assumed to represent methyl groups",
  sections: {
    /** Terminal single bonds: an unlabelled line end is a methyl carbon. */
    lineEnds: { id: "GR-1.4", anchor: "#GR14" },
    /** Hydrogen atoms: a labelled atom has only the H written beside it;
     *  an unlabelled atom is a carbon with H enough for a valence of four. */
    hydrogens: { id: "GR-2.1.1", anchor: "#GR211" },
    /** Labeling of carbon atoms: a carbon bonded to two or more atoms is left
     *  unlabelled, implied by the bend in the bonds. */
    carbons: { id: "GR-2.1.2", anchor: "#GR212" },
  },
});

/** PubChem's record for L-isoleucine, read on 2026-10-07. Its InChIKey is the
 *  one the dictionary entry carries. */
export const PUBCHEM_ISOLEUCINE = Object.freeze({
  cid: 6306,
  url: "https://pubchem.ncbi.nlm.nih.gov/compound/6306",
  title: "L-Isoleucine",
  formula: "C6H13NO2",
  inchiKey: "AGPKZVBTJJNPAG-WHFBIAKZSA-N",
  fetched: "2026-10-07",
});

export interface CarbonRow {
  readonly atomId: AtomId;
  /** "C1" … "C5", or "the methyl on C3" for the carbon the editor leaves
   *  unnumbered. */
  readonly name: string;
  /** Bond orders summed: a double bond counts two. */
  readonly bondsDrawn: number;
  readonly hydrogens: number;
  /** One bond to another atom: a line end in the skeletal panel. */
  readonly lineEnd: boolean;
  readonly hasDoubleBond: boolean;
}

export interface SkeletalFigure {
  readonly svg: string;
  readonly widthCm: number;
}

export interface SkeletalFormulaNumbers {
  readonly figure: SkeletalFigure;
  readonly carbons: readonly CarbonRow[];
  readonly carbonCount: number;
  readonly lineEndCount: number;
  readonly hydrogensOnCarbon: number;
  readonly hydrogensOnNitrogen: number;
  readonly hydrogensOnOxygen: number;
  readonly hydrogenCount: number;
  /** "C6H13NO2", for comparing with PubChem. */
  readonly formula: string;
  /** "C₆H₁₃NO₂", as the editor prints it. */
  readonly formulaUnicode: string;
  /** chem-core's label for the over-valent C1: "C has 5 bonds; max 4". */
  readonly fiveBondLabel: string;
}

const SINGLE_COLUMN: FigureExportSettings = {
  width: "single",
  customWidthCm: 12,
  dpi: 600,
  style: "publication",
  pngBackground: "white",
};

function figure(): SkeletalFigure {
  const prepared = prepareFigure(skeletalFormulaDocument(), SINGLE_COLUMN);
  if (!prepared.ok) {
    throw new Error(`The skeletal-formula guide's figure cannot be exported: ${prepared.message}`);
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

function hydrogensOn(mol: Molecule, element: string): number {
  return mol.atomIds
    .filter((id) => mol.atoms[id]!.element === element)
    .reduce((sum, id) => sum + implicitHydrogenCount(mol, id), 0);
}

/** The carbons in the order the table lists them: C1 upward, then any the
 *  editor leaves unnumbered, each named after the carbon it hangs from. */
function carbonRows(mol: Molecule): CarbonRow[] {
  const { locants } = atomNumbering(mol);
  const locantOf = (id: AtomId): string | undefined =>
    Object.hasOwn(locants, id) ? locants[id] : undefined;
  const rows = mol.atomIds
    .filter((id) => mol.atoms[id]!.element === "C")
    .map((id): CarbonRow & { readonly order: number } => {
      const bonds = bondsAt(mol, id);
      const neighbours = bonds.map((b) => (b.from === id ? b.to : b.from));
      const locant = locantOf(id);
      let name: string;
      if (locant !== undefined) {
        name = `C${locant}`;
      } else {
        const host = neighbours.map(locantOf).find((l) => l !== undefined);
        if (host === undefined) throw new Error(`Carbon ${id} has no numbered neighbour to be named after.`);
        name = `the methyl on C${host}`;
      }
      return {
        atomId: id,
        name,
        bondsDrawn: explicitValence(mol, id),
        hydrogens: implicitHydrogenCount(mol, id),
        lineEnd: neighbours.length === 1,
        hasDoubleBond: bonds.some((b) => b.order === 2),
        order: locant === undefined ? Number.POSITIVE_INFINITY : Number(locant),
      };
    });
  return rows.sort((a, b) => a.order - b.order).map(({ order: _order, ...row }) => row);
}

export function skeletalFormulaNumbers(): SkeletalFormulaNumbers {
  const mol = skeletalFormulaDocument().molecule;
  const carbons = carbonRows(mol);

  const fiveBonds = fiveBondCarbonMolecule();
  const c1 = carboxylCarbon(fiveBonds);
  const issue = chemistryIssues(fiveBonds).find((i) => i.kind === "over-valent" && i.atomId === c1);
  if (issue === undefined) throw new Error("chem-core no longer flags a carbon with five bonds.");

  return {
    figure: figure(),
    carbons,
    carbonCount: carbons.length,
    lineEndCount: carbons.filter((c) => c.lineEnd).length,
    hydrogensOnCarbon: carbons.reduce((sum, c) => sum + c.hydrogens, 0),
    hydrogensOnNitrogen: hydrogensOn(mol, "N"),
    hydrogensOnOxygen: hydrogensOn(mol, "O"),
    hydrogenCount: mol.atomIds.reduce((sum, id) => sum + implicitHydrogenCount(mol, id), 0),
    formula: molecularFormula(mol),
    formulaUnicode: molecularFormulaUnicode(mol),
    fiveBondLabel: issue.label,
  };
}
