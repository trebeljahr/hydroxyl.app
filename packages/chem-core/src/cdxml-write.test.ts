import { describe, expect, it } from "vitest";

import { benzene, buildMolecule } from "./builders.js";
import { CDXML_BOND_LENGTH, writeCdxml } from "./cdxml-write.js";
import { withStereoGroups } from "./stereo-groups.js";
import type { Molecule } from "./types.js";
import { vec } from "./vec.js";

// Real molecules, so a failure reads as "acetate lost its charge" rather than
// as a graph error.

/** CH3-CH2-OH, drawn left to right. */
function ethanol(): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", vec(0, 0));
    const c2 = b.atom("C", vec(0.87, 0.5));
    const o = b.atom("O", vec(1.73, 0));
    b.bond(c1, c2, 1);
    b.bond(c2, o, 1);
  });
}

/** CH3-C(=O)-O(-) */
function acetate(): Molecule {
  return buildMolecule((b) => {
    const me = b.atom("C", vec(0, 0));
    const c = b.atom("C", vec(0.87, 0.5));
    const o1 = b.atom("O", vec(0.87, 1.5));
    const o2 = b.atom("O", vec(1.73, 0), { charge: -1 });
    b.bond(me, c, 1);
    b.bond(c, o1, 2);
    b.bond(c, o2, 1);
  });
}

/** (S)-alanine, the alpha carbon's methyl on a wedge. */
function alanine(stereo: "wedge" | "hash" = "wedge"): Molecule {
  return buildMolecule((b) => {
    const ca = b.atom("C", vec(0, 0));
    const n = b.atom("N", vec(-0.87, 0.5));
    const me = b.atom("C", vec(0, -1));
    const c = b.atom("C", vec(0.87, 0.5));
    const o1 = b.atom("O", vec(0.87, 1.5));
    const o2 = b.atom("O", vec(1.73, 0));
    b.bond(ca, n, 1);
    b.bond(ca, me, 1, stereo);
    b.bond(ca, c, 1);
    b.bond(c, o1, 2);
    b.bond(c, o2, 1);
  });
}

/** Sodium chloride: two ions, two components. */
function sodiumChloride(): Molecule {
  return buildMolecule((b) => {
    b.atom("Na", vec(0, 0), { charge: 1 });
    b.atom("Cl", vec(2, 0), { charge: -1 });
  });
}

/** Every `<n …>` opening tag, in document order. */
function nodes(cdxml: string): string[] {
  return [...cdxml.matchAll(/<n [^>]*>/g)].map((m) => m[0]);
}

