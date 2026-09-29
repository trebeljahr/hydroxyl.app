/**
 * Where this build is deployed, and how to address another page of it.
 *
 * ── ONE QUESTION, TWO CALLERS, AND IT HAD ALREADY BEEN ANSWERED ONCE ───────
 *
 * `lib/rdkit/asset-base.ts` worked this out for the wasm and nothing else
 * needed it, because before the recents grid existed no page in this app
 * linked to another one: the export was only ever entered by typing a URL.
 * The grid changed that, so the answer moved here and the RDKit base now
 * reads it from this module.
 *
 * ── WHY THE ANSWER CANNOT BE `/editor` ─────────────────────────────────────
 *
 * Three shapes have to work and they disagree about what a URL means:
 *
 *   dev / `output:"standalone"` — `trailingSlash: true`, assets at
 *     `/_next/…`, pages served from the site root. `/editor` is correct.
 *
 *   `output:"export"` with `assetPrefix:"./"` — every page is written FLAT at
 *     the export root (`out/editor.html`, never `out/editor/index.html`; see
 *     the trailingSlash comment in next.config.ts and scripts/check-export.mjs
 *     which fails the build if a nested page reappears) and every asset URL is
 *     relative to the DOCUMENT. The app may be opened from a subdirectory, an
 *     Electron custom protocol or a Capacitor bundle, where `/editor` names
 *     the wrong origin-absolute path entirely.
 *
 * MEASURED, and the reason a plain `<a>` is used rather than `next/link`: in
 * the export, a client-side router navigation to `/editor?doc=…` pushes
 * `/editor/?doc=…` — WITH the trailing slash — without loading a document. The
 * page's own relative `./_next/…` then resolves against `/editor/`, so every
 * chunk loaded after that click 404s: the dynamic `import("@/lib/rdkit")` in
 * `lib/io/open.ts` dies with "Failed to load chunk", and reloading the URL the
 * router left in the address bar renders nothing at all, because no document
 * exists at `/editor/`. A full-page navigation to a document-relative href has
 * none of that: the browser loads a real HTML file that sits at the depth its
 * asset prefix was written for.
 *
 * ── LINKS ANSWER FROM THE BUILD, ASSETS ANSWER FROM THE DOCUMENT ───────────
 *
 * Two different questions, and they need different sources.
 *
 * A LINK has to be right in the very first byte of HTML. The grid is
 * prerendered, and a runtime sniff cannot answer during a prerender — the
 * emitted markup would carry `/editor`, a file the export does not contain,
 * until hydration replaced it. `NEXT_PUBLIC_FILE_EXPORT` is substituted at
 * build time (see next.config.ts), so the answer is baked in and there is no
 * hydration flip and no window in which the link is wrong. A bare relative
 * `editor.html` is all a link needs: the browser resolves it against the
 * current document, which is exactly the flat root the export writes.
 *
 * An ASSET base cannot use that, because `rdkitAssetBase()` has to hand an
 * absolute URL to `new Worker(...)`. There the raw `src` ATTRIBUTE is what
 * distinguishes the builds — Next writes `./_next/…` in the export and
 * `/_next/…` everywhere else — while the browser-resolved `.src` carries the
 * deployment directory, because the browser has already done the resolution.
 */

const ASSET_MARKER = "/_next/static/";

interface AssetScript {
  /** Exactly what Next wrote into the tag. */
  readonly raw: string;
  /** The same URL after the browser resolved it against the document. */
  readonly resolved: string;
}

function assetScript(): AssetScript | null {
  if (typeof document === "undefined") return null;
  const script = document.querySelector<HTMLScriptElement>(`script[src*="${ASSET_MARKER}"]`);
  const raw = script?.getAttribute("src");
  if (script === null || raw === null || raw === undefined) return null;
  return { raw, resolved: script.src };
}

/** The directory every page and every public asset of this build sits in,
 *  as an absolute URL ending in a slash. */
export function deploymentRoot(): string {
  const script = assetScript();
  if (script !== null) {
    const marker = script.resolved.indexOf(ASSET_MARKER);
    if (marker >= 0) return script.resolved.slice(0, marker + 1);
  }
  if (typeof document === "undefined") return "/";
  return new URL(".", document.baseURI).href;
}

/**
 * True in `output:"export"`, where every page is a flat `.html` file at the
 * export root and there is no server to resolve a route.
 *
 * Read at CALL time rather than into a module constant. Next substitutes the
 * literal into the bundle either way, and leaving the read in the function is
 * what lets a test stub it.
 */
export function isFileExportBuild(): boolean {
  return process.env.NEXT_PUBLIC_FILE_EXPORT === "1";
}

/**
 * A link to the editor, optionally carrying the document to open.
 *
 * `?doc=` is a QUERY PARAMETER rather than a path segment on purpose:
 * `generateStaticParams` cannot enumerate ids that only exist in a visitor's
 * IndexedDB, so a dynamic segment would fail the export build.
 */
export function editorHref(docId?: string | null): string {
  const query =
    docId === undefined || docId === null || docId === ""
      ? ""
      : `?doc=${encodeURIComponent(docId)}`;
  return `${isFileExportBuild() ? "editor.html" : "/editor"}${query}`;
}

/** A link to the recents grid, in whichever build this is. */
export function recentsHref(): string {
  return isFileExportBuild() ? "index.html" : "/";
}

/** A link to the page that explains what the editor is for. Flat in the
 *  export for the same reason `editor.html` is. */
export function aboutHref(): string {
  return isFileExportBuild() ? "about.html" : "/about";
}

/**
 * The public URL this app is published at, absolute and ending in a slash.
 *
 * The ONE place anything that must name the site from outside it takes the
 * host from: `sitemap.xml`, `robots.txt` and `metadataBase` (decision 122).
 * `next.config.ts` bakes it in from the domain in `.hatchkit.json`, and fails
 * the build when there is none, so an unset value here means this code is
 * running outside a Next build.
 */
export function siteUrl(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL;
  if (url === undefined || url === "") {
    throw new Error("NEXT_PUBLIC_SITE_URL is unset; next.config.ts derives it from .hatchkit.json");
  }
  return url;
}

/**
 * The pages a search engine should index, as absolute URLs: the landing at
 * `/` and the about page. Not the editor, whose `?doc=` ids name one
 * browser's IndexedDB.
 *
 * Each is the address its build answers with a 200 rather than a redirect,
 * which is why the about page is not simply `aboutHref()`: under
 * `trailingSlash: true` a request for `/about` is sent a 308 to `/about/`.
 * The export's `about.html` is the flat file its links already point at;
 * `/about` there only works on a host with extension fallback.
 */
export function indexablePageUrls(): string[] {
  const root = siteUrl();
  return [root, new URL(isFileExportBuild() ? "about.html" : "about/", root).href];
}

/**
 * The licence notice for the redistributed RDKit build, which
 * `scripts/copy-rdkit.mjs` stages beside the wasm.
 *
 * Origin-absolute outside the export, because `/about` is served as
 * `/about/` there and a relative `rdkit/…` would resolve under it.
 */
export function thirdPartyNoticesHref(): string {
  return isFileExportBuild() ? "rdkit/THIRD-PARTY-NOTICES.txt" : "/rdkit/THIRD-PARTY-NOTICES.txt";
}
