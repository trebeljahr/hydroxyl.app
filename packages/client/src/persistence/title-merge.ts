/**
 * The title, merged per field when a document is written.
 *
 * A document open in an editor is written back WHOLE on every autosave, and
 * the title rides along in it. Before this module, renaming a card in the
 * recents grid while the same sketch was open in another tab lasted exactly
 * until that tab's next edit: the editor still held the old title and put it
 * straight back. The molecule is still last-writer-wins — reconciling two
 * edits of one structure is a different feature, see broadcast.ts — but the
 * title is one string that the grid can change without touching anything
 * else, so it can be merged honestly.
 *
 * Pure, and shared by both stores, so the memory store the unit tests use and
 * the IndexedDB store the browser uses cannot disagree about the rule.
 */

import type { DocumentMeta, PutReceipt, StoredRecord, TitleReceipt } from "./types";

/**
 * Retitle an encoded document without decoding it.
 *
 * Shared with the IndexedDB store, and written defensively because the value
 * comes back out of storage rather than out of `encodeDocument`: a row that no
 * longer has a metadata object is left exactly as it was, so a rename cannot
 * turn an unreadable document into a differently unreadable one.
 */
export function renameEncoded(encoded: unknown, title: string): unknown {
  if (typeof encoded !== "object" || encoded === null) return encoded;
  if (!Object.hasOwn(encoded, "metadata")) return encoded;
  const metadata = (encoded as Record<string, unknown>)["metadata"];
  if (typeof metadata !== "object" || metadata === null) return encoded;
  return { ...(encoded as Record<string, unknown>), metadata: { ...metadata, title } };
}

/**
 * What a stored meta row says about its title, read defensively: the row comes
 * out of storage, and one written before `titleRevision` existed has none.
 */
export function storedTitleOf(row: unknown): TitleReceipt | null {
  if (typeof row !== "object" || row === null) return null;
  const title = Object.hasOwn(row, "title") ? (row as Record<string, unknown>)["title"] : undefined;
  if (typeof title !== "string") return null;
  const revision = Object.hasOwn(row, "titleRevision")
    ? (row as Record<string, unknown>)["titleRevision"]
    : undefined;
  return {
    title,
    titleRevision:
      typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0
        ? revision
        : 0,
  };
}

/**
 * The record to write, given what storage holds for its id right now.
 *
 * - No stored row, or no base: the record's title stands. A first save, an
 *   import, a duplicate, a journal recovery.
 * - Storage still holds the base, or already holds the record's title:
 *   nothing moved elsewhere, and the record's title stands.
 * - Storage moved away from the base and the record did NOT: somebody renamed
 *   it elsewhere, and this writer never touched the title. Storage's title is
 *   kept.
 * - Both moved, to different titles: a genuine conflict. The writer's title
 *   wins (decision 52) and the title it replaced is reported, so the editor
 *   can say what it overrode.
 */
export function mergeTitle(
  record: StoredRecord,
  stored: TitleReceipt | null,
  titleBase: string | undefined,
): { readonly record: StoredRecord; readonly receipt: PutReceipt } {
  const mine = record.meta.title;
  let title = mine;
  let replacedTitle: string | null = null;
  if (
    stored !== null &&
    titleBase !== undefined &&
    stored.title !== titleBase &&
    stored.title !== mine
  ) {
    if (mine === titleBase) title = stored.title;
    else replacedTitle = stored.title;
  }
  const titleRevision =
    stored === null
      ? 0
      : title === stored.title
        ? stored.titleRevision
        : stored.titleRevision + 1;
  const meta: DocumentMeta = { ...record.meta, title, titleRevision };
  return {
    record: {
      meta,
      encoded: title === mine ? record.encoded : renameEncoded(record.encoded, title),
      thumbnail: record.thumbnail,
    },
    receipt: { title, titleRevision, replacedTitle },
  };
}

/** The meta row a rename writes: the new title, one revision on. */
export function renamedMeta(row: DocumentMeta, title: string): DocumentMeta {
  const stored = storedTitleOf(row);
  return { ...row, title, titleRevision: (stored?.titleRevision ?? 0) + 1 };
}
