import { describe, expect, it } from "vitest";
import { benzene, buildMolecule, carbocycle, linearChain, singleAtom } from "./builders.js";
import * as M from "./molecule.js";
import * as V from "./valence.js";

const first = (mol: ReturnType<typeof singleAtom>) => mol.atomIds[0]!;

describe("implicit hydrogens on neutral atoms", () => {
  it("saturates a lone atom", () => {
    expect(V.implicitHydrogenCount(singleAtom("C"), first(singleAtom("C")))).toBe(4);
    expect(V.implicitHydrogenCount(singleAtom("N"), first(singleAtom("N")))).toBe(3);
    expect(V.implicitHydrogenCount(singleAtom("O"), first(singleAtom("O")))).toBe(2);
    expect(V.implicitHydrogenCount(singleAtom("Cl"), first(singleAtom("Cl")))).toBe(1);
  });

  it("counts down as bonds are drawn", () => {
    const ethane = linearChain(2);
    for (const id of ethane.atomIds) {
      expect(V.implicitHydrogenCount(ethane, id)).toBe(3);
    }
    const propane = linearChain(3);
    expect(V.implicitHydrogenCount(propane, propane.atomIds[1]!)).toBe(2);
  });

  it("accounts for bond order", () => {
    // Ethene: each carbon carries two hydrogens.
    const ethene = buildMolecule((b) => {
      const c1 = b.atom("C");
      const c2 = b.atom("C");
      b.bond(c1, c2, 2);
    });
    for (const id of ethene.atomIds) {
      expect(V.implicitHydrogenCount(ethene, id)).toBe(2);
    }
    // Ethyne: one each.
    const ethyne = buildMolecule((b) => {
      const c1 = b.atom("C");
      const c2 = b.atom("C");
      b.bond(c1, c2, 3);
    });
    for (const id of ethyne.atomIds) {
      expect(V.implicitHydrogenCount(ethyne, id)).toBe(1);
    }
  });

  it("gives no hydrogens to a noble gas or a metal", () => {
    expect(V.implicitHydrogenCount(singleAtom("He"), first(singleAtom("He")))).toBe(0);
    expect(V.implicitHydrogenCount(singleAtom("Fe"), first(singleAtom("Fe")))).toBe(0);
  });
});

describe("variable valence", () => {
  it("picks the smallest valence that fits — sulfur", () => {
    // Thiol sulfur: 2 bonds used of valence 2, so no room left.
    const thiol = buildMolecule((b) => {
      const c = b.atom("C");
      const s = b.atom("S");
      b.bond(c, s, 1);
    });
    expect(V.implicitHydrogenCount(thiol, thiol.atomIds[1]!)).toBe(1);

    // Sulfone sulfur: four bond-order units used, so valence 6 applies and
    // there is no hydrogen. A single maxBonds number cannot express this.
    const sulfone = buildMolecule((b) => {
      const s = b.atom("S");
      const o1 = b.atom("O");
      const o2 = b.atom("O");
      const c1 = b.atom("C");
      const c2 = b.atom("C");
      b.bond(s, o1, 2);
      b.bond(s, o2, 2);
      b.bond(s, c1, 1);
      b.bond(s, c2, 1);
    });
    expect(V.bondOrderSum(sulfone, sulfone.atomIds[0]!)).toBe(6);
    expect(V.implicitHydrogenCount(sulfone, sulfone.atomIds[0]!)).toBe(0);
    expect(V.isOverValent(sulfone, sulfone.atomIds[0]!)).toBe(false);
  });

  it("picks the smallest valence that fits — phosphorus", () => {
    // Phosphine PH3 vs a five-coordinate phosphorane.
    expect(V.implicitHydrogenCount(singleAtom("P"), first(singleAtom("P")))).toBe(3);
    const phosphate = buildMolecule((b) => {
      const p = b.atom("P");
      const o1 = b.atom("O");
      const o2 = b.atom("O");
      const o3 = b.atom("O");
      const o4 = b.atom("O");
      b.bond(p, o1, 2);
      b.bond(p, o2, 1);
      b.bond(p, o3, 1);
      b.bond(p, o4, 1);
    });
    expect(V.implicitHydrogenCount(phosphate, phosphate.atomIds[0]!)).toBe(0);
  });

  it("exposes the whole charge-adjusted valence list, not just its maximum", () => {
    // `maxValence` alone cannot answer "how much room does this atom have",
    // because for sulfur the answer depends on which of its three valences the
    // bonding actually reaches. Kekulisation needs the list: thiopyrylium's S+
    // settles at 3 with one double bond, and measuring it against the 7 at the
    // top of the same list says it needs no double bond at all.
    const thiophene = buildMolecule((b) => b.atom("S"));
    expect(V.chargeAdjustedValences(thiophene, thiophene.atomIds[0]!)).toEqual([2, 4, 6]);

    const sulfonium = buildMolecule((b) => b.atom("S", undefined, { charge: 1 }));
    expect(V.chargeAdjustedValences(sulfonium, sulfonium.atomIds[0]!)).toEqual([3, 5, 7]);
    expect(V.maxValence(sulfonium, sulfonium.atomIds[0]!)).toBe(7);

    // Carbon's positive-charge inversion carries through, as it must: the list
    // and `maxValence` are two readings of one adjustment, never two rules.
    const cation = buildMolecule((b) => b.atom("C", undefined, { charge: 1 }));
    expect(V.chargeAdjustedValences(cation, cation.atomIds[0]!)).toEqual([3]);

    // A metal carries no default valence, so there is nothing to adjust.
    const iron = buildMolecule((b) => b.atom("Fe"));
    expect(V.chargeAdjustedValences(iron, iron.atomIds[0]!)).toEqual([]);
  });
});

