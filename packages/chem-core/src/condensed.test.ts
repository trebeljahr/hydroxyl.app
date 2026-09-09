import { describe, expect, it } from "vitest";

import { benzene, buildMolecule, linearChain } from "./builders.js";
import { canCondense, condensedFormula, condensedParts } from "./condensed.js";
import { emptyMolecule } from "./molecule.js";
import type { Molecule } from "./types.js";
import { vec } from "./vec.js";

function ethanol(): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", vec(0, 0));
    const c2 = b.atom("C", vec(1, 0));
    const o = b.atom("O", vec(2, 0));
    b.bond(c1, c2);
    b.bond(c2, o);
  });
}

function dimethylEther(): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", vec(0, 0));
    const o = b.atom("O", vec(1, 0));
    const c2 = b.atom("C", vec(2, 0));
    b.bond(c1, o);
    b.bond(o, c2);
  });
}

describe("condensedFormula", () => {
  it("spells ethanol along its chain", () => {
    expect(condensedFormula(ethanol())).toBe("CH3CH2OH");
  });

  it("tells ethanol and dimethyl ether apart, which the sum formula cannot", () => {
    // Both are C2H6O. This is the entire reason the condensed view exists
    // beside the sum-formula one.
    expect(condensedFormula(dimethylEther())).toBe("CH3OCH3");
    expect(condensedFormula(ethanol())).not.toBe(
      condensedFormula(dimethylEther()),
    );
  });

  it("brackets a branch off the main chain", () => {
    // Isobutane: the longest path is three carbons and the fourth hangs off
    // the middle one. Picking the diameter rather than an arbitrary start is
    // what keeps this from reading as a three-branch star.
    const isobutane = buildMolecule((b) => {
      const centre = b.atom("C", vec(0, 0));
      b.bond(centre, b.atom("C", vec(-1, 0)));
      b.bond(centre, b.atom("C", vec(1, 0)));
      b.bond(centre, b.atom("C", vec(0, 1)));
    });
    expect(condensedFormula(isobutane)).toBe("CH3CH(CH3)CH3");
  });

  it("keeps a charge on the atom that carries it", () => {
    // Acetate. Putting a net charge at the end of a condensed formula loses
    // which centre it sits on, which is the one thing a condensed formula is
    // for.
    const acetate = buildMolecule((b) => {
      const c1 = b.atom("C", vec(0, 0));
      const c2 = b.atom("C", vec(1, 0));
      const o1 = b.atom("O", vec(2, 0.6), { charge: -1 });
      const o2 = b.atom("O", vec(2, -0.6));
      b.bond(c1, c2);
      b.bond(c2, o1);
      b.bond(c2, o2, 2);
    });
    expect(condensedFormula(acetate)).toBe("CH3C(O-)=O");
  });

  it("writes the multiple bonds, which are half of what connectivity means", () => {
    // Without them but-2-ene and the butane skeleton spell the same string,
    // and propyne states a divalent middle carbon.
    const butene = buildMolecule((b) => {
      const c1 = b.atom("C", vec(0, 0));
      const c2 = b.atom("C", vec(1, 0));
      const c3 = b.atom("C", vec(2, 0));
      const c4 = b.atom("C", vec(3, 0));
      b.bond(c1, c2);
      b.bond(c2, c3, 2);
      b.bond(c3, c4);
    });
    expect(condensedFormula(butene)).toBe("CH3CH=CHCH3");

    const propyne = buildMolecule((b) => {
      const c1 = b.atom("C", vec(0, 0));
      const c2 = b.atom("C", vec(1, 0));
      const c3 = b.atom("C", vec(2, 0));
      b.bond(c1, c2);
      b.bond(c2, c3, 3);
    });
    expect(condensedFormula(propyne)).toBe("CH3C≡CH");

    const butadiene = buildMolecule((b) => {
      const c1 = b.atom("C", vec(0, 0));
      const c2 = b.atom("C", vec(1, 0));
      const c3 = b.atom("C", vec(2, 0));
      const c4 = b.atom("C", vec(3, 0));
      b.bond(c1, c2, 2);
      b.bond(c2, c3);
      b.bond(c3, c4, 2);
    });
    expect(condensedFormula(butadiene)).toBe("CH2=CHCH=CH2");
  });

  it("puts a branch's bond order inside the branch's own bracket", () => {
    // Pentan-3-one, whose carbonyl oxygen really is off the main chain — the
    // five carbons are the diameter. "C=(O)" would read as a double bond to
    // the bracket itself, which is not a notation anybody writes.
    const pentan3one = buildMolecule((b) => {
      const carbons = [0, 1, 2, 3, 4].map((i) => b.atom("C", vec(i, 0)));
      for (let i = 0; i + 1 < carbons.length; i++) {
        b.bond(carbons[i]!, carbons[i + 1]!);
      }
      b.bond(carbons[2]!, b.atom("O", vec(2, 1)), 2);
    });
    expect(condensedFormula(pentan3one)).toBe("CH3CH2C(=O)CH2CH3");
  });

  it("sets its counts as real subscripts and its charges as superscripts", () => {
    // The same `FormulaPart` run the sum-formula view uses, so a renderer
    // never parses digits back out of a flat string.
    expect(condensedParts(ethanol())).toEqual([
      { kind: "symbol", text: "C" },
      { kind: "symbol", text: "H" },
      { kind: "count", text: "3" },
      { kind: "symbol", text: "C" },
      { kind: "symbol", text: "H" },
      { kind: "count", text: "2" },
      { kind: "symbol", text: "O" },
      { kind: "symbol", text: "H" },
    ]);
  });

  it("separates the components of a mixture", () => {
    const twoMethanes = buildMolecule((b) => {
      b.atom("C", vec(0, 0));
      b.atom("C", vec(5, 0));
    });
    expect(condensedFormula(twoMethanes)).toBe("CH4·CH4");
  });

  it("is deterministic across repeated calls, which a figure diff depends on", () => {
    const chain = linearChain(6, "C");
    expect(condensedFormula(chain)).toBe(condensedFormula(chain));
    expect(condensedFormula(chain)).toBe("CH3CH2CH2CH2CH2CH3");
  });

  it("refuses a ring rather than inventing a spelling for it", () => {
    expect(canCondense(benzene())).toBe(false);
    expect(() => condensedFormula(benzene())).toThrow(/no condensed formula/);
    expect(canCondense(ethanol())).toBe(true);
  });

  it("gives an empty molecule an empty run", () => {
    expect(condensedParts(emptyMolecule())).toEqual([]);
  });
});
