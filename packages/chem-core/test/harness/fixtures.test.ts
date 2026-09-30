/**
 * THE FIXTURES, BEFORE ANY LAYOUT RUNS. Every descriptor a projection is
 * later checked against is asserted to be a letter here first, because an
 * undetermined descriptor survives every projection perfectly and would make
 * the whole matrix pass while proving nothing (the architectural ruling on
 * CIP depth). The schemes are checked as schemes: species, formulae, a
 * balanced reaction, one compound on both sides of a resonance arrow. And a
 * row with nothing to state asserts that emptiness, against RDKit's CIP as
 * the generation script recorded it, instead of passing the law vacuously.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { composition, speciesRelationIssues, type Composition } from "../../src/mechanism.js";
import { species } from "../../src/species.js";
import { stereoConfig } from "../../src/stereo-config.js";
import { stereocenterAtoms } from "../../src/stereo.js";
import {
  FIXTURE_ROOT,
  HARNESS_FIXTURES,
  fixtureName,
  fixturePath,
  harnessManifest,
  loadFixture,
  type ManifestEntry,
} from "./fixtures.js";
import { isLetter, letters, relations } from "./law.js";

describe("the harness's fixtures, before any layout runs", () => {
  it("are the checked-in molblocks of three RDKit-generated sets, each listed in its manifest", () => {
    for (const set of ["projection", "steroid", "harness"] as const) {
      const manifest = JSON.parse(readFileSync(join(FIXTURE_ROOT, set, "manifest.json"), "utf8")) as {
        rdkit: string;
        fixtures: { file: string }[];
      };
      expect(manifest.rdkit, set).toMatch(/@rdkit\/rdkit 2025\.03\.4/);
      const listed = new Set(manifest.fixtures.map((f) => f.file));
      for (const fixture of HARNESS_FIXTURES.filter((f) => f.set === set)) {
        expect(listed.has(fixture.file), fixtureName(fixture)).toBe(true);
        expect(existsSync(fixturePath(fixture)), fixtureName(fixture)).toBe(true);
        // Line 1 names the compound and its RDKit generation.
        expect(readFileSync(fixturePath(fixture), "utf8").split("\n")[0], fixtureName(fixture)).toMatch(/RDKit 2025\.03\.4\)$/);
      }
    }
    // The matrix takes the WHOLE projection and harness sets: a molecule added
    // to either joins every row without an edit elsewhere forgetting it.
    for (const set of ["projection", "harness"] as const) {
      const files = readdirSync(join(FIXTURE_ROOT, set)).filter((f) => f.endsWith(".mol")).sort();
      expect(HARNESS_FIXTURES.filter((f) => f.set === set).map((f) => f.file).sort(), set).toEqual(files);
    }
  });

  for (const fixture of HARNESS_FIXTURES) {
    it(`${fixtureName(fixture)}: every stereo unit resolves to a letter`, () => {
      const mol = loadFixture(fixture);
      const config = stereoConfig(mol);
      expect(config.centres.map((c) => c.atomId)).toEqual(stereocenterAtoms(mol));
      for (const [atomId, letter] of Object.entries(letters(mol, config))) {
        expect(isLetter(letter), `${atomId} reads ${letter}`).toBe(true);
      }
      for (const [bondId, relation] of Object.entries(relations(config))) {
        expect(["cis", "trans"], bondId).toContain(relation);
      }
    });
  }

  it("letter the harness set exactly as RDKit did when the script wrote it", () => {
    for (const entry of harnessManifest()) {
      const fixture = HARNESS_FIXTURES.find((f) => f.set === "harness" && f.file === entry.file)!;
      const mol = loadFixture(fixture);
      const config = stereoConfig(mol);
      const byRow = letters(mol, config);
      // The manifest lists RDKit's letters in SMILES atom order, which is row
      // order; chem-core's centres come out in the same order.
      const expected = entry.species.flatMap((s) => s.cip);
      expect(config.centres.map((c) => byRow[c.atomId]), entry.file).toEqual(expected);
    }
  });

  it("have propylene pentamers whose tacticity is not one letter repeated", () => {
    // (3R,5R,7R,9S,11S) is isotactic: from C9 on, the unbranched butyl end
    // ranks below the chain toward C1. A harness that expected "all R" for an
    // isotactic chain would be testing the wrong chemistry.
    const read = (file: string) => {
      const fixture = HARNESS_FIXTURES.find((f) => f.file === file)!;
      const mol = loadFixture(fixture);
      return Object.values(letters(mol, stereoConfig(mol))).join("");
    };
    expect(read("isotactic-pentamer.mol")).toBe("RRRSS");
    expect(read("syndiotactic-pentamer.mol")).toBe("RSRRS");
    expect(read("atactic-pentamer.mol")).toBe("RRSSR");
  });
});

// ---------------------------------------------------------------------------
// Rows with nothing to state
// ---------------------------------------------------------------------------

describe("a fixture with no stereo unit states that emptiness", () => {
  const EMPTY: readonly [string, readonly string[]][] = [
    ["butane.mol", []],
    ["allyl-cation-resonance.mol", []],
    ["propan-2-ol-wedged.mol", []],
    // The allene's axis is real configuration that no unit here can state.
    ["penta-2-3-diene.mol", ["allene-axis"]],
  ];
  for (const [file, unrepresentable] of EMPTY) {
    it(`${file}: no centre and no double bond, as RDKit found none`, () => {
      const entry = harnessManifest().find((e) => e.file === file)!;
      expect(entry.species.flatMap((s) => s.cip)).toEqual([]);
      const mol = loadFixture(HARNESS_FIXTURES.find((f) => f.file === file)!);
      const config = stereoConfig(mol);
      expect(config.centres).toEqual([]);
      expect(config.doubleBonds).toEqual([]);
      expect(config.unrepresentable.map((u) => u.kind)).toEqual(unrepresentable);
    });
  }

  it("keeps the wedge the script drew on propan-2-ol's C2-O, which states nothing", () => {
    const mol = loadFixture(HARNESS_FIXTURES.find((f) => f.file === "propan-2-ol-wedged.mol")!);
    const wedged = mol.bondIds.map((id) => mol.bonds[id]!).filter((b) => b.stereo !== "none");
    expect(wedged).toMatchObject([{ from: "a2", to: "a4", stereo: "wedge" }]);
  });
});

// ---------------------------------------------------------------------------
// The schemes
// ---------------------------------------------------------------------------

/** A composition as a Hill-ordered formula with its charge: "C4H9Br", "HO-". */
function formula(c: Composition): string {
  const counts: Record<string, number> = { ...c.heavyAtoms };
  const h = c.hydrogenAtoms + c.implicitHydrogens;
  if (h > 0) counts["H"] = h;
  const order = Object.keys(counts).sort((a, b) => {
    const rank = (e: string) => (e === "C" ? 0 : e === "H" ? 1 : 2);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  const body = order.map((e) => `${e}${counts[e] === 1 ? "" : counts[e]}`).join("");
  const charge = c.netCharge === 0 ? "" : c.netCharge > 0 ? "+".repeat(c.netCharge) : "-".repeat(-c.netCharge);
  return `${body}${charge}`;
}

function sum(parts: readonly Composition[]): Composition {
  const heavyAtoms: Record<string, number> = {};
  let hydrogenAtoms = 0;
  let implicitHydrogens = 0;
  let netCharge = 0;
  for (const part of parts) {
    for (const [element, count] of Object.entries(part.heavyAtoms)) heavyAtoms[element] = (heavyAtoms[element] ?? 0) + count;
    hydrogenAtoms += part.hydrogenAtoms;
    implicitHydrogens += part.implicitHydrogens;
    netCharge += part.netCharge;
  }
  return { heavyAtoms, hydrogenAtoms, implicitHydrogens, netCharge };
}

const SCHEME_FORMULAE: Readonly<Record<string, readonly string[]>> = {
  "sn2-scheme.mol": ["HO-", "C4H9Br", "C4H10O", "Br-"],
  "aldol-scheme.mol": ["C3H6O", "C4H8O", "C7H14O2"],
  "allyl-cation-resonance.mol": ["C3H5+", "C3H5+"],
  "ester-hydrolysis-equilibrium.mol": ["C5H10O3", "H2O", "C3H6O3", "C2H6O"],
};

describe("the schemes, checked as schemes before anything is projected (decision 211)", () => {
  const schemes = harnessManifest().filter((e): e is ManifestEntry & { arrows: NonNullable<ManifestEntry["arrows"]> } => e.arrows !== undefined);

  it("are the four decision 211 names, each one molecule of several species", () => {
    expect(schemes.map((e) => e.file).sort()).toEqual(Object.keys(SCHEME_FORMULAE).sort());
    for (const entry of schemes) {
      const fixture = HARNESS_FIXTURES.find((f) => f.file === entry.file)!;
      expect(fixture.family).toBe("scheme");
    }
  });

  for (const [file, formulae] of Object.entries(SCHEME_FORMULAE)) {
    it(`${file}: its species, formulae and arrows balance`, () => {
      const entry = schemes.find((e) => e.file === file)!;
      const mol = loadFixture(HARNESS_FIXTURES.find((f) => f.file === file)!);
      const found = species(mol);
      expect(found).toHaveLength(entry.species.length);
      // Species come out in the order their first atoms were written, which
      // is the order the script laid them out left to right.
      expect(found.map((s) => s.atomIds.length)).toEqual(entry.species.map((s) => s.atoms));
      const compositions = found.map((s) => composition(mol, s.atomIds));
      expect(compositions.map(formula)).toEqual(formulae);
      for (let i = 1; i < found.length; i++) {
        const left = found[i - 1]!.atomIds.map((id) => mol.atoms[id]!.pos.x);
        const right = found[i]!.atomIds.map((id) => mol.atoms[id]!.pos.x);
        expect(Math.min(...right), "left to right").toBeGreaterThan(Math.max(...left));
      }

      for (const arrow of entry.arrows) {
        const side = (indices: readonly number[]) => sum(indices.map((i) => compositions[i]!));
        const anchors = (indices: readonly number[]) => indices.map((i) => found[i]!.atomIds[0]!);
        if (arrow.kind === "resonance") {
          expect(speciesRelationIssues(mol, "resonance", anchors(arrow.from), anchors(arrow.to))).toEqual([]);
        } else {
          // Every atom and every charge accounted for: nothing left off the page.
          expect(formula(side(arrow.to)), `${arrow.kind} arrow`).toBe(formula(side(arrow.from)));
        }
      }
    });
  }

  it("would catch a resonance pair that lost a hydrogen or a charge", () => {
    // The check has teeth: the SN2's substrate and product are not one compound.
    const mol = loadFixture(HARNESS_FIXTURES.find((f) => f.file === "sn2-scheme.mol")!);
    const [, substrate, product] = species(mol);
    const issues = speciesRelationIssues(mol, "resonance", [substrate!.atomIds[0]!], [product!.atomIds[0]!]);
    expect(issues.map((i) => i.kind)).toEqual(["resonance-formula-differs"]);
  });

  it("record the conditions the reaction arrows will carry once they are drawn", () => {
    const aldol = schemes.find((e) => e.file === "aldol-scheme.mol")!;
    expect(aldol.arrows).toEqual([
      { kind: "forward", from: [0, 1], to: [2], above: ["L-proline (30 mol%)"], below: ["DMSO, rt"] },
    ]);
    const ester = schemes.find((e) => e.file === "ester-hydrolysis-equilibrium.mol")!;
    expect(ester.arrows![0]).toMatchObject({ kind: "equilibrium", above: ["H+ (cat.)"] });
  });

  it("invert the SN2's centre and keep the ester hydrolysis's, as the chemistry says", () => {
    const letterOf = (file: string) => {
      const mol = loadFixture(HARNESS_FIXTURES.find((f) => f.file === file)!);
      return letters(mol, stereoConfig(mol));
    };
    // (R)-2-bromobutane to (S)-butan-2-ol: Walden inversion.
    expect(letterOf("sn2-scheme.mol")).toEqual({ a3: "R", a8: "S" });
    // Ethyl (S)-lactate to (S)-lactic acid: the centre is not touched.
    expect(letterOf("ester-hydrolysis-equilibrium.mol")).toEqual({ a2: "S", a11: "S" });
    expect(letterOf("aldol-scheme.mol")).toEqual({ a14: "R" });
  });
});
