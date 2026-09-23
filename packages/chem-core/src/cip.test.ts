/**
 * CIP ranking (cip.ts), asserted on real molecules against letters pinned as
 * literals.
 *
 * THE MOLECULES are in test/fixtures/cip/cases.json: each SMILES was turned
 * into a molblock ONCE by RDKit (`set_new_coords`, `get_molblock`), and the
 * file records the date and RDKit version. THE LETTERS below are what RDKit
 * 2025.03.4 `get_stereo_tags` gives for the same SMILES, keyed by molblock row
 * (a1 = row 1). Where chem-core deliberately refuses a letter RDKit gives, the
 * test says so and names the escalation. packages/client's
 * stereo-centres.node.test.ts repeats the decision 43 cases against RDKit live.
 *
 * Every letter is asserted through BOTH readers: stereo.ts's `cipDescriptor`
 * off the wedges, and stereo-config.ts's `descriptorFromConfig` off the
 * coordinate-free record, so the two cannot drift apart.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildMolecule } from "./builders.js";
import { rankStereoCentre, rankSubstituentPair, cipUnits } from "./cip.js";
import { readMolblock } from "./molblock-read.js";
import { bondsAt, otherEnd } from "./molecule.js";
import { updateBond } from "./ops.js";
import { rings } from "./rings.js";
import { unrepresentableStereo } from "./stereo-axes.js";
import {
  cipDescriptor,
  descriptorText,
  doubleBondDescriptor,
  stereocenterAtoms,
  stereogenicBonds,
} from "./stereo.js";
import { descriptorFromConfig, stereoConfig, stereoTopology } from "./stereo-config.js";
import type { Molecule } from "./types.js";
import { DEG, fromPolar, ORIGIN, type Vec2 } from "./vec.js";

const CASES = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "cip", "cases.json"),
    "utf8",
  ),
) as { cases: Record<string, { smiles: string; molblock: string }> };

function load(name: string): Molecule {
  const entry = CASES.cases[name];
  if (entry === undefined) throw new Error(`no fixture ${name}`);
  return readMolblock(entry.molblock).molecule;
}

function show(descriptor: { readonly kind: string; readonly reason?: string } | undefined): string {
  if (descriptor === undefined) return "-";
  return descriptor.kind === "undetermined" ? `?${descriptor.reason}` : descriptor.kind;
}

/** Every centre's letter from both readers, keyed by atom id. Throws if they disagree. */
function centreLetters(mol: Molecule): Record<string, string> {
  const config = stereoConfig(mol);
  const out: Record<string, string> = {};
  for (const atomId of stereocenterAtoms(mol)) {
    const drawn = show(cipDescriptor(mol, atomId));
    const centre = config.centres.find((c) => c.atomId === atomId);
    const fromConfig = centre === undefined ? "-" : show(descriptorFromConfig(mol, centre, config));
    expect(fromConfig, `${atomId}: stereo.ts ${drawn}, stereo-config ${fromConfig}`).toBe(drawn);
    out[atomId] = drawn;
  }
  return out;
}

/** Every stereogenic double bond's E/Z, keyed "a2=a3". */
function bondLetters(mol: Molecule): Record<string, string> {
  const out: Record<string, string> = {};
  for (const bondId of stereogenicBonds(mol)) {
    const bond = mol.bonds[bondId]!;
    out[`${bond.from}=${bond.to}`] = show(doubleBondDescriptor(mol, bondId));
  }
  return out;
}

function step(from: Vec2, degrees: number): Vec2 {
  const d = fromPolar(degrees * DEG, 1);
  return { x: from.x + d.x, y: from.y + d.y };
}

describe("rule 2: mass number", () => {
  it("orders CH3–CH(OH)–CH2D by the deuterium three spheres out", () => {
    expect(centreLetters(load("ch2d-propanol"))).toEqual({ a2: "S" });
  });

  it("ranks 125I below natural iodine (standard weight 126.9)", () => {
    // IUPAC P-92.3 ranks by mass, "81Br > Br > 79Br"; RDKit agrees: R.
    expect(centreLetters(load("iodo-125"))).toEqual({ a2: "R" });
  });

  it("ranks 13C above an unlabelled carbon", () => {
    expect(centreLetters(load("c13-propan-2-ol"))).toEqual({ a2: "R" });
  });
});

describe("rule 3: seqcis before seqtrans", () => {
  it("makes the carbinol between a Z and an E propenyl a centre with a letter", () => {
    // Identical under rules 1-2; before rule 3 this centre was silently dropped.
    const mol = load("rule3-allylic");
    expect(centreLetters(mol)).toEqual({ a4: "S" });
    expect(bondLetters(mol)).toEqual({ "a2=a3": "E", "a6=a7": "Z" });
  });
});

