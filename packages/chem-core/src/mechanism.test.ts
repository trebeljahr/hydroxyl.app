/**
 * Curly arrows applied as bookkeeping, on real mechanisms.
 *
 * Every assertion is phrased as chemistry — a charge, a bond order, a
 * hydrogen count, a configuration — so a regression reads as the wrong
 * product of a named reaction rather than as a graph error. The correctness
 * oracle is REVERSAL: the reversed arrows applied to the product must give
 * the reactant back, for every step here, heterolysis included.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildMolecule } from "./builders.js";
import {
  ELECTRON_COUNTS,
  applyArrows,
  composition,
  mechanismIssues,
  reverseArrows,
  speciesRelationIssues,
  type ElectronMove,
  type ElectronSink,
  type ElectronSource,
  type MechanismIssueKind,
} from "./mechanism.js";
import { readMolblock } from "./molblock-read.js";
import { addAtom, bondBetween, ringCount } from "./molecule.js";
import { setBondStereo } from "./ops.js";
import { promoteImplicitHydrogen } from "./promote-hydrogen.js";
import { cipDescriptor } from "./stereo.js";
import { ligandRefs, parityAgainst, stereoConfig } from "./stereo-config.js";
import type { AtomId, BondId, Molecule } from "./types.js";
import { implicitHydrogenCount, valenceIssues } from "./valence.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "projection");

function load(file: string): Molecule {
  return readMolblock(readFileSync(join(FIXTURES, file), "utf8")).molecule;
}

// ---------------------------------------------------------------------------
// Arrow spelling
// ---------------------------------------------------------------------------

const lp = (atomId: AtomId): ElectronSource => ({ kind: "lonePair", atomId });
const rad = (atomId: AtomId): ElectronSource => ({ kind: "radical", atomId });
const bd = (bondId: BondId): ElectronSource => ({ kind: "bond", bondId });
const toAtom = (atomId: AtomId): ElectronSink => ({ kind: "atom", atomId });
const toBond = (bondId: BondId): ElectronSink => ({ kind: "bond", bondId });
const toLp = (atomId: AtomId): ElectronSink => ({ kind: "lonePair", atomId });
const pair = (source: ElectronSource, sink: ElectronSink): ElectronMove => ({
  electrons: "pair",
  source,
  sink,
});
const hook = (source: ElectronSource, sink: ElectronSink): ElectronMove => ({
  electrons: "single",
  source,
  sink,
});

// ---------------------------------------------------------------------------
// Structural equality: atoms field for field, bonds by unordered atom pair
// ---------------------------------------------------------------------------

/**
 * A molecule as the reversal oracle compares it (decision 151): every atom
 * field for field, every bond by its atom pair with order, mark (and the
 * narrow end, when marked), side and flag. Bond ids and `bondIds` order are
 * left out: a bond the step broke comes back with a fresh id.
 */
function structure(mol: Molecule): unknown {
  return {
    atoms: mol.atomIds.map((id) => mol.atoms[id]),
    bonds: mol.bondIds
      .map((id) => {
        const bond = mol.bonds[id]!;
        const [x, y] = bond.from < bond.to ? [bond.from, bond.to] : [bond.to, bond.from];
        return {
          pair: `${x}-${y}`,
          order: bond.order,
          stereo: bond.stereo,
          narrow: bond.stereo === "none" ? null : bond.from,
          side: bond.doubleBondSide,
          aromatic: bond.aromatic,
        };
      })
      .sort((p, q) => (p.pair < q.pair ? -1 : p.pair > q.pair ? 1 : 0)),
    stereoGroups: mol.stereoGroups ?? null,
    speciesJoins: mol.speciesJoins ?? null,
  };
}

const REFUSALS: ReadonlySet<MechanismIssueKind> = new Set([
  "unknown-reference",
  "self-target",
  "disconnected",
  "ambiguous-bond-end",
  "aromatic-bond",
  "pair-from-radical",
  "no-lone-pair",
  "no-radical",
  "electron-conflict",
  "bond-order-overflow",
  "unpaired-bond-electron",
]);

/** Applies, reverses, re-applies; asserts the reverse applies whole and lands on the reactant. */
function expectReverses(mol: Molecule, arrows: readonly ElectronMove[]): Molecule {
  const product = applyArrows(mol, arrows);
  const reverse = reverseArrows(mol, arrows);
  const refusedInReverse = mechanismIssues(product, reverse).filter((i) => REFUSALS.has(i.kind));
  expect(refusedInReverse).toEqual([]);
  const back = applyArrows(product, reverse);
  expect(structure(back)).toEqual(structure(mol));
  return product;
}

function charge(mol: Molecule, atomId: AtomId): number {
  return mol.atoms[atomId]!.charge;
}

function order(mol: Molecule, a: AtomId, b: AtomId): number {
  return bondBetween(mol, a, b)?.order ?? 0;
}

function kinds(mol: Molecule, arrows: readonly ElectronMove[]): MechanismIssueKind[] {
  return mechanismIssues(mol, arrows).map((issue) => issue.kind);
}

// ---------------------------------------------------------------------------
// Fixtures: real molecules, built by hand
// ---------------------------------------------------------------------------

/** Bromomethane beside hydroxide: the SN2 textbook pair. */
function bromomethaneAndHydroxide() {
  let c = "";
  let br = "";
  let cBr = "";
  let o = "";
  const mol = buildMolecule((b) => {
    c = b.atom("C", { x: 0, y: 0 });
    br = b.atom("Br", { x: 1, y: 0 });
    cBr = b.bond(c, br);
    o = b.atom("O", { x: -2, y: 0 }, { charge: -1 });
  });
  return { mol, c, br, cBr, o };
}

/** 2-bromo-2-methylpropane (t-butyl bromide). */
function tButylBromide() {
  let c = "";
  let br = "";
  let cBr = "";
  const methyls: AtomId[] = [];
  const mol = buildMolecule((b) => {
    c = b.atom("C", { x: 0, y: 0 });
    for (const [x, y] of [
      [-1, 0],
      [0.5, 0.87],
      [0.5, -0.87],
    ] as const) {
      const m = b.atom("C", { x, y });
      b.bond(c, m);
      methyls.push(m);
    }
    br = b.atom("Br", { x: 1, y: 0 });
    cBr = b.bond(c, br);
  });
  return { mol, c, br, cBr, methyls };
}

/** Acetone beside cyanide, C- triple-bonded to N. */
function acetoneAndCyanide() {
  let carbonyl = "";
  let oxygen = "";
  let co = "";
  let cn = "";
  let n = "";
  let alpha = "";
  let alphaCarbonyl = "";
  const mol = buildMolecule((b) => {
    alpha = b.atom("C", { x: -1, y: 0 });
    carbonyl = b.atom("C", { x: 0, y: 0 });
    alphaCarbonyl = b.bond(alpha, carbonyl);
    oxygen = b.atom("O", { x: 0, y: 1 });
    co = b.bond(carbonyl, oxygen, 2);
    const methyl = b.atom("C", { x: 1, y: 0 });
    b.bond(carbonyl, methyl);
    cn = b.atom("C", { x: 0, y: -2 }, { charge: -1 });
    n = b.atom("N", { x: 0, y: -3 });
    b.bond(cn, n, 3);
  });
  return { mol, carbonyl, oxygen, co, cn, n, alpha, alphaCarbonyl };
}

/** 2-bromopropane beside hydroxide: the E2 textbook pair. */
function bromopropaneAndHydroxide() {
  let c1 = "";
  let c2 = "";
  let br = "";
  let c1c2 = "";
  let c2br = "";
  let o = "";
  const mol = buildMolecule((b) => {
    c1 = b.atom("C", { x: -1, y: 0 });
    c2 = b.atom("C", { x: 0, y: 0.5 });
    c1c2 = b.bond(c1, c2);
    const c3 = b.atom("C", { x: 1, y: 0 });
    b.bond(c2, c3);
    br = b.atom("Br", { x: 0, y: 1.5 });
    c2br = b.bond(c2, br);
    o = b.atom("O", { x: -2, y: -1 }, { charge: -1 });
  });
  return { mol, c1, c2, br, c1c2, c2br, o };
}

