/**
 * Functional groups: the "put a COOH here" gesture.
 *
 * A group is a small fragment with one ATTACHMENT atom, stamped onto an
 * existing atom through a new single bond — the same shape of edit as
 * `attachRingToAtom`, and built from the same two primitives: the fragment is
 * pasted with `insertFragment` and joined with one `addBond`.
 *
 * Four decisions are load-bearing.
 *
 * A GROUP IS EXPANDED INTO REAL ATOMS, never drawn as a label. `Atom.label`
 * ("Ph", "Boc") is cosmetic by design and `writeMolblock` refuses it with a
 * named error rather than guess what it stands for (decision 8), so a palette
 * that stamped labels would produce drawings that cannot be exported, have no
 * formula and no mass. A stamped Boc is five carbons, two oxygens and the
 * bonds between them: every export, every formula and the valence badge see
 * exactly what the figure shows.
 *
 * HYDROGENS STAY IMPLICIT. "NH2" is ONE nitrogen; its two hydrogens are
 * derived from valence at query time like every other hydrogen in the model.
 * The label a group carries (`label`) is for the palette button only.
 *
 * CHARGE-SEPARATED WHERE THAT IS THE STORAGE FORM. Nitro is N+(=O)O− and azide
 * N=N+=N−, exactly as RDKit sanitises them. The pentavalent spellings (N(=O)=O)
 * would be flagged over-valent by valence.ts and rewritten on the first SMILES
 * round-trip, so the group would change under the user's hands.
 *
 * GEOMETRY IS THE SAME LATTICE THE REST OF THE EDITOR DRAWS ON. Each group is
 * written in its own frame with the attachment bond arriving along +x, every
 * bond one unit long and every angle a multiple of 30 degrees; placing it is a
 * rotation onto `templateAngle` and a scale to the drawing's bond length. The
 * one choice left — which way an asymmetric group (CHO, COOH, Boc) bends — is
 * made by trying the mirror image as well and keeping whichever sits further
 * from the atoms already drawn. On a terminal chain atom that is the anti
 * placement, which is the zig-zag a chemist would draw; on a ring carbon both
 * sides are equal and the unmirrored one wins, so the result is deterministic.
 *
 * VALENCE NEVER BLOCKS A PLACEMENT, exactly as for rings and sprouts. A COOH
 * stamped on a quaternary carbon is drawn and the badge appears afterwards.
 */

import { MoleculeBuilder } from "./builders.js";
import type { ElementSymbol } from "./elements.js";
import { insertFragment } from "./fragment.js";
import { addBond, requireAtom } from "./molecule.js";
import { DEFAULT_BOND_LENGTH } from "./sprout.js";
import { templateAngle } from "./templates.js";
import type { AtomId, BondId, BondOrder, Molecule } from "./types.js";
import { add, DEG, distanceSq, fromPolar, rotate, scale, type Vec2 } from "./vec.js";

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

/**
 * One atom of a group, placed relative to an earlier one.
 *
 * A turtle walk rather than a coordinate table: every position is one unit
 * step from the atom it is bonded to, so a typo shows up as a wrong ANGLE
 * (which the tests catch as a bond that is not one unit long, or a ring that
 * does not close) rather than as a coordinate that is subtly off.
 */
export interface GroupAtomSpec {
  readonly element: ElementSymbol;
  /** Index of the atom this one is bonded to and stepped from. Absent only on
   *  atom 0, the attachment atom, which sits at the origin. */
  readonly from?: number;
  /** Direction of the step from `from`, in degrees, in the group's own frame
   *  (the attachment bond arrives along +x, so 0 continues straight on). */
  readonly angle?: number;
  /** Order of the bond to `from`. Defaults to 1. */
  readonly order?: BondOrder;
  readonly charge?: number;
}

/** A bond that closes a ring inside the group: two atom indices and an order. */
export type GroupRingClosure = readonly [number, number, BondOrder];

