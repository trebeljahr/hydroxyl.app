import { describe, expect, it } from "vitest";

import { isAromaticAtom } from "./aromatic.js";
import { buildMolecule } from "./builders.js";
import { writeCdxml } from "./cdxml-write.js";
import { extractFragment } from "./fragment.js";
import { elementCounts, molecularFormula } from "./formula.js";
import { chemistryIssues } from "./issues.js";
import { drawnLonePairs } from "./lewis.js";
import { readMolblock } from "./molblock-read.js";
import { MolblockDativeBondError, writeMolblock } from "./molblock-write.js";
import { requireBond } from "./molecule.js";
import {
  flipBond,
  setBondBold,
  setBondDative,
  setBondOrder,
  setExplicitHydrogenCount,
} from "./ops.js";
import { species } from "./species.js";
import type { AtomId, BondId, Molecule } from "./types.js";
import { implicitHydrogenCount } from "./valence.js";
import { vec } from "./vec.js";

/**
 * Dative and bold bonds (decision 226). A dative bond is chemistry — it moves
 * hydrogens and joins species — and a bold bond is not. The fixtures are real
 * compounds: the ammonia–borane adduct, cisplatin, pyridine bound to platinum.
 */

interface Adduct {
  readonly molecule: Molecule;
  readonly n: AtomId;
  readonly b: AtomId;
  readonly bond: BondId;
}

/** H3N->BH3 as drawn: N and B with a dative bond, hydrogens implicit. */
function ammoniaBorane(): Adduct {
  let n = "";
  let b = "";
  let bond = "";
  const plain = buildMolecule((m) => {
    n = m.atom("N", vec(0, 0));
    b = m.atom("B", vec(1, 0));
    bond = m.bond(n, b);
  });
  return { molecule: setBondDative(plain, bond, true), n, b, bond };
}

/** cis-[PtCl2(NH3)2], both ammines dative N->Pt. */
function cisplatin(): { molecule: Molecule; pt: AtomId; ammines: AtomId[]; datives: BondId[] } {
  let pt = "";
  const ammines: AtomId[] = [];
  const datives: BondId[] = [];
  let molecule = buildMolecule((m) => {
    pt = m.atom("Pt", vec(0, 0));
    m.bond(m.atom("Cl", vec(-1, 0)), pt);
    m.bond(m.atom("Cl", vec(0, -1)), pt);
    for (const pos of [vec(1, 0), vec(0, 1)]) {
      const n = m.atom("N", pos);
      ammines.push(n);
      datives.push(m.bond(n, pt));
    }
  });
  for (const id of datives) molecule = setBondDative(molecule, id, true);
  return { molecule, pt, ammines, datives };
}