describe("rules 4 and 5: pseudoasymmetric centres read lowercase", () => {
  const cases: [string, Record<string, string>][] = [
    ["ribitol", { a3: "S", a5: "s", a7: "R" }],
    ["xylitol", { a3: "S", a5: "r", a7: "R" }],
    ["xylaric-acid", { a4: "R", a6: "s", a8: "S" }],
    ["tropine", { a3: "R", a6: "S", a8: "r" }],
    ["pseudotropine", { a3: "R", a6: "S", a8: "s" }],
    ["pentane-2-3-4-trithiol", { a2: "R", a4: "r", a6: "S" }],
    ["myo-inositol", { a2: "S", a3: "r", a5: "R", a7: "S", a9: "s", a11: "R" }],
    ["4-methylthiane-1-oxide", { a2: "r", a5: "r" }],
    ["cis-decalin", { a1: "s", a6: "s" }],
  ];
  for (const [name, expected] of cases) {
    it(`letters ${name} as RDKit does`, () => {
      expect(centreLetters(load(name))).toEqual(expected);
    });
  }

  it("keeps (2R,4R)-arabinitol's C3 out: it is not stereogenic in this configuration", () => {
    expect(centreLetters(load("arabinitol"))).toEqual({ a3: "R", a7: "R" });
    // It IS a potential unit of the constitution; the configuration rules it out.
    expect(cipUnits(load("arabinitol")).centreById.has("a5")).toBe(true);
  });

  it("refuses a pseudoasymmetric ranking without the configuration it needs", () => {
    const mol = load("ribitol");
    expect(rankStereoCentre(mol, "a5")).toEqual({ kind: "undetermined", reason: "ranking-unsupported" });
  });
});

describe("ring cis/trans at constitutionally symmetric centres (decision 32b)", () => {
  function parities(name: string): string {
    const config = stereoConfig(load(name));
    return config.centres.map((c) => `${c.atomId}:${c.reading.kind === "specified" ? c.reading.parity : "?"}`).join(" ");
  }

  it("gives cis- and trans-1,4-dimethylcyclohexane distinct configs and letters", () => {
    expect(centreLetters(load("cis-1-4-dimethylcyclohexane"))).toEqual({ a2: "s", a5: "s" });
    expect(centreLetters(load("trans-1-4-dimethylcyclohexane"))).toEqual({ a2: "r", a5: "r" });
    expect(stereoTopology(load("cis-1-4-dimethylcyclohexane")).centres.map((c) => c.atomId)).toEqual(["a2", "a5"]);
    expect(parities("cis-1-4-dimethylcyclohexane")).not.toEqual(parities("trans-1-4-dimethylcyclohexane"));
  });

  it("gives tranexamic acid's two isomers distinct configs", () => {
    expect(centreLetters(load("trans-tranexamic-acid"))).toEqual({ a3: "r", a6: "r" });
    expect(centreLetters(load("cis-tranexamic-acid"))).toEqual({ a3: "s", a6: "s" });
  });

  it("letters cis-cyclobutane-1,3-diol (1s,3s), IUPAC P-92.6's own example shape", () => {
    expect(centreLetters(load("cis-cyclobutane-1-3-diol"))).toEqual({ a2: "s", a4: "s" });
  });

  it("renders pseudoasymmetric letters in parentheses, lowercase", () => {
    expect(descriptorText({ kind: "r" })).toBe("(r)");
    expect(descriptorText({ kind: "s" })).toBe("(s)");
  });
});

describe("C=N and N=N units, the nitrogen lone pair lowest (decision 32c)", () => {
  const cases: [string, Record<string, string>][] = [
    ["butanone-oxime", { "a2=a3": "Z" }],
    ["hydrazone", { "a2=a5": "E" }],
    ["e-azobenzene", { "a7=a8": "E" }],
    ["z-azobenzene", { "a7=a8": "Z" }],
    ["n-methyl-imine", { "a2=a5": "Z" }],
  ];
  for (const [name, expected] of cases) {
    it(`reads ${name} as RDKit does, in stereo.ts and as a cis/trans unit in stereo-config`, () => {
      const mol = load(name);
      const found = bondLetters(mol);
      // Bond keys are stored from/to; compare as unordered pairs.
      const normal = (record: Record<string, string>) =>
        Object.fromEntries(Object.entries(record).map(([k, v]) => [k.split("=").sort().join("="), v]));
      expect(normal(found)).toEqual(normal(expected));
      expect(stereoConfig(mol).doubleBonds).toHaveLength(1);
      expect(stereoConfig(mol).doubleBonds[0]!.reading.kind).toBe("specified");
    });
  }

  it("does not make an N–H imine or a sulfilimine S=N a double-bond unit", () => {
    const nh = buildMolecule((b) => {
      const c = b.atom("C", ORIGIN);
      b.bond(c, b.atom("C", step(ORIGIN, 150)));
      const et = b.atom("C", step(ORIGIN, 210));
      b.bond(c, et);
      b.bond(et, b.atom("C", step(step(ORIGIN, 210), 150)));
      b.bond(c, b.atom("N", step(ORIGIN, 0)), 2);
    });
    expect(stereogenicBonds(nh)).toEqual([]);
    expect(stereogenicBonds(load("sulfilimine"))).toEqual([]);
  });
});