describe("charge", () => {
  it("lets ammonium take a fourth bond", () => {
    const ammonium = buildMolecule((b) => b.atom("N", undefined, { charge: 1 }));
    expect(V.implicitHydrogenCount(ammonium, ammonium.atomIds[0]!)).toBe(4);
    expect(V.maxValence(ammonium, ammonium.atomIds[0]!)).toBe(4);
  });

  it("shrinks alkoxide oxygen to one bond", () => {
    const alkoxide = buildMolecule((b) => {
      const c = b.atom("C");
      const o = b.atom("O", undefined, { charge: -1 });
      b.bond(c, o, 1);
    });
    expect(V.implicitHydrogenCount(alkoxide, alkoxide.atomIds[1]!)).toBe(0);
  });

  it("gives a carbocation three hydrogens, not five", () => {
    // Without carbon's special case a positive charge would add capacity
    // rather than remove it, and CH3+ would come out as CH5+.
    const cation = buildMolecule((b) => b.atom("C", undefined, { charge: 1 }));
    expect(V.implicitHydrogenCount(cation, cation.atomIds[0]!)).toBe(3);
  });

  it("gives a carbanion three hydrogens", () => {
    const anion = buildMolecule((b) => b.atom("C", undefined, { charge: -1 }));
    expect(V.implicitHydrogenCount(anion, anion.atomIds[0]!)).toBe(3);
  });

  it("inverts for electropositive elements", () => {
    // Borohydride: B- reaches four bonds where neutral boron manages three.
    const borohydride = buildMolecule((b) => b.atom("B", undefined, { charge: -1 }));
    expect(V.maxValence(borohydride, borohydride.atomIds[0]!)).toBe(4);
    expect(V.implicitHydrogenCount(borohydride, borohydride.atomIds[0]!)).toBe(4);
  });
});

describe("radicals", () => {
  it("consume valence", () => {
    const methyl = buildMolecule((b) =>
      b.atom("C", undefined, { radicalElectrons: 1 }),
    );
    expect(V.implicitHydrogenCount(methyl, methyl.atomIds[0]!)).toBe(3);
    expect(V.explicitValence(methyl, methyl.atomIds[0]!)).toBe(1);
  });
});

describe("explicitHydrogenCount override", () => {
  it("wins over the derived count", () => {
    const pinned = buildMolecule((b) =>
      b.atom("C", undefined, { explicitHydrogenCount: 0 }),
    );
    expect(V.implicitHydrogenCount(pinned, pinned.atomIds[0]!)).toBe(0);
  });

  it("is how pyrrole's N-H is expressed", () => {
    // Pyrrole and pyridine nitrogens both see a bond-order sum of 3 from two
    // aromatic ring bonds, so valence alone cannot tell them apart.
    const ring = carbocycle(5);
    const atoms = { ...ring.atoms };
    const nId = ring.atomIds[0]!;
    atoms[nId] = { ...atoms[nId]!, element: "N", explicitHydrogenCount: 1 };
    const pyrrole = { ...ring, atoms };
    expect(V.implicitHydrogenCount(pyrrole, nId)).toBe(1);
  });
});

describe("aromatic bonds", () => {
  it("count as one and a half so a benzene carbon still gets one hydrogen", () => {
    const kekule = benzene();
    const bonds = Object.fromEntries(
      Object.entries(kekule.bonds).map(([id, b]) => [
        id,
        { ...b, order: 1 as const, aromatic: true },
      ]),
    );
    const aromatic = { ...kekule, bonds };
    for (const id of aromatic.atomIds) {
      expect(V.bondOrderSum(aromatic, id)).toBe(3);
      expect(V.implicitHydrogenCount(aromatic, id)).toBe(1);
    }
  });

  it("agrees with the Kekule form", () => {
    const kekule = benzene();
    for (const id of kekule.atomIds) {
      expect(V.implicitHydrogenCount(kekule, id)).toBe(1);
    }
  });
});

describe("free valence and over-valence", () => {
  it("reports remaining capacity", () => {
    const methane = singleAtom("C");
    expect(V.freeValence(methane, methane.atomIds[0]!)).toBe(4);
    const propane = linearChain(3);
    expect(V.freeValence(propane, propane.atomIds[1]!)).toBe(2);
    expect(V.canAcceptBond(propane, propane.atomIds[1]!, 2)).toBe(true);
    expect(V.canAcceptBond(propane, propane.atomIds[1]!, 3)).toBe(false);
  });

  it("treats metals as never saturated", () => {
    const iron = singleAtom("Fe");
    expect(V.freeValence(iron, iron.atomIds[0]!)).toBe(Infinity);
    expect(V.canAcceptBond(iron, iron.atomIds[0]!, 6)).toBe(true);
  });

  it("flags a pentavalent carbon as an error but still returns a count", () => {
    const bad = buildMolecule((b) => {
      const c = b.atom("C");
      for (let i = 0; i < 5; i++) b.bond(c, b.atom("Cl"), 1);
    });
    const carbon = bad.atomIds[0]!;
    expect(V.isOverValent(bad, carbon)).toBe(true);
    expect(V.implicitHydrogenCount(bad, carbon)).toBe(0);

    const issues = V.valenceIssues(bad);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.atomId).toBe(carbon);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.message).toMatch(/5 bonds/);
  });

  it("reports nothing for a clean structure", () => {
    expect(V.valenceIssues(benzene())).toEqual([]);
    expect(V.valenceIssues(linearChain(8))).toEqual([]);
  });
});