export interface FunctionalGroup {
  /** What the group is written as in a scheme, and what the palette shows:
   *  "NH₂", "CO₂Me". Subscripts are Unicode digits because it is set as text. */
  readonly label: string;
  /** The substituent name, for the tooltip and the palette search. */
  readonly title: string;
  /** Extra search words beyond `label` and `title`. */
  readonly keywords: readonly string[];
  /** Atom 0 is the attachment atom. */
  readonly atoms: readonly GroupAtomSpec[];
  readonly closures: readonly GroupRingClosure[];
}

/** Terse constructor for the table below. */
function at(
  element: ElementSymbol,
  from: number,
  angle: number,
  order: BondOrder = 1,
  charge = 0,
): GroupAtomSpec {
  return charge === 0
    ? { element, from, angle, order }
    : { element, from, angle, order, charge };
}

/**
 * A Kekule benzene ring hanging off atom `from` in direction `heading`, or —
 * with `from` undefined — with its ipso carbon at the origin (phenyl itself).
 * Returns the six ring atoms and the one closure bond; the ipso carbon is the
 * first atom returned and the para carbon the fourth.
 *
 * The walk goes round the ring anticlockwise from the ipso carbon, so the
 * ring's centre lies along `heading` and the attaching bond points straight
 * at it — the way biphenyl is drawn, and what `attachRingToAtom` does.
 */
function benzeneRing(
  firstIndex: number,
  from: number | undefined,
  heading: number,
): { readonly atoms: GroupAtomSpec[]; readonly closure: GroupRingClosure } {
  const ipso: GroupAtomSpec =
    from === undefined ? { element: "C" } : at("C", from, heading);
  const i = firstIndex;
  return {
    atoms: [
      ipso,
      at("C", i, heading + 60, 2),
      at("C", i + 1, heading, 1),
      at("C", i + 2, heading - 60, 2),
      at("C", i + 3, heading - 120, 1),
      at("C", i + 4, heading + 180, 2),
    ],
    closure: [i + 5, i, 1],
  };
}

function group(
  label: string,
  title: string,
  keywords: readonly string[],
  atoms: readonly GroupAtomSpec[],
  closures: readonly GroupRingClosure[] = [],
): FunctionalGroup {
  return Object.freeze({
    label,
    title,
    keywords: Object.freeze([...keywords]),
    atoms: Object.freeze(atoms.map((a) => Object.freeze(a))),
    closures: Object.freeze([...closures]),
  });
}

const phenyl = benzeneRing(0, undefined, 0);
const benzyl = benzeneRing(1, 0, 60);
const tosyl = benzeneRing(3, 0, 0);
const cbz = benzeneRing(4, 3, -60);

/**
 * The palette, in the order it is shown: heteroatom groups, then carbonyls,
 * then sulfonyls, then carbon substituents, then aryls and the protecting
 * groups a synthesis scheme is full of.
 *
 * Every entry is pinned by a test that stamps it onto benzene (or, for the
 * N-protecting groups, onto aniline's nitrogen) and checks the molecular
 * formula of the real compound that makes: phenol, nitrobenzene, tert-butyl
 * phenylcarbamate and so on.
 */
