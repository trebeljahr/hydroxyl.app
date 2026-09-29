/**
 * Which side of a Fischer projection a substituent sits on, read from the
 * molecule's CONFIGURATION rather than from any drawing of it.
 *
 * D/L and alpha/beta are both defined on a Fischer projection: "the hydroxy
 * group on the configurational atom is on the right", "the exocyclic oxygen
 * at the anomeric centre is formally cis to the oxygen on the reference atom".
 * Nothing on the page has to be a Fischer projection for those to have an
 * answer, and reading them off the drawn coordinates would make the answer
 * depend on how the author happened to turn the molecule. So the question is
 * put to the configuration instead (decisions 132 and 144):
 *
 *   Put ONE centre on a synthetic Fischer cross: `up` on the upper vertical
 *   bond, `down` on the lower one, `side` on the east arm, the remaining
 *   ligand on the west arm (an implicit hydrogen fills the vacant arm by
 *   itself). Read that placement with `readConfig` under the fischer
 *   convention, SCOPED to that centre, and compare the parity it implies with
 *   the molecule's own. Equal means `side` really is on the right.
 *
 * The scope is what makes this possible at all: every other centre of the
 * molecule keeps its real, off-axis bonds, and without the scope the fischer
 * convention refuses the whole placement for them.
 *
 * This is the ONLY thing the sugar and the amino-acid D/L code share
 * (decision 132). Which atoms go up, down and sideways is each caller's
 * chemistry: a sugar reads its configurational atom with the chain vertical,
 * an amino acid reads its alpha carbon with the carboxyl up and the side chain
 * down. Neither ever consults R/S — L-cysteine is (R) and L-alanine is (S).
 */

import type { TetrahedralParity } from "./parity.js";
import {
  readConfig,
  stereoConfig,
  stereoTopology,
  type ConfigUndeterminedReason,
  type StereoConfig,
} from "./stereo-config.js";
import type { AtomId, Molecule } from "./types.js";
import type { Vec2 } from "./vec.js";

/** The three named arms of the cross. The fourth ligand takes the west arm. */
export interface FischerArms {
  /** On the upper vertical bond: the lower-numbered chain neighbour. */
  readonly up: AtomId;
  /** On the lower vertical bond: the higher-numbered chain neighbour. */
  readonly down: AtomId;
  /** The substituent whose side is asked about, placed on the east arm. */
  readonly side: AtomId;
}

export type FischerSideUndeterminedReason =
  /** The atom is not a stereocentre of the molecule. */
  | "not-a-stereocentre"
  /** `up`, `down` and `side` are not three distinct ligands of the centre. */
  | "not-its-ligands"
  /** The configuration says nothing about this centre. */
  | "no-configuration"
  | ConfigUndeterminedReason;

export type FischerSide =
  | { readonly kind: "right" }
  | { readonly kind: "left" }
  /** A wavy bond at the centre: both configurations, so both sides. */
  | { readonly kind: "mixture" }
  | { readonly kind: "undetermined"; readonly reason: FischerSideUndeterminedReason };

/**
 * D or L, read at one centre on a Fischer projection. Shared by the sugar and
 * the amino-acid readings, which differ only in which centre and which arms.
 */
export type DLConfiguration =
  | { readonly kind: "D"; readonly atomId: AtomId }
  | { readonly kind: "L"; readonly atomId: AtomId }
  /** A wavy bond at the configurational atom: both series. */
  | { readonly kind: "mixture"; readonly atomId: AtomId }
  /** The question has no answer here. */
  | { readonly kind: "notApplicable"; readonly reason: DLNotApplicableReason }
  | {
      readonly kind: "undetermined";
      readonly reason: DLUndeterminedReason;
      readonly atomId?: AtomId;
    };

export type DLNotApplicableReason =
  /** A carbohydrate chain with no stereocentre: dihydroxyacetone. */
  | "no-stereocentre"
  /** An amino acid whose alpha carbon is not a stereocentre: glycine. */
  | "achiral-alpha-carbon";

export type DLUndeterminedReason =
  | FischerSideUndeterminedReason
  /** The atoms the reading needs lie past a tie in the parent chain. */
  | "tied-chain"
  /** The atom has no single substituent to put on the side arm. */
  | "no-side-substituent";

const FISCHER = Object.freeze({ kind: "fischer" as const });

