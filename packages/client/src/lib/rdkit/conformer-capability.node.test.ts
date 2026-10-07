/**
 * THE BUNDLED RDKit CANNOT EMBED A 3D CONFORMER. Pinned, because it is why
 * the 3D view gets its geometry from OpenChemLib's MMFF94 instead of ETKDG
 * (decision 232; `@/lib/conformer/embed.ts` has the rest).
 *
 * MinimalLib's JSMol carries 2D coordinate generation (`set_new_coords`,
 * `get_new_coords`, `generate_aligned_coords`) and nothing from DistGeom,
 * ETKDG, UFF or MMFF. Like the InChI reader (`inchi.node.test.ts`), the gap is
 * discoverable only by asking the wasm, so it is written as a test: a future
 * RDKit build that gains an embedder FAILS here, and someone can weigh moving
 * the 3D view onto it.
 *
 * Runs in the `rdkit` vitest project, which loads the real wasm in node.
 */

import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";

import type { RDKitModuleLike } from "./ops";

const require = createRequire(import.meta.url);

let RDKit: RDKitModuleLike;

beforeAll(async () => {
  const initRDKitModule = require("@rdkit/rdkit") as () => Promise<RDKitModuleLike>;
  RDKit = await initRDKitModule();
}, 60_000);

const THREE_D = /embed|etkdg|conform|mmff|uff|3d|distgeom|minimi/i;

describe("RDKit MinimalLib and 3D coordinates", () => {
  it("has no conformer embedding on a molecule", () => {
    const mol = RDKit.get_mol("CCO");
    expect(mol).not.toBeNull();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(mol));
    expect(methods.filter((name) => THREE_D.test(name))).toEqual([]);
    // The coordinate methods it does have are the 2D ones.
    expect(methods.filter((name) => /coords/.test(name)).sort()).toEqual([
      "generate_aligned_coords",
      "get_new_coords",
      "has_coords",
      "set_new_coords",
    ]);
    mol?.delete();
  });

  it("has no conformer entry point on the module either", () => {
    const keys = Object.keys(RDKit as unknown as Record<string, unknown>);
    expect(keys.filter((key) => THREE_D.test(key))).toEqual([]);
  });
});
