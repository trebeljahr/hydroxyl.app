/**
 * The service worker for the hosted build — decision 239.
 *
 * BUNDLED TO `public/sw.js` by `scripts/build-service-worker.mjs` after
 * `next build`, which substitutes `__PRECACHE__` with every file under
 * `.next/static/`. Never registered in the static export or in `next dev`
 * (`@/lib/service-worker`).
 *
 * NO `skipWaiting`. A new worker takes over once every tab of the old one has
 * closed, and nothing here ever reloads a page. A tab moves to a new release
 * only through `ReleaseLifetime`, which waits for autosave first, so this file
 * has no way to lose an edit.
 */

import {
  CACHES,
  CACHE_PREFIX,
  PAGE_CACHE,
  PRECACHED_PAGES,
  RDKIT_CACHE,
  STATIC_CACHE,
  cacheableStatic,
  pageKey,
  pageKeys,
  rdkitVersion,
  route,
  staticKey,
} from "./routing";

declare const __PRECACHE__: readonly string[];

// The DOM lib types this file is checked against have no service worker
// scope, and adding the WebWorker lib to the client project would retype
// every `self` in it. These are the few members this file touches.
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}
interface ExtendableMessageEvent extends ExtendableEvent {
  readonly data: unknown;
}
declare const self: {
  readonly location: Location;
  readonly clients: { claim(): Promise<void> };
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
  addEventListener(type: "message", listener: (event: ExtendableMessageEvent) => void): void;
};

const origin = self.location.origin;
const precached = new Set(__PRECACHE__.map((path) => new URL(path, origin).href));

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const statics = await caches.open(STATIC_CACHE);
      const missing: string[] = [];
      for (const url of precached) if (!(await statics.match(url))) missing.push(url);
      // All or nothing: a half-filled cache would pass for offline-ready.
      await statics.addAll(missing);
      const pages = await caches.open(PAGE_CACHE);
      await Promise.all(
        PRECACHED_PAGES.map(async (path) => {
          const url = new URL(path, origin).href;
          const response = await fetch(url, { cache: "reload" });
          if (!response.ok) throw new Error(`${url} answered ${response.status}`);
          await pages.put(url, response);
        }),
      );
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(CACHE_PREFIX) && !(CACHES as readonly string[]).includes(name)) {
          await caches.delete(name);
        }
      }
      // Every tab of the previous worker has closed by now (no skipWaiting),
      // so no open page can still want a file the new build dropped.
      const statics = await caches.open(STATIC_CACHE);
      for (const request of await statics.keys()) {
        if (!precached.has(request.url)) await statics.delete(request);
      }
      // The first visit's page becomes controlled at once, so the editor's
      // request to fetch RDKit ahead of time reaches this worker.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const kind = route(
    { url: request.url, method: request.method, mode: request.mode, rsc: request.headers.has("RSC") },
    origin,
  );
  if (kind === "page") event.respondWith(page(request));
  else if (kind === "static") event.respondWith(staticFile(request));
  else if (kind === "rdkit") event.respondWith(rdkitFile(request));
});

self.addEventListener("message", (event) => {
  const data = event.data as { type?: unknown; urls?: unknown } | null;
  if (data?.type !== "warm-rdkit" || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter(
    (url): url is string =>
      typeof url === "string" &&
      route({ url, method: "GET", mode: "cors", rsc: false }, origin) === "rdkit",
  );
  event.waitUntil(Promise.all(urls.map((url) => rdkitFile(new Request(url)))).catch(() => {}));
});

/** Network first: a rolled release is never hidden behind a cache. */
async function page(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    // A redirect (opaque under navigation's manual mode) or an error page is
    // no offline answer for the path it came from.
    if (response.ok && response.type === "basic") {
      const copy = response.clone();
      void caches.open(PAGE_CACHE).then((pages) => pages.put(pageKey(request.url), copy));
    }
    return response;
  } catch (error) {
    const pages = await caches.open(PAGE_CACHE);
    for (const key of pageKeys(request.url)) {
      const cached = await pages.match(key);
      if (cached) return cached;
    }
    throw error;
  }
}

async function staticFile(request: Request): Promise<Response> {
  const statics = await caches.open(STATIC_CACHE);
  const key = staticKey(request.url);
  const cached = await statics.match(key);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheableStatic(response.status, response.headers.get("Cache-Control"))) {
    await statics.put(key, response.clone());
  }
  return response;
}

async function rdkitFile(request: Request): Promise<Response> {
  const rdkit = await caches.open(RDKIT_CACHE);
  const cached = await rdkit.match(request.url);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.status === 200) {
    await rdkit.put(request.url, response.clone());
    // One RDKit build at a time: 6.9 MB per stale copy adds up.
    const version = rdkitVersion(request.url);
    for (const key of await rdkit.keys()) {
      if (rdkitVersion(key.url) !== version) await rdkit.delete(key);
    }
  }
  return response;
}
