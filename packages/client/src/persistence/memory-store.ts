/**
 * An in-memory `DocumentStore`, for the unit tests and for the one production
 * case where there is no storage at all.
 *
 * IT KEEPS THE ENCODED VALUE, not the document. Holding the `SketchDocument`
 * would make every test that round-trips through this store weaker than the
 * real thing by exactly the step most likely to break — `encodeDocument`
 * followed by `decodeStored`, which is where a new optional field goes
 * missing and where a `{ key: undefined }` sneaks back in. Encoding on the way
 * in and decoding on the way out costs nothing at these sizes and makes the
 * fake exercise the same codec the browser does.
 *
 * `failWith` is not a convenience. "A rejected or quota-exhausted write
 * surfaces visibly rather than failing silently" is a claim about the SAVE
 * PATH, not about IndexedDB, and the only way to test it is to hand that path
 * a store that says no.
 */

import type { SketchDocument } from "@starter/shared";

import { decodeStored } from "./migrate";
import { mergeTitle, renameEncoded, renamedMeta, storedTitleOf } from "./title-merge";
import {
  storeFail,
  storeOk,
  type DocumentMeta,
  type DocumentStore,
  type PutReceipt,
  type StoreErrorKind,
  type StoredRecord,
  type StoreResult,
  type TitleReceipt,
} from "./types";

export interface MemoryDocumentStore extends DocumentStore {
  /** Every write from now on fails with this kind, until set back to null. */
  failWith(kind: StoreErrorKind | null, message?: string): void;
  /** How many times `get` was called — i.e. how many molecules were
   *  deserialized. The recents-grid criterion is asserted against this. */
  readonly counts: { get: number; listMeta: number; put: number };
}

export function createMemoryDocumentStore(
  seed: readonly StoredRecord[] = [],
): MemoryDocumentStore {
  const records = new Map<string, StoredRecord>();
  for (const record of seed) records.set(record.meta.id, record);

  const counts = { get: 0, listMeta: 0, put: 0 };
  let failure: { kind: StoreErrorKind; message: string } | null = null;

  function refuse<T>(): StoreResult<T> | null {
    return failure === null ? null : storeFail<T>(failure.kind, failure.message);
  }

  return {
    counts,

    failWith(kind, message = "The memory store was told to refuse this write.") {
      failure = kind === null ? null : { kind, message };
    },

    put(record, options = {}): Promise<StoreResult<PutReceipt>> {
      counts.put++;
      const refused = refuse<PutReceipt>();
      if (refused) return Promise.resolve(refused);
      const stored = records.get(record.meta.id);
      const merged = mergeTitle(
        record,
        stored === undefined ? null : storedTitleOf(stored.meta),
        options.titleBase,
      );
      records.set(record.meta.id, merged.record);
      return Promise.resolve(storeOk(merged.receipt));
    },

    get(id: string): Promise<StoreResult<SketchDocument>> {
      counts.get++;
      const record = records.get(id);
      if (record === undefined) {
        return Promise.resolve(storeFail<SketchDocument>("not-found", `No document "${id}".`));
      }
      return Promise.resolve(decodeStored(record.encoded));
    },

    listMeta(): Promise<StoreResult<readonly DocumentMeta[]>> {
      counts.listMeta++;
      const metas = [...records.values()]
        .map((record) => record.meta)
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
      return Promise.resolve(storeOk<readonly DocumentMeta[]>(metas));
    },

    getThumbnail(id: string): Promise<StoreResult<string | null>> {
      return Promise.resolve(storeOk(records.get(id)?.thumbnail ?? null));
    },

    rename(id: string, title: string): Promise<StoreResult<TitleReceipt>> {
      const refused = refuse<TitleReceipt>();
      if (refused) return Promise.resolve(refused);
      const record = records.get(id);
      if (record === undefined) {
        return Promise.resolve(storeFail<TitleReceipt>("not-found", `No document "${id}".`));
      }
      // Both halves, for the reason `DocumentStore.rename` gives: a grid and
      // an editor disagreeing about a document's name is worse than either
      // being wrong.
      const encoded = renameEncoded(record.encoded, title);
      const meta = renamedMeta(record.meta, title);
      records.set(id, { meta, encoded, thumbnail: record.thumbnail });
      return Promise.resolve(storeOk({ title, titleRevision: meta.titleRevision ?? 0 }));
    },

    remove(id: string): Promise<StoreResult<void>> {
      records.delete(id);
      return Promise.resolve(storeOk(undefined));
    },
  };
}
