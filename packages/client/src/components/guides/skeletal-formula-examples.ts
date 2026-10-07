/**
 * The documents the skeletal-formula guide draws and opens in the editor
 * (decision 247): L-isoleucine in a skeletal and an explicit-H panel, and the
 * same molecule with a fifth bond drawn to C1.
 *
 * ── WHY L-ISOLEUCINE ───────────────────────────────────────────────────────
 *
 * The guide teaches the hydrogen count from the bonds drawn, so its molecule
 * needs a carbon of every kind: CH3 (C5 and the methyl on C3), CH2 (C4), CH
 * (C3 and C2) and a carbon with no hydrogen at all (C1). It is an amino acid,
 * for a reader new to biochemistry, and it is in the insert box. L-leucine
 * has the same four kinds and was tried first: its two methyls fan their
 * hydrogens into C3's and C4's in the explicit-H panel, so a reader cannot
 * tell which H belongs to which carbon. L-valine draws cleanly but has no CH2.
 *
 * ── THE MOLBLOCK IS A COPY, AND A TEST HOLDS IT TO THE DICTIONARY ─────────
 *
 * `/editor` imports this module through `EXAMPLES`, and the dictionary is
 * ~80 kB that the editor loads only when the insert box opens. So the one
 * entry is copied here, byte for byte, and `skeletal-formula.test.ts` fails
 * the day the generated entry stops matching. The reader who types
 * "isoleucine" into the insert box gets exactly this drawing.
 *
 * Ids are FIXED for the reason `exampleDocument` gives: the panel id reaches
 * the SVG's element ids, and the guide's figure must be byte-identical on
 * every build. The editor opens a `copyOf` under a fresh id.
 */

import {
  addAtom,
  addBond,
  add,
  atomNumbering,
  bondDirections,
  fromPolar,
  largestGapBisector,
  normalizeBondLength,
  readMolblock,
} from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";
import { VIEW_KIND_TITLES } from "@starter/chem-render";
import { createDocument, createPanel } from "@starter/shared";
import type { Panel, RepresentationKind, SketchDocument } from "@starter/shared";

/** `l-isoleucine` in `packages/chem-core/src/dictionary-entries.ts`, verbatim. */
export const L_ISOLEUCINE_DICTIONARY_ID = "l-isoleucine";
export const L_ISOLEUCINE_MOLBLOCK = `L-isoleucine
     RDKit          2D

  9  8  0  0  0  0  0  0  0  0999 V2000
   -1.0601    2.0547    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
   -1.0593    1.0547    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
   -0.1929    0.5555    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.6727    1.0561    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
   -0.1921   -0.4445    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.6743   -0.9439    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.5399   -0.4431    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
    0.6751   -1.9439    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
   -1.0577   -0.9453    0.0000 N   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0
  2  3  1  0
  3  4  1  6
  3  5  1  0
  5  6  1  0
  6  7  2  0
  6  8  1  0
  5  9  1  1
M  END
`;

/** L-isoleucine at the standard bond length, as `dictionaryMolecule` reads it. */
export function isoleucineMolecule(): Molecule {
  const read = readMolblock(L_ISOLEUCINE_MOLBLOCK);
  if (read.warnings.length > 0) {
    throw new Error(`The guide's L-isoleucine did not read cleanly: ${read.warnings.map((w) => w.kind).join(", ")}`);
  }
  return normalizeBondLength(read.molecule);
}

/** The carbon the editor numbers C1, the carboxyl carbon. */
export function carboxylCarbon(mol: Molecule): AtomId {
  const { locants } = atomNumbering(mol);
  const c1 = mol.atomIds.find((id) => Object.hasOwn(locants, id) && locants[id] === "1");
  if (c1 === undefined) throw new Error("L-isoleucine has no C1: amino-acid numbering changed.");
  return c1;
}

function panel(docKey: string, kind: RepresentationKind, showLocants: boolean): Panel {
  const base = createPanel(kind, VIEW_KIND_TITLES[kind], "publication");
  return {
    ...base,
    id: `panel-${docKey}-${kind}`,
    representation: {
      ...base.representation,
      display: { ...base.representation.display, showLocants },
    },
  };
}

/**
 * Panel (a) skeletal with the carbons numbered, panel (b) explicit H, side by
 * side. Numbers on (a) only: placed in (b) they have to step around the
 * hydrogens and land far from their carbons.
 */
export function skeletalFormulaDocument(): SketchDocument {
  return createDocument({
    id: "doc-guide-skeletal-formula",
    title: "L-isoleucine",
    molecule: isoleucineMolecule(),
    stylePreset: "publication",
    panels: [panel("skeletal-formula", "skeletal", true), panel("skeletal-formula", "explicitH", false)],
    figure: { columns: 2 },
    now: "2026-01-01T00:00:00.000Z",
  });
}

/**
 * L-isoleucine with a methyl drawn on C1, which already has four bonds. The
 * mistake the guide's last section shows: the editor draws it, rings C1 and
 * labels it. The methyl goes into the widest gap C1's bonds leave, where the
 * drawing tool would sprout it.
 */
export function fiveBondCarbonMolecule(): Molecule {
  const mol = isoleucineMolecule();
  const c1 = carboxylCarbon(mol);
  const at = mol.atoms[c1]!.pos;
  const angle = largestGapBisector(bondDirections(mol, c1));
  const methyl = addAtom(mol, { element: "C", pos: add(at, fromPolar(angle, 1)) });
  return addBond(methyl.molecule, { from: c1, to: methyl.id, order: 1 }).molecule;
}

export function fiveBondCarbonDocument(): SketchDocument {
  return createDocument({
    id: "doc-guide-skeletal-formula-five-bonds",
    title: "L-isoleucine with a fifth bond on C1",
    molecule: fiveBondCarbonMolecule(),
    stylePreset: "publication",
    panels: [panel("skeletal-formula-five-bonds", "skeletal", true)],
    now: "2026-01-01T00:00:00.000Z",
  });
}
