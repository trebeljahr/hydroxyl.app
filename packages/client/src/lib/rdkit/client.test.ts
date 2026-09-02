import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { benzene, buildMolecule, elementCounts, vec } from "@starter/chem-core";

import {
  canonicalize,
  disposeRdkitWorker,
  fromMolblock,
  fromSmiles,
  toSmiles,
} from "./client.js";
import type { WorkerRequest } from "./protocol.js";

/**
 * The boundary's plumbing, with a stub Worker.
 *
 * The chemistry is proved in `fidelity.node.test.ts` against the real wasm;
 * what is proved HERE is the contract around it — that a failure is a result
 * rather than a throw, that a silent worker becomes a `timeout` rather than a
 * hang, and that an operation which cannot even be attempted never reaches
 * the worker at all.
 */

/** A molblock RDKit would plausibly hand back for benzene. */
const BENZENE_FROM_RDKIT = [
  "",
  "     RDKit          2D",
  "",
  "  6  6  0  0  0  0  0  0  0  0999 V2000",
  "    1.5000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "    0.7500    1.2990    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "   -0.7500    1.2990    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "   -1.5000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "   -0.7500   -1.2990    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "    0.7500   -1.2990    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "  1  2  2  0",
  "  2  3  1  0",
  "  3  4  2  0",
  "  4  5  1  0",
  "  5  6  2  0",
  "  6  1  1  0",
  "M  END",
  "",
].join("\n");

type Responder = (request: WorkerRequest) => unknown | undefined;

let seen: WorkerRequest[] = [];
let respond: Responder = () => undefined;

class StubWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  postMessage(request: WorkerRequest): void {
    seen.push(request);
    const result = respond(request);
    if (result === undefined) return; // silence, on purpose
    queueMicrotask(() => this.onmessage?.({ data: { id: request.id, result } }));
  }
  terminate(): void {}
}

beforeEach(() => {
  seen = [];
  respond = () => ({
    ok: true,
    value: {
      smiles: "c1ccccc1",
      molblock: BENZENE_FROM_RDKIT,
      hadCoords: 2,
      coordsGenerated: false,
    },
    notes: [],
  });
  vi.stubGlobal("Worker", StubWorker);
  disposeRdkitWorker();
});

afterEach(() => {
  disposeRdkitWorker();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the boundary", () => {
  it("hands RDKit a Kekule molblock and gives back its SMILES", async () => {
    const result = await toSmiles(benzene());
    expect(result).toMatchObject({ ok: true, value: "c1ccccc1" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.op).toBe("smiles");
    expect(seen[0]?.text).toContain("M  END");
  });

  it("never reaches the worker for a structure that cannot be written", async () => {
    // Decision 8: a cosmetic label refuses at the codec, with the atom ids.
    // Sending it anyway would produce a molblock describing a methyl.
    const withLabel = buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0));
      const ph = b.atom("C", vec(1, 0), { label: "Ph" });
      b.bond(c, ph, 1);
    });
    const result = await toSmiles(withLabel);
    expect(result).toMatchObject({ ok: false, error: { kind: "labelled-atoms" } });
    expect(seen).toEqual([]);
  });

  it("turns a silent worker into a timeout rather than a hang", async () => {
    // An emscripten module whose wasm cannot be fetched leaves its init
    // promise PENDING rather than rejecting, so a mis-served asset presents
    // as nothing happening, for ever, with no error anywhere.
    vi.useFakeTimers();
    respond = () => undefined;
    const pending = fromSmiles("c1ccccc1");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toMatchObject({ ok: false, error: { kind: "timeout" } });
  });

  it("reports the absence of Workers rather than throwing", async () => {
    disposeRdkitWorker();
    vi.stubGlobal("Worker", undefined);
    expect(await fromSmiles("c1ccccc1")).toMatchObject({
      ok: false,
      error: { kind: "worker-unavailable" },
    });
  });

  it("passes a worker-side failure through as a failed result", async () => {
    respond = () => ({
      ok: false,
      kind: "parse-failed",
      message: "SMILES Parse Error: unclosed ring for input: 'C1CC'",
      notes: ["SMILES Parse Error: unclosed ring for input: 'C1CC'"],
    });
    const result = await fromSmiles("C1CC");
    expect(result).toMatchObject({ ok: false, error: { kind: "parse-failed" } });
    if (result.ok) return;
    expect(result.error.notes).toHaveLength(1);
  });

  it("reads the worker's molblock back through chem-core, not through the SMILES", async () => {
    const result = await canonicalize(benzene());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(elementCounts(result.value.molecule)).toEqual({ C: 6, H: 6 });
    expect(result.value.smiles).toBe("c1ccccc1");
  });

  it("says a layout was generated when the source carried none", async () => {
    respond = () => ({
      ok: true,
      value: {
        smiles: "c1ccccc1",
        molblock: BENZENE_FROM_RDKIT,
        hadCoords: 0,
        coordsGenerated: true,
      },
      notes: [],
    });
    const result = await fromSmiles("c1ccccc1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.coordinates).toBe("generated");
  });

  it("distinguishes a replaced layout from an absent one", async () => {
    // hadCoords 3: the file was a 3D conformer, whose flat projection stacks
    // atoms. Something WAS thrown away, and the UI should say so.
    respond = () => ({
      ok: true,
      value: {
        smiles: "c1ccccc1",
        molblock: BENZENE_FROM_RDKIT,
        hadCoords: 3,
        coordsGenerated: true,
      },
      notes: [],
    });
    const result = await fromMolblock(BENZENE_FROM_RDKIT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.coordinates).toBe("regenerated");
  });

  it("reports what RDKit changed, not merely what it produced", async () => {
    // The worker answers with a DIFFERENT molecule from the one sent — a
    // cyclohexadiene where benzene went in. Every operation must notice.
    respond = () => ({
      ok: true,
      value: {
        smiles: "C1=CCC=CC1",
        molblock: BENZENE_FROM_RDKIT.replace("  3  4  2  0", "  3  4  1  0"),
        hadCoords: 2,
        coordsGenerated: false,
      },
      notes: ["Explicit valence check skipped"],
    });
    const result = await canonicalize(benzene());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.severity).toBe("changed");
    const kinds = result.report.diffs.map((d) => d.kind);
    expect(kinds).toContain("bond-orders");
    expect(kinds).toContain("element-counts");
    expect(result.report.notes).toEqual(["Explicit valence check skipped"]);
  });
});
