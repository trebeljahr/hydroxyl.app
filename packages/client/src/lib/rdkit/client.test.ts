import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { benzene, buildMolecule, elementCounts, vec } from "@starter/chem-core";

import {
  canonicalize,
  disposeRdkitWorker,
  fromMolblock,
  fromSmiles,
  toMolblock,
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

/**
 * A V3000 answer. RDKit switches to it unprompted — for more than 999 atoms,
 * and for coordinates past what the V2000 fields hold — and chem-core's codec
 * is V2000-only, so this is the shape of an answer that cannot be checked.
 */
const V3000_FROM_RDKIT = [
  "",
  "     RDKit          2D",
  "",
  "  0  0  0  0  0  0  0  0  0  0999 V3000",
  "M  V30 BEGIN CTAB",
  "M  V30 COUNTS 2 1 0 0 0",
  "M  V30 BEGIN ATOM",
  "M  V30 1 C 0.000000 0.000000 0.000000 0",
  "M  V30 2 O 1.500000 0.000000 0.000000 0",
  "M  V30 END ATOM",
  "M  V30 BEGIN BOND",
  "M  V30 1 1 1 2",
  "M  V30 END BOND",
  "M  V30 END CTAB",
  "M  END",
  "",
].join("\n");

/** A conformer that is PRESENT and carries no layout: every atom at 0,0,0. */
const ZERO_CONFORMER = [
  "stacked",
  "  chemcore          2D",
  "",
  "  2  1  0  0  0  0  0  0  0  0999 V2000",
  "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
  "  1  2  1  0  0  0  0",
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

  it("says a result is UNVERIFIED rather than clean when the answer cannot be read back", async () => {
    // The failure this guards is silent by construction: with nothing to diff
    // against, `diffs` is empty, and an empty `diffs` used to be reported as
    // `severity: "clean"` — the exact opposite of the truth. Measured with
    // real RDKit: its V3000 rendering of `CN(=O)=O` comes back
    // charge-separated, and the old report called that clean.
    respond = () => ({
      ok: true,
      value: { molblock: V3000_FROM_RDKIT, hadCoords: 2, coordsGenerated: false },
      notes: [],
    });
    const result = await toMolblock(benzene());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.verification).toBe("unavailable");
    expect(result.report.severity).not.toBe("clean");
    expect(result.report.notes.join(" ")).toMatch(/V3000/);
  });

  it("marks a genuinely checked result as verified, so the two are distinguishable", async () => {
    const result = await canonicalize(benzene());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.verification).toBe("verified");
  });

  it("calls a SMILES import not-applicable rather than unverified", async () => {
    // There was no "before" molecule to diff against — the input is a string.
    // Nothing went unchecked, so this must not read as a failed check.
    const result = await fromSmiles("c1ccccc1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.verification).toBe("not-applicable");
  });

  it("generates a layout for a conformer that is present but all on the origin", async () => {
    // RDKit answers `has_coords() === 2` for this file — measured — so
    // "preserve" would import every atom stacked on the origin and report the
    // layout as preserved. chem-core's own writeMolblock of a molecule built
    // at the default position produces exactly this file, so it is not a
    // hand-made curiosity.
    respond = () => ({
      ok: true,
      value: { molblock: BENZENE_FROM_RDKIT, hadCoords: 2, coordsGenerated: true },
      notes: [],
    });
    const result = await fromMolblock(ZERO_CONFORMER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen[0]?.layout).toBe("generate");
    expect(result.report.coordinates).toBe("generated");
  });

  it("keeps preserving a layout the file actually carries", async () => {
    const result = await fromMolblock(BENZENE_FROM_RDKIT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen[0]?.layout).toBe("preserve");
    expect(result.report.coordinates).toBe("preserved");
    // The file went out and came back byte-identical, so this is the case
    // where "clean" is the true answer — and it has to remain reachable, or
    // the unverified signal above would just be noise on every result.
    expect(result.report.verification).toBe("verified");
    expect(result.report.severity).toBe("clean");
    expect(result.report.diffs).toEqual([]);
  });

  it("reports a Worker constructor that throws instead of letting it escape", async () => {
    // `new Worker` raises SecurityError SYNCHRONOUSLY for a cross-origin
    // script URL, and every file:// document is cross-origin to its own
    // neighbours. `onerror` never fires, so the sticky fallback below the
    // constructor is never reached and the exception escapes the boundary.
    disposeRdkitWorker();
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new DOMException("Failed to construct 'Worker'", "SecurityError");
        }
      },
    );
    expect(await fromSmiles("c1ccccc1")).toMatchObject({
      ok: false,
      error: { kind: "worker-unavailable" },
    });
    // And STICKY: a second call must not re-attempt the constructor.
    expect(await fromSmiles("c1ccccc1")).toMatchObject({ ok: false });
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
