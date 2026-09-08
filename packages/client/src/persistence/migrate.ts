/**
 * Upgrading a stored document to the schema this build understands, and
 * decoding it.
 *
 * MIGRATION RUNS BEFORE THE SCHEMA, NOT INSIDE IT. `sketchDocumentSchema`
 * pins `schemaVersion` to `.max(SCHEMA_VERSION)`, so a document written by an
 * older build is rejected outright rather than coerced — deliberately, per
 * the note in @starter/shared. The upgrade therefore has to happen on the raw
 * parsed value, one version step at a time, and only then does the result meet
 * the schema.
 *
 * SCHEMA_VERSION IS STILL 1, so there is nothing to upgrade FROM yet and the
 * ladder below has no rungs. It exists anyway because the alternative — adding
 * the whole mechanism at the moment the first breaking change lands, with
 * users' documents already on disk — is how a format loses its old files. The
 * shape is what matters now: `migrateStored` is total, it never throws, and
 * every future step is a case in one switch.
 *
 * INPUT IS UNTRUSTED, and IndexedDB is not a trusted source: rows survive a
 * hand edit through devtools, a half-written transaction, and a build that no
 * longer exists. So the version is read with `Object.hasOwn` rather than `in`
 * — a stored document whose molecule carries an atom id of `"constructor"`
 * decoded cleanly before the codec was hardened against exactly this, and
 * anything new reading external data has to be hardened too.
 */

import { SCHEMA_VERSION, safeDecodeDocument } from "@starter/shared";
import type { SketchDocument } from "@starter/shared";

import { storeFail, storeOk, type StoreResult } from "./types";

/** The version a raw stored value claims, or `undefined` when it claims none
 *  in a form we can read. */
export function storedSchemaVersion(raw: unknown): number | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  if (!Object.hasOwn(raw, "schemaVersion")) return undefined;
  const value = (raw as Record<string, unknown>)["schemaVersion"];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export type MigrateResult =
  | { readonly ok: true; readonly value: unknown; readonly upgradedFrom?: number }
  | { readonly ok: false; readonly message: string };

/**
 * Walk a stored value up to `SCHEMA_VERSION`.
 *
 * A version we have never heard of is refused rather than attempted. Reading a
 * document from a NEWER build with this build's schema would drop whatever it
 * added and then re-save the truncated result over the original, which is the
 * one failure mode worse than "this file is from a newer version".
 */
export function migrateStored(raw: unknown): MigrateResult {
  const from = storedSchemaVersion(raw);
  if (from === undefined) {
    return { ok: false, message: "This record does not carry a schema version." };
  }
  if (from > SCHEMA_VERSION) {
    return {
      ok: false,
      message:
        `This document was written by a newer version of the editor ` +
        `(schema ${String(from)}; this build reads up to ${String(SCHEMA_VERSION)}).`,
    };
  }
  if (from < 1) {
    return { ok: false, message: `Unknown schema version ${String(from)}.` };
  }

  let value = raw;
  for (let version = from; version < SCHEMA_VERSION; version++) {
    const step = UPGRADES[version];
    if (step === undefined) {
      return {
        ok: false,
        message: `No upgrade path from schema version ${String(version)}.`,
      };
    }
    value = step(value);
  }
  return from === SCHEMA_VERSION ? { ok: true, value } : { ok: true, value, upgradedFrom: from };
}

/**
 * `UPGRADES[n]` turns a version-`n` value into a version-`n+1` one.
 *
 * Empty while SCHEMA_VERSION is 1. Each entry must also bump the value's own
 * `schemaVersion` field, since that is what the schema validates against.
 */
const UPGRADES: Readonly<Record<number, (value: unknown) => unknown>> = {};

/** Migrate, then decode. The only route from a stored row to a document. */
export function decodeStored(raw: unknown): StoreResult<SketchDocument> {
  const migrated = migrateStored(raw);
  if (!migrated.ok) return storeFail("corrupt", migrated.message);
  const decoded = safeDecodeDocument(migrated.value);
  if (!decoded.ok) {
    return storeFail(
      "corrupt",
      `This document could not be read: ${decoded.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return storeOk(decoded.document);
}