/** s-cis-buta-1,3-diene beside ethylene. */
function butadieneAndEthylene() {
  const c: AtomId[] = [];
  const bonds: Record<string, BondId> = {};
  const mol = buildMolecule((b) => {
    for (const [x, y] of [
      [0, 1],
      [0.87, 1.5],
      [1.73, 1],
      [1.73, 0],
      [0.3, -0.5],
      [0, 0],
    ] as const) {
      c.push(b.atom("C", { x, y }));
    }
    bonds["12"] = b.bond(c[0]!, c[1]!, 2);
    bonds["23"] = b.bond(c[1]!, c[2]!);
    bonds["34"] = b.bond(c[2]!, c[3]!, 2);
    bonds["56"] = b.bond(c[4]!, c[5]!, 2);
  });
  return { mol, c, bonds };
}

/** Acetate, CH3-C(=O1)-O2(-). */
function acetate(at = { x: 0, y: 0 }) {
  let c = "";
  let o1 = "";
  let o2 = "";
  let co1 = "";
  let co2 = "";
  const mol = buildMolecule((b) => {
    const methyl = b.atom("C", { x: at.x - 1, y: at.y });
    c = b.atom("C", at);
    b.bond(methyl, c);
    o1 = b.atom("O", { x: at.x + 0.5, y: at.y + 0.87 });
    co1 = b.bond(c, o1, 2);
    o2 = b.atom("O", { x: at.x + 0.5, y: at.y - 0.87 }, { charge: -1 });
    co2 = b.bond(c, o2);
  });
  return { mol, c, o1, o2, co1, co2 };
}

/** `mol` with the aromatic flag of each named bond set to `flag`. */
function withBondFlags(mol: Molecule, bondIds: readonly BondId[], flag: boolean): Molecule {
  const bonds = { ...mol.bonds };
  for (const id of bondIds) bonds[id] = { ...bonds[id]!, aromatic: flag };
  return { ...mol, bonds };
}

/** The same drawing with every aromatic flag, atom and bond, cleared: plain Kekule. */
function unflagged(mol: Molecule): Molecule {
  const cleared = withBondFlags(mol, mol.bondIds, false);
  const atoms = { ...cleared.atoms };
  for (const id of cleared.atomIds) atoms[id] = { ...atoms[id]!, aromatic: false };
  return { ...cleared, atoms };
}

/** Pyridine as an importer leaves it: Kekule orders, every ring bond and atom flagged. */
function flaggedPyridine() {
  const ring: AtomId[] = [];
  const mol = buildMolecule((b) => {
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      ring.push(b.atom(i === 0 ? "N" : "C", { x: Math.cos(angle), y: Math.sin(angle) }, { aromatic: true }));
    }
    for (let i = 0; i < 6; i++) b.bond(ring[i]!, ring[(i + 1) % 6]!, i % 2 === 0 ? 2 : 1);
  });
  return { mol: withBondFlags(mol, mol.bondIds, true), ring };
}

/** 2-pyridone as RDKit flags it: the ring aromatic, C2=O exocyclic and unflagged. */
function flaggedPyridone() {
  const ring: AtomId[] = [];
  let o = "";
  const ringBonds: BondId[] = [];
  const mol = buildMolecule((b) => {
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      ring.push(b.atom(i === 0 ? "N" : "C", { x: Math.cos(angle), y: Math.sin(angle) }, { aromatic: true }));
    }
    // N1-C2, C2-C3 single; C3=C4; C4-C5; C5=C6; C6-N1.
    const orders = [1, 1, 2, 1, 2, 1] as const;
    for (let i = 0; i < 6; i++) ringBonds.push(b.bond(ring[i]!, ring[(i + 1) % 6]!, orders[i]!));
    o = b.atom("O", { x: 1, y: 2 });
    b.bond(ring[1]!, o, 2);
  });
  return { mol: withBondFlags(mol, ringBonds, true), ring, o };
}

/**
 * A carbocation beside a carbon carrying the group that can migrate to it,
 * that group promoted to a real atom when it is a hydrogen:
 *   hydride: 3-methylbutan-2-yl cation, CH3-CH(+)-CH(CH3)2
 *   methyl:  3,3-dimethylbutan-2-yl (pinacolyl) cation, CH3-CH(+)-C(CH3)3
 */
function cationBesideMigratingGroup(group: "hydride" | "methyl") {
  let cation = "";
  let origin = "";
  let migrant = "";
  const drawn = buildMolecule((b) => {
    const c1 = b.atom("C", { x: 0, y: 0 });
    cation = b.atom("C", { x: 1, y: 0.5 }, { charge: 1 });
    b.bond(c1, cation);
    origin = b.atom("C", { x: 2, y: 0 });
    b.bond(cation, origin);
    b.bond(origin, b.atom("C", { x: 3, y: 0.5 }));
    b.bond(origin, b.atom("C", { x: 2, y: -1 }));
    if (group === "methyl") {
      migrant = b.atom("C", { x: 2.5, y: 1 });
      b.bond(origin, migrant);
    }
  });
  let mol = drawn;
  if (group === "hydride") {
    const promoted = promoteImplicitHydrogen(drawn, origin);
    if (!promoted.ok) throw new Error(promoted.reason);
    mol = promoted.molecule;
    migrant = promoted.hydrogenId;
  }
  return { mol, cation, origin, migrant, migrating: bondBetween(mol, origin, migrant)!.id };
}

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

describe("vocabulary", () => {
  it("names the two curly arrows by their barbs, and keeps the resonance arrow out", () => {
    expect(ELECTRON_COUNTS).toEqual(["pair", "single"]);
    const header = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "mechanism.ts"), "utf8");
    expect(header).toMatch(/DOUBLE-BARBED is the two-electron curly arrow/);
    expect(header).toMatch(/SINGLE-BARBED, or FISHHOOK, is the one-electron arrow/);
    expect(header).toMatch(/RESONANCE arrow is a straight DOUBLE-HEADED arrow/);
  });

  it("asks every saturation question of lonePairCount and isOverValent, never bondOrderSum", () => {
    const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "mechanism.ts"), "utf8");
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/bondOrderSum/);
    expect(code).toMatch(/lonePairCount\(/);
    expect(code).toMatch(/isOverValent\(/);
  });
});

// ---------------------------------------------------------------------------
// Named reactions
// ---------------------------------------------------------------------------