function bonds(cdxml: string): string[] {
  return [...cdxml.matchAll(/<b [^>]*\/>/g)].map((m) => m[0]);
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

describe("writeCdxml", () => {
  it("writes a CDXML document ChemDraw recognises", () => {
    const { cdxml, dropped } = writeCdxml(ethanol());
    expect(cdxml.startsWith(`<?xml version="1.0" encoding="UTF-8" ?>`)).toBe(true);
    expect(cdxml).toContain(`<!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" >`);
    expect(cdxml).toContain(`BondLength="14.4"`);
    expect(cdxml.trimEnd().endsWith("</CDXML>")).toBe(true);
    expect(dropped).toEqual([]);
  });

  it("leaves skeletal carbon unlabelled and labels the oxygen OH", () => {
    const { cdxml } = writeCdxml(ethanol());
    const [c1, c2, o] = nodes(cdxml);
    expect(attr(c1!, "Element")).toBeUndefined();
    expect(attr(c1!, "NumHydrogens")).toBeUndefined();
    expect(c2).toMatch(/\/>$/);
    expect(attr(o!, "Element")).toBe("8");
    expect(attr(o!, "NumHydrogens")).toBe("1");
    expect(cdxml).toContain(`face="96">OH</s>`);
  });

  it("writes HO when every neighbour is to the right", () => {
    const flipped = buildMolecule((b) => {
      const o = b.atom("O", vec(0, 0));
      const c = b.atom("C", vec(0.87, 0.5));
      b.bond(o, c, 1);
    });
    expect(writeCdxml(flipped).cdxml).toContain(`face="96">HO</s>`);
  });

  it("scales one bond to the ACS bond length and flips y to point down", () => {
    const { cdxml } = writeCdxml(ethanol());
    const [c1, c2] = nodes(cdxml).map((tag) => attr(tag, "p")!.split(" ").map(Number));
    expect(Math.hypot(c2![0]! - c1![0]!, c2![1]! - c1![1]!)).toBeCloseTo(CDXML_BOND_LENGTH, 0);
    // c2 is above c1 in the model (y-up), so it has the smaller page y.
    expect(c2![1]!).toBeLessThan(c1![1]!);
  });

  it("carries acetate's charge as chemistry and as a superscript", () => {
    const { cdxml } = writeCdxml(acetate());
    const anion = nodes(cdxml)[3]!;
    expect(attr(anion, "Charge")).toBe("-1");
    expect(attr(anion, "NumHydrogens")).toBe("0");
    expect(cdxml).toContain(`face="64">-</s>`);
    const carbonyl = bonds(cdxml)[1]!;
    expect(attr(carbonyl, "Order")).toBe("2");
  });

  it("labels 13C methane with its isotope and hydrogens", () => {
    const methane = buildMolecule((b) => {
      b.atom("C", vec(0, 0), { isotope: 13 });
    });
    const { cdxml } = writeCdxml(methane);
    const c = nodes(cdxml)[0]!;
    expect(attr(c, "Isotope")).toBe("13");
    expect(attr(c, "NumHydrogens")).toBe("4");
    expect(cdxml).toContain(`<s font="3" size="10" face="64">13</s><s font="3" size="10" face="96">CH4</s>`);
  });

  it("writes a methyl radical as a doublet", () => {
    const methyl = buildMolecule((b) => {
      b.atom("C", vec(0, 0), { radicalElectrons: 1 });
    });
    const c = nodes(writeCdxml(methyl).cdxml)[0]!;
    expect(attr(c, "Radical")).toBe("Doublet");
    expect(attr(c, "NumHydrogens")).toBe("3");
  });

  it("keeps the wedge's narrow end at the stereocentre", () => {
    const { cdxml } = writeCdxml(alanine());
    const ids = nodes(cdxml).map((tag) => attr(tag, "id"));
    const wedge = bonds(cdxml).find((tag) => attr(tag, "Display") !== undefined)!;
    expect(attr(wedge, "Display")).toBe("WedgeBegin");
    expect(attr(wedge, "B")).toBe(ids[0]);
    expect(attr(wedge, "E")).toBe(ids[2]);
    expect(attr(bonds(writeCdxml(alanine("hash")).cdxml)[1]!, "Display")).toBe("WedgedHashBegin");
  });

  it("writes stereo groups as ChemDraw enhanced stereo", () => {
    const mol = alanine();
    const grouped = withStereoGroups(mol, [{ kind: "and", index: 1, atomIds: [mol.atomIds[0]!] }]);
    const ca = nodes(writeCdxml(grouped).cdxml)[0]!;
    expect(attr(ca, "EnhancedStereoType")).toBe("And");
    expect(attr(ca, "EnhancedStereoGroupNum")).toBe("1");
  });

  it("kekulises aromatic flags and keeps benzene's hydrogens implicit", () => {
    const flat = benzene();
    const flagged: Molecule = {
      ...flat,
      atoms: Object.fromEntries(Object.entries(flat.atoms).map(([id, a]) => [id, { ...a, aromatic: true }])),
      bonds: Object.fromEntries(
        Object.entries(flat.bonds).map(([id, b]) => [id, { ...b, order: 1 as const, aromatic: true }]),
      ),
    };
    const { cdxml } = writeCdxml(flagged);
    const orders = bonds(cdxml).map((tag) => attr(tag, "Order") ?? "1");
    expect(orders.filter((o) => o === "2")).toHaveLength(3);
    expect(orders.filter((o) => o === "1")).toHaveLength(3);
    expect(cdxml).not.toContain("NumHydrogens");
  });

  it("writes each ion of a salt as its own fragment", () => {
    const { cdxml } = writeCdxml(sodiumChloride());
    expect(cdxml.match(/<fragment /g)).toHaveLength(2);
    expect(cdxml).toContain(`face="96">Na</s><s font="3" size="10" face="64">+</s>`);
    expect(cdxml).toContain(`face="96">Cl</s><s font="3" size="10" face="64">-</s>`);
  });

  it("writes a display label as a generic nickname, never as its element", () => {
    const tolyl = buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0));
      const ph = b.atom("C", vec(1, 0), { label: "Ph" });
      b.bond(c, ph, 1);
    });
    const ph = nodes(writeCdxml(tolyl).cdxml)[1]!;
    expect(attr(ph, "NodeType")).toBe("GenericNickname");
    expect(attr(ph, "GenericNickname")).toBe("Ph");
    // Zero, not absent: CDXML's default element is carbon.
    expect(attr(ph, "Element")).toBe("0");
    expect(attr(ph, "NumHydrogens")).toBeUndefined();
  });

  it("escapes a label that is not valid XML text", () => {
    const odd = buildMolecule((b) => {
      b.atom("C", vec(0, 0), { label: `R<"&">` });
    });
    const { cdxml } = writeCdxml(odd);
    expect(cdxml).toContain(`GenericNickname="R&lt;&quot;&amp;&quot;&gt;"`);
    expect(cdxml).not.toContain(`R<`);
  });

  it("reports a crossed double bond it can only write as a plain one", () => {
    const butene = buildMolecule((b) => {
      const c1 = b.atom("C", vec(0, 0));
      const c2 = b.atom("C", vec(0.87, 0.5));
      const c3 = b.atom("C", vec(1.73, 0));
      const c4 = b.atom("C", vec(2.6, 0.5));
      b.bond(c1, c2, 1);
      b.bond(c2, c3, 2, "either");
      b.bond(c3, c4, 1);
    });
    const { cdxml, dropped } = writeCdxml(butene);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatch(/crossed double bond/);
    expect(attr(bonds(cdxml)[1]!, "Display")).toBeUndefined();
  });

  it("writes the same bytes twice", () => {
    expect(writeCdxml(alanine()).cdxml).toBe(writeCdxml(alanine()).cdxml);
  });
});
