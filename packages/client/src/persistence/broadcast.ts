/**
 * "Something changed in another tab."
 *
 * ── WHAT IT DOES AND, JUST AS IMPORTANTLY, WHAT IT DOES NOT ────────────────
 *
 * One origin has ONE IndexedDB, and the recents cards are ordinary links, so
 * two tabs on the same library is a single gesture away. Measured with two
 * pages driving the real store: a delete in one tab left the other tab's grid
 * still showing the card, and that tab's next autosave RESURRECTED the deleted
 * document; two tabs saving the same id both reported success and the later
 * write silently won.
 *
 * This module makes those events VISIBLE. It is deliberately not a sync
 * protocol: there is no compare-and-swap on `modifiedAt`, no merge and no
 * leader election, because reconciling two divergent edits of one molecule is
 * a different feature (and cloud sync is explicitly out of scope). What it
 * buys is that the grid stops lying about what is in storage, and that a
 * chemist whose document is being written from somewhere else is told rather
 * than left to find out.
 *
 * `BroadcastChannel` is absent in jsdom, in node and in a few older mobile
 * browsers, and constructing one can throw in a sandboxed iframe. Every entry
 * point here degrades to a no-op, which is exactly the behaviour this app had
 * before the module existed.
 */

export type DocumentChangeKind = "put" | "remove" | "rename";

export interface DocumentChange {
  readonly kind: DocumentChangeKind;
  readonly id: string;
  /**
   * On a rename only: the new title and the revision the rename wrote. Both
   * optional on the wire, because a tab running an older build sends neither;
   * a listener that gets no title still has the write-time merge to keep the
   * rename from being overwritten, it just learns the name a save later.
   */
  readonly title?: string | undefined;
  readonly titleRevision?: number | undefined;
}

const CHANNEL_NAME = "chemistry-sketcher/documents";

/**
 * ONE channel object for the whole tab, shared by the announcer and the
 * listeners, and that sharing is load-bearing twice over.
 *
 * A `BroadcastChannel` never delivers a message to the object that posted it,
 * so posting and listening through the same object is what stops this tab
 * from reacting to its own writes — the recents grid would otherwise re-list
 * itself after every duplicate. And a channel closed immediately after
 * `postMessage` is a delivery race nobody should have to reason about; a
 * long-lived one has no such window.
 */
let channel: BroadcastChannel | null = null;
let unavailable = false;

function documentsChannel(): BroadcastChannel | null {
  if (unavailable) return null;
  if (channel !== null) return channel;
  try {
    if (typeof BroadcastChannel === "undefined") {
      unavailable = true;
      return null;
    }
    channel = new BroadcastChannel(CHANNEL_NAME);
    // Node's BroadcastChannel is a libuv handle and an open one can hold the
    // event loop — and therefore a Vitest worker — alive after the last test.
    // Browsers have no such method; the cast is the cheapest way to say "call
    // it if it is there" without pretending the DOM type has it.
    (channel as unknown as { unref?: () => void }).unref?.();
  } catch {
    // A sandboxed iframe throws here rather than leaving the global undefined.
    unavailable = true;
    return null;
  }
  return channel;
}

/**
 * Tell the other tabs. Never awaited and never throws — a save whose
 * announcement failed is still a save.
 */
export function announceDocumentChange(change: DocumentChange): void {
  try {
    documentsChannel()?.postMessage(change);
  } catch {
    // A closed channel during teardown. Nothing here is worth a failed save.
  }
}

/**
 * Listen for the other tabs. Returns the unsubscribe.
 *
 * The payload is validated rather than trusted: it arrives from another
 * document on the same origin, which is this app — but a stale tab running an
 * older build is a real thing and a malformed message must not throw inside a
 * React effect.
 */
export function onDocumentChange(listener: (change: DocumentChange) => void): () => void {
  const live = documentsChannel();
  if (live === null) return () => undefined;
  const handler = (event: MessageEvent<unknown>): void => {
    const data = event.data;
    if (typeof data !== "object" || data === null) return;
    const kind = (data as Record<string, unknown>)["kind"];
    const id = (data as Record<string, unknown>)["id"];
    if (kind !== "put" && kind !== "remove" && kind !== "rename") return;
    if (typeof id !== "string" || id === "") return;
    const title = (data as Record<string, unknown>)["title"];
    const titleRevision = (data as Record<string, unknown>)["titleRevision"];
    if (
      kind === "rename" &&
      typeof title === "string" &&
      typeof titleRevision === "number" &&
      Number.isSafeInteger(titleRevision) &&
      titleRevision >= 0
    ) {
      listener({ kind, id, title, titleRevision });
      return;
    }
    listener({ kind, id });
  };
  live.addEventListener("message", handler);
  return () => {
    live.removeEventListener("message", handler);
  };
}