describe("dative bonds: valence", () => {
  it("leaves the donor's hydrogens alone — ammonia stays NH3", () => {
    const { molecule, n } = ammoniaBorane();
    expect(implicitHydrogenCount(molecule, n)).toBe(3);
  });

  it("charges the acceptor 1, as RDKit does — a drawn N->B leaves BH2", () => {
    // Measured on RDKit MinimalLib: `N->B` reads as NH3 and BH2, and
    // `[NH3]->[BH3]` is refused, because boron's only valence is 3.
    const { molecule, b } = ammoniaBorane();
    expect(implicitHydrogenCount(molecule, b)).toBe(2);
    expect(molecularFormula(molecule)).toBe("BH5N");
  });

  it("reports BH3 on the acceptor as over-valent, which RDKit refuses too", () => {
    const { molecule, b } = ammoniaBorane();
    const pinned = setExplicitHydrogenCount(molecule, b, 3);
    const issues = chemistryIssues(pinned);
    expect(issues.some((issue) => issue.atomId === b && issue.kind === "over-valent")).toBe(true);
  });

  it("is not a single bond: the same drawing with a plain bond gives NH2", () => {
    const { molecule, n, bond } = ammoniaBorane();
    const plain = setBondDative(molecule, bond, false);
    expect(implicitHydrogenCount(plain, n)).toBe(2);
  });

  it("gives cisplatin its formula, two NH3 and no N-H lost", () => {
    const { molecule, ammines } = cisplatin();
    for (const n of ammines) expect(implicitHydrogenCount(molecule, n)).toBe(3);
    expect(molecularFormula(molecule)).toBe("Cl2H6N2Pt");
    expect(chemistryIssues(molecule)).toEqual([]);
  });

  it("joins the pieces into one species", () => {
    expect(species(cisplatin().molecule)).toHaveLength(1);
    expect(species(ammoniaBorane().molecule)).toHaveLength(1);
  });

  it("keeps pyridine aromatic when its nitrogen donates to platinum", () => {
    let n = "";
    let bond = "";
    let molecule = buildMolecule((m) => {
      const ring: AtomId[] = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        ring.push(m.atom(i === 0 ? "N" : "C", vec(Math.cos(angle), Math.sin(angle))));
      }
      for (let i = 0; i < 6; i++) m.bond(ring[i]!, ring[(i + 1) % 6]!, i % 2 === 0 ? 2 : 1);
      n = ring[0]!;
      bond = m.bond(n, m.atom("Pt", vec(2, 0)));
    });
    molecule = setBondDative(molecule, bond, true);
    expect(implicitHydrogenCount(molecule, n)).toBe(0);
    expect(isAromaticAtom(molecule, n)).toBe(true);
    expect(molecularFormula(molecule)).toBe("C5H5NPt");
  });

  it("counts the donor's pair as spent in the Lewis view", () => {
    const { molecule, n, b } = ammoniaBorane();
    expect(drawnLonePairs(molecule, n)).toBe(0);
    expect(drawnLonePairs(setExplicitHydrogenCount(molecule, b, 3), b)).toBe(0);
  });
});

describe("dative bonds: editing", () => {
  it("refuses a dative double bond", () => {
    const { molecule, bond } = ammoniaBorane();
    const double = setBondOrder(setBondDative(molecule, bond, false), bond, 2);
    expect(() => setBondDative(double, bond, true)).toThrow(/single/);
  });

  it("becomes a plain bond when its order changes", () => {
    const { molecule, bond } = ammoniaBorane();
    const next = setBondOrder(molecule, bond, 2);
    expect("dative" in requireBond(next, bond)).toBe(false);
  });

  it("turns the arrow round on flip: the other atom becomes the donor", () => {
    const { molecule, n, b, bond } = ammoniaBorane();
    const flipped = flipBond(molecule, bond);
    expect(requireBond(flipped, bond).dative).toBe(true);
    expect(implicitHydrogenCount(flipped, b)).toBe(3);
    expect(implicitHydrogenCount(flipped, n)).toBe(2);
  });

  it("omits the key rather than storing false", () => {
    const { molecule, bond } = ammoniaBorane();
    const cleared = setBondDative(molecule, bond, false);
    expect(Object.keys(requireBond(cleared, bond))).not.toContain("dative");
  });

  it("survives copy into a fragment", () => {
    const { molecule, n, b, bond } = ammoniaBorane();
    const fragment = extractFragment(molecule, [n, b]);
    const copied = requireBond(fragment.molecule, fragment.bondIdMap.get(bond)!);
    expect(copied.dative).toBe(true);
    expect(copied.from).toBe(fragment.atomIdMap.get(n));
  });
});

