/**
 * Plausible pageviews, cookie-less, and nothing else (decisions 136 and 170).
 *
 * ── NO TRACKER SCRIPT IS LOADED ────────────────────────────────────────────
 *
 * The landing page promises that "the structures you draw do not leave your
 * computer", so what analytics sends has to be something this repo can state
 * exactly. Plausible's own script cannot be held to that:
 *
 *   - It sends `document.referrer` as it is, and has no option to change it.
 *     A same-origin referrer carries the whole URL, so opening the recents
 *     grid from `/editor/?doc=<id>` would report the document id.
 *   - The site settings `hatchkit add` creates turn on form-submission and
 *     outbound-link tracking, which newer trackers send as custom events.
 *   - A third-party script runs with the page, and can read it.
 *
 * So the root layout inlines {@link pageviewScript} instead: one POST per page
 * load to Plausible's Events API, built here from four fields. The pages link
 * to each other with plain anchors (see `lib/deployment.ts`), so every
 * navigation is a page load and there is no client-side route change to miss.
 *
 * ── THE SETTINGS ARE THE ONES `hatchkit add` WRITES ────────────────────────
 *
 * `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` and `NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL`. The
 * events go to the script URL's origin + `/api/event`, which is the rule
 * Plausible's tracker applies to its own `src`.
 *
 * `hatchkit add` writes both into `packages/client/.env.production`, encrypted
 * with dotenvx, and `next build` loads that file. A build without the key (CI,
 * the Docker image) therefore reads `encrypted:…` ciphertext, which is treated
 * as no settings at all. The image takes the real values as build args from
 * GitHub repository variables instead; see the Dockerfile.
 */

import { isFileExportBuild } from "@/lib/deployment";

export interface PlausibleSettings {
  /** The site as Plausible knows it, sent as `d`. */
  readonly domain: string;
  /** Plausible's Events API on the host that serves the tracker. */
  readonly endpoint: string;
}

/** The `id` of the inline script, which `scripts/check-export.mjs` looks for. */
export const PAGEVIEW_SCRIPT_ID = "plausible-pageview";

/** How dotenvx marks a value it has encrypted. */
const CIPHERTEXT = "encrypted:";

/**
 * The settings this build was made with, or null when analytics is off: in the
 * static export always, and in any build that has no settings to read.
 *
 * The two `process.env.NEXT_PUBLIC_…` reads stay literal, because Next only
 * inlines an exact `process.env.NAME` expression. They are read at call time
 * so a test can stub them.
 */
export function plausibleSettings(): PlausibleSettings | null {
  // The export is a file bundle for the desktop and mobile shells, opened
  // from disk or a custom protocol; there is no site to count visits to.
  if (isFileExportBuild()) return null;
  return parsePlausibleSettings(
    process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN,
    process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL,
  );
}

/**
 * Null when neither value is set or either is still ciphertext. Throws when
 * only one is set or one is malformed: a half-configured deploy fails its
 * build rather than shipping a tracker that posts to the wrong place.
 */
export function parsePlausibleSettings(
  domainValue: string | undefined,
  scriptUrlValue: string | undefined,
): PlausibleSettings | null {
  const domain = domainValue?.trim() ?? "";
  const scriptUrl = scriptUrlValue?.trim() ?? "";
  if (domain === "" && scriptUrl === "") return null;
  if (domain.startsWith(CIPHERTEXT) || scriptUrl.startsWith(CIPHERTEXT)) return null;

  if (domain === "" || scriptUrl === "") {
    throw new Error(
      "Plausible is half-configured: set both NEXT_PUBLIC_PLAUSIBLE_DOMAIN and " +
        "NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL, or neither",
    );
  }
  // A bare host, as Plausible names a site. The same shape next.config.ts
  // accepts for the domain in .hatchkit.json.
  if (!/^[a-z0-9.-]+$/i.test(domain)) {
    throw new Error(`NEXT_PUBLIC_PLAUSIBLE_DOMAIN is not a host name: ${JSON.stringify(domain)}`);
  }
  let url: URL;
  try {
    url = new URL(scriptUrl);
  } catch {
    throw new Error(`NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL is not a URL: ${JSON.stringify(scriptUrl)}`);
  }
  // An https page cannot post to http anyway; the browser blocks it as mixed
  // content, silently from the page's point of view.
  if (url.protocol !== "https:") {
    throw new Error(`NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL must be https: ${JSON.stringify(scriptUrl)}`);
  }
  return { domain: domain.toLowerCase(), endpoint: `${url.origin}/api/event` };
}

/**
 * The inline script that sends one pageview, as source text.
 *
 * What it sends is the whole of what leaves the browser for analytics:
 *
 *   n  "pageview", the only event. No custom events.
 *   u  origin + path. The query string and the hash are dropped, so neither
 *      `?doc=<id>` nor `?example=` is reported.
 *   d  the site domain.
 *   r  null when the visitor came from a page of this site, since that URL
 *      can hold `?doc=`; for another site, its origin + path.
 *
 * The request carries no cookies and no Referer header. It is `no-cors`,
 * which keeps it a simple request whatever CORS headers the Plausible host
 * sends; nothing reads the response.
 *
 * Automation (`navigator.webdriver`) and a browser that has set
 * `localStorage.plausible_ignore` to "true" send nothing, as with Plausible's
 * own tracker. The e2e suite relies on the first to keep every other spec off
 * the network.
 */
export function pageviewScript(settings: PlausibleSettings): string {
  return `(function () {
  try {
    if (navigator.webdriver) return;
    try {
      if (localStorage.getItem("plausible_ignore") === "true") return;
    } catch (e) {}
    var referrer = null;
    if (document.referrer) {
      var from = new URL(document.referrer);
      if (from.origin !== location.origin) referrer = from.origin + from.pathname;
    }
    fetch(${scriptLiteral(settings.endpoint)}, {
      method: "POST",
      mode: "no-cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      body: JSON.stringify({
        n: "pageview",
        u: location.origin + location.pathname,
        d: ${scriptLiteral(settings.domain)},
        r: referrer
      })
    }).catch(function () {});
  } catch (e) {}
})();`;
}

/** A JS string literal that cannot close the `<script>` element it sits in. */
function scriptLiteral(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
