/**
 * THE CHANNEL A FAST REFRESH USED TO LEAVE BEHIND.
 *
 * `broadcast.ts` keeps ONE `BroadcastChannel` at module scope, which is
 * load-bearing (a channel never delivers to the object that posted, so posting
 * and listening through the same object is what stops a tab reacting to its
 * own writes). Module scope is also what makes it survive a module swap: if
 * the module is replaced while the page lives on, the outgoing instance's
 * channel, its message handler and the closure over the editor store that
 * handler reaches all stay registered with the browser, and the incoming
 * instance opens a second one. (Measured on 2026-09-29, an edit to
 * `broadcast.ts` full-reloads the page instead, so this is a guard for the day
 * that changes rather than a leak that was being hit.)
 *
 * Decision 94: `closeDocumentsChannel` is the fix, wired to
 * `import.meta.turbopackHot.dispose` in the module itself. This file pins both
 * halves. The teardown is exercised for real below; the WIRING is asserted
 * against the source, because the hot context is injected per module by the
 * bundler and a test cannot hand another module a fake one.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { closeDocumentsChannel, onDocumentChange, type DocumentChange } from "./broadcast";

const CHANNEL_NAME = "chemistry-sketcher/documents";

/** Channels opened BY THE TEST, standing in for the other tab. */
const foreign: BroadcastChannel[] = [];

function otherTab(): BroadcastChannel {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  (channel as unknown as { unref?: () => void }).unref?.();
  foreign.push(channel);
  return channel;
}

/** Delivery is asynchronous in every implementation of this API. */
async function delivered(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

afterEach(() => {
  for (const channel of foreign) channel.close();
  foreign.length = 0;
  closeDocumentsChannel();
});

describe("the documents channel", () => {
  it("delivers another tab's change to a listener", async () => {
    const seen: DocumentChange[] = [];
    onDocumentChange((change) => seen.push(change));

    otherTab().postMessage({ kind: "put", id: "doc_a" });
    await delivered();

    expect(seen).toEqual([{ kind: "put", id: "doc_a" }]);
  });

  it("delivers nothing once the channel is closed", async () => {
    const seen: DocumentChange[] = [];
    onDocumentChange((change) => seen.push(change));
    const other = otherTab();

    other.postMessage({ kind: "put", id: "doc_a" });
    await delivered();
    expect(seen).toHaveLength(1);

    closeDocumentsChannel();
    other.postMessage({ kind: "put", id: "doc_b" });
    await delivered();

    // The handler is gone, not merely unreferenced: an unsubscribe that only
    // dropped the caller's own closure would leave the channel listening.
    expect(seen).toHaveLength(1);
  });

  it("opens a working channel again afterwards", async () => {
    closeDocumentsChannel();
    const seen: DocumentChange[] = [];
    onDocumentChange((change) => seen.push(change));

    otherTab().postMessage({ kind: "remove", id: "doc_a" });
    await delivered();

    // `closeDocumentsChannel` must not latch the module into the
    // "unavailable" state it uses for an environment with no
    // `BroadcastChannel` — a Fast Refresh would then silence the app for the
    // rest of the session.
    expect(seen).toEqual([{ kind: "remove", id: "doc_a" }]);
  });

  it("drops an unsubscribed handler without closing the channel", async () => {
    const seen: DocumentChange[] = [];
    const off = onDocumentChange((change) => seen.push(change));
    const kept: DocumentChange[] = [];
    onDocumentChange((change) => kept.push(change));

    off();
    otherTab().postMessage({ kind: "put", id: "doc_a" });
    await delivered();

    expect(seen).toHaveLength(0);
    expect(kept).toHaveLength(1);
  });
});

/**
 * THE LEAK ITSELF, reproduced.
 *
 * `vi.resetModules()` drops the module registry, so the next `import()`
 * evaluates `broadcast.ts` afresh with its own module-scope `channel` — which
 * is exactly what Fast Refresh does to it. Whether the previous instance is
 * torn down is the difference between one channel listening and one per
 * reload.
 */
describe("across a simulated Fast Refresh", () => {
  const RELOADS = 5;

  async function reload(tearDown: boolean): Promise<string[]> {
    const seen: string[] = [];
    let previous: typeof import("./broadcast") | null = null;
    for (let generation = 0; generation < RELOADS; generation += 1) {
      // What the dispose hook does: the OUTGOING instance is closed as the
      // incoming one is evaluated.
      if (tearDown) previous?.closeDocumentsChannel();
      vi.resetModules();
      const instance = await import("./broadcast");
      instance.onDocumentChange((change) => seen.push(`${generation}:${change.id}`));
      previous = instance;
    }
    otherTab().postMessage({ kind: "put", id: "doc_a" });
    await delivered();
    previous?.closeDocumentsChannel();
    return seen;
  }

  it("keeps one live channel when each outgoing instance is disposed", async () => {
    expect(await reload(true)).toEqual([`${RELOADS - 1}:doc_a`]);
  });

  it("would keep one per reload without it — which is the bug", async () => {
    // Not a test of production behaviour: it is the measurement that makes the
    // assertion above mean something. Five reloads, five channels, five
    // handlers, and five closures over whatever each held.
    const seen = await reload(false);
    expect(seen).toHaveLength(RELOADS);
  });
});

/**
 * THE WIRING, checked against the source.
 *
 * `import.meta.turbopackHot` is created per module by the bundler's runtime and
 * handed to the module at evaluation; nothing outside can substitute one, so
 * there is no way to assert from a test that THIS module registered a dispose
 * callback. What can be asserted is that the registration is present, on the
 * hook Turbopack actually provides, and calls the teardown the tests above
 * exercise — so removing the hook fails here and breaking the teardown fails
 * there.
 */
describe("the dev-only dispose hook", () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "broadcast.ts"),
    "utf8",
  );

  it("registers the teardown with Turbopack's hot context", () => {
    const registration =
      /import\.meta\.turbopackHot\?\.dispose\(\(\) => \{\s*closeDocumentsChannel\(\);/;
    expect(source).toMatch(registration);
  });

  it("does not register it on Vite's, which Turbopack never defines", () => {
    // Turbopack's `import.meta` has `url` and `turbopackHot` only. The first
    // version of this hook sat behind `import.meta.hot`, passed a test of its
    // shape, and never ran.
    expect(source).not.toMatch(/import\.meta[^\n`]*\.hot(\?\.|\))/);
  });
});