describe("heteroatom centres (decisions 43 and 47)", () => {
  // Letters RDKit get_stereo_tags gives for each SMILES in cases.json.
  const cases: [string, Record<string, string>][] = [
    ["phosphorus-ylide", { a2: "R" }],
    ["sulfilimine", { a2: "S" }],
    ["selenoxide", { a2: "R" }],
    ["arsine", { a2: "R" }],
    ["sulfoxide-charge-separated", { a2: "R" }],
    ["ethyl-nitrobenzenesulfinate", { a4: "S" }],
    ["methyl-methanesulfinate", { a3: "R" }],
    ["methyl-phenylphosphinate", { a3: "R" }],
    ["phosphine-oxide", { a2: "S" }],
    ["phosphine-oxide-charge-separated", { a2: "S" }],
    ["sulfoximine", { a2: "R" }],
    ["phosphate-triester", { a3: "R" }],
    ["phosphonate", { a3: "R" }],
    ["phosphoramidate", { a3: "R" }],
    ["phosphorothioate", { a3: "R" }],
  ];
  for (const [name, expected] of cases) {
    it(`letters ${name} as RDKit does`, () => {
      expect(centreLetters(load(name))).toEqual(expected);
    });
  }

  it("does not duplicate the multiple bond at the centre: S=O and S+–O− rank alike", () => {
    // IUPAC P-93.3.4.1's ethyl (R)-4-nitrobenzene-1-sulfinate figure ranks
    // OEt above =O, which holds only without a duplicate S on the oxygen.
    const mol = load("ethyl-nitrobenzenesulfinate");
    const ranking = rankStereoCentre(mol, "a4");
    expect(ranking?.kind).toBe("ranked");
    const order = ranking?.kind === "ranked" ? ranking.order : [];
    const ethoxy = order.findIndex((ref) => ref.kind === "atom" && mol.atoms[ref.atomId]!.element === "O" &&
      bondsAt(mol, ref.atomId).length === 2);
    const oxo = order.findIndex((ref) => ref.kind === "atom" && mol.atoms[ref.atomId]!.element === "O" &&
      bondsAt(mol, ref.atomId).length === 1);
    expect(ethoxy).toBeLessThan(oxo);
    // The phantom lone pair ranks lowest, always.
    expect(order[order.length - 1]).toEqual({ kind: "lonePair" });
  });

  it("lists the phosphate diester anion's P without a letter (escalated)", () => {
    // =O and O− tie under rules 1-2 and differ only by formal charge, which
    // is not a CIP criterion. RDKit lists it as "(?)".
    const mol = load("phosphate-diester-anion");
    expect(centreLetters(mol)).toEqual({ a3: "?ranking-unsupported" });
  });

  it("leaves Tröger's base's bridgehead nitrogens out, a KNOWN LIMIT (decision 43)", () => {
    // Tröger's base IS resolvable: its two bridgehead nitrogens are
    // configurationally locked by the methano bridge, and the compound was one
    // of the first resolved without a carbon stereocentre. Neither reader here
    // says so, and neither does RDKit 2025.03.4, which parses
    // [N@]...[N@@] and canonicalises the label away. Pinned so that the limit
    // is a recorded decision rather than an accident: the day it is lifted,
    // this test is what states what changed.
    const mol = load("trogers-base");
    expect(mol.atomIds.filter((id) => mol.atoms[id]!.element === "N")).toHaveLength(2);
    expect(stereocenterAtoms(mol)).toEqual([]);
    expect(stereoTopology(mol).centres).toEqual([]);
    // And it is not silently reported as an axis either.
    expect(unrepresentableStereo(mol)).toEqual([]);
  });

  it("refuses a centre whose ranking depends on how a branch P=O is drawn (escalated)", () => {
    // RDKit gives S drawn P=O and R drawn P+–O−; the IUPAC text says charges
    // are not considered. The two forms disagree, so no letter.
    expect(centreLetters(load("branch-phosphoryl"))).toEqual({ a2: "?ranking-unsupported" });
  });
});

