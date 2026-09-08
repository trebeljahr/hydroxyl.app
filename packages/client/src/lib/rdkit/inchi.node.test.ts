/**
 * THE BUNDLED RDKit CANNOT READ AN InChI. Pinned, because it is the reason
 * `@/lib/io/open` refuses an InChI by name instead of importing it.
 *
 * MinimalLib exports `get_mol`, `get_qmol`, `get_mol_copy`,
 * `get_mol_from_uint8array` and `get_inchikey_for_inchi`. The last of those
 * goes InChI -> key, which is not a reader; there is no `get_mol_from_inchi`
 * and no InChI branch in `get_mol`'s dispatch. Handing it one returns null and
 * logs a SMILES parse error naming the InChI string, which is the giveaway:
 * the input was tried as a SMILES.
 *
 * This is the same family of limit as "there is no 3D conformer generation in
 * MinimalLib" — a capability the wasm simply does not carry, discoverable only
 * by asking it. Written as a test rather than as a comment so that a future
 * RDKit build which gains the reader FAILS here and someone goes and wires it
 * up, instead of the gap staying dark forever.
 *
 * Runs in the `rdkit` vitest project, which loads the real wasm in node.
 */

import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";

import type { RDKitLogLike, RDKitModuleLike } from "./ops";

const require = createRequire(import.meta.url);

let RDKit: RDKitModuleLike;
let log: RDKitLogLike | null = null;

beforeAll(async () => {
  const initRDKitModule = require("@rdkit/rdkit") as () => Promise<RDKitModuleLike>;
  RDKit = await initRDKitModule();
  // One handle for the whole file: `set_log_capture` takes a global exclusive
  // lock inside the wasm instance and only `.delete()` releases it.
  log = RDKit.set_log_capture?.("rdApp.*") ?? null;
}, 60_000);

const INCHIS = [
  "InChI=1S/C6H6/c1-2-4-6-5-3-1/h1-6H",
  "InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3",
  "InChI=1S/C4H4S/c1-2-4-5-3-1/h1-4H",
];

describe("RDKit MinimalLib and InChI", () => {
  it.each(INCHIS)("cannot build a molecule from %s", (inchi) => {
    log?.clear_buffer();
    const mol = RDKit.get_mol(inchi);
    // `get_mol` returns null rather than throwing, which is why the failure is
    // silent unless someone looks at the log.
    expect(mol).toBeNull();
    expect(log?.get_buffer() ?? "").toMatch(/SMILES Parse Error/);
  });

  it("has no InChI-to-molecule entry point at all", () => {
    const entryPoints = Object.keys(RDKit as unknown as Record<string, unknown>).filter((key) =>
      /inchi/i.test(key),
    );
    // The only one is InChI -> InChIKey, which is not a reader.
    expect(entryPoints).toEqual(["get_inchikey_for_inchi"]);
  });

  it("still writes an InChI, which is the direction the bridge supports", () => {
    const mol = RDKit.get_mol("c1ccccc1");
    expect(mol).not.toBeNull();
    expect(mol?.get_inchi()).toBe(INCHIS[0]);
    mol?.delete();
  });
});