interface Cross {
  readonly centre: AtomId;
  readonly arms: FischerArms;
  /** The ligand left for the west arm, when it is a drawn atom. */
  readonly west: AtomId | undefined;
}

function crossOf(
  mol: Molecule,
  centre: AtomId,
  arms: FischerArms,
): Cross | FischerSideUndeterminedReason {
  const ligands = stereoTopology(mol).centres.find((c) => c.atomId === centre);
  if (ligands === undefined) return "not-a-stereocentre";
  const named = [arms.up, arms.down, arms.side];
  if (new Set(named).size !== 3 || named.some((id) => !ligands.order.includes(id))) {
    return "not-its-ligands";
  }
  const rest = ligands.order.filter((id) => !named.includes(id));
  const implicit = (ligands.implicitHydrogen ? 1 : 0) + (ligands.lonePair ? 1 : 0);
  if (rest.length + implicit !== 1) return "not-its-ligands";
  return { centre, arms, west: rest[0] };
}

function crossParity(mol: Molecule, cross: Cross): TetrahedralParity {
  const origin = mol.atoms[cross.centre]!.pos;
  const at = (dx: number, dy: number): Vec2 => ({ x: origin.x + dx, y: origin.y + dy });
  const positions: Record<AtomId, Vec2> = {
    [cross.arms.up]: at(0, 1),
    [cross.arms.down]: at(0, -1),
    [cross.arms.side]: at(1, 0),
  };
  if (cross.west !== undefined) positions[cross.west] = at(-1, 0);

  const read = readConfig({ mol, positions }, FISCHER, { centres: [cross.centre] });
  const placed =
    read.kind === "read" ? read.config.centres.find((c) => c.atomId === cross.centre) : undefined;
  // The cross is exact by construction, so the placement never refuses and
  // the centre always reads; the guard keeps a future convention change loud.
  if (placed === undefined || placed.reading.kind !== "specified") {
    throw new Error(`The synthetic Fischer cross at ${cross.centre} did not read`);
  }
  return placed.reading.parity;
}

/**
 * The parity, against `centre`'s canonical ligand order, of the Fischer cross
 * with `arms.side` on the RIGHT. Undefined when `centre` is not a stereocentre
 * of `mol` whose ligands are those three plus exactly one more.
 *
 * The left side is the opposite parity: swapping the two horizontal arms is
 * one transposition. `cycliseSugar` uses this to turn "alpha" into the parity
 * it must draw at an anomeric centre that does not exist in its input.
 */
export function fischerCrossParity(
  mol: Molecule,
  centre: AtomId,
  arms: FischerArms,
): TetrahedralParity | undefined {
  const cross = crossOf(mol, centre, arms);
  if (typeof cross === "string") return undefined;
  return crossParity(mol, cross);
}

/**
 * The side `arms.side` occupies at `centre` when `arms.up` is up and
 * `arms.down` is down in a Fischer projection.
 *
 * `config` is the configuration to ask; by default the one the wedge drawing
 * states. Pass a config read under another convention (a drawn Fischer, a
 * projection's read-back) to ask that one instead. It must be a config OF
 * `mol`: a centre whose ligands differ throws, as `descriptorFromConfig` does,
 * because comparing parities over two different ligand lists would give a
 * confident answer to a different question.
 */
export function fischerSide(
  mol: Molecule,
  centre: AtomId,
  arms: FischerArms,
  config: StereoConfig = stereoConfig(mol),
): FischerSide {
  const cross = crossOf(mol, centre, arms);
  if (typeof cross === "string") return { kind: "undetermined", reason: cross };
  const actual = config.centres.find((c) => c.atomId === centre);
  if (actual === undefined) return { kind: "undetermined", reason: "no-configuration" };
  const own = stereoTopology(mol).centres.find((c) => c.atomId === centre)!;
  if (
    actual.implicitHydrogen !== own.implicitHydrogen ||
    actual.lonePair !== own.lonePair ||
    actual.order.length !== own.order.length ||
    actual.order.some((id, i) => id !== own.order[i])
  ) {
    throw new Error(`The configuration's centre ${centre} does not match this molecule's ligands`);
  }
  switch (actual.reading.kind) {
    case "mixture":
      return { kind: "mixture" };
    case "undetermined":
      return { kind: "undetermined", reason: actual.reading.reason };
    case "specified":
      return actual.reading.parity === crossParity(mol, cross)
        ? { kind: "right" }
        : { kind: "left" };
  }
}