describe("explicit protium equals the implicit hydrogen", () => {
  function ethanol(isotope: number | undefined) {
    return buildMolecule((b) => {
      const me = b.atom("C", step(ORIGIN, 210));
      const c = b.atom("C", ORIGIN);
      b.bond(me, c);
      b.bond(c, b.atom("O", step(ORIGIN, -30)));
      b.bond(c, b.atom("H", step(ORIGIN, 90), isotope === undefined ? {} : { isotope }), 1, "wedge");
    });
  }

  it("makes CH3–CH(H)–OH with one H drawn no centre in either reader", () => {
    const mol = ethanol(undefined);
    expect(stereocenterAtoms(mol)).toEqual([]);
    expect(cipDescriptor(mol, "a2")).toBeUndefined();
    expect(stereoTopology(mol).centres).toEqual([]);
    // 1H labelled is still protium.
    expect(stereocenterAtoms(ethanol(1))).toEqual([]);
  });

  it("makes CH3–CHD–OH a centre, R as drawn (RDKit reads this molblock R)", () => {
    const mol = ethanol(2);
    expect(centreLetters(mol)).toEqual({ a2: "R" });
  });
});

describe("mancude duplicates", () => {
  it("letters no heteroaromatic centre by which Kekulé form was drawn", () => {
    for (const name of ["pyridyl-ethanol", "nicotine", "esomeprazole"]) {
      const mol = load(name);
      let flipped = mol;
      for (const ring of rings(mol)) {
        if (ring.size !== 6) continue;
        const orders = ring.bondIds.map((id) => mol.bonds[id]!.order);
        if (!orders.every((o, i) => (o === 1 || o === 2) && o !== orders[(i + 1) % 6])) continue;
        for (const id of ring.bondIds) flipped = updateBond(flipped, id, { order: mol.bonds[id]!.order === 1 ? 2 : 1 });
      }
      expect(flipped, name).not.toBe(mol);
      expect(centreLetters(flipped), name).toEqual(centreLetters(mol));
    }
    expect(centreLetters(load("pyridyl-ethanol"))).toEqual({ a2: "S" });
    expect(centreLetters(load("nicotine"))).toEqual({ a6: "S" });
    expect(centreLetters(load("esomeprazole"))).toEqual({ a9: "S" });
  });

  it("finds toluene's two ortho branches identical, whichever Kekulé form", () => {
    const mol = load("2-2-6-6-tetramethylbiphenyl");
    // a8 is an axis carbon; its ring neighbours a2 and a6 both carry a methyl.
    const ortho = bondsAt(mol, "a8").map((b) => otherEnd(b, "a8")).filter((id) => id !== "a9");
    expect(rankSubstituentPair(mol, "a8", ortho[0]!, ortho[1]!)).toEqual({ kind: "identical" });
  });
});

describe("scale", () => {
  it("letters taxol and erythromycin as RDKit does, within the caps", () => {
    expect(centreLetters(load("taxol"))).toEqual({
      a5: "S", a6: "S", a7: "R", a8: "S", a9: "R", a13: "S", a14: "S", a17: "R", a38: "S", a42: "R", a44: "S",
    });
    expect(centreLetters(load("erythromycin"))).toEqual({
      a3: "R", a4: "S", a5: "R", a6: "R", a9: "R", a11: "R", a12: "R", a13: "S", a14: "S", a15: "R",
      a21: "R", a23: "R", a24: "S", a25: "S", a34: "S", a35: "R", a36: "S", a38: "R",
    });
  });

  it("reports ranking-truncated, never a letter, past MAX_SPHERES", () => {
    // Two chains that differ only at their far ends, 70 atoms out: past the
    // 64-sphere cap. Built through MoleculeBuilder: addAtom in a loop is quadratic.
    const mol = buildMolecule((b) => {
      const c = b.atom("C", ORIGIN);
      b.bond(c, b.atom("O", step(ORIGIN, 90)), 1, "wedge");
      let left = c;
      let right = c;
      for (let i = 1; i <= 70; i++) {
        const l = b.atom("C", { x: -i, y: -1 });
        b.bond(left, l);
        left = l;
        const r = b.atom("C", { x: i, y: -1 });
        b.bond(right, r);
        right = r;
      }
      b.bond(right, b.atom("F", { x: 71, y: -2 }));
    });
    expect(cipDescriptor(mol, "a1")).toEqual({ kind: "undetermined", reason: "ranking-truncated" });
  });
});
