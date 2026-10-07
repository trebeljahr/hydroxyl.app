import { describe, expect, it, beforeEach } from "vitest";

import {
  inchiAndMolblock,
  molLifecycleCounts,
  normalizeMolblock,
  resetMolLifecycleCounts,
  smilesAndMolblock,
  withMol,
  type JSMolLike,
  type RDKitModuleLike,
} from "./ops";

/**
 * A JSMol that counts its own deletions and can be told to throw.
 *
 * The whole point of injecting the module is that this file needs no wasm, no
 * Worker and no DOM to prove the lifetime rules — which is what makes it
 * possible to assert them at all, since a leaked JSMol produces no error, no
 * log line and no visible symptom short of a wasm heap that grows until the
 * tab dies.
 */
function fakeModule(options: {
  readonly parseReturnsNull?: boolean;
  readonly bodyThrows?: unknown;
  readonly getMolThrows?: unknown;
  /** Written into the log handle by `get_mol`, as RDKit itself would. */
  readonly logsOnParse?: string;
  readonly log?: { buffer: string };
} = {}) {
  let live = 0;
  let deletes = 0;
  const mol: JSMolLike = {
    get_smiles: () => {
      if (options.bodyThrows !== undefined) throw options.bodyThrows;
      return "CCO";
    },
    get_inchi: () => "InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3",
    get_molblock: () => "MOLBLOCK",
    get_descriptors: () => '{"tpsa":20.23,"CrippenClogP":-0.0014,"lipinskiHBD":1,"lipinskiHBA":1}',
    has_coords: () => 2,
    set_new_coords: () => true,
    delete: () => {
      deletes++;
      live--;
    },
  };
  const rdkit: RDKitModuleLike = {
    get_mol: () => {
      if (options.getMolThrows !== undefined) throw options.getMolThrows;
      if (options.logsOnParse !== undefined && options.log) {
        options.log.buffer += options.logsOnParse;
      }
      if (options.parseReturnsNull) return null;
      live++;
      return mol;
    },
    get_inchikey_for_inchi: () => "LFQSCWFLJHTTHZ-UHFFFAOYSA-N",
    version: () => "test",
  };
  return { rdkit, stats: () => ({ live, deletes }) };
}

beforeEach(() => resetMolLifecycleCounts());

