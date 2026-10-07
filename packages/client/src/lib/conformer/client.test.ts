/**
 * The conformer client's one promise: the newest request wins, and an older
 * one is abandoned — its worker terminated, its promise resolved `null` —
 * rather than allowed to finish and paint an outdated drawing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConformerRequest } from "./protocol";

let started: StubWorker[] = [];

class StubWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string; preventDefault(): void }) => void) | null = null;
  readonly requests: ConformerRequest[] = [];
  terminated = false;
  constructor(readonly url: string) {
    started.push(this);
  }
  postMessage(request: ConformerRequest): void {
    this.requests.push(request);
  }
  terminate(): void {
    this.terminated = true;
  }
  answer(index = this.requests.length - 1): void {
    const request = this.requests[index]!;
    this.onmessage?.({
      data: {
        id: request.id,
        result: { ok: true, atoms: [], bonds: [], energy: 0, attempts: 1 },
      },
    });
  }
}

type Client = typeof import("./client");
let client: Client;

beforeEach(async () => {
  started = [];
  vi.stubGlobal("Worker", StubWorker);
  vi.resetModules();
  client = await import("./client");
});

afterEach(() => {
  client.disposeConformerWorker();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("requestConformer", () => {
  it("starts no worker until the first request", () => {
    expect(started).toHaveLength(0);
  });

  it("loads the staged worker script from the deployment root", async () => {
    const pending = client.requestConformer("molblock");
    expect(started[0]?.url).toMatch(/conformer\/conformer\.worker\.js$/);
    started[0]!.answer();
    await expect(pending).resolves.toMatchObject({ ok: true });
  });

  it("versions the script by content, so a cache keyed by URL cannot pair releases", async () => {
    // Decision 253: the name is fixed and the service worker serves it cache-first.
    vi.stubEnv("NEXT_PUBLIC_CONFORMER_ASSET_VERSION", "0123456789abcdef");
    const pending = client.requestConformer("molblock");
    expect(started[0]?.url).toMatch(/conformer\/conformer\.worker\.js\?v=0123456789abcdef$/);
    started[0]!.answer();
    await pending;
  });

  it("loads the bare name outside a Next build", () => {
    vi.stubEnv("NEXT_PUBLIC_CONFORMER_ASSET_VERSION", "");
    expect(client.conformerWorkerUrl()).toMatch(/conformer\/conformer\.worker\.js$/);
  });

  it("reuses one worker for requests that do not overlap", async () => {
    const first = client.requestConformer("a");
    started[0]!.answer();
    await first;
    const second = client.requestConformer("b");
    started[0]!.answer();
    await second;
    expect(started).toHaveLength(1);
  });

  it("abandons a request still running when a newer one arrives", async () => {
    const stale = client.requestConformer("old drawing");
    const fresh = client.requestConformer("new drawing");
    await expect(stale).resolves.toBeNull();
    expect(started).toHaveLength(2);
    expect(started[0]!.terminated).toBe(true);
    expect(started[1]!.requests.map((request) => request.molblock)).toEqual(["new drawing"]);
    started[1]!.answer();
    await expect(fresh).resolves.toMatchObject({ ok: true });
  });

  it("reports a worker that fails to start in words, even with an empty message", async () => {
    const pending = client.requestConformer("x");
    started[0]!.onerror?.({ message: "", preventDefault: () => undefined });
    await expect(pending).resolves.toEqual({
      ok: false,
      reason: "worker",
      message: "The 3D worker did not start.",
    });
  });
});