describe("dative bonds: molfile", () => {
  it("writes V3000 bond type 9 with the donor first", () => {
    const text = writeMolblock(cisplatin().molecule, { version: "V3000" });
    expect(text).toContain("M  V30 3 9 4 1");
    expect(text).toContain("M  V30 4 9 5 1");
  });

  it("refuses V2000, naming the bonds", () => {
    const { molecule, datives } = cisplatin();
    let thrown: unknown;
    try {
      writeMolblock(molecule, { version: "V2000" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MolblockDativeBondError);
    expect((thrown as MolblockDativeBondError).bondIds).toEqual(datives);
  });

  it("round-trips through its own reader with the direction and hydrogens intact", () => {
    const source = cisplatin().molecule;
    const back = readMolblock(writeMolblock(source, { version: "V3000" })).molecule;
    const dative = back.bondIds.map((id) => requireBond(back, id)).filter((bond) => bond.dative);
    expect(dative).toHaveLength(2);
    for (const bond of dative) expect(back.atoms[bond.from]?.element).toBe("N");
    expect(elementCounts(back)).toEqual(elementCounts(source));
  });

  it("reads the borane adduct as RDKit writes it", () => {
    // `get_v3Kmolblock()` of RDKit's `N->B`, verbatim bar the header.
    const text = [
      "",
      "     RDKit          2D",
      "",
      "  0  0  0  0  0  0  0  0  0  0999 V3000",
      "M  V30 BEGIN CTAB",
      "M  V30 COUNTS 2 1 0 0 0",
      "M  V30 BEGIN ATOM",
      "M  V30 1 N 1.299038 0.750000 0.000000 0",
      "M  V30 2 B 0.000000 0.000000 0.000000 0",
      "M  V30 END ATOM",
      "M  V30 BEGIN BOND",
      "M  V30 1 9 1 2",
      "M  V30 END BOND",
      "M  V30 END CTAB",
      "M  END",
      "",
    ].join("\n");
    const { molecule, warnings } = readMolblock(text);
    expect(warnings).toEqual([]);
    expect(molecularFormula(molecule)).toBe("BH5N");
    const [n, b] = molecule.atomIds;
    expect(implicitHydrogenCount(molecule, n!)).toBe(3);
    expect(implicitHydrogenCount(molecule, b!)).toBe(2);
  });
});

describe("bold bonds", () => {
  /** Ethanol's C-O, the bond made bold. */
  function ethanol(): { molecule: Molecule; co: BondId } {
    let co = "";
    const molecule = buildMolecule((m) => {
      const c1 = m.atom("C", vec(0, 0));
      const c2 = m.atom("C", vec(1, 0));
      m.bond(c1, c2);
      co = m.bond(c2, m.atom("O", vec(2, 0)));
    });
    return { molecule, co };
  }

  it("is display only: formula, hydrogens and the molfile ignore it", () => {
    const { molecule, co } = ethanol();
    const bold = setBondBold(molecule, co, true);
    expect(requireBond(bold, co).bold).toBe(true);
    expect(molecularFormula(bold)).toBe("C2H6O");
    expect(writeMolblock(bold)).toBe(writeMolblock(molecule));
    expect(writeMolblock(bold, { version: "V3000" })).toBe(
      writeMolblock(molecule, { version: "V3000" }),
    );
  });

  it("survives order changes and copies, and clears to an absent key", () => {
    const { molecule, co } = ethanol();
    const bold = setBondOrder(setBondBold(molecule, co, true), co, 2);
    expect(requireBond(bold, co).bold).toBe(true);
    const fragment = extractFragment(bold, bold.atomIds);
    expect(requireBond(fragment.molecule, fragment.bondIdMap.get(co)!).bold).toBe(true);
    expect(Object.keys(requireBond(setBondBold(bold, co, false), co))).not.toContain("bold");
  });

  it("sits on a dative bond too, the two flags independent", () => {
    const { molecule, bond } = ammoniaBorane();
    const both = setBondBold(molecule, bond, true);
    expect(requireBond(both, bond)).toMatchObject({ dative: true, bold: true });
    expect(requireBond(setBondDative(both, bond, false), bond).bold).toBe(true);
  });
});

describe("CDXML", () => {
  it("writes ChemDraw's own dative order, donor first, and its bold display", () => {
    const { molecule, bond } = ammoniaBorane();
    const { cdxml, dropped } = writeCdxml(setBondBold(molecule, bond, true));
    const b = cdxml.match(/<b [^>]*\/>/g) ?? [];
    expect(b).toHaveLength(1);
    expect(b[0]).toContain(`Order="dative"`);
    expect(b[0]).toContain(`Display="Bold"`);
    // B is the nitrogen's node: it is written first.
    expect(b[0]).toMatch(/B="(\d+)"/);
    const nodeIds = [...cdxml.matchAll(/<n id="(\d+)"/g)].map((m) => m[1]);
    expect(b[0]).toContain(`B="${nodeIds[0]}"`);
    expect(dropped).toEqual([]);
  });
});
