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
import { auxiliaryRank, compareRule1b, rankStereoCentre, rankSubstituentPair, cipUnits } from "./cip.js";
import type { CipAuxiliaryDescriptor, Rule1bNode } from "./cip.js";
import { readMolblock } from "./molblock-read.js";
import { bondsAt, otherEnd } from "./molecule.js";
import { updateAtom, updateBond } from "./ops.js";
import { rings } from "./rings.js";
import { isAchiral } from "./achirality.js";
import { unrepresentableStereo } from "./stereo-axes.js";
import {
  cipDescriptor,
  descriptorText,
  doubleBondDescriptor,
  stereocenterAtoms,
  stereogenicBonds,
  structuralIssues,
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

describe("rule 1b, the comparator no molecule pins", () => {
  /**
   * Replacing the whole RULE_1B branch of `keyCompare` with "tie" leaves every
   * letter in the fixture corpus unchanged, so the rule cannot be asserted
   * through a molecule: some earlier key or later rule always settles the
   * comparison a letter hangs on. It is not dead, though — instrumenting it
   * over the 109 checked-in molecules counts 1074 ring-closure pairs decided
   * by distance in each reading, and 90 ring-against-mancude pairs decided in
   * the Hanson reading alone. So it is pinned here, directly, as the pure
   * comparison it is. Each test says whether the shape it covers is one the
   * corpus reaches.
   */
  const atom: Rule1bNode = {
    duplicate: false,
    ringDuplicate: false,
    mancudeDuplicate: false,
    originDepth: 3,
  };
  const dup = (originDepth: number, kind: "ring" | "multiple" | "mancude"): Rule1bNode => ({
    duplicate: true,
    ringDuplicate: kind === "ring",
    mancudeDuplicate: kind === "mancude",
    originDepth,
  });

  it("ranks the duplicate whose original is NEARER the root higher", () => {
    // P-92.1.3.1(b). Nearer the root is the SMALLER origin depth, so the
    // comparison runs against the number — the sign trap this pins. Reached
    // by the corpus, 1074 times in each reading.
    expect(compareRule1b("iupac", dup(1, "ring"), dup(4, "ring"))).toBe(1);
    expect(compareRule1b("iupac", dup(4, "ring"), dup(1, "ring"))).toBe(-1);
    expect(compareRule1b("hanson", dup(1, "ring"), dup(4, "ring"))).toBe(1);
    expect(compareRule1b("iupac", dup(2, "ring"), dup(2, "ring"))).toBe(0);
  });

  it("orders two MULTIPLE-BOND duplicates in the IUPAC reading and not in Hanson's", () => {
    // The literal P-92 text says "duplicate atoms", not "ring-closure
    // duplicates"; Hanson and RDKit narrow it. NOT reached by any checked-in
    // molecule, which is exactly why it is asserted here.
    expect(compareRule1b("iupac", dup(1, "multiple"), dup(3, "multiple"))).toBe(1);
    expect(compareRule1b("hanson", dup(1, "multiple"), dup(3, "multiple"))).toBe(0);
  });

  it("ranks a ring-closure duplicate over anything else, in Hanson's reading only", () => {
    // A ring duplicate keyed against a real atom is also unreached by the
    // corpus.
    expect(compareRule1b("hanson", dup(5, "ring"), atom)).toBe(1);
    expect(compareRule1b("hanson", atom, dup(5, "ring"))).toBe(-1);
    expect(compareRule1b("hanson", dup(5, "ring"), dup(1, "multiple"))).toBe(1);
    // The IUPAC reading has no such precedence: a duplicate against a
    // non-duplicate is simply not ordered by rule 1b.
    expect(compareRule1b("iupac", dup(5, "ring"), atom)).toBe(0);
    expect(compareRule1b("iupac", dup(1, "multiple"), atom)).toBe(0);
  });

  it("keeps a mancude duplicate out of every IUPAC distance order", () => {
    // Where a mancude duplicate sits is a Kekulé artefact, so ordering on it
    // ranked toluene's two ortho branches apart. Dropping this carve-out is
    // the regression the test exists for.
    expect(compareRule1b("iupac", dup(1, "mancude"), dup(4, "ring"))).toBe(0);
    expect(compareRule1b("iupac", dup(4, "ring"), dup(1, "mancude"))).toBe(0);
    expect(compareRule1b("iupac", dup(1, "mancude"), dup(4, "mancude"))).toBe(0);
    // Hanson's rule does not consult the origin depth there, but its
    // ring-closure precedence still applies — and that IS reached by the
    // corpus, 90 times.
    expect(compareRule1b("hanson", dup(4, "ring"), dup(1, "mancude"))).toBe(1);
  });

  it("is a tie when neither node is a duplicate, whatever their depths", () => {
    expect(compareRule1b("iupac", atom, { ...atom, originDepth: 9 })).toBe(0);
    expect(compareRule1b("hanson", atom, { ...atom, originDepth: 9 })).toBe(0);
  });

  it("has inputs the two readings disagree on, which is what refuses a letter", () => {
    // `ranking-unsupported` for a rule-1b disagreement is reachable only
    // because such inputs exist. If this ever came back empty, the refusal
    // would be unreachable and the module header would be describing a hazard
    // the code no longer has.
    const shapes: Rule1bNode[] = [
      atom,
      dup(1, "ring"),
      dup(4, "ring"),
      dup(1, "multiple"),
      dup(2, "mancude"),
    ];
    const disagreements = shapes.flatMap((a) =>
      shapes.filter((b) => compareRule1b("iupac", a, b) !== compareRule1b("hanson", a, b)),
    );
    expect(disagreements.length).toBeGreaterThan(0);
  });

  it("is antisymmetric on every shape it can be handed", () => {
    const shapes: Rule1bNode[] = [
      atom,
      dup(0, "ring"),
      dup(1, "ring"),
      dup(4, "ring"),
      dup(1, "multiple"),
      dup(4, "multiple"),
      dup(1, "mancude"),
      dup(4, "mancude"),
    ];
    for (const variant of ["iupac", "hanson"] as const) {
      for (const a of shapes) {
        for (const b of shapes) {
          // Summed rather than negated: -0 is not +0 under Object.is.
          expect(compareRule1b(variant, a, b) + compareRule1b(variant, b, a), variant).toBe(0);
        }
      }
    }
  });
});

describe("the refusals the header names are reached, not just described (decision 76)", () => {
  /**
   * A refusal nothing reaches is a promise nobody has checked. Each test here
   * drives one NAMED refusal of the module header to its reason. The header
   * says which of cip.ts's `ranking-unsupported` / `ranking-truncated` returns
   * are part of that contract and which are internal guards that no input
   * found so far reaches.
   */
  it("refuses a mancude mean it could not compute: cyclopentadienide", () => {
    // The anion's carbanion sits outside the perfect matching, so no Kekulé
    // structure gives its neighbours' duplicates a mean atomic number. IUPAC
    // counts the anion's electron pair; this build does not, and says so.
    const mol = load("cyclopentadienide-carbinol");
    expect(centreLetters(mol)).toEqual({ a2: "?ranking-unsupported" });
  });

  it("refuses two branches that differ only in formal charge", () => {
    // Charge is not a CIP criterion, so =O against O- is neither ordered nor
    // identical. This is the phosphate diester anion's P.
    expect(centreLetters(load("phosphate-diester-anion"))).toEqual({ a3: "?ranking-unsupported" });
  });

  it("truncates rather than approximating when a cap bites", () => {
    const mol = load("butyl-propyl-carbinol");
    for (const limits of [{ maxSpheres: 2 }, { maxBranchNodes: 10 }]) {
      expect(rankSubstituentPair(mol, "a5", "a4", "a8", limits), JSON.stringify(limits)).toEqual({
        kind: "undetermined",
        reason: "ranking-truncated",
      });
    }
  });

  it("refuses a ranking that needs a configuration nobody handed it", () => {
    // rankStereoCentre without a configuration cannot run rules 3 to 5, so a
    // centre that ties under rules 1-2 has no letter rather than a guess.
    expect(rankStereoCentre(load("ribitol"), "a5")).toEqual({
      kind: "undetermined",
      reason: "ranking-unsupported",
    });
  });

  it("refuses a hypervalent branch whose ranking depends on how it was drawn", () => {
    expect(centreLetters(load("branch-phosphoryl"))).toEqual({ a2: "?ranking-unsupported" });
  });

  it("refuses an isotope label too close to the standard weight to order", () => {
    // 127-iodine against unlabelled iodine differ by less than 0.5, so rule 2
    // does not order them. 125-iodine, three units away, does get a letter.
    const mol = load("iodo-125");
    expect(centreLetters(mol)).toEqual({ a2: "R" });
    const labelled = mol.atomIds.find((id) => mol.atoms[id]!.isotope === 125)!;
    const blunted = updateAtom(mol, labelled, { isotope: 127 });
    expect(centreLetters(blunted)).toEqual({ a2: "?ranking-unsupported" });
  });
});

describe("rules 4a and 4c, the ordinals no molecule pins (decision 75)", () => {
  // Deleting either rule leaves every letter in the corpus unchanged: they
  // need a node whose branches tie through rule 4b and then differ only in
  // whether they carry a descriptor, or only in its case. No fixture reaches
  // that, and 160 enumerated heptitols and nonitols do not either. So the
  // ordinals are asserted directly, as compareRule1b is.
  const ALL: CipAuxiliaryDescriptor[] = ["R", "S", "r", "s", "E", "Z", "none"];

  it("rule 4a puts a chirality descriptor over a pseudoasymmetric or E/Z one, and both over none", () => {
    for (const upper of ["R", "S"] as const) {
      for (const lower of ["r", "s", "E", "Z"] as const) {
        expect(auxiliaryRank("4a", upper), `${upper} over ${lower}`).toBeGreaterThan(
          auxiliaryRank("4a", lower),
        );
        expect(auxiliaryRank("4a", lower), `${lower} over none`).toBeGreaterThan(
          auxiliaryRank("4a", "none"),
        );
      }
    }
    // R against S, and r against s, are ties HERE: rule 4a only says which
    // KIND of descriptor a node carries. Ranking them apart at 4a would let
    // rule 4a decide what rules 4c and 5 exist to decide.
    expect(auxiliaryRank("4a", "R")).toBe(auxiliaryRank("4a", "S"));
    expect(auxiliaryRank("4a", "r")).toBe(auxiliaryRank("4a", "s"));
    expect(auxiliaryRank("4a", "E")).toBe(auxiliaryRank("4a", "Z"));
  });

  it("rule 4c puts r over s, and is blind to everything else", () => {
    expect(auxiliaryRank("4c", "r")).toBeGreaterThan(auxiliaryRank("4c", "s"));
    // The UPPERCASE pair is rule 5's, not 4c's. A 4c that also ordered R over
    // S would letter a pseudoasymmetric centre from the wrong rule.
    expect(auxiliaryRank("4c", "R")).toBe(auxiliaryRank("4c", "S"));
    for (const aux of ["R", "S", "E", "Z", "none"] as const) {
      expect(auxiliaryRank("4c", aux), aux).toBeLessThan(auxiliaryRank("4c", "s"));
    }
  });

  it("rule 3 puts Z over E, and rule 5 puts R over S, each blind to the other's pair", () => {
    expect(auxiliaryRank("3", "Z")).toBeGreaterThan(auxiliaryRank("3", "E"));
    expect(auxiliaryRank("3", "R")).toBe(auxiliaryRank("3", "S"));
    expect(auxiliaryRank("5", "R")).toBeGreaterThan(auxiliaryRank("5", "S"));
    expect(auxiliaryRank("5", "r")).toBe(auxiliaryRank("5", "s"));
    expect(auxiliaryRank("5", "Z")).toBe(auxiliaryRank("5", "E"));
  });

  it("gives every rule a total order over every descriptor", () => {
    for (const rule of ["3", "4a", "4c", "5"] as const) {
      for (const aux of ALL) {
        expect(Number.isInteger(auxiliaryRank(rule, aux)), `${rule} ${aux}`).toBe(true);
      }
      // Each rule must actually separate something, or it is not a rule.
      const values = new Set(ALL.map((aux) => auxiliaryRank(rule, aux)));
      expect(values.size, rule).toBeGreaterThan(1);
    }
  });
});

describe("every bound is pinned by a case its value decides (decision 75)", () => {
  /**
   * A cap nothing discriminates is a cap that can be deleted. The shipped
   * values are far past anything a figure contains — 23 spheres needed against
   * 64, 230 nodes against 20000 — so reaching them from a drawing takes a
   * pathological cage that ranks in seconds, which is a bad fixture and a worse
   * thing to run on every commit. Each cap is therefore an argument with the
   * shipped value as its default, exactly as `isAchiral`'s `maxSearchNodes`
   * already is, and each test below lowers ONE cap over an ordinary molecule
   * and shows the answer change. Raising that cap to infinity restores the
   * unbounded answer, which is what makes the test discriminating.
   */
  it("MAX_SPHERES: a comparison that needs sphere 3 is truncated at 2", () => {
    // Butyl against propyl on one carbinol: identical until the butyl's fourth
    // carbon, so the answer depends on being allowed to look that far.
    const mol = load("butyl-propyl-carbinol");
    expect(rankSubstituentPair(mol, "a5", "a4", "a8")).toEqual({ kind: "ordered", aFirst: true });
    expect(rankSubstituentPair(mol, "a5", "a4", "a8", { maxSpheres: 3 })).toEqual({
      kind: "ordered",
      aFirst: true,
    });
    expect(rankSubstituentPair(mol, "a5", "a4", "a8", { maxSpheres: 2 })).toEqual({
      kind: "undetermined",
      reason: "ranking-truncated",
    });
    // Unbounded gives the shipped answer: the cap is not what decides it.
    expect(rankSubstituentPair(mol, "a5", "a4", "a8", { maxSpheres: 1e9 })).toEqual({
      kind: "ordered",
      aFirst: true,
    });
  });

  it("MAX_BRANCH_NODES: the same comparison is truncated on a ten-node budget", () => {
    const mol = load("butyl-propyl-carbinol");
    expect(rankSubstituentPair(mol, "a5", "a4", "a8", { maxBranchNodes: 10 })).toEqual({
      kind: "undetermined",
      reason: "ranking-truncated",
    });
    expect(rankSubstituentPair(mol, "a5", "a4", "a8", { maxBranchNodes: 1e9 })).toEqual({
      kind: "ordered",
      aFirst: true,
    });
  });

  it("MAX_KEKULE_STRUCTURES: pyridyl duplicates go fuzzy on an exhausted budget", () => {
    // 2-pyridyl against 3-pyridyl is decided by the MEAN atomic number of the
    // duplicates over every Kekulé structure. With no structures enumerated
    // the means are unknown, and an unknown mean is refused, never guessed.
    const mol = load("bis-pyridyl-carbinol");
    expect(rankSubstituentPair(mol, "a2", "a4", "a10")).toEqual({ kind: "ordered", aFirst: true });
    expect(rankSubstituentPair(mol, "a2", "a4", "a10", { maxKekuleStructures: 0 })).toEqual({
      kind: "undetermined",
      reason: "ranking-unsupported",
    });
    expect(rankSubstituentPair(mol, "a2", "a4", "a10", { maxKekuleStructures: 1e9 })).toEqual({
      kind: "ordered",
      aFirst: true,
    });
  });

  it("the automorphism cap: cubane is achiral, and says so instead past a cap of 3", () => {
    // achirality.test.ts owns this one; repeated here so decision 75's four
    // bounds read as one list.
    expect(isAchiral(load("cubane")).kind).toBe("achiral");
    expect(isAchiral(load("cubane"), { maxSearchNodes: 3 })).toEqual({
      kind: "undetermined",
      reason: "search-truncated",
    });
  });
});

describe("bridged cages are not stereocentres (decision 74)", () => {
  // The greatest-fixed-point rule keeps a tied centre whose branches reach
  // another surviving unit, and in a bridged cage the bridgeheads reach only
  // each other: they held one another up in a circle and every one of them was
  // reported as a stereocentre. None of these molecules has a stereoisomer.
  const cages = [
    "norbornane",
    "bicyclo-3-3-1-nonane",
    "7-oxanorbornane",
    "adamantane",
    "1-adamantanol",
    "amantadine",
  ];
  for (const name of cages) {
    it(`finds no centre in ${name}, as RDKit finds none`, () => {
      const mol = load(name);
      expect(stereocenterAtoms(mol)).toEqual([]);
      expect(centreLetters(mol)).toEqual({});
      expect(stereoTopology(mol).centres).toEqual([]);
      expect(stereoConfig(mol).centres).toEqual([]);
    });
  }

  it("calls the symmetric cages achiral, not undetermined", () => {
    // The phantom centres were unread units, so the achirality proof could not
    // finish and answered `unspecified-unit` for molecules that are plainly
    // achiral.
    for (const name of ["1-adamantanol", "amantadine", "norbornane", "adamantane"]) {
      expect(isAchiral(load(name)).kind, name).toBe("achiral");
    }
  });

  it("reports a wedge in a cage as a wedge on a non-stereocentre again", () => {
    // The pass reports and never repairs, so the wedge is still DRAWN; what
    // changed is that there is no configuration left for it to name.
    const mol = load("norbornane");
    const bondId = bondsAt(mol, "a3")[0]!.id;
    const wedged = updateBond(mol, bondId, { stereo: "wedge" });
    expect(structuralIssues(wedged).map((issue) => issue.kind)).toContain(
      "wedge-on-non-stereocenter",
    );
    expect(cipDescriptor(wedged, "a3")).toBeUndefined();
  });

  it("keeps memantine's two methylated bridgeheads, the two RDKit finds", () => {
    // Their ligands rank pairwise distinct under rules 1-2 — three different
    // CH2 branches — so they are not tied and the bridge rule never sees them.
    // The amine-bearing bridgehead and the CH bridgehead ARE tied (two of
    // their branches lead to the two methylated carbons) and go.
    expect(stereocenterAtoms(load("memantine"))).toEqual(["a2", "a4"]);
  });

  it("still separates cis- and trans-decalin: a fusion is not a bridge", () => {
    // Decalin's two rings share ONE bond, so its ring-fusion carbons are not
    // bridgeheads. Were the rule written on ring membership rather than on
    // shared bonds, cis- and trans-decalin would collapse into one compound.
    expect(stereocenterAtoms(load("cis-decalin"))).toHaveLength(2);
  });

  it("keeps BOTH units of a 4-substituted cyclohexanone oxime or hydrazone", () => {
    // These look like the cage case and are not. C4's two ring arms are tied,
    // and the automorphism that swaps them also exchanges the two ring atoms
    // the C=N is measured against, so it flips the C=N geometry: the swap is
    // no symmetry of the molecule and both units are real. The ring is a single
    // ring anyway, so the bridge rule never applies — this pins that it stays
    // that way if the rule is ever widened.
    for (const name of ["4-methylcyclohexanone-oxime", "4-methylcyclohexanone-hydrazone"]) {
      const mol = load(name);
      expect(stereocenterAtoms(mol), name).toHaveLength(1);
      expect(stereogenicBonds(mol), name).toHaveLength(1);
      expect(stereoConfig(mol).centres, name).toHaveLength(1);
      expect(stereoConfig(mol).doubleBonds, name).toHaveLength(1);
    }
  });

  it("leaves every tied centre that no bridge holds", () => {
    // The regression guard for the rule's reach: a substituent is not a bridge.
    expect(stereocenterAtoms(load("cis-1-4-dimethylcyclohexane"))).toEqual(["a2", "a5"]);
    expect(stereocenterAtoms(load("trans-1-4-dimethylcyclohexane"))).toEqual(["a2", "a5"]);
    expect(stereocenterAtoms(load("cis-cyclobutane-1-3-diol"))).toHaveLength(2);
    expect(centreLetters(load("ribitol"))).toMatchObject({ a5: "s" });
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
