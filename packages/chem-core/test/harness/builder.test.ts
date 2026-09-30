/**
 * The layout-to-Molecule builder stays a test fixture (the architectural
 * ruling; decision 210): unreachable from the package anyone imports, and
 * branded so a document refuses what it builds. shared's document.test.ts
 * hands the builder's own product to `createDocument` and `encodeDocument`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { setAtomPosition } from "../../src/ops.js";
import { project } from "../../src/projection/engine.js";
import { stereoConfig } from "../../src/stereo-config.js";
import { isTestOnlyMolecule, TEST_ONLY_MOLECULE } from "../../src/test-only.js";
import { HARNESS_FIXTURES, loadFixture, viewFor } from "./fixtures.js";
import { moleculeFromLayout } from "./rebuild.js";

const CHEM_CORE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : name.endsWith(".ts") ? [path] : [];
  });
}

function fischerOfGlucose() {
  const fixture = HARNESS_FIXTURES.find((f) => f.file === "d-glucose-open.mol")!;
  const mol = loadFixture(fixture);
  const chosen = viewFor(fixture, mol, "chain/fischer");
  if (chosen.kind !== "view") throw new Error("no Fischer view");
  const result = project(mol, stereoConfig(mol), chosen.view);
  if (result.kind !== "available") throw new Error(result.kind);
  return { mol, layout: result.layout };
}

describe("the layout-to-Molecule builder", () => {
  it("brands what it builds, invisibly to JSON, and an edited copy is no longer branded", () => {
    const { mol, layout } = fischerOfGlucose();
    const rebuilt = moleculeFromLayout(mol, layout).molecule;
    expect(isTestOnlyMolecule(rebuilt)).toBe(true);
    expect(isTestOnlyMolecule(mol)).toBe(false);
    expect(Object.keys(rebuilt)).not.toContain(String(TEST_ONLY_MOLECULE));
    expect(JSON.stringify(rebuilt)).not.toContain("test-only");
    expect(isTestOnlyMolecule(setAtomPosition(rebuilt, "a3", { x: 5, y: 5 }))).toBe(false);
  });

  it("draws every source atom where the layout does, and each synthetic hydrogen as an H atom on its host", () => {
    const { mol, layout } = fischerOfGlucose();
    const { molecule, atomOfNode } = moleculeFromLayout(mol, layout);
    // The four crossings of D-glucose sit on the page axis, each with an H arm.
    for (const centre of ["a3", "a5", "a7", "a9"]) {
      expect(molecule.atoms[centre]!.pos).toEqual(layout.positions[centre]);
      const h = atomOfNode.get(`${centre}.H`)!;
      expect(molecule.atoms[h]).toMatchObject({ element: "H", pos: layout.positions[`${centre}.H`] });
    }
    // CHO's carbon is ON its node; its oxygen is strung out beyond it.
    expect(molecule.atoms["a2"]!.pos).toEqual(layout.positions["a2.CHO"]);
    expect(molecule.atoms["a1"]!.pos.y).toBeGreaterThan(molecule.atoms["a2"]!.pos.y);
    // A Fischer draws no wedge, and none of the author's leaks in.
    expect(molecule.bondIds.map((id) => molecule.bonds[id]!.stereo).filter((s) => s !== "none")).toEqual([]);
    expect(mol.bondIds.map((id) => mol.bonds[id]!.stereo).filter((s) => s !== "none")).toHaveLength(4);
  });

  it("is unreachable from the published package: nothing in src imports the test tree, and only src is built", () => {
    for (const file of sourceFiles(join(CHEM_CORE, "src"))) {
      const text = readFileSync(file, "utf8");
      expect(text, relative(CHEM_CORE, file)).not.toMatch(/from\s+["'][^"']*test\/harness/);
      expect(text, relative(CHEM_CORE, file)).not.toMatch(/\bmoleculeFromLayout\b/);
    }
    const tsconfig = JSON.parse(readFileSync(join(CHEM_CORE, "tsconfig.json"), "utf8")) as {
      compilerOptions: { rootDir: string };
      include: string[];
    };
    expect(tsconfig.include).toEqual(["src"]);
    expect(tsconfig.compilerOptions.rootDir).toBe("./src");
    const pkg = JSON.parse(readFileSync(join(CHEM_CORE, "package.json"), "utf8")) as {
      exports: Record<string, { import: string }>;
    };
    for (const entry of Object.values(pkg.exports)) expect(entry.import).toMatch(/^\.\/dist\//);
    // And the built output, where there is one, never carries it.
    const dist = join(CHEM_CORE, "dist");
    if (existsSync(dist)) {
      for (const file of sourceFiles(dist).concat(readdirSync(dist).filter((f) => f.endsWith(".js")).map((f) => join(dist, f)))) {
        expect(readFileSync(file, "utf8"), relative(CHEM_CORE, file)).not.toMatch(/\bmoleculeFromLayout\b/);
      }
    }
    // The barrel exports the BRAND, so shared can refuse it, and not the builder.
    const index = readFileSync(join(CHEM_CORE, "src", "index.ts"), "utf8");
    expect(index).toContain('"./test-only.js"');
    expect(index).not.toMatch(/from\s+"[^"]*(rebuild|harness|test\/)[^"]*"/);
  });
});