export const FUNCTIONAL_GROUPS = Object.freeze({
  OH: group("OH", "Hydroxy", ["alcohol", "hydroxyl", "phenol"], [{ element: "O" }]),
  OMe: group("OMe", "Methoxy", ["ether", "methyl ether"], [
    { element: "O" },
    at("C", 0, 60),
  ]),
  OAc: group("OAc", "Acetoxy", ["acetate", "ester"], [
    { element: "O" },
    at("C", 0, 60),
    at("O", 1, 120, 2),
    at("C", 1, 0),
  ]),
  SH: group("SH", "Sulfanyl", ["thiol", "mercapto"], [{ element: "S" }]),
  NH2: group("NH₂", "Amino", ["amine", "primary amine"], [{ element: "N" }]),
  NMe2: group("NMe₂", "Dimethylamino", ["amine", "tertiary amine"], [
    { element: "N" },
    at("C", 0, 60),
    at("C", 0, -60),
  ]),
  NHAc: group("NHAc", "Acetamido", ["amide", "acetamide"], [
    { element: "N" },
    at("C", 0, 60),
    at("O", 1, 120, 2),
    at("C", 1, 0),
  ]),
  NO2: group("NO₂", "Nitro", ["nitro"], [
    { element: "N", charge: 1 },
    at("O", 0, 60, 2),
    at("O", 0, -60, 1, -1),
  ]),
  CN: group("CN", "Cyano", ["nitrile", "cyanide"], [
    { element: "C" },
    at("N", 0, 0, 3),
  ]),
  N3: group("N₃", "Azido", ["azide", "click"], [
    { element: "N" },
    at("N", 0, 60, 2, 1),
    at("N", 1, 60, 2, -1),
  ]),
  CHO: group("CHO", "Formyl", ["aldehyde", "carbonyl"], [
    { element: "C" },
    at("O", 0, 60, 2),
  ]),
  Ac: group("Ac", "Acetyl", ["ketone", "methyl ketone", "carbonyl"], [
    { element: "C" },
    at("O", 0, 60, 2),
    at("C", 0, -60),
  ]),
  COOH: group("COOH", "Carboxy", ["carboxylic acid", "acid", "CO2H"], [
    { element: "C" },
    at("O", 0, 60, 2),
    at("O", 0, -60),
  ]),
  CO2Me: group("CO₂Me", "Methoxycarbonyl", ["methyl ester", "ester", "COOMe"], [
    { element: "C" },
    at("O", 0, 60, 2),
    at("O", 0, -60),
    at("C", 2, 0),
  ]),
  CONH2: group("CONH₂", "Carbamoyl", ["amide", "primary amide"], [
    { element: "C" },
    at("O", 0, 60, 2),
    at("N", 0, -60),
  ]),
  COCl: group("COCl", "Chlorocarbonyl", ["acyl chloride", "acid chloride"], [
    { element: "C" },
    at("O", 0, 60, 2),
    at("Cl", 0, -60),
  ]),
  SO3H: group("SO₃H", "Sulfo", ["sulfonic acid"], [
    { element: "S" },
    at("O", 0, 90, 2),
    at("O", 0, -90, 2),
    at("O", 0, 0),
  ]),
  Ms: group("Ms", "Methanesulfonyl", ["mesyl", "sulfone", "SO2Me"], [
    { element: "S" },
    at("O", 0, 90, 2),
    at("O", 0, -90, 2),
    at("C", 0, 0),
  ]),
  Ts: group(
    "Ts",
    "p-Toluenesulfonyl",
    ["tosyl", "sulfonyl", "sulfone"],
    [
      { element: "S" },
      at("O", 0, 90, 2),
      at("O", 0, -90, 2),
      ...tosyl.atoms,
      // The para methyl, straight on from the ring's far vertex.
      at("C", 6, 0),
    ],
    [tosyl.closure],
  ),
  Me: group("Me", "Methyl", ["CH3", "alkyl"], [{ element: "C" }]),
  Et: group("Et", "Ethyl", ["alkyl"], [{ element: "C" }, at("C", 0, 60)]),
  iPr: group("iPr", "Isopropyl", ["alkyl", "propan-2-yl"], [
    { element: "C" },
    at("C", 0, 60),
    at("C", 0, -60),
  ]),
  tBu: group("tBu", "tert-Butyl", ["alkyl", "t-butyl"], [
    { element: "C" },
    at("C", 0, 0),
    at("C", 0, 90),
    at("C", 0, -90),
  ]),
  CF3: group("CF₃", "Trifluoromethyl", ["fluoro", "fluorinated"], [
    { element: "C" },
    at("F", 0, 0),
    at("F", 0, 90),
    at("F", 0, -90),
  ]),
  vinyl: group("CH=CH₂", "Vinyl", ["ethenyl", "alkene", "olefin"], [
    { element: "C" },
    at("C", 0, 60, 2),
  ]),
  ethynyl: group("C≡CH", "Ethynyl", ["alkyne", "acetylene"], [
    { element: "C" },
    at("C", 0, 0, 3),
  ]),
  Ph: group("Ph", "Phenyl", ["aryl", "benzene", "arene"], phenyl.atoms, [
    phenyl.closure,
  ]),
  Bn: group(
    "Bn",
    "Benzyl",
    ["aryl", "arene"],
    [{ element: "C" }, ...benzyl.atoms],
    [benzyl.closure],
  ),
  Boc: group(
    "Boc",
    "tert-Butoxycarbonyl",
    ["protecting group", "carbamate"],
    [
      { element: "C" },
      at("O", 0, 60, 2),
      at("O", 0, -60),
      at("C", 2, 0),
      at("C", 3, 0),
      at("C", 3, 90),
      at("C", 3, -90),
    ],
  ),
  Cbz: group(
    "Cbz",
    "Benzyloxycarbonyl",
    ["protecting group", "carbamate", "Z"],
    [
      { element: "C" },
      at("O", 0, 60, 2),
      at("O", 0, -60),
      at("C", 2, 0),
      ...cbz.atoms,
    ],
    [cbz.closure],
  ),
  TMS: group("TMS", "Trimethylsilyl", ["silyl", "SiMe3"], [
    { element: "Si" },
    at("C", 0, 0),
    at("C", 0, 90),
    at("C", 0, -90),
  ]),
  // The silyl ether protecting group a scheme writes as OTBS. Added with
  // decision 225, so the commonest contracted label has a stamp to make it.
  TBS: group("TBS", "tert-Butyldimethylsilyl", ["silyl", "TBDMS", "protecting group"], [
    { element: "Si" },
    at("C", 0, 90),
    at("C", 0, -90),
    at("C", 0, 0),
    at("C", 3, 0),
    at("C", 3, 90),
    at("C", 3, -90),
  ]),
} satisfies Record<string, FunctionalGroup>);

