/**
 * ONE RDKIT WORKER PER PAGE, HOWEVER MANY COPIES OF THE BRIDGE EXIST.
 *
 * `client.ts` keeps the worker at module scope. If a second copy of that
 * module is ever evaluated while the page lives on — a hot swap — the new copy
 * starts a worker of its own, and a dedicated worker is not collected for
 * being unreferenced: the browser keeps it running for the life of the page,
 * with 6.9 MB of compiled wasm and RDKit's heap. Forced in the browser, one
 * swap left two live workers, both answering.
 *
 * Today an edit under `lib/rdkit/` full-reloads the page instead (the header
 * of `PAGE_OWNER` in `client.ts` has the measurement), so this pins a guard
 * rather than a leak anyone has hit. Two halves, as in
 * `persistence/broadcast.test.ts`: a copy about to start a worker disposes
 * whichever copy owns one, exercised for real below by re-evaluating the
 * module; and the module disposes itself from the bundler's hot-swap hook,
 * checked against the source because a test cannot hand a module its own
 * `import.meta`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { benzene } from "@starter/chem-core";

import type { WorkerRequest } from "./protocol";

type Client = typeof import("./client");

/** Every worker any copy of the module started, in order. */
let started: StubWorker[] = [];
/** Whether a started worker answers. Off means requests stay pending. */
let answering = true;

class StubWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminations = 0;
  constructor() {
    started.push(this);
  }
  postMessage(request: WorkerRequest): void {
    if (!answering || this.terminations > 0) return;
    queueMicrotask(() =>
      this.onmessage?.({
        data: {
          id: request.id,
          result: { ok: false, kind: "rdkit-failed", message: "stub", notes: [] },
        },
      }),
    );
  }
  terminate(): void {
    this.terminations += 1;
  }
}

function live(): StubWorker[] {
  return started.filter((worker) => worker.terminations === 0);
}

/**
 * A fresh evaluation of `client.ts`, with its own module-scope `worker`.
 *
 * `vi.resetModules()` empties the registry, so the `import()` evaluates the
 * file again — which is what Fast Refresh does to it. `globalThis` is NOT
 * reset, exactly as a hot update leaves `window` alone.
 */
async function evaluate(): Promise<Client> {
  vi.resetModules();
  return import("./client");
}

const copies: Client[] = [];

beforeEach(() => {
  started = [];
  answering = true;
  vi.stubGlobal("Worker", StubWorker);
});

afterEach(() => {
  for (const copy of copies) copy.disposeRdkitWorker();
  copies.length = 0;
  vi.unstubAllGlobals();
});

async function copyThatUsedRdkit(): Promise<Client> {
  const copy = await evaluate();
  copies.push(copy);
  await copy.toSmiles(benzene());
  return copy;
}

describe("across simulated Fast Refreshes", () => {
  const RELOADS = 5;

  it("started one worker per copy — the measurement the next test depends on", async () => {
    // Without this, "one live worker" could mean the module was served from
    // cache and never re-evaluated at all.
    for (let reload = 0; reload < RELOADS; reload += 1) await copyThatUsedRdkit();
    expect(started).toHaveLength(RELOADS);
  });

  it("leaves exactly one live worker, and it is the newest copy's", async () => {
    for (let reload = 0; reload < RELOADS; reload += 1) await copyThatUsedRdkit();
    expect(live()).toEqual([started[RELOADS - 1]]);
  });

  it("terminates every earlier worker exactly once", async () => {
    for (let reload = 0; reload < RELOADS; reload += 1) await copyThatUsedRdkit();
    expect(started.slice(0, -1).map((worker) => worker.terminations)).toEqual(
      Array.from({ length: RELOADS - 1 }, () => 1),
    );
  });

  it("answers the outgoing copy's pending request now, not after its 45 s timeout", async () => {
    answering = false;
    const outgoing = await evaluate();
    copies.push(outgoing);
    const inFlight = outgoing.toSmiles(benzene());

    const incoming = await evaluate();
    copies.push(incoming);
    void incoming.toSmiles(benzene());

    // Settling at all inside the default 5 s test timeout is the assertion:
    // the only other way this promise resolves is the 45 s timer.
    const result = await inFlight;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("worker-unavailable");
  });

  it("keeps one live worker when a caller goes back to a superseded copy", async () => {
    const outgoing = await copyThatUsedRdkit();
    const incoming = await copyThatUsedRdkit();

    // A caller still holding the old copy. It may take the page back — that
    // costs a wasm start — but it must not add a second live worker.
    await outgoing.toSmiles(benzene());
    expect(live()).toEqual([started[2]]);

    await incoming.toSmiles(benzene());
    expect(live()).toEqual([started[3]]);
  });

  it("still lets a copy restart its own worker after disposeRdkitWorker", async () => {
    // Disposal must not latch: the handoff is built on it, and so is every
    // test in `client.test.ts` after the first.
    const copy = await copyThatUsedRdkit();
    copy.disposeRdkitWorker();
    await copy.toSmiles(benzene());

    expect(started).toHaveLength(2);
    expect(live()).toEqual([started[1]]);
  });
});

/**
 * THE WIRING, checked against the source.
 *
 * Removing the hook fails here; breaking what it calls fails above, because
 * the handoff calls the same `disposeRdkitWorker`.
 */
describe("the dev-only dispose hook", () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "client.ts"),
    "utf8",
  );

  it("disposes this copy when the bundler swaps it out", () => {
    expect(source).toMatch(
      /import\.meta\.turbopackHot\?\.dispose\(\(\) => \{\s*disposeRdkitWorker\(\);/,
    );
  });

  it("uses the hook Turbopack provides, not Vite's", () => {
    // Turbopack's `import.meta` has `url` and `turbopackHot` only. A hook
    // behind `import.meta.hot` reads like a working one and never runs —
    // which is exactly what decision 94's first version did.
    expect(source).not.toMatch(/import\.meta[^\n`]*\.hot(\?\.|\))/);
  });
});
