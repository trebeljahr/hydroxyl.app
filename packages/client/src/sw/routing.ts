/**
 * Which caching rule a request falls under — the service worker's whole
 * policy, as pure functions so Vitest can pin it without a worker.
 * Decision 239 holds the reasoning; `service-worker.ts` applies it.
 */

export type Route =
  /** A page load. Network first; the cached copy is only the offline answer. */
  | "page"
  /** `/_next/static/…`, hashed by Next and immutable. Cache first. */
  | "static"
  /** A versioned RDKit file (`?v=<content hash>`). Cache first. */
  | "rdkit"
  /** Everything else, left to the browser untouched. */
  | "pass";

export interface RouteInput {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
  /** The `RSC` request header, which Next's client router sets. */
  readonly rsc: boolean;
}

export const CACHE_PREFIX = "sketcher-";
export const PAGE_CACHE = `${CACHE_PREFIX}pages-v1`;
export const STATIC_CACHE = `${CACHE_PREFIX}static-v1`;
export const RDKIT_CACHE = `${CACHE_PREFIX}rdkit-v1`;
export const CACHES = [PAGE_CACHE, STATIC_CACHE, RDKIT_CACHE] as const;

/** Pages stored at install, so the first offline launch has both the
 *  library (`start_url`) and the editor even if only one was visited. */
export const PRECACHED_PAGES = ["/", "/editor/"] as const;

export function route(request: RouteInput, origin: string): Route {
  if (request.method !== "GET") return "pass";
  const url = new URL(request.url);
  // Plausible, PubChem and anything else off-site are none of our business.
  if (url.origin !== origin) return "pass";
  if (request.mode === "navigate") return "page";
  // An RSC payload names one release's modules; serving a stale one is the
  // skew `shared-assets.cjs` answers with 409. Never cache it.
  if (request.rsc || url.searchParams.has("_rsc")) return "pass";
  if (url.pathname.startsWith("/_next/static/")) return "static";
  if (url.pathname.startsWith("/rdkit/") && url.searchParams.has("v")) return "rdkit";
  return "pass";
}

/**
 * Where a static file is stored: its path alone. Next appends `?dpl=<release>`
 * when NEXT_DEPLOYMENT_ID is set, and the same hashed file must not be stored
 * once per release that happened to request it.
 */
export function staticKey(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

/**
 * The cached copies that may answer a page load offline, best first.
 *
 * The query is dropped: `/editor?example=…` and `/editor?doc=…` are one
 * prerendered document that reads its own query (decision 127). Standalone
 * serves `/editor` as a 308 to `/editor/`, and that redirect is never stored,
 * so a slashless path also tries the slashed one.
 */
export function pageKeys(url: string): string[] {
  const parsed = new URL(url);
  const base = `${parsed.origin}${parsed.pathname}`;
  return parsed.pathname.endsWith("/") ? [base] : [base, `${base}/`];
}

/** The key a fresh page response is stored under. */
export function pageKey(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

/**
 * Whether a network response to a static request may be stored.
 *
 * Production marks `/_next/static/` `immutable`; `next dev` does not, and its
 * chunk names are not content hashes. A worker a local `next start` left on
 * the dev port would otherwise pin dev chunks forever.
 */
export function cacheableStatic(status: number, cacheControl: string | null): boolean {
  return status === 200 && cacheControl !== null && /\bimmutable\b/i.test(cacheControl);
}

/** The RDKit version a URL names, or null. */
export function rdkitVersion(url: string): string | null {
  return new URL(url).searchParams.get("v");
}
