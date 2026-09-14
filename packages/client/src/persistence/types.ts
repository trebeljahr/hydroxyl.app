/**
 * What a document store is, seen from everything that uses one.
 *
 * THE INTERFACE IS THE INJECTION SEAM, not `IDBFactory`.
 *
 * jsdom implements no IndexedDB and node has no global `indexedDB`, so a
 * persistence layer that reached for the real thing at module scope would be
 * untestable in two of this package's three vitest projects. Injecting an
 * `IDBFactory` would fix the reach but not the testability: a fake factory
 * faithful enough to be worth trusting is a reimplementation of IndexedDB,
 * and a test that passes against a half-built one proves nothing about the
 * browser. So the seam is drawn one level up — at the six operations the app
 * actually performs — with an in-memory implementation for the unit tests and
 * the IndexedDB one proven where it matters, in a real browser, by the
 * Playwright specs.
 *
 * NOTHING HERE THROWS. Every operation returns a discriminated result, the
 * same shape `@/lib/rdkit` uses, because a full disk, a private-mode window
 * and a browser whose storage the user has disabled are all ORDINARY
 * conditions for a drawing program — and a rejected write that surfaces as an
 * unhandled rejection is a save the chemist never learns they did not make.
 *
 * THE META ROW IS THE POINT OF THE THREE STORES. A recents grid that had to
 * decode every molecule to print a title would pay for the whole library on
 * every visit to the landing page. `listMeta` reads one small record per
 * document and is the only call that grid makes; `get` — the expensive one,
 * which decodes a molecule — is reached only when a document is opened.
 */

import type { SketchDocument } from "@starter/shared";

/**
 * The summary the recents grid renders, denormalised out of the document at
 * save time.
 *
 * `formulaUnicode` is stored rather than derived on read for exactly the
 * reason above: deriving it needs the molecule.
 */
export interface DocumentMeta {
  readonly id: string;
  readonly title: string;
  /** ISO-8601. */
  readonly createdAt: string;
  /** ISO-8601. Also the sort key of the recents listing. */
  readonly modifiedAt: string;
  readonly atomCount: number;
  readonly bondCount: number;
  readonly formulaUnicode: string;
  readonly schemaVersion: number;
  /**
   * Bumped by every write that changes the stored title — a rename, or a put
   * carrying a different one. Absent on rows written before it existed, which
   * read as 0.
   *
   * It exists to ORDER title news, not to decide the merge. An editor hears
   * about a title twice over — the rename broadcast and its own put's receipt
   * — and the two can arrive in either order; comparing revisions is what
   * stops the older one being adopted last. The merge itself compares titles
   * by value, where a rename away and back again is harmless.
   */
  readonly titleRevision?: number;
}

/** One document, split the way the three object stores split it. */
export interface StoredRecord {
  readonly meta: DocumentMeta;
  /** `encodeDocument(doc)` verbatim — a plain, structured-cloneable value
   *  with no `undefined`-valued key anywhere. */
  readonly encoded: unknown;
  /** An inline SVG fragment, or null when none was generated. */
  readonly thumbnail: string | null;
}

export type StoreErrorKind =
  /** The write was refused for want of space. Actionable: delete something. */
  | "quota"
  /** Another tab holds an upgrade open, or the database could not be opened. */
  | "blocked"
  /** Storage exists but refused the operation — private mode, disabled site
   *  data, a transaction the browser aborted for its own reasons. */
  | "rejected"
  /** There is no storage at all in this environment. */
  | "unavailable"
  | "not-found"
  /** The row is there and does not decode: a hand-edited file, a document
   *  from a future schema version, a truncated write. */
  | "corrupt";

export interface StoreError {
  readonly kind: StoreErrorKind;
  readonly message: string;
}

export type StoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: StoreError };

export function storeOk<T>(value: T): StoreResult<T> {
  return { ok: true, value };
}

export function storeFail<T>(kind: StoreErrorKind, message: string): StoreResult<T> {
  return { ok: false, error: { kind, message } };
}

/** The title a write left in storage. */
export interface TitleReceipt {
  readonly title: string;
  readonly titleRevision: number;
}

export interface PutReceipt extends TitleReceipt {
  /**
   * A title renamed elsewhere that this write REPLACED, because the writer had
   * changed the title too (decision 52: the editor's own title wins). Null
   * when nothing was overridden.
   */
  readonly replacedTitle: string | null;
}

export interface PutOptions {
  /**
   * The title the writer last knew to be in storage for this id.
   *
   * THE TITLE IS MERGED PER FIELD, inside the put's own transaction, against
   * this. A document open in an editor carries whatever title it was loaded
   * with, and writing that back wholesale undid any rename made from the
   * recents grid in the meantime. With a base, a stored title that moved away
   * from it while the record's own title did not is kept rather than
   * overwritten. Comparing at write time is what makes the rename-vs-save race
   * irrelevant: IndexedDB serialises the two transactions, and whichever runs
   * second sees the other's title. Omitted, the record's title is written as
   * it stands — an import, a duplicate, a journal recovery.
   */
  readonly titleBase?: string | undefined;
}

export interface DocumentStore {
  /** Writes all three rows — document, meta and thumbnail — as one unit. */
  put(record: StoredRecord, options?: PutOptions): Promise<StoreResult<PutReceipt>>;
  /** Decodes. The expensive call, and the one the recents grid must not make. */
  get(id: string): Promise<StoreResult<SketchDocument>>;
  /** Newest first. Reads the meta store ONLY. */
  listMeta(): Promise<StoreResult<readonly DocumentMeta[]>>;
  getThumbnail(id: string): Promise<StoreResult<string | null>>;
  /** Renames in the meta store AND in the stored document, so the two cannot
   *  drift into a grid that says one thing and an editor that says another. */
  rename(id: string, title: string): Promise<StoreResult<TitleReceipt>>;
  remove(id: string): Promise<StoreResult<void>>;
}
