/**
 * The real store: three IndexedDB object stores in one database.
 *
 * ── WHY THREE STORES AND NOT ONE ───────────────────────────────────────────
 *
 * `documents` holds the encoded sketch, which is as big as the molecule.
 * `meta` holds the ~120-byte summary the recents grid renders. `thumbnails`
 * holds an SVG fragment that is small but never wanted in a listing. Putting
 * all three in one record would mean the landing page read — and the browser
 * structured-cloned — every molecule in the library to print a row of titles.
 * Split, the grid touches `meta` alone, and that is a property this file
 * enforces rather than merely intends: `listMeta` opens a transaction over
 * `meta` only, so a future edit that reached for a molecule there would throw
 * `NotFoundError` rather than quietly get slow.
 *
 * ── AND WHY ONE TRANSACTION FOR THE WRITE ──────────────────────────────────
 *
 * A document whose meta row says one thing and whose molecule says another is
 * worse than an unsaved document: the grid would advertise a drawing that does
 * not open. One readwrite transaction across all three stores makes the save
 * atomic — IndexedDB aborts the whole thing if any request fails, including
 * the quota failure this is most likely to hit.
 *
 * ── NOTHING HERE THROWS ────────────────────────────────────────────────────
 *
 * Every path resolves a `StoreResult`. That includes the three failures a
 * browser actually produces and which are silent by default:
 *
 * - `QuotaExceededError` on the request or on the transaction's abort. The
 *   request's `onerror` fires FIRST and, unhandled, lets the abort follow with
 *   no name attached, which is how a full disk becomes a save that simply did
 *   not happen. Both are caught.
 * - `open()` firing neither `onsuccess` nor `onerror`. A Firefox private
 *   window and a Chrome profile with site data blocked both leave the request
 *   pending indefinitely rather than rejecting, so there is a timeout.
 * - `onblocked`, when another tab holds an older version open.
 *
 * `indexedDB` is read through `globalThis` at CALL time, never at module
 * scope: this module is imported by the editor page, which is prerendered by
 * `next build`, and a top-level touch of a browser global is a build failure
 * rather than a runtime one.
 */

import type { SketchDocument } from "@starter/shared";

import { decodeStored } from "./migrate";
import { mergeTitle, renameEncoded, renamedMeta, storedTitleOf } from "./title-merge";
import {
  storeFail,
  storeOk,
  type DocumentMeta,
  type DocumentStore,
  type PutOptions,
  type PutReceipt,
  type StoreError,
  type StoreErrorKind,
  type StoredRecord,
  type StoreResult,
  type TitleReceipt,
} from "./types";

export const DB_NAME = "chemistry-sketcher";
/** The IndexedDB schema version, which is NOT the document schema version.
 *  This one counts object-store layout changes; the document's counts changes
 *  to what a row contains, and is migrated by `migrate.ts`. */
export const DB_VERSION = 1;

export const DOCUMENTS_STORE = "documents";
export const META_STORE = "meta";
export const THUMBNAILS_STORE = "thumbnails";
const MODIFIED_INDEX = "modifiedAt";

/** How long to wait on `open()` before deciding storage is not coming. See
 *  the header: a blocked profile leaves the request pending, not rejected. */
const OPEN_TIMEOUT_MS = 10_000;

/**
 * Name a DOMException the way the caller has to act on it.
 *
 * Quota is the one worth separating, because it is the only one the user can
 * do something about — and the message says what.
 */
export function classifyStorageError(error: unknown, context: string): StoreError {
  if (error instanceof DOMException) {
    if (error.name === "QuotaExceededError") {
      return {
        kind: "quota",
        message:
          `There is no room left in this browser's storage, so ${context} was not saved. ` +
          `Delete a document from the recents list, or export this one to a file.`,
      };
    }
    if (error.name === "VersionError" || error.name === "InvalidStateError") {
      return {
        kind: "blocked",
        message: `Storage is busy or held open by another tab, so ${context} was not saved.`,
      };
    }
    return { kind: "rejected", message: `${context} was refused by storage: ${error.name}.` };
  }
  if (error instanceof Error) return { kind: "rejected", message: error.message };
  return { kind: "rejected", message: `${context} failed for an unknown reason.` };
}

function factory(): IDBFactory | undefined {
  // `globalThis.indexedDB` is `undefined` under node and jsdom, and accessing
  // it can THROW in a sandboxed iframe rather than return undefined.
  try {
    return typeof globalThis.indexedDB === "undefined" ? undefined : globalThis.indexedDB;
  } catch {
    return undefined;
  }
}

