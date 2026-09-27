/**
 * The document the editor holds BEFORE anybody has opened or drawn anything —
 * and the rule that keeps it out of storage.
 *
 * ── WHY IT HAS A FIXED ID (the hydration half) ─────────────────────────────
 *
 * `createDocument()` mints its id from `Date.now()` and `Math.random()`, and
 * `TopBar` renders `state.document.id` into `data-doc-id`. The store is a
 * module singleton, so it is constructed ONCE PER MODULE INSTANCE — and there
 * are always two: the prerender's and the browser's. Each minted its own id,
 * so the two never agreed and every load of `/editor` reported
 *
 *     + data-doc-id="doc_mue9v6v1_1_hnb6s68v"
 *     - data-doc-id="doc_mue9v6pk_1_pts6ksvh"
 *
 * — React's own first two bullets ("a server/client branch", "variable input
 * such as Date.now() or Math.random()") in one attribute. It is NOT a dev-only
 * symptom: `/editor` is prerendered, so the id in the shipped HTML is whatever
 * `next build` happened to mint, frozen at build time, and every visitor's
 * browser disagrees with it. React does not patch a mismatched attribute up.
 *
 * ── WHY IT IS EPHEMERAL (the data-loss half) ───────────────────────────────
 *
 * The fixed string is the same in every tab and in every visitor's browser, so
 * a record stored under it belongs to nobody: `/editor?doc=doc_startup` would
 * name a different sketch on every machine, and two tabs on one machine would
 * overwrite each other. Measured against the built app: opening the benzene
 * fixture is an UNDOABLE entry by design, so one Ctrl+Z after the editor
 * mounts put the placeholder back on the canvas, twelve atoms drawn on it were
 * autosaved under `doc_startup`, and reopening the resulting recents card
 * showed an empty canvas.
 *
 * Decision 85 settles it: the startup document is EPHEMERAL UNTIL THE FIRST
 * EDIT. The id stays a rendering constant — a string two module instances can
 * agree on — and is never a document identity, because:
 *
 *   - the document slice MINTS a real id as part of the first edit that
 *     touches the placeholder (`mintStartupIdentity` below), so nothing ever
 *     reaches storage carrying the reserved string;
 *   - the autosave loop REFUSES the placeholder outright
 *     (`isStartupDocument`), so an untouched editor — and an editor undone
 *     back to the placeholder — writes nothing to IndexedDB and journals
 *     nothing on teardown;
 *   - `/editor?doc=doc_startup` names nothing, so the route cannot discard or
 *     overwrite whatever a previous build left under that key.
 *
 * An earlier repair minted the id in `/editor`'s mount effect instead. That
 * fixes hydration and the `doc_startup` record, but it makes the editor own a
 * real document before the chemist has done anything: a stray Ctrl+Z right
 * after opening lands on an empty document with a minted id, and autosave
 * writes it — an `Untitled` card in the recents grid that nobody asked for.
 * Minting at the first edit is what makes "an untouched editor writes nothing"
 * true rather than nearly true.
 *
 * Framework-free and dependency-light on purpose: both the store and the
 * persistence session import it, and neither may pull in the other.
 */

import { createDocument, type SketchDocument } from "@starter/shared";

/** The reserved id. Never a document identity — see this module's header. */
export const STARTUP_DOCUMENT_ID = "doc_startup";

/**
 * The placeholder's timestamps.
 *
 * The epoch is deliberate rather than arbitrary: until the mint this is the
 * one value on screen that must not vary between the prerender and the
 * browser, and a placeholder has no honest creation time to report. A 1970
 * card in the recents grid would be a bug a chemist can see — and cannot
 * appear, because a placeholder is never stored.
 */
export const STARTUP_DOCUMENT_TIME = "1970-01-01T00:00:00.000Z";

/** The placeholder document the singleton store opens with. Deterministic,
 *  and the reason is this module's header. */
export function startupDocument(): SketchDocument {
  return createDocument({ id: STARTUP_DOCUMENT_ID, now: STARTUP_DOCUMENT_TIME });
}

/**
 * Is this the placeholder — the document that must never be written?
 *
 * Asked by the persistence session on every candidate write. A plain id
 * comparison rather than a reference one: undo restores the placeholder from
 * the history, a `?doc=` read could in principle hand one back, and both are
 * the same nobody's-document as the original.
 */
export function isStartupDocument(doc: SketchDocument): boolean {
  return doc.id === STARTUP_DOCUMENT_ID;
}

/**
 * `doc` with an identity of this tab's own, or `doc` itself when it already
 * has one.
 *
 * CALLED FROM THE DOCUMENT SLICE'S SINGLE COMMIT PATH, so the mint and the
 * edit that triggered it are one state change and one undo entry. Everything
 * downstream — autosave, the journal, `?doc=`, the recents grid — then sees an
 * ordinary document with an id no other browser can produce.
 *
 * The CONTENT is carried over rather than rebuilt: only the identity and the
 * timestamps change, and they change together because a document minted now
 * was not created in 1970. `createdAt` moves as well as `modifiedAt` for that
 * reason — this is the moment the document starts existing.
 *
 * The id comes from a throwaway `createDocument` because minting one is
 * `@starter/shared`'s job and it exposes no other way to ask for one.
 */
export function mintStartupIdentity(doc: SketchDocument, now: string): SketchDocument {
  if (doc.id !== STARTUP_DOCUMENT_ID) return doc;
  return {
    ...doc,
    id: createDocument({ now }).id,
    metadata: { ...doc.metadata, createdAt: now, modifiedAt: now },
  };
}