describe("named mechanisms give their textbook products and reverse exactly", () => {
  it("SN2 on bromomethane: hydroxide in, bromide out, no charge left on carbon", () => {
    const { mol, c, br, cBr, o } = bromomethaneAndHydroxide();
    const arrows = [pair(lp(o), toAtom(c)), pair(bd(cBr), toAtom(br))];
    const product = expectReverses(mol, arrows);
    expect(order(product, c, o)).toBe(1);
    expect(bondBetween(product, c, br)).toBeUndefined();
    expect([charge(product, c), charge(product, o), charge(product, br)]).toEqual([0, 0, -1]);
    expect(implicitHydrogenCount(product, c)).toBe(3);
    expect(implicitHydrogenCount(product, o)).toBe(1);
    expect(mechanismIssues(mol, arrows)).toEqual([]);
  });

  it("carbonyl addition: cyanide adds to acetone and the oxygen takes the pi pair", () => {
    const { mol, carbonyl, oxygen, co, cn } = acetoneAndCyanide();
    const arrows = [pair(lp(cn), toAtom(carbonyl)), pair(bd(co), toAtom(oxygen))];
    const product = expectReverses(mol, arrows);
    expect(order(product, carbonyl, cn)).toBe(1);
    expect(order(product, carbonyl, oxygen)).toBe(1);
    expect([charge(product, cn), charge(product, carbonyl), charge(product, oxygen)]).toEqual([0, 0, -1]);
    expect(mechanismIssues(mol, arrows)).toEqual([]);
  });

  it("E2 on 2-bromopropane through a promoted hydrogen: propene, water and bromide", () => {
    const { mol, c1, c2, br, c1c2, c2br, o } = bromopropaneAndHydroxide();
    const promoted = promoteImplicitHydrogen(mol, c1);
    if (!promoted.ok) throw new Error(promoted.reason);
    const h = promoted.hydrogenId;
    const arrows = [
      pair(lp(o), toAtom(h)),
      pair(bd(promoted.bondId), toBond(c1c2)),
      pair(bd(c2br), toAtom(br)),
    ];
    const product = expectReverses(promoted.molecule, arrows);
    expect(order(product, c1, c2)).toBe(2);
    expect(order(product, o, h)).toBe(1);
    expect(bondBetween(product, c1, h)).toBeUndefined();
    expect(bondBetween(product, c2, br)).toBeUndefined();
    expect([charge(product, o), charge(product, h), charge(product, br)]).toEqual([0, 0, -1]);
    expect(implicitHydrogenCount(product, c1)).toBe(2);
    expect(mechanismIssues(promoted.molecule, arrows)).toEqual([]);
  });

  it("Diels-Alder: a six-electron cycle of three arrows closes cyclohexene", () => {
    const { mol, c, bonds } = butadieneAndEthylene();
    const [c1, c2, c3, c4, c5, c6] = c as [AtomId, AtomId, AtomId, AtomId, AtomId, AtomId];
    const arrows = [
      pair(bd(bonds["12"]!), toBond(bonds["23"]!)),
      // Aimed at the dienophile's ATOM: the flow rule picks C4, not C3, since
      // C3 already receives the first arrow's pair.
      pair(bd(bonds["34"]!), toAtom(c5)),
      pair(bd(bonds["56"]!), toAtom(c1)),
    ];
    const product = expectReverses(mol, arrows);
    expect(ringCount(product)).toBe(1);
    expect(order(product, c2, c3)).toBe(2);
    for (const [a, b] of [
      [c1, c2],
      [c3, c4],
      [c4, c5],
      [c5, c6],
      [c6, c1],
    ] as const) {
      expect(order(product, a, b), `${a}-${b}`).toBe(1);
    }
    expect(bondBetween(product, c3, c5)).toBeUndefined();
    expect(product.atomIds.map((id) => charge(product, id))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(mechanismIssues(mol, arrows)).toEqual([]);
    // The retro-Diels-Alder is three bond-to-bond shifts, every bond named.
    expect(reverseArrows(mol, arrows).every((a) => a.source.kind === "bond" && a.sink.kind === "bond")).toBe(true);
  });

  it("acetate resonance moves the charge to the other oxygen and never makes a dication", () => {
    const { mol, c, o1, o2, co1, co2 } = acetate();
    const arrows = [pair(lp(o2), toBond(co2)), pair(bd(co1), toAtom(o1))];
    const product = expectReverses(mol, arrows);
    expect([order(product, c, o1), order(product, c, o2)]).toEqual([1, 2]);
    expect([charge(product, o1), charge(product, o2), charge(product, c)]).toEqual([-1, 0, 0]);
    expect(composition(product).netCharge).toBe(-1);
    expect(composition(product)).toEqual(composition(mol));
    expect(mechanismIssues(mol, arrows)).toEqual([]);
  });

  it("heterolysis of t-butyl bromide ionises to a carbocation and bromide, and recombines", () => {
    const { mol, c, br, cBr } = tButylBromide();
    const arrows = [pair(bd(cBr), toAtom(br))];
    const product = expectReverses(mol, arrows);
    expect(bondBetween(product, c, br)).toBeUndefined();
    expect([charge(product, c), charge(product, br)]).toEqual([1, -1]);
    expect(implicitHydrogenCount(product, c)).toBe(0);
    expect(mechanismIssues(mol, arrows)).toEqual([]);
    // The reverse is the bromide's lone pair back onto the cation.
    expect(reverseArrows(mol, arrows)).toEqual([pair(lp(br), toAtom(c))]);
  });

  it("an oxygen donating a lone pair into a new bond becomes O+ (water onto the t-butyl cation)", () => {
    const ionised = applyArrows(tButylBromide().mol, [pair(bd(tButylBromide().cBr), toAtom(tButylBromide().br))]);
    const { c } = tButylBromide();
    const water = addAtom(ionised, { element: "O", pos: { x: 3, y: 0 } });
    const arrows = [pair(lp(water.id), toAtom(c))];
    const product = expectReverses(water.molecule, arrows);
    expect([charge(product, water.id), charge(product, c)]).toEqual([1, 0]);
    expect(implicitHydrogenCount(product, water.id)).toBe(2);
    expect(mechanismIssues(water.molecule, arrows)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The nine cells of the source-to-sink table
// ---------------------------------------------------------------------------

describe("source-to-sink table: one fixture per cell", () => {
  it("lone pair -> atom, not bonded: FORMS a bond (SN2's nucleophile)", () => {
    const { mol, c, o } = bromomethaneAndHydroxide();
    const product = applyArrows(mol, [pair(lp(o), toAtom(c))]);
    expect(order(product, o, c)).toBe(1);
  });

  it("lone pair -> atom already bonded: PROMOTES the bond rather than duplicating it", () => {
    const { mol, carbonyl, oxygen, co, cn } = acetoneAndCyanide();
    const adduct = applyArrows(mol, [pair(lp(cn), toAtom(carbonyl)), pair(bd(co), toAtom(oxygen))]);
    const cc = bondBetween(adduct, carbonyl, cn)!.id;
    // The alkoxide collapses and expels cyanide: the reverse of the addition.
    const arrows = [pair(lp(oxygen), toAtom(carbonyl)), pair(bd(cc), toAtom(cn))];
    const product = expectReverses(adduct, arrows);
    expect(order(product, carbonyl, oxygen)).toBe(2);
    expect(product.bondIds.length).toBe(adduct.bondIds.length - 1);
    expect(product.bondIds.filter((id) => {
      const b = product.bonds[id]!;
      return [b.from, b.to].includes(carbonyl) && [b.from, b.to].includes(oxygen);
    })).toHaveLength(1);
  });

  it("lone pair -> bond at that atom: PROMOTES it (acetate's lone pair into C-O)", () => {
    const { mol, c, o2, co2 } = acetate();
    const product = applyArrows(mol, [pair(lp(o2), toBond(co2))]);
    expect(order(product, c, o2)).toBe(2);
    expect([charge(product, o2), charge(product, c)]).toEqual([0, -1]);
  });

  it("lone pair -> lone pair on another atom: an electron TRANSFER (SET from trimethylamine)", () => {
    let n = "";
    let c = "";
    const mol = buildMolecule((b) => {
      n = b.atom("N", { x: 0, y: 0 });
      for (const [x, y] of [
        [-1, 0],
        [0.5, 0.87],
        [0.5, -0.87],
      ] as const) b.bond(n, b.atom("C", { x, y }));
      c = b.atom("C", { x: 3, y: 0 }, { charge: 1 });
    });
    const arrows = [hook(lp(n), toLp(c))];
    const product = expectReverses(mol, arrows);
    // Me3N.+ and a methyl radical.
    expect([charge(product, n), product.atoms[n]!.radicalElectrons]).toEqual([1, 1]);
    expect([charge(product, c), product.atoms[c]!.radicalElectrons]).toEqual([0, 1]);
    expect(implicitHydrogenCount(product, c)).toBe(3);
    expect(mechanismIssues(mol, arrows)).toEqual([]);
    // A PAIR moved that way is applied and warned: no bond carries it.
    expect(mechanismIssues(mol, [pair(lp(n), toLp(c))])).toMatchObject([
      {
        kind: "electron-transfer",
        severity: "warning",
        bondIds: [],
        message: "Arrow 1 moves a pair from N's lone pairs to C's, through no bond",
      },
    ]);
  });

  it("a pair moved between the lone pairs of two BONDED atoms is warned as such (hydroperoxide's O-O)", () => {
    // HO-O(-): the anion's pair handed straight to the other oxygen moves two
    // charges (O- to O+, O to O2-) and leaves the O-O bond as it was, and the
    // warning says that rather than "not bonded".
    let oh = "";
    let ominus = "";
    let oo = "";
    const mol = buildMolecule((b) => {
      oh = b.atom("O", { x: 0, y: 0 });
      ominus = b.atom("O", { x: 1, y: 0 }, { charge: -1 });
      oo = b.bond(oh, ominus);
    });
    const arrows = [pair(lp(ominus), toLp(oh))];
    const product = expectReverses(mol, arrows);
    expect([charge(product, ominus), charge(product, oh), order(product, oh, ominus)]).toEqual([1, -2, 1]);
    const transfer = mechanismIssues(mol, arrows).find((i) => i.kind === "electron-transfer");
    expect(transfer).toMatchObject({
      severity: "warning",
      atomIds: [ominus, oh],
      bondIds: [oo],
      message: "Arrow 1 moves a pair from O's lone pairs to O's, straight across; the O-O bond between them does not change",
    });
  });

  it("bond -> one of its own atoms: HETEROLYSIS (t-butyl bromide)", () => {
    const { mol, c, br, cBr } = tButylBromide();
    const product = applyArrows(mol, [pair(bd(cBr), toAtom(br))]);
    expect([charge(product, c), charge(product, br)]).toEqual([1, -1]);
  });

  it("bond -> bond sharing an atom: the pair SHIFTS (E2's C-H pair into C=C)", () => {
    const { mol, c1, c2, c1c2 } = bromopropaneAndHydroxide();
    const promoted = promoteImplicitHydrogen(mol, c1);
    if (!promoted.ok) throw new Error(promoted.reason);
    const product = applyArrows(promoted.molecule, [pair(bd(promoted.bondId), toBond(c1c2))]);
    expect(order(product, c1, c2)).toBe(2);
    expect(bondBetween(product, c1, promoted.hydrogenId)).toBeUndefined();
    // The departing proton and the carbon now carrying five bonds' worth.
    expect([charge(product, promoted.hydrogenId), charge(product, c2)]).toEqual([1, -1]);
  });

  it("bond -> lone pair on one of its atoms: heterolysis, identical to aiming at the atom", () => {
    const { mol, cBr, br } = tButylBromide();
    const toTheAtom = applyArrows(mol, [pair(bd(cBr), toAtom(br))]);
    const toThePair = applyArrows(mol, [pair(bd(cBr), toLp(br))]);
    expect(structure(toThePair)).toEqual(structure(toTheAtom));
    expectReverses(mol, [pair(bd(cBr), toLp(br))]);
  });

  it("radical -> atom: two fishhooks recombine two methyl radicals into ethane", () => {
    let a = "";
    let b2 = "";
    const mol = buildMolecule((b) => {
      a = b.atom("C", { x: 0, y: 0 }, { radicalElectrons: 1 });
      b2 = b.atom("C", { x: 1, y: 0 }, { radicalElectrons: 1 });
    });
    const arrows = [hook(rad(a), toAtom(b2)), hook(rad(b2), toAtom(a))];
    const product = expectReverses(mol, arrows);
    expect(order(product, a, b2)).toBe(1);
    expect([product.atoms[a]!.radicalElectrons, product.atoms[b2]!.radicalElectrons]).toEqual([0, 0]);
    expect([implicitHydrogenCount(product, a), implicitHydrogenCount(product, b2)]).toEqual([3, 3]);
    expect(mechanismIssues(mol, arrows)).toEqual([]);
  });

  it("radical -> bond: a t-butoxy radical's beta-scission gives acetone and a methyl radical", () => {
    let o = "";
    let c = "";
    let oc = "";
    let me = "";
    let cMe = "";
    const mol = buildMolecule((b) => {
      c = b.atom("C", { x: 0, y: 0 });
      o = b.atom("O", { x: 0, y: 1 }, { radicalElectrons: 1 });
      oc = b.bond(c, o);
      me = b.atom("C", { x: 1, y: 0 });
      cMe = b.bond(c, me);
      b.bond(c, b.atom("C", { x: -1, y: 0 }));
      b.bond(c, b.atom("C", { x: 0, y: -1 }));
    });
    const arrows = [hook(rad(o), toBond(oc)), hook(bd(cMe), toBond(oc)), hook(bd(cMe), toAtom(me))];
    const product = expectReverses(mol, arrows);
    expect(order(product, c, o)).toBe(2);
    expect(bondBetween(product, c, me)).toBeUndefined();
    expect([product.atoms[o]!.radicalElectrons, product.atoms[me]!.radicalElectrons]).toEqual([0, 1]);
    expect(product.atomIds.every((id) => charge(product, id) === 0)).toBe(true);
    expect(mechanismIssues(mol, arrows)).toEqual([]);
  });

  it("radical -> lone pair: sodium hands its electron to a methyl radical (Na+ and CH3-)", () => {
    let na = "";
    let c = "";
    const mol = buildMolecule((b) => {
      na = b.atom("Na", { x: 0, y: 0 }, { radicalElectrons: 1 });
      c = b.atom("C", { x: 2, y: 0 }, { radicalElectrons: 1 });
    });
    const arrows = [hook(rad(na), toLp(c))];
    const product = expectReverses(mol, arrows);
    expect([charge(product, na), product.atoms[na]!.radicalElectrons]).toEqual([1, 0]);
    // The electron PAIRS with the methyl radical's: a carbanion, not a diradical.
    expect([charge(product, c), product.atoms[c]!.radicalElectrons]).toEqual([-1, 0]);
    expect(implicitHydrogenCount(product, c)).toBe(3);
    expect(mechanismIssues(mol, arrows)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fishhooks and the third-atom cell
// ---------------------------------------------------------------------------

describe("single electrons and a bond's pair aimed at a third atom", () => {
  it("homolysis of bromine with two fishhooks changes radicals, never charges", () => {
    let a = "";
    let b2 = "";
    let bond = "";
    const mol = buildMolecule((b) => {
      a = b.atom("Br", { x: 0, y: 0 });
      b2 = b.atom("Br", { x: 1, y: 0 });
      bond = b.bond(a, b2);
    });
    const arrows = [hook(bd(bond), toAtom(a)), hook(bd(bond), toAtom(b2))];
    const product = expectReverses(mol, arrows);
    expect(bondBetween(product, a, b2)).toBeUndefined();
    expect([charge(product, a), charge(product, b2)]).toEqual([0, 0]);
    expect([product.atoms[a]!.radicalElectrons, product.atoms[b2]!.radicalElectrons]).toEqual([1, 1]);
  });

  it("a bromine radical adds to ethylene: the flow rule pairs it with the NEAR carbon", () => {
    let br = "";
    let c1 = "";
    let c2 = "";
    let cc = "";
    const mol = buildMolecule((b) => {
      br = b.atom("Br", { x: 0, y: 1 }, { radicalElectrons: 1 });
      c1 = b.atom("C", { x: 0, y: 0 });
      c2 = b.atom("C", { x: 1, y: 0 });
      cc = b.bond(c1, c2, 2);
    });
    const arrows = [hook(rad(br), toAtom(c1)), hook(bd(cc), toAtom(br)), hook(bd(cc), toAtom(c2))];
    const product = expectReverses(mol, arrows);
    expect(order(product, br, c1)).toBe(1);
    expect(bondBetween(product, br, c2)).toBeUndefined();
    expect(order(product, c1, c2)).toBe(1);
    expect(product.atoms[c2]!.radicalElectrons).toBe(1);
    expect(mechanismIssues(mol, arrows)).toEqual([]);
  });

  it("E2 with every arrow aimed at an atom still promotes C=C: the proton is taken elsewhere", () => {
    const { mol, c1, c2, br, c2br, o } = bromopropaneAndHydroxide();
    const promoted = promoteImplicitHydrogen(mol, c1);
    if (!promoted.ok) throw new Error(promoted.reason);
    const arrows = [
      pair(lp(o), toAtom(promoted.hydrogenId)),
      pair(bd(promoted.bondId), toAtom(c2)),
      pair(bd(c2br), toAtom(br)),
    ];
    const product = expectReverses(promoted.molecule, arrows);
    expect(order(product, c1, c2)).toBe(2);
    expect(bondBetween(product, promoted.hydrogenId, c2)).toBeUndefined();
  });

  it("the allyl cation's pi pair aimed at the cationic carbon promotes the bond it already has", () => {
    let c1 = "";
    let c2 = "";
    let c3 = "";
    let c12 = "";
    const mol = buildMolecule((b) => {
      c1 = b.atom("C", { x: 0, y: 0 });
      c2 = b.atom("C", { x: 1, y: 0.5 });
      c12 = b.bond(c1, c2, 2);
      c3 = b.atom("C", { x: 2, y: 0 }, { charge: 1 });
      b.bond(c2, c3);
    });
    const arrows = [pair(bd(c12), toAtom(c3))];
    const product = expectReverses(mol, arrows);
    expect([order(product, c1, c2), order(product, c2, c3)]).toEqual([1, 2]);
    expect([charge(product, c1), charge(product, c3)]).toEqual([1, 0]);
    expect(mechanismIssues(mol, arrows)).toEqual([]);
  });

  it("propene's pi pair aimed at HBr's proton does not say which carbon: reported, not applied", () => {
    let c1 = "";
    let c2 = "";
    let c12 = "";
    let h = "";
    let hbr = "";
    let br = "";
    const mol = buildMolecule((b) => {
      c1 = b.atom("C", { x: 0, y: 0 });
      c2 = b.atom("C", { x: 1, y: 0.5 });
      c12 = b.bond(c1, c2, 2);
      b.bond(c2, b.atom("C", { x: 2, y: 0 }));
      h = b.atom("H", { x: 0.5, y: 2 });
      br = b.atom("Br", { x: 0.5, y: 3 });
      hbr = b.bond(h, br);
    });
    const arrows = [pair(bd(c12), toAtom(h)), pair(bd(hbr), toAtom(br))];
    const issues = mechanismIssues(mol, arrows);
    expect(issues[0]).toMatchObject({ kind: "ambiguous-bond-end", arrowIndices: [0], severity: "error" });
    expect(issues[0]!.atomIds).toEqual(expect.arrayContaining([c1, c2, h]));
    // The rest of the step still applies: HBr ionises.
    const product = applyArrows(mol, arrows);
    expect(order(product, c1, c2)).toBe(2);
    expect([charge(product, h), charge(product, br)]).toEqual([1, -1]);
  });

  it("a 1,2-hydride shift drawn to the cation is reported, never applied as an elimination stranding H+", () => {
    // The C3-H pair aimed at C2+. Adjacency alone would promote C2=C3 and leave
    // the hydrogen a bare proton with no arrow receiving it: 2-methylbut-2-ene
    // and H+, a different reaction, reported as clean.
    const { mol, cation, origin, migrant, migrating } = cationBesideMigratingGroup("hydride");
    const arrows = [pair(bd(migrating), toAtom(cation))];
    const issues = mechanismIssues(mol, arrows);
    expect(issues).toMatchObject([{ kind: "ambiguous-bond-end", arrowIndices: [0], severity: "error" }]);
    expect(issues[0]!.atomIds).toEqual(expect.arrayContaining([origin, migrant, cation]));
    expect(applyArrows(mol, arrows)).toBe(mol);
  });

  it("a Wagner-Meerwein methyl shift drawn to the cation is reported, never applied as a free methyl cation", () => {
    const { mol, cation, migrating } = cationBesideMigratingGroup("methyl");
    const arrows = [pair(bd(migrating), toAtom(cation))];
    expect(kinds(mol, arrows)).toEqual(["ambiguous-bond-end"]);
    expect(applyArrows(mol, arrows)).toBe(mol);
  });

  it("the elimination is spelled as the C-H pair into the C-C bond: 2-methylbut-2-ene and H+, and back", () => {
    const { mol, cation, origin, migrant, migrating } = cationBesideMigratingGroup("hydride");
    const arrows = [pair(bd(migrating), toBond(bondBetween(mol, cation, origin)!.id))];
    const product = expectReverses(mol, arrows);
    expect(order(product, cation, origin)).toBe(2);
    expect(bondBetween(product, origin, migrant)).toBeUndefined();
    expect([charge(product, cation), charge(product, origin), charge(product, migrant)]).toEqual([0, 0, 1]);
    expect(mechanismIssues(mol, arrows)).toEqual([]);
  });

  it("a pinacol shift, with the oxygen's push drawn, lets flow move the methyl: protonated pinacolone", () => {
    // (CH3)2C(+)-C(CH3)2-OH. The oxygen's lone pair into C3-O makes C3 an end
    // that receives electrons, so the migrating C3-Me pair bonds the METHYL to
    // the cation; nothing is left to adjacency.
    let cation = "";
    let c3 = "";
    let me = "";
    let o = "";
    const mol = buildMolecule((b) => {
      cation = b.atom("C", { x: 0, y: 0 }, { charge: 1 });
      b.bond(cation, b.atom("C", { x: -1, y: 0.5 }));
      b.bond(cation, b.atom("C", { x: -1, y: -0.5 }));
      c3 = b.atom("C", { x: 1, y: 0 });
      b.bond(cation, c3);
      b.bond(c3, b.atom("C", { x: 2, y: -0.5 }));
      me = b.atom("C", { x: 1, y: 1 });
      b.bond(c3, me);
      o = b.atom("O", { x: 2, y: 0.5 });
      b.bond(c3, o);
    });
    const arrows = [
      pair(bd(bondBetween(mol, c3, me)!.id), toAtom(cation)),
      pair(lp(o), toBond(bondBetween(mol, c3, o)!.id)),
    ];
    const product = expectReverses(mol, arrows);
    expect(order(product, me, cation)).toBe(1);
    expect(bondBetween(product, me, c3)).toBeUndefined();
    expect(order(product, c3, o)).toBe(2);
    expect([charge(product, cation), charge(product, c3), charge(product, me), charge(product, o)]).toEqual([
      0, 0, 0, 1,
    ]);
    expect(implicitHydrogenCount(product, o)).toBe(1);
    expect(mechanismIssues(mol, arrows)).toEqual([]);
  });

  describe("hydrogen-atom abstraction from methane by a bromine radical", () => {
    function methaneAndBromine() {
      let c = "";
      let br = "";
      const drawn = buildMolecule((b) => {
        c = b.atom("C", { x: 0, y: 0 });
        br = b.atom("Br", { x: 3, y: 0 }, { radicalElectrons: 1 });
      });
      const promoted = promoteImplicitHydrogen(drawn, c);
      if (!promoted.ok) throw new Error(promoted.reason);
      return { mol: promoted.molecule, c, br, h: promoted.hydrogenId, ch: promoted.bondId };
    }

    it("the C-H electron aimed at the bromine is resolved by flow: HBr and a methyl radical", () => {
      const { mol, c, br, h, ch } = methaneAndBromine();
      const arrows = [hook(rad(br), toAtom(h)), hook(bd(ch), toAtom(br)), hook(bd(ch), toAtom(c))];
      const product = expectReverses(mol, arrows);
      expect(order(product, h, br)).toBe(1);
      expect(bondBetween(product, c, h)).toBeUndefined();
      expect([product.atoms[c]!.radicalElectrons, product.atoms[br]!.radicalElectrons]).toEqual([1, 0]);
      expect(product.atomIds.every((id) => charge(product, id) === 0)).toBe(true);
      expect(mechanismIssues(mol, arrows)).toEqual([]);
    });

    it("the textbook spelling, the C-H electron aimed at its own H, is half a homolysis: the Br arrow is refused", () => {
      // The sinks cannot name the incipient H-Br bond, so an electron aimed at
      // the H stays on the H, and the bromine's lone electron would be half a
      // bond. That arrow is skipped and named; the C-H homolysis applies.
      const { mol, c, br, h, ch } = methaneAndBromine();
      const arrows = [hook(rad(br), toAtom(h)), hook(bd(ch), toAtom(h)), hook(bd(ch), toAtom(c))];
      expect(mechanismIssues(mol, arrows)).toMatchObject([
        { kind: "unpaired-bond-electron", arrowIndices: [0], label: "half a bond" },
      ]);
      const product = applyArrows(mol, arrows);
      expect(bondBetween(product, h, br)).toBeUndefined();
      expect(bondBetween(product, c, h)).toBeUndefined();
      expect(
        [c, h, br].map((id) => product.atoms[id]!.radicalElectrons),
      ).toEqual([1, 1, 1]);
    });
  });

  it("a shift whose re-formed bond the flow rule would misread is reversed as two arrows", () => {
    // Cyclopropane's S-Z pair shifted into S-W, breaking S-Z. Aimed back at Z,
    // Z's ring bond to W would promote W-Z; the reverse spells it as a
    // heterolysis to S and S's lone pair into S-Z instead.
    let s = "";
    let z = "";
    let w = "";
    let sz = "";
    let sw = "";
    const mol = buildMolecule((b) => {
      s = b.atom("C", { x: 0, y: 0 });
      z = b.atom("C", { x: 1, y: 0 });
      w = b.atom("C", { x: 0.5, y: 0.87 });
      sz = b.bond(s, z);
      sw = b.bond(s, w);
      b.bond(z, w);
    });
    const arrows = [pair(bd(sz), toBond(sw))];
    const product = expectReverses(mol, arrows);
    expect(order(product, s, w)).toBe(2);
    expect([charge(product, z), charge(product, w)]).toEqual([1, -1]);
    expect(reverseArrows(mol, arrows)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// The whole step, never arrow by arrow
// ---------------------------------------------------------------------------

describe("the whole step at once", () => {
  it("SN2 folded one arrow at a time passes through a carbon the step never has", () => {
    const { mol, c, br, cBr, o } = bromomethaneAndHydroxide();
    const arrows = [pair(lp(o), toAtom(c)), pair(bd(cBr), toAtom(br))];
    const intermediate = applyArrows(mol, [arrows[0]!]);
    // Five bonds' worth on carbon, disguised as a carbanion that lost two H.
    expect(kinds(mol, [arrows[0]!])).toContain("hydrogens-changed");
    expect(implicitHydrogenCount(intermediate, c)).toBe(1);
    // Applied together, nothing is ever wrong.
    expect(mechanismIssues(mol, arrows)).toEqual([]);
  });

  it("a step that changes nothing returns the molecule itself", () => {
    const { mol } = bromomethaneAndHydroxide();
    expect(applyArrows(mol, [])).toBe(mol);
    const { c } = bromomethaneAndHydroxide();
    // A lone pair the carbon does not have: skipped, so nothing changes.
    expect(applyArrows(mol, [pair(lp(c), toAtom("a4"))])).toBe(mol);
  });

  it("keeps species joins and stereo groups, which name atoms the step never deletes", () => {
    const { mol, c, br, cBr, o } = bromomethaneAndHydroxide();
    const joined: Molecule = { ...mol, speciesJoins: [{ atomIds: [c, o] }] };
    const product = applyArrows(joined, [pair(lp(o), toAtom(c)), pair(bd(cBr), toAtom(br))]);
    expect(product.speciesJoins).toEqual([{ atomIds: [c, o] }]);
  });
});

// ---------------------------------------------------------------------------
// Bad arrows: applied and reported, or skipped and reported
// ---------------------------------------------------------------------------

describe("bad arrows are reported, never refused as a set", () => {
  it("two arrows claiming bromomethane's one C-Br pair: a conflict, applied once", () => {
    const { mol, c, br, cBr, o } = bromomethaneAndHydroxide();
    const arrows = [pair(lp(o), toAtom(c)), pair(bd(cBr), toAtom(br)), pair(bd(cBr), toAtom(br))];
    const issues = mechanismIssues(mol, arrows);
    expect(issues.map((i) => [i.kind, i.arrowIndices])).toEqual([["electron-conflict", [2, 1]]]);
    const product = applyArrows(mol, arrows);
    expect(charge(product, br)).toBe(-1);
    expect(structure(product)).toEqual(structure(applyArrows(mol, arrows.slice(0, 2))));
  });

  it("two arrows from ammonia's single lone pair: the second is a conflict", () => {
    let n = "";
    let h1 = "";
    let h2 = "";
    const mol = buildMolecule((b) => {
      n = b.atom("N", { x: 0, y: 0 });
      h1 = b.atom("H", { x: 2, y: 0 }, { charge: 1 });
      h2 = b.atom("H", { x: -2, y: 0 }, { charge: 1 });
    });
    const arrows = [pair(lp(n), toAtom(h1)), pair(lp(n), toAtom(h2))];
    expect(kinds(mol, arrows)).toEqual(["electron-conflict"]);
    const product = applyArrows(mol, arrows);
    expect(charge(product, n)).toBe(1);
    expect(bondBetween(product, n, h2)).toBeUndefined();
  });

  it("a double-barbed arrow from a carbon with no lone pair is meaningless, not a carbanion", () => {
    let c = "";
    let h = "";
    const mol = buildMolecule((b) => {
      c = b.atom("C", { x: 0, y: 0 });
      h = b.atom("H", { x: 2, y: 0 }, { charge: 1 });
    });
    const arrows = [pair(lp(c), toAtom(h))];
    expect(mechanismIssues(mol, arrows)).toMatchObject([
      { kind: "no-lone-pair", atomId: c, arrowIndices: [0], severity: "error", label: "no lone pair" },
    ]);
    expect(applyArrows(mol, arrows)).toBe(mol);
  });

  it("names what is wrong with each malformed arrow, and the prototype does not resolve an id", () => {
    const { mol, c, br, cBr, o } = bromomethaneAndHydroxide();
    expect(kinds(mol, [pair(lp(o), toAtom(o))])).toEqual(["self-target"]);
    expect(kinds(mol, [pair(bd(cBr), toBond(cBr))])).toEqual(["self-target"]);
    expect(kinds(mol, [pair(lp(o), toBond(cBr))])).toEqual(["disconnected"]);
    expect(kinds(mol, [pair(bd(cBr), toLp(o))])).toEqual(["disconnected"]);
    expect(kinds(mol, [pair(lp("constructor"), toAtom(c))])).toEqual(["unknown-reference"]);
    expect(kinds(mol, [pair(bd("toString"), toAtom(br))])).toEqual(["unknown-reference"]);
    expect(kinds(mol, [pair(rad(o), toAtom(c))])).toEqual(["pair-from-radical"]);
    expect(kinds(mol, [hook(rad(o), toLp(c))])).toEqual(["no-radical"]);
  });

  it("an aromatic-flagged bond has no order to consume; the Kekule bond at the same place does", () => {
    const flagged = buildMolecule((b) => {
      const ring: AtomId[] = [];
      for (let i = 0; i < 6; i++) {
        ring.push(b.atom("C", { x: Math.cos(i), y: Math.sin(i) }, { aromatic: true }));
      }
      for (let i = 0; i < 6; i++) b.bond(ring[i]!, ring[(i + 1) % 6]!, i % 2 === 0 ? 2 : 1);
    });
    const withFlags: Molecule = {
      ...flagged,
      bonds: Object.fromEntries(
        flagged.bondIds.map((id) => [id, { ...flagged.bonds[id]!, aromatic: true }]),
      ),
    };
    const [first, second] = [flagged.bondIds[0]!, flagged.bondIds[1]!];
    const arrows = [pair(bd(first), toBond(second))];
    expect(kinds(withFlags, arrows)).toEqual(["aromatic-bond"]);
    expect(applyArrows(withFlags, arrows)).toBe(withFlags);
    expect(applyArrows(flagged, arrows)).not.toBe(flagged);
  });

  it("an aromatic-flagged bond an arrow reaches through an ATOM sink is refused as well (pyridine's N)", () => {
    // An importer's pyridine: every ring bond flagged. Aimed at a ring
    // neighbour's atom, the nitrogen's lone pair would promote the flagged
    // N-C bond without naming it — to a triple bond on one side.
    const { mol, ring } = flaggedPyridine();
    const n = ring[0]!;
    for (const neighbour of [ring[1]!, ring[5]!]) {
      const arrows = [pair(lp(n), toAtom(neighbour))];
      const issues = mechanismIssues(mol, arrows);
      expect(issues.map((i) => i.kind), neighbour).toEqual(["aromatic-bond"]);
      expect(issues[0]!.bondIds).toEqual([bondBetween(mol, n, neighbour)!.id]);
      expect(applyArrows(mol, arrows)).toBe(mol);
    }
  });

  it("a third-atom arrow that adjacency lands on an aromatic-flagged ring bond is refused (2-pyridone's C=O)", () => {
    // RDKit flags 2-pyridone's ring aromatic and keeps C2=O exocyclic. The
    // C=O pi pair aimed at N1 resolves by adjacency to the flagged C2-N1 bond.
    const { mol, ring, o } = flaggedPyridone();
    const [n1, c2] = [ring[0]!, ring[1]!];
    const co = bondBetween(mol, c2, o)!.id;
    const arrows = [pair(bd(co), toAtom(n1))];
    const issues = mechanismIssues(mol, arrows);
    expect(issues.map((i) => [i.kind, i.bondIds])).toEqual([["aromatic-bond", [bondBetween(mol, n1, c2)!.id]]]);
    expect(applyArrows(mol, arrows)).toBe(mol);
    // The same drawing with the flags cleared is an ordinary allyl-type shift.
    const kekule = unflagged(mol);
    const product = expectReverses(kekule, arrows);
    expect([order(product, c2, o), order(product, n1, c2)]).toEqual([1, 2]);
  });

  it("a bond past triple is refused; a lone fishhook into a bond leaves half a bond and is refused", () => {
    let c = "";
    let n = "";
    let cn = "";
    const hcn = buildMolecule((b) => {
      c = b.atom("C", { x: 0, y: 0 });
      n = b.atom("N", { x: 1, y: 0 });
      cn = b.bond(c, n, 3);
    });
    expect(kinds(hcn, [pair(lp(n), toBond(cn))])).toEqual(["bond-order-overflow"]);
    let a = "";
    let b2 = "";
    const radicals = buildMolecule((b) => {
      a = b.atom("C", { x: 0, y: 0 }, { radicalElectrons: 1 });
      b2 = b.atom("C", { x: 1, y: 0 }, { radicalElectrons: 1 });
    });
    expect(kinds(radicals, [hook(rad(a), toAtom(b2))])).toEqual(["unpaired-bond-electron"]);
  });

  it("hydroxide pushed into t-butyl bromide's carbon with no leaving group: applied, over-valent, reported", () => {
    const { mol, c } = tButylBromide();
    const withBase = addAtom(mol, { element: "O", pos: { x: -3, y: 0 }, charge: -1 });
    const arrows = [pair(lp(withBase.id), toAtom(c))];
    const product = applyArrows(withBase.molecule, arrows);
    // Five bonds on a C-: the pentavalent carbon draws, and is reported.
    expect(charge(product, c)).toBe(-1);
    expect(product.bondIds).toHaveLength(mol.bondIds.length + 1);
    expect(mechanismIssues(withBase.molecule, arrows)).toMatchObject([
      { kind: "product-over-valent", atomId: c, arrowIndices: [0], severity: "error" },
    ]);
  });

  it("moves a pinned lone-pair count with the step, and back", () => {
    const { mol, c, o1, o2, co1, co2 } = acetate();
    const pinned: Molecule = {
      ...mol,
      atoms: { ...mol.atoms, [o2]: { ...mol.atoms[o2]!, lonePairs: 3 } },
    };
    const arrows = [pair(lp(o2), toBond(co2)), pair(bd(co1), toAtom(o1))];
    const product = expectReverses(pinned, arrows);
    expect(product.atoms[o2]!.lonePairs).toBe(2);
    expect(product.atoms[o1]!.lonePairs).toBeUndefined();
    void c;
  });
});

// ---------------------------------------------------------------------------
// Hydrogens: heavy atoms, drawn H and derived H compared separately
// ---------------------------------------------------------------------------

describe("hydrogens are counted in three piles", () => {
  it("SN2 conserves heavy atoms, drawn hydrogens and derived hydrogens, each on its own", () => {
    const { mol, c, br, cBr, o } = bromomethaneAndHydroxide();
    const product = applyArrows(mol, [pair(lp(o), toAtom(c)), pair(bd(cBr), toAtom(br))]);
    expect(composition(product)).toEqual(composition(mol));
    expect(composition(mol)).toEqual({
      heavyAtoms: { C: 1, Br: 1, O: 1 },
      hydrogenAtoms: 0,
      implicitHydrogens: 4,
      netCharge: -1,
    });
  });

  it("MASKS: the forgotten leaving-group arrow reads as a clean carbanion; the derived count catches it", () => {
    const { mol, c, o } = bromomethaneAndHydroxide();
    const arrows = [pair(lp(o), toAtom(c))];
    const product = applyArrows(mol, arrows);
    // Valence sees nothing: C- with two bonds and one hydrogen is fine.
    expect(valenceIssues(product)).toEqual([]);
    // Heavy atoms and drawn H are untouched; the derived pile lost two.
    const before = composition(mol);
    const after = composition(product);
    expect(after.heavyAtoms).toEqual(before.heavyAtoms);
    expect(after.hydrogenAtoms).toBe(before.hydrogenAtoms);
    expect(after.implicitHydrogens - before.implicitHydrogens).toBe(-2);
    expect(mechanismIssues(mol, arrows)).toMatchObject([
      { kind: "hydrogens-changed", atomId: c, arrowIndices: [0], label: "C: H 3 to 1" },
    ]);
  });

  it("FAKES: across a promotion the derived pile drops by one though no hydrogen was lost", () => {
    const { mol, c1, c2, br, c1c2, c2br, o } = bromopropaneAndHydroxide();
    const promoted = promoteImplicitHydrogen(mol, c1);
    if (!promoted.ok) throw new Error(promoted.reason);
    const arrows = [
      pair(lp(o), toAtom(promoted.hydrogenId)),
      pair(bd(promoted.bondId), toBond(c1c2)),
      pair(bd(c2br), toAtom(br)),
    ];
    const product = applyArrows(promoted.molecule, arrows);
    const drawn = composition(mol);
    const after = composition(product);
    // Against the UNPROMOTED drawing, a derived-only comparison calls one
    // hydrogen lost. It moved to the drawn pile; the total is conserved.
    expect(after.implicitHydrogens - drawn.implicitHydrogens).toBe(-1);
    expect(after.hydrogenAtoms - drawn.hydrogenAtoms).toBe(1);
    expect(after.heavyAtoms).toEqual(drawn.heavyAtoms);
    // The step itself — its own input against its own output — is clean.
    expect(mechanismIssues(promoted.molecule, arrows)).toEqual([]);
    expect(composition(product)).toEqual(composition(promoted.molecule));
    void c2;
  });

  it("a deprotonation drawn onto a promoted hydrogen: acetone's enolate, and back", () => {
    const { mol, alpha, carbonyl, oxygen, co, alphaCarbonyl } = acetoneAndCyanide();
    const base = addAtom(mol, { element: "O", pos: { x: -3, y: 0 }, charge: -1 });
    const promoted = promoteImplicitHydrogen(base.molecule, alpha);
    if (!promoted.ok) throw new Error(promoted.reason);
    const arrows = [
      pair(lp(base.id), toAtom(promoted.hydrogenId)),
      pair(bd(promoted.bondId), toBond(alphaCarbonyl)),
      pair(bd(co), toAtom(oxygen)),
    ];
    const product = expectReverses(promoted.molecule, arrows);
    expect([order(product, alpha, carbonyl), order(product, carbonyl, oxygen)]).toEqual([2, 1]);
    expect([charge(product, oxygen), charge(product, base.id)]).toEqual([-1, 0]);
    expect(mechanismIssues(promoted.molecule, arrows)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Resonance forms against reaction arrows
// ---------------------------------------------------------------------------

describe("two structures joined by a straight arrow", () => {
  function twoStructures(second: "acetate" | "aceticAcid") {
    const a = acetate();
    const b = acetate({ x: 5, y: 0 });
    let mol: Molecule = a.mol;
    // Graft the second drawing in with fresh ids.
    const offset = mol.nextId;
    const rename = (id: string) => `${id[0]}${Number(id.slice(1)) + offset}`;
    const atoms = { ...mol.atoms };
    const bonds = { ...mol.bonds };
    for (const id of b.mol.atomIds) {
      const atom = b.mol.atoms[id]!;
      atoms[rename(id)] = { ...atom, id: rename(id), charge: second === "aceticAcid" ? 0 : atom.charge };
    }
    for (const id of b.mol.bondIds) {
      const bond = b.mol.bonds[id]!;
      bonds[rename(id)] = { ...bond, id: rename(id), from: rename(bond.from), to: rename(bond.to) };
    }
    mol = {
      atoms,
      bonds,
      atomIds: [...mol.atomIds, ...b.mol.atomIds.map(rename)],
      bondIds: [...mol.bondIds, ...b.mol.bondIds.map(rename)],
      nextId: offset + b.mol.nextId,
    };
    return { mol, left: a.c, right: rename(b.c) };
  }

  it("two drawings of acetate are resonance forms: one formula, one charge", () => {
    const { mol, left, right } = twoStructures("acetate");
    expect(speciesRelationIssues(mol, "resonance", [left], [right])).toEqual([]);
  });

  it("acetate beside acetic acid is reported as a resonance pair, and not as a reaction", () => {
    const { mol, left, right } = twoStructures("aceticAcid");
    expect(speciesRelationIssues(mol, "resonance", [left], [right]).map((i) => i.kind)).toEqual([
      "resonance-formula-differs",
      "resonance-charge-differs",
    ]);
    expect(speciesRelationIssues(mol, "resonance", [left], [right])[0]!.message).toBe(
      "Resonance forms must have one formula; these are C2H3O2 and C2H4O2",
    );
    // A reaction arrow routinely leaves a by-product undrawn: never checked.
    expect(speciesRelationIssues(mol, "reaction", [left], [right])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Sugars and a nucleoside, from the checked-in fixtures
// ---------------------------------------------------------------------------

describe("real molecules keep every configuration the step does not touch", () => {
  function letters(mol: Molecule, atomIds: readonly AtomId[]): (string | undefined)[] {
    return atomIds.map((id) => cipDescriptor(mol, id)?.kind);
  }

  /** Each centre's parity against the ligand order it had before, read after. */
  function paritiesKept(before: Molecule, after: Molecule, atomIds: readonly AtomId[]): boolean[] {
    const was = stereoConfig(before);
    const now = stereoConfig(after);
    return atomIds.map((id) => {
      const centre = was.centres.find((c) => c.atomId === id)!;
      if (centre.reading.kind !== "specified") throw new Error(`${id} has no configuration to keep`);
      const later = now.centres.find((c) => c.atomId === id);
      return later !== undefined && parityAgainst(later, ligandRefs(centre)) === centre.reading.parity;
    });
  }

  it("beta-D-glucopyranose opens to the aldehyde and closes back, anomer included", () => {
    const pyranose = load("beta-d-glucopyranose.mol");
    // O1 is a6, C1 a5, ring O5 a4; C2-C5 are a7, a9, a11, a3.
    const base = addAtom(pyranose, { element: "O", pos: { x: 6, y: 0 }, charge: -1 });
    const promoted = promoteImplicitHydrogen(base.molecule, "a6");
    if (!promoted.ok) throw new Error(promoted.reason);
    const mol = promoted.molecule;
    const centres = ["a3", "a5", "a7", "a9", "a11"];
    // Non-vacuous: every centre resolves before anything is compared.
    expect(letters(mol, centres)).toEqual(["R", "R", "R", "S", "S"]);

    const c1o1 = bondBetween(mol, "a5", "a6")!.id;
    const c1o5 = bondBetween(mol, "a5", "a4")!.id;
    const arrows = [
      pair(lp(base.id), toAtom(promoted.hydrogenId)),
      pair(bd(promoted.bondId), toBond(c1o1)),
      pair(bd(c1o5), toAtom("a4")),
    ];
    const open = expectReverses(mol, arrows);
    expect(ringCount(open)).toBe(0);
    expect(order(open, "a5", "a6")).toBe(2);
    expect(charge(open, "a4")).toBe(-1);
    expect(mechanismIssues(mol, arrows)).toEqual([]);
    // C2-C5 keep their parity against the same four ligands; their LETTERS
    // are not asserted, since C5's substituents changed.
    expect(paritiesKept(mol, open, ["a7", "a9", "a11", "a3"])).toEqual([true, true, true, true]);

    // And back: the C1-O1 wedge survived the double bond, so beta returns.
    const closed = applyArrows(open, reverseArrows(mol, arrows));
    expect(letters(closed, centres)).toEqual(["R", "R", "R", "S", "S"]);
  });

  it("D-ribose closes to a furanose whose new anomeric centre states no configuration", () => {
    const ribose = load("d-ribose-open.mol");
    // O1= a1, C1 a2, C2 a3, C3 a5, C4 a7 with its O4 a8.
    expect(letters(ribose, ["a3", "a5", "a7"])).toEqual(["R", "R", "R"]);
    const arrows = [pair(lp("a8"), toAtom("a2")), pair(bd(bondBetween(ribose, "a1", "a2")!.id), toAtom("a1"))];
    const furanose = expectReverses(ribose, arrows);
    expect(ringCount(furanose)).toBe(1);
    expect([charge(furanose, "a8"), charge(furanose, "a1")]).toEqual([1, -1]);
    expect(mechanismIssues(ribose, arrows)).toEqual([]);
    expect(paritiesKept(ribose, furanose, ["a3", "a5", "a7"])).toEqual([true, true, true]);
    // Attack on a planar carbonyl gives both anomers; the bond it forms is
    // unmarked, so C1 is a centre with no stated configuration, not alpha.
    const c1 = stereoConfig(furanose).centres.find((c) => c.atomId === "a2");
    expect(c1?.reading.kind).toBe("undetermined");
  });

  it("adenosine's depurination reverses to adenosine with C1' left unstated, by design", () => {
    const adenosine = load("adenosine.mol");
    // C1' a11, O4' a12, N9 a10; C2'-C4' are a18, a16, a13.
    const centres = ["a11", "a13", "a16", "a18"];
    expect(letters(adenosine, centres)).toEqual(["R", "R", "S", "R"]);
    const c1o4 = bondBetween(adenosine, "a11", "a12")!.id;
    const c1n9 = bondBetween(adenosine, "a11", "a10")!.id;
    const arrows = [pair(lp("a12"), toBond(c1o4)), pair(bd(c1n9), toAtom("a10"))];
    const oxocarbenium = applyArrows(adenosine, arrows);
    expect([order(oxocarbenium, "a11", "a12"), charge(oxocarbenium, "a12"), charge(oxocarbenium, "a10")]).toEqual([
      2, 1, -1,
    ]);
    expect(mechanismIssues(adenosine, arrows)).toEqual([]);

    const back = applyArrows(oxocarbenium, reverseArrows(adenosine, arrows));
    // Everything but the hash on the glycosidic bond, which was broken: an
    // SN1 ion pair re-forms from either face.
    expect(structure(back)).toEqual(structure(setBondStereo(adenosine, c1n9, "none")));
    expect(letters(back, ["a13", "a16", "a18"])).toEqual(["R", "S", "R"]);
    expect(cipDescriptor(back, "a11")?.kind).toBe("undetermined");
  });
});

// ---------------------------------------------------------------------------
// Reversal as a property
// ---------------------------------------------------------------------------

describe("reversal is total", () => {
  /** A small deterministic generator, so a failure names its seed. */
  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  const molecules: readonly (() => Molecule)[] = [
    () => bromomethaneAndHydroxide().mol,
    () => tButylBromide().mol,
    () => acetoneAndCyanide().mol,
    () => butadieneAndEthylene().mol,
    () => acetate().mol,
    () => bromopropaneAndHydroxide().mol,
    () =>
      buildMolecule((b) => {
        const o = b.atom("O", { x: 0, y: 1 }, { radicalElectrons: 1 });
        const c = b.atom("C", { x: 0, y: 0 });
        b.bond(c, o);
        b.bond(c, b.atom("C", { x: 1, y: 0 }));
        b.bond(c, b.atom("C", { x: -1, y: 0 }));
        b.atom("C", { x: 3, y: 0 }, { radicalElectrons: 1 });
      }),
  ];

  it("every step that keeps its derived hydrogens comes back to its reactant, over 2000 random steps", () => {
    const rand = lcg(20260929);
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
    let admittedSomething = 0;
    let exact = 0;
    const trials = 2000;
    for (let trial = 0; trial < trials; trial++) {
      const mol = pick(molecules)();
      const sources: ElectronSource[] = [
        ...mol.atomIds.flatMap((id) => [lp(id), rad(id)]),
        ...mol.bondIds.map((id) => bd(id)),
      ];
      const sinks: ElectronSink[] = [
        ...mol.atomIds.flatMap((id) => [toAtom(id), toLp(id)]),
        ...mol.bondIds.map((id) => toBond(id)),
      ];
      const arrows: ElectronMove[] = [];
      const count = 1 + Math.floor(rand() * 4);
      for (let i = 0; i < count; i++) {
        arrows.push({ electrons: rand() < 0.7 ? "pair" : "single", source: pick(sources), sink: pick(sinks) });
      }
      const product = applyArrows(mol, arrows);
      if (product === mol) continue;
      admittedSomething++;
      const reverse = reverseArrows(mol, arrows);
      // The documented residual: where the step itself changed a derived
      // hydrogen count, valence reads part of a delivered pair as hydrogens,
      // and the reverse can find that pair missing. It is reported.
      if (kinds(mol, arrows).includes("hydrogens-changed")) continue;
      exact++;
      const refused = mechanismIssues(product, reverse).filter((i) => REFUSALS.has(i.kind));
      expect(refused, `trial ${trial}`).toEqual([]);
      expect(structure(applyArrows(product, reverse)), `trial ${trial}`).toEqual(structure(mol));
    }
    // Not vacuous: a random arrow is usually refused, but hundreds of these
    // steps change the molecule, and most of those keep their hydrogens.
    // (Measured at 667 and 255 of 2000.)
    expect(admittedSomething).toBeGreaterThan(500);
    expect(exact).toBeGreaterThan(200);
  });

  it("names the residual: a pair valence reads back as hydrogens is not there to reverse", () => {
    // t-butyl bromide's central carbon keeps one methyl's pair and loses
    // another's: a carbene by bookkeeping, a CH2 to valence.
    const { mol, c, methyls } = tButylBromide();
    const [m1, , m3] = methyls as [AtomId, AtomId, AtomId];
    const arrows = [
      pair(bd(bondBetween(mol, c, m1)!.id), toLp(m1)),
      pair(bd(bondBetween(mol, c, m3)!.id), toAtom(c)),
    ];
    expect(kinds(mol, arrows)).toContain("hydrogens-changed");
    const product = applyArrows(mol, arrows);
    expect(kinds(product, reverseArrows(mol, arrows))).toContain("no-lone-pair");
  });
});
