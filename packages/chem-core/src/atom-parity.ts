/**
 * The V2000 atom stereo parity column (`sss`), mapped to and from a
 * `StereoConfig` (decision 207; decision 15 left this writer to the
 * projection harness).
 *
 * WHY IT EXISTS AT ALL. The model states configuration with wedges and
 * derives it (decision 24), and the molblock writer re-derives nothing: a
 * wedge travels as a bond code. A drawing with NO mark to carry its
 * configuration — a Fischer projection, whose axes are the marks — would
 * leave a file with nothing in it, and an oracle that writes such a file and
 * reads it back would assert nothing about the projections it exists to
 * check. The parity column is the molfile's own place for a mark-free
 * statement. It is OPT-IN on the writer and never feeds the reader's
 * molecule: a parity that disagreed with a wedge would make a document
 * nobody can trust, so the wedges stay the model's statement and parity is
 * returned beside it.
 *
 * THE RULE, the CTfile's. Number the stereocentre's neighbours by their row
 * in the atom block, a hydrogen counting as the highest; look at the centre
 * with the highest-numbered neighbour pointing away; 1 ("odd") when the other
 * three run 1-2-3 CLOCKWISE, 2 ("even") when counter-clockwise, 3 for "either
 * or unmarked", 0 for no stereocentre. As an order over chem-core's ligands:
 *
 *   non-hydrogen neighbours by row, then hydrogen-element neighbours (²H and
 *   ³H included) by row, then the implicit hydrogen.
 *
 * With that order and the one signed volume parity.ts defines (x right, y up,
 * z toward the viewer), counter-clockwise seen with the last ligand behind is
 * a POSITIVE volume, so parity 2 is exactly a positive sign. Checked against
 * RDKit 2025.03.4's own writer on 3D blocks, which is where RDKit writes the
 * column: a D-glyceraldehyde Fischer lift writes 2 whether its hydrogen is
 * row 5 or row 1 (an explicit H goes last, not by row), and CH3–CHD–OH writes
 * 1, which fixes ²H before the implicit hydrogen. The client's projection
 * harness re-checks the rule against RDKit on every Fischer it lifts.
 *
 * A LONE-PAIR CENTRE (a sulfoxide, a phosphine) is written 0, as RDKit writes
 * it: the spec numbers four ATOMS, and a reader that guessed where the lone
 * pair goes could state the other enantiomer. Its configuration still travels
 * as a wedge.
 */

import type { LigandRef } from "./cip.js";
import { requireAtom } from "./molecule.js";
import {
  parityAgainst,
  stereoConfig,
  stereoTopology,
  type CentreConfig,
  type CentreLigands,
  type CentreReading,
  type StereoConfig,
} from "./stereo-config.js";
import type { AtomId, Molecule } from "./types.js";

/** The V2000 `sss` values: none, odd, even, either. */
export type MolfileAtomParity = 0 | 1 | 2 | 3;

/** A parity the file actually states: odd, even or either. */
export type StatedAtomParity = 1 | 2 | 3;

/**
 * `centre`'s ligands in the order the parity column counts them, or
 * undefined for a lone-pair centre, which the column does not describe.
 * `rowOf` gives each atom's position in the atom block (any increasing
 * numbering will do; only the order matters).
 */
export function molfileLigandOrder(
  mol: Molecule,
  centre: CentreLigands,
  rowOf: (atomId: AtomId) => number,
): readonly LigandRef[] | undefined {
  if (centre.lonePair) return undefined;
  const byRow = (a: AtomId, b: AtomId): number => rowOf(a) - rowOf(b);
  const hydrogen = (id: AtomId): boolean => requireAtom(mol, id).element === "H";
  const heavy = centre.order.filter((id) => !hydrogen(id)).sort(byRow);
  const hydrogens = centre.order.filter(hydrogen).sort(byRow);
  const out: LigandRef[] = [...heavy, ...hydrogens].map((atomId) => ({ kind: "atom", atomId }));
  if (centre.implicitHydrogen) out.push({ kind: "implicitHydrogen" });
  return out;
}

/**
 * The `sss` value that states `centre`'s reading: 1 or 2 for a specified
 * centre, 3 for a mixture (a wavy bond: "either"), 0 for anything
 * undetermined and for a lone-pair centre.
 */
export function molfileAtomParity(
  mol: Molecule,
  centre: CentreConfig,
  rowOf: (atomId: AtomId) => number,
): MolfileAtomParity {
  const own = stereoTopology(mol).centres.find((c) => c.atomId === centre.atomId);
  if (
    own === undefined ||
    own.implicitHydrogen !== centre.implicitHydrogen ||
    own.lonePair !== centre.lonePair ||
    own.order.length !== centre.order.length ||
    own.order.some((id, i) => id !== centre.order[i])
  ) {
    throw new Error(`The configuration of ${centre.atomId} is not a configuration of this molecule's centre.`);
  }
  if (centre.reading.kind === "mixture") return centre.lonePair ? 0 : 3;
  if (centre.reading.kind !== "specified") return 0;
  const order = molfileLigandOrder(mol, centre, rowOf);
  if (order === undefined) return 0;
  const sign = parityAgainst(centre, order);
  if (sign === undefined) {
    throw new Error(`The configuration of ${centre.atomId} does not name its ligands in this molecule.`);
  }
  return sign > 0 ? 2 : 1;
}

/**
 * The configuration an atom-parity column states, as a `StereoConfig` of
 * `mol`: each stereocentre's reading from `parities` (keyed by atom id;
 * 1 and 2 specified, 3 a mixture, absent or 0 `unspecified`, a lone-pair
 * centre always `unspecified`). Double bonds and `unrepresentable` come from
 * the drawing, as the column says nothing about them.
 *
 * The atom-block order is `mol.atomIds`, which is how `readMolblock` builds
 * a molecule: row order, skipped rows aside.
 */
export function stereoConfigFromAtomParities(
  mol: Molecule,
  parities: Readonly<Record<AtomId, StatedAtomParity>>,
): StereoConfig {
  const index = new Map(mol.atomIds.map((id, i) => [id, i]));
  const rowOf = (id: AtomId): number => index.get(id) ?? Number.MAX_SAFE_INTEGER;
  const drawn = stereoConfig(mol);
  const centres = stereoTopology(mol).centres.map((centre): CentreConfig => {
    const code = Object.hasOwn(parities, centre.atomId) ? parities[centre.atomId] : undefined;
    return Object.freeze({ ...centre, reading: readingOf(mol, centre, code, rowOf) });
  });
  return Object.freeze({
    centres: Object.freeze(centres),
    doubleBonds: drawn.doubleBonds,
    unrepresentable: drawn.unrepresentable,
  });
}

function readingOf(
  mol: Molecule,
  centre: CentreLigands,
  code: StatedAtomParity | undefined,
  rowOf: (atomId: AtomId) => number,
): CentreReading {
  const order = molfileLigandOrder(mol, centre, rowOf);
  if (order === undefined || code === undefined) return { kind: "undetermined", reason: "unspecified" };
  if (code === 3) return { kind: "mixture", of: "epimers" };
  // The column states a sign over the molfile order; the canonical parity is
  // that sign times the permutation's own sign.
  const permutation = parityAgainst({ ...centre, reading: { kind: "specified", parity: 1 } }, order);
  if (permutation === undefined) return { kind: "undetermined", reason: "unspecified" };
  const stated = code === 2 ? 1 : -1;
  return { kind: "specified", parity: stated === permutation ? 1 : -1 };
}