describe("withMol", () => {
  it("deletes the JSMol when the body throws", () => {
    // The acceptance criterion this file exists for. `finally` runs for a
    // thrown value of any type, including the raw heap POINTER emscripten
    // throws for a C++ exception — which is a number, not an Error.
    const { rdkit, stats } = fakeModule({ bodyThrows: 2012072 });
    const result = withMol(rdkit, "CCO", (mol) => mol.get_smiles());
    expect(result.ok).toBe(false);
    expect(stats().deletes).toBe(1);
    expect(stats().live).toBe(0);
    expect(molLifecycleCounts()).toEqual({ created: 1, deleted: 1 });
  });

  it("reports an emscripten numeric throw as prose, not as [object Number]", () => {
    const { rdkit } = fakeModule({ bodyThrows: 2012072 });
    const result = withMol(rdkit, "CCO", (mol) => mol.get_smiles());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("rdkit-failed");
    expect(result.message).toContain("2012072");
  });

  it("deletes the JSMol on the ordinary path too", () => {
    const { rdkit, stats } = fakeModule();
    const result = withMol(rdkit, "CCO", (mol) => mol.get_smiles());
    expect(result).toMatchObject({ ok: true, value: "CCO" });
    expect(stats().deletes).toBe(1);
    expect(molLifecycleCounts()).toEqual({ created: 1, deleted: 1 });
  });

  it("allocates nothing when the parse returns null", () => {
    // `get_mol` returns null for bad input rather than throwing, and a null
    // return allocates nothing — so counting a deletion here would be wrong.
    const { rdkit, stats } = fakeModule({ parseReturnsNull: true });
    const result = withMol(rdkit, "C1CC", (mol) => mol.get_smiles());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("parse-failed");
    expect(stats().deletes).toBe(0);
    expect(molLifecycleCounts()).toEqual({ created: 0, deleted: 0 });
  });

  it("survives get_mol itself throwing", () => {
    const { rdkit } = fakeModule({ getMolThrows: new Error("boom") });
    const result = withMol(rdkit, "CCO", (mol) => mol.get_smiles());
    expect(result).toMatchObject({ ok: false, kind: "rdkit-failed" });
    expect(molLifecycleCounts()).toEqual({ created: 0, deleted: 0 });
  });

  it("refuses empty input instead of letting it become a zero-atom molecule", () => {
    // RDKit's get_mol("") returns a NON-null, perfectly valid molecule with
    // no atoms. Without this guard an empty paste succeeds silently.
    const { rdkit, stats } = fakeModule();
    for (const text of ["", "   ", "\n\t "]) {
      const result = withMol(rdkit, text, (mol) => mol.get_smiles());
      expect(result).toMatchObject({ ok: false, kind: "empty-input" });
    }
    expect(stats().live).toBe(0);
  });

  it("separates a structure RDKit refused from text it could not read", () => {
    // Both come back as a null return. The log is the only thing that tells
    // them apart, and the UI says different things about them.
    const log = {
      buffer: "",
      get_buffer() {
        return this.buffer;
      },
      clear_buffer() {
        this.buffer = "";
      },
      delete() {},
    };
    const { rdkit } = fakeModule({
      parseReturnsNull: true,
      log,
      logsOnParse:
        "[22:21:33] Explicit valence for atom # 0 N, 4, is greater than permitted\n",
    });
    const result = withMol(rdkit, "CN(C)(C)C", (mol) => mol.get_smiles(), { log });
    expect(result).toMatchObject({ ok: false, kind: "sanitize-failed" });
    if (result.ok) return;
    // The timestamp is stripped: it is noise in a UI and it makes a message
    // differ between two runs of the same input.
    expect(result.notes[0]).toBe(
      "Explicit valence for atom # 0 N, 4, is greater than permitted",
    );
  });
});

describe("operations", () => {
  it("keeps the source layout when the conformer is 2D", () => {
    const { rdkit } = fakeModule();
    const result = normalizeMolblock(rdkit, "x\n\n\n  0  0\nM  END\n", "preserve");
    expect(result).toMatchObject({ ok: true, value: { hadCoords: 2, coordsGenerated: false } });
  });

  it("re-lays-out a 3D conformer, whose flat projection stacks atoms", () => {
    const { rdkit } = fakeModule();
    const threeD: RDKitModuleLike = {
      ...rdkit,
      get_mol: (text) => {
        const mol = rdkit.get_mol(text);
        return mol ? { ...mol, has_coords: () => 3 } : null;
      },
    };
    const result = normalizeMolblock(threeD, "text", "preserve");
    expect(result).toMatchObject({ ok: true, value: { hadCoords: 3, coordsGenerated: true } });
  });

  it("reports an empty InChI key rather than pretending it worked", () => {
    const { rdkit } = fakeModule();
    const silent: RDKitModuleLike = { ...rdkit, get_inchikey_for_inchi: () => "" };
    const result = inchiAndMolblock(silent, "text");
    expect(result).toMatchObject({ ok: true, value: { inchiKey: "" } });
  });

  it("hands back the sanitized molblock beside the SMILES", () => {
    // The caller diffs against the MOLECULE, never against the string:
    // RDKit canonicalises the right and the wrong answer to the same SMILES.
    const { rdkit } = fakeModule();
    const result = smilesAndMolblock(rdkit, "text", "preserve");
    expect(result).toMatchObject({ ok: true, value: { smiles: "CCO", molblock: "MOLBLOCK" } });
  });
});