export type FunctionalGroupName = keyof typeof FUNCTIONAL_GROUPS;

/** Palette order. `Object.keys` on the frozen literal is insertion order. */
export const FUNCTIONAL_GROUP_NAMES: readonly FunctionalGroupName[] = Object.freeze(
  Object.keys(FUNCTIONAL_GROUPS) as FunctionalGroupName[],
);

export function isFunctionalGroupName(name: string): name is FunctionalGroupName {
  return Object.prototype.hasOwnProperty.call(FUNCTIONAL_GROUPS, name);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Every atom's position in the group's own frame: attachment atom at the
 * origin, attachment bond arriving along +x, unit bonds.
 *
 * Throws on a spec that steps from an atom not yet placed — that is a typo in
 * the table above, not a user-recoverable state.
 */
export function groupLocalPositions(spec: FunctionalGroup): readonly Vec2[] {
  const positions: Vec2[] = [];
  spec.atoms.forEach((atom, index) => {
    if (atom.from === undefined) {
      if (index !== 0) {
        throw new Error(`Group ${spec.label}: atom ${index} has no parent to step from`);
      }
      positions.push({ x: 0, y: 0 });
      return;
    }
    const origin = positions[atom.from];
    if (origin === undefined || atom.from >= index) {
      throw new Error(
        `Group ${spec.label}: atom ${index} steps from atom ${atom.from}, which is not placed yet`,
      );
    }
    positions.push(add(origin, fromPolar((atom.angle ?? 0) * DEG, 1)));
  });
  return positions;
}

/**
 * The group as a standalone molecule in its own frame (attachment atom first,
 * at the origin). Built with `MoleculeBuilder`, so it is linear in the group's
 * size — irrelevant at twelve atoms, but it keeps the "bulk construction goes
 * through the builder" rule without an exception to explain.
 */
export function groupFragment(
  name: FunctionalGroupName,
  place: (local: Vec2) => Vec2 = (p) => p,
): Molecule {
  const spec = FUNCTIONAL_GROUPS[name];
  const local = groupLocalPositions(spec);
  const b = new MoleculeBuilder();
  const ids: AtomId[] = [];
  spec.atoms.forEach((atom, index) => {
    const pos = place(local[index]!);
    ids.push(
      b.atom(atom.element, pos, atom.charge === undefined ? {} : { charge: atom.charge }),
    );
    if (atom.from !== undefined) b.bond(ids[atom.from]!, ids[index]!, atom.order ?? 1);
  });
  for (const [i, j, order] of spec.closures) b.bond(ids[i]!, ids[j]!, order);
  return b.build();
}

/**
 * How crowded a placement would be: the sum of inverse squared distances from
 * each group atom to each atom already drawn. Smaller is roomier.
 *
 * A sum rather than the single nearest distance, because the nearest distance
 * TIES on the commonest substrate — a ring carbon, whose two neighbours are
 * mirror images of each other — and a tie decided by float noise would make
 * the same click bend the group a different way on a different machine.
 */
function crowding(mol: Molecule, placed: readonly Vec2[]): number {
  let total = 0;
  for (const atomId of mol.atomIds) {
    const pos = mol.atoms[atomId]?.pos;
    if (pos === undefined) continue;
    for (const p of placed) total += 1 / Math.max(distanceSq(p, pos), 1e-12);
  }
  return total;
}

/**
 * Below this relative difference two placements are equally roomy and the
 * unmirrored one wins. Far above float noise on sums of order 1-100, far below
 * any difference a human could see.
 */
const CROWDING_TIE = 1e-9;

export interface GroupOptions {
  readonly bondLength?: number;
}

export interface GroupResult {
  readonly molecule: Molecule;
  /** Ids of the atoms this call minted, in the group's own order: the
   *  attachment atom first. */
  readonly atomIds: readonly AtomId[];
  /** Ids of the bonds this call minted: the linking bond first. */
  readonly bondIds: readonly BondId[];
}

/**
 * Attach a functional group to an atom through a new single bond.
 *
 * The direction is `templateAngle`'s — the same one a ring attached here would
 * take — so a group never points into a ring the atom belongs to. The group is
 * then laid both ways round that axis and the roomier of the two is kept.
 */
export function attachGroupToAtom(
  mol: Molecule,
  atomId: AtomId,
  name: FunctionalGroupName,
  options?: GroupOptions,
): GroupResult {
  const anchor = requireAtom(mol, atomId).pos;
  const bondLength = options?.bondLength ?? DEFAULT_BOND_LENGTH;
  const angle = templateAngle(mol, atomId);
  const local = groupLocalPositions(FUNCTIONAL_GROUPS[name]);

  // The attachment bond arrives along +x, so the attachment atom sits one bond
  // from the anchor: shift by one unit, then rotate and scale onto the page.
  const placer =
    (mirror: boolean) =>
    (p: Vec2): Vec2 =>
      add(anchor, scale(rotate({ x: p.x + 1, y: mirror ? -p.y : p.y }, angle), bondLength));

  const straight = placer(false);
  const mirrored = placer(true);
  const straightCost = crowding(mol, local.map(straight));
  const mirroredCost = crowding(mol, local.map(mirrored));
  const useMirror = mirroredCost < straightCost * (1 - CROWDING_TIE);

  const fragment = groupFragment(name, useMirror ? mirrored : straight);
  const inserted = insertFragment(mol, fragment);
  const attachment = inserted.atomIds[0]!;
  const link = addBond(inserted.molecule, { from: atomId, to: attachment, order: 1 });
  return {
    molecule: link.molecule,
    atomIds: inserted.atomIds,
    bondIds: [link.id, ...inserted.bondIds],
  };
}
