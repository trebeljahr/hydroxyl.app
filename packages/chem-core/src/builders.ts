/**
 * Ergonomic construction helpers.
 *
 * The pure `addAtom`/`addBond` API threads a molecule through every call,
 * which is correct but tedious to read. This wraps it in a short-lived
 * mutable builder: the ergonomics of mutation while it is being assembled,
 * an immutable `Molecule` at the end.
 *
 * Used by the tests, the ring/functional-group templates, and file importers.
 */

import { emptyMolecule, makeAtom } from "./molecule.js";
import type {
  Atom,
  AtomId,
  AtomInit,
  Bond,
  BondId,
  BondOrder,
  BondStereo,
  Molecule,
} from "./types.js";
import { DEG, fromPolar, add as addVec, ORIGIN, type Vec2 } from "./vec.js";

function pairKey(a: AtomId, b: AtomId): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/**
 * Accumulates a molecule with local mutation, then hands back an immutable
 * one.
 *
 * Deliberately does NOT go through `addAtom`/`addBond`. Those copy the whole
 * atom and bond records on every call and `addBond` rebuilds the adjacency
 * index to check for duplicates, so building an n-atom structure through them
 * is O(n^2) — measurably so: a 20k-atom chain took over four minutes. Here the
 * partial structure is private and cannot be observed mid-build, so mutating
 * it is safe, and construction is linear.
 */
export class MoleculeBuilder {
  private readonly atomRecords: Record<AtomId, Atom> = {};
  private readonly bondRecords: Record<BondId, Bond> = {};
  private readonly atomIds: AtomId[] = [];
  private readonly bondIds: BondId[] = [];
  private readonly bonded = new Set<string>();
  private nextId = 1;

  atom(element: string, pos: Vec2 = ORIGIN, extra: Partial<AtomInit> = {}): AtomId {
    const id = `a${this.nextId++}`;
    // Through `makeAtom` rather than assembled here: that is the one place
    // that knows to omit an absent optional key instead of storing undefined,
    // and a second copy of the rule would drift the first time `Atom` grows a
    // field. It is O(1), so it costs the linear build nothing.
    const atom = makeAtom(id, { ...extra, element, pos });
    this.atomRecords[id] = atom;
    this.atomIds.push(id);
    return id;
  }

  bond(
    from: AtomId,
    to: AtomId,
    order: BondOrder = 1,
    stereo: BondStereo = "none",
  ): BondId {
    if (from === to) throw new Error(`Cannot bond atom ${from} to itself`);
    if (!this.atomRecords[from]) throw new Error(`No such atom: ${from}`);
    if (!this.atomRecords[to]) throw new Error(`No such atom: ${to}`);
    const key = pairKey(from, to);
    if (this.bonded.has(key)) {
      throw new Error(`Atoms ${from} and ${to} are already bonded`);
    }
    this.bonded.add(key);
    const id = `b${this.nextId++}`;
    this.bondRecords[id] = {
      id,
      from,
      to,
      order,
      stereo,
      doubleBondSide: "auto",
      aromatic: false,
    };
    this.bondIds.push(id);
    return id;
  }

  build(): Molecule {
    if (this.atomIds.length === 0) return emptyMolecule();
    return {
      atoms: this.atomRecords,
      bonds: this.bondRecords,
      atomIds: this.atomIds,
      bondIds: this.bondIds,
      nextId: this.nextId,
    };
  }
}

export function buildMolecule(fn: (b: MoleculeBuilder) => void): Molecule {
  const builder = new MoleculeBuilder();
  fn(builder);
  return builder.build();
}

/** A single atom, unbonded. */
export function singleAtom(element: string, pos: Vec2 = ORIGIN): Molecule {
  return buildMolecule((b) => {
    b.atom(element, pos);
  });
}

/**
 * A zig-zag chain, the way a chemist actually draws an alkane: alternating
 * +30/-30 degrees so successive bonds subtend the 120 degrees of an sp3
 * carbon rather than lying in a straight line.
 */
export function linearChain(
  length: number,
  element = "C",
  bondLength = 1,
  startAngle = 30 * DEG,
): Molecule {
  if (length < 1) return emptyMolecule();
  return buildMolecule((b) => {
    let pos: Vec2 = ORIGIN;
    let previous = b.atom(element, pos);
    for (let i = 1; i < length; i++) {
      const angle = i % 2 === 1 ? startAngle : -startAngle;
      pos = addVec(pos, fromPolar(angle, bondLength));
      const next = b.atom(element, pos);
      b.bond(previous, next, 1);
      previous = next;
    }
  });
}

/**
 * A regular carbocycle. Vertices sit on a circle whose radius makes every
 * edge exactly `bondLength`, so fusing rings later lines up.
 */
export function carbocycle(
  size: number,
  element = "C",
  bondLength = 1,
  centre: Vec2 = ORIGIN,
): Molecule {
  if (size < 3) throw new Error(`A ring needs at least 3 atoms, got ${size}`);
  const radius = bondLength / (2 * Math.sin(Math.PI / size));
  return buildMolecule((b) => {
    const ids: AtomId[] = [];
    for (let i = 0; i < size; i++) {
      // Start at -90 degrees so even-membered rings sit flat-bottomed, which
      // is how cyclohexane is conventionally drawn.
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / size;
      ids.push(b.atom(element, addVec(centre, fromPolar(angle, radius))));
    }
    for (let i = 0; i < size; i++) {
      b.bond(ids[i]!, ids[(i + 1) % size]!, 1);
    }
  });
}

/**
 * Benzene as an explicit Kekule structure — alternating single and double
 * bonds rather than aromatic flags.
 *
 * Kekule is the right default for a drawing tool: it is what most journals
 * print, it survives export to every format, and aromaticity perception can
 * always convert it to a delocalised ring afterwards. Going the other way is
 * lossier.
 */
export function benzene(bondLength = 1, centre: Vec2 = ORIGIN): Molecule {
  const ring = carbocycle(6, "C", bondLength, centre);
  const bonds = { ...ring.bonds };
  ring.bondIds.forEach((id, index) => {
    if (index % 2 === 1) bonds[id] = { ...bonds[id]!, order: 2 };
  });
  return { ...ring, bonds };
}