function openDatabase(name: string, version: number): Promise<IDBDatabase> {
  const idb = factory();
  if (idb === undefined) {
    return Promise.reject(new Error("This browser has no IndexedDB, so nothing can be saved."));
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => {
        reject(new Error("Storage did not respond, so this document was not saved."));
      });
    }, OPEN_TIMEOUT_MS);

    let request: IDBOpenDBRequest;
    try {
      request = idb.open(name, version);
    } catch (error) {
      finish(() => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENTS_STORE)) {
        // keyPath "id": `encodeDocument` already puts the document's own id at
        // the top level, so the row IS the encoded document with no wrapper.
        db.createObjectStore(DOCUMENTS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        const meta = db.createObjectStore(META_STORE, { keyPath: "id" });
        meta.createIndex(MODIFIED_INDEX, "modifiedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(THUMBNAILS_STORE)) {
        db.createObjectStore(THUMBNAILS_STORE, { keyPath: "id" });
      }
    };
    request.onblocked = () => {
      finish(() => {
        reject(
          new Error(
            "Another tab is holding this editor's storage open. Close it and try again.",
          ),
        );
      });
    };
    request.onsuccess = () => {
      finish(() => {
        const db = request.result;
        // A version change from another tab must not leave this one holding a
        // connection that blocks it forever.
        db.onversionchange = () => {
          db.close();
        };
        resolve(db);
      });
    };
    request.onerror = () => {
      finish(() => {
        reject(request.error ?? new Error("Storage could not be opened."));
      });
    };
  });
}

/** Awaits a transaction's completion, surfacing the ABORT reason — which is
 *  where `QuotaExceededError` actually lands. */
function settle(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => {
      resolve();
    };
    tx.onabort = () => {
      reject(tx.error ?? new DOMException("The write was aborted.", "AbortError"));
    };
    tx.onerror = () => {
      reject(tx.error ?? new DOMException("The write failed.", "UnknownError"));
    };
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new DOMException("The request failed.", "UnknownError"));
    };
  });
}

export interface IndexedDbStoreOptions {
  readonly name?: string | undefined;
  readonly version?: number | undefined;
}

