/**
 * How much the library occupies, and whether the browser has promised to keep
 * it. Both through the Storage API, both optional.
 *
 * ── WHY THE GRID SHOWS THIS AT ALL (decision 108) ──────────────────────────
 *
 * Sketches live only in this origin's IndexedDB. By default that storage is
 * "best effort": under disk pressure a browser may clear it without asking,
 * and some clear a site's script-written storage after a stretch of days
 * without a visit. A local-only library therefore owes the chemist two facts —
 * how big it is, and whether it is protected — and a way to ask for the
 * protection.
 *
 * ── `persist()` RUNS ON A CLICK, NEVER ON LOAD ─────────────────────────────
 *
 * Firefox answers it with a permission prompt. Firing that at every visitor on
 * page load is how a site teaches people to click "Block". Chromium decides
 * silently from engagement, so asking early would not help there either.
 *
 * ── NOTHING HERE THROWS, AND ABSENCE IS AN ANSWER ──────────────────────────
 *
 * jsdom, node, older Safari and some embedded webviews have no
 * `navigator.storage`. `null` means "the browser does not say", which the UI
 * renders as silence rather than as a claim either way.
 */

/** Just the part of `StorageManager` this module calls, so a test can pass a
 *  stub instead of patching a global. */
export interface StorageApi {
  estimate?: () => Promise<{ usage?: number | undefined }>;
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

export interface StorageStatus {
  /** Bytes this origin stores, or null when the browser does not say. */
  readonly usageBytes: number | null;
  /** True once the browser has promised not to clear this site's storage on
   *  its own. Null when there is no way to ask. */
  readonly persisted: boolean | null;
}

function browserStorage(): StorageApi | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { storage?: StorageApi }).storage;
}

export async function readStorageStatus(
  api: StorageApi | undefined = browserStorage(),
): Promise<StorageStatus> {
  let usageBytes: number | null = null;
  let persisted: boolean | null = null;
  try {
    const estimate = await api?.estimate?.();
    if (typeof estimate?.usage === "number" && Number.isFinite(estimate.usage)) {
      usageBytes = estimate.usage;
    }
  } catch {
    // An estimate the browser refuses is the same as no estimate.
  }
  try {
    if (typeof api?.persisted === "function" && typeof api.persist === "function") {
      persisted = await api.persisted();
    }
  } catch {
    persisted = null;
  }
  return { usageBytes, persisted };
}

/** Ask the browser to keep this site's storage. True when it agreed, false
 *  when it declined, null when there is no way to ask. */
export async function requestPersistentStorage(
  api: StorageApi | undefined = browserStorage(),
): Promise<boolean | null> {
  if (typeof api?.persist !== "function") return null;
  try {
    return await api.persist();
  } catch {
    return false;
  }
}

/** "12 KB", "3.4 MB". Decimal units, as browsers' own storage settings show. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${String(Math.round(bytes))} bytes`;
  if (bytes < 1_000_000) return `${String(Math.round(bytes / 1000))} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