export function createIndexedDbStore(options: IndexedDbStoreOptions = {}): DocumentStore {
  const name = options.name ?? DB_NAME;
  const version = options.version ?? DB_VERSION;

  /**
   * One connection, reopened if it was closed.
   *
   * Cached as the PROMISE rather than the database, so twenty autosaves in the
   * first second of a session open the database once. A rejected promise is
   * dropped, not remembered: a transient failure (another tab mid-upgrade)
   * must not poison every later write for the life of the page, which is the
   * opposite of the RDKit worker's deliberately sticky failure — there the
   * failure is a missing asset and retrying costs a 404 per call.
   */
  let connection: Promise<IDBDatabase> | null = null;

  /**
   * The SAME database, held synchronously once it has been opened.
   *
   * `await connect()` — even on a promise that resolved minutes ago — puts a
   * microtask between the caller and the `put`, and the warm path has no need
   * of one. Holding the handle keeps a flush synchronous from the event that
   * triggered it all the way to the queued request.
   *
   * IT DOES NOT MAKE A TEARDOWN WRITE SURVIVE, and it was once claimed here
   * that it did. Measured in Chrome afterwards: with the handle warm and the
   * whole path synchronous, the three requests really are queued before
   * `pagehide` returns — and the transaction still never commits, because the
   * document is destroyed first. No `complete` event, no row. Rescuing an edit
   * from a teardown needs something synchronous all the way to storage, which
   * IndexedDB is not; see `journal.ts`.
   *
   * Cleared alongside `connection` whenever the handle stops being usable.
   */
  let ready: IDBDatabase | null = null;

  function forget(): void {
    connection = null;
    ready = null;
  }

  function connect(): Promise<IDBDatabase> {
    connection ??= openDatabase(name, version).then(
      (db) => {
        ready = db;
        // Both ways a connection can stop being usable have to drop the
        // cached handle, or every later write would be issued against a dead
        // database. `close` fires when the browser loses the connection on its
        // own; `versionchange` is another tab upgrading the schema, and
        // `openDatabase` already closes on it — that path does NOT fire
        // `close`, so it is chained here rather than replaced.
        db.addEventListener("close", forget);
        const closeForUpgrade = db.onversionchange;
        db.onversionchange = (event) => {
          closeForUpgrade?.call(db, event);
          forget();
        };
        return db;
      },
      (error: unknown) => {
        forget();
        throw error;
      },
    );
    return connection;
  }

  async function withStores<T>(
    stores: readonly string[],
    mode: IDBTransactionMode,
    context: string,
    body: (tx: IDBTransaction) => Promise<T>,
  ): Promise<StoreResult<T>> {
    // NO `await` on the warm path — see `ready` above. Everything before the
    // first await in an async function runs synchronously with the caller, so
    // a flush fired from `pagehide` gets its requests onto the transaction in
    // the same task the event was dispatched in.
    let db = ready;
    if (db === null) {
      try {
        db = await connect();
      } catch (error) {
        const kind: StoreErrorKind = factory() === undefined ? "unavailable" : "blocked";
        return storeFail<T>(
          kind,
          error instanceof Error ? error.message : `${context} could not reach storage.`,
        );
      }
    }
    try {
      const tx = db.transaction([...stores], mode);
      const settled = settle(tx);
      const value = await body(tx);
      // Both, and in this order. The body's requests can reject on their own
      // (a bad key) and the transaction can abort afterwards (quota); awaiting
      // only one of the two loses whichever failure came second.
      await settled;
      return storeOk(value);
    } catch (error) {
      // A connection closed under us — another tab upgraded the schema — is
      // worth one retry on the next call rather than for the life of the page.
      if (error instanceof DOMException && error.name === "InvalidStateError") forget();
      return { ok: false, error: classifyStorageError(error, context) };
    }
  }

  return {
    put(record: StoredRecord, options: PutOptions = {}): Promise<StoreResult<PutReceipt>> {
      return withStores(
        [DOCUMENTS_STORE, META_STORE, THUMBNAILS_STORE],
        "readwrite",
        `"${record.meta.title}"`,
        async (tx) => {
          // Read INSIDE the write transaction, never before it. A rename is a
          // readwrite transaction over the same stores, so IndexedDB runs the
          // two one after the other; the stored title this sees is therefore
          // the one this write lands on top of, whichever tab got there first.
          //
          // Read even without a base, because the revision must carry on from
          // the stored row rather than restart at 0. That costs the put its
          // "queued synchronously from the caller" property, which `ready`
          // above records never made a teardown write survive anyway —
          // `journal.ts` is the rescue on that path.
          const stored = storedTitleOf(
            await request<unknown>(tx.objectStore(META_STORE).get(record.meta.id)),
          );
          const merged = mergeTitle(record, stored, options.titleBase);
          const { meta, encoded, thumbnail } = merged.record;
          // Fire all three, then await. IndexedDB queues them on the same
          // transaction, so this is one round trip rather than three.
          const writes = [
            request(tx.objectStore(DOCUMENTS_STORE).put(encoded)),
            request(tx.objectStore(META_STORE).put(meta)),
            thumbnail === null
              ? request(tx.objectStore(THUMBNAILS_STORE).delete(meta.id))
              : request(tx.objectStore(THUMBNAILS_STORE).put({ id: meta.id, svg: thumbnail })),
          ];
          await Promise.all(writes);
          return merged.receipt;
        },
      );
    },

    async get(id: string): Promise<StoreResult<SketchDocument>> {
      const raw = await withStores([DOCUMENTS_STORE], "readonly", "this document", (tx) =>
        request<unknown>(tx.objectStore(DOCUMENTS_STORE).get(id)),
      );
      if (!raw.ok) return raw;
      if (raw.value === undefined) {
        return storeFail<SketchDocument>("not-found", `No saved document with the id "${id}".`);
      }
      return decodeStored(raw.value);
    },

    listMeta(): Promise<StoreResult<readonly DocumentMeta[]>> {
      // META ONLY. See the header: the narrow store list is what makes the
      // "lists without deserializing molecules" claim structural.
      return withStores([META_STORE], "readonly", "the recents list", async (tx) => {
        const rows = await request<unknown[]>(
          tx.objectStore(META_STORE).index(MODIFIED_INDEX).getAll(),
        );
        // The index sorts ascending; the grid wants newest first.
        return rows.reverse() as readonly DocumentMeta[];
      });
    },

    async getThumbnail(id: string): Promise<StoreResult<string | null>> {
      const row = await withStores([THUMBNAILS_STORE], "readonly", "a preview", (tx) =>
        request<unknown>(tx.objectStore(THUMBNAILS_STORE).get(id)),
      );
      if (!row.ok) return row;
      if (typeof row.value !== "object" || row.value === null) return storeOk(null);
      const svg = (row.value as Record<string, unknown>)["svg"];
      return storeOk(typeof svg === "string" ? svg : null);
    },

    rename(id: string, title: string): Promise<StoreResult<TitleReceipt>> {
      return withStores(
        [DOCUMENTS_STORE, META_STORE],
        "readwrite",
        "this rename",
        async (tx) => {
          const documents = tx.objectStore(DOCUMENTS_STORE);
          const meta = tx.objectStore(META_STORE);
          const [encoded, row] = await Promise.all([
            request<unknown>(documents.get(id)),
            request<unknown>(meta.get(id)),
          ]);
          if (encoded === undefined || row === undefined) {
            throw new DOMException(`No saved document with the id "${id}".`, "NotFoundError");
          }
          const renamed = renamedMeta(row as DocumentMeta, title);
          await Promise.all([
            request(documents.put(renameEncoded(encoded, title))),
            request(meta.put(renamed)),
          ]);
          return { title, titleRevision: renamed.titleRevision ?? 0 };
        },
      );
    },

    remove(id: string): Promise<StoreResult<void>> {
      return withStores(
        [DOCUMENTS_STORE, META_STORE, THUMBNAILS_STORE],
        "readwrite",
        "this delete",
        async (tx) => {
          await Promise.all([
            request(tx.objectStore(DOCUMENTS_STORE).delete(id)),
            request(tx.objectStore(META_STORE).delete(id)),
            request(tx.objectStore(THUMBNAILS_STORE).delete(id)),
          ]);
        },
      );
    },
  };
}
