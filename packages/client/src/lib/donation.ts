/**
 * The Donate link, and the return from it.
 *
 * ── ONE DONATE PAGE FOR EVERY PROJECT ──────────────────────────────────────
 *
 * The page lives on ricos.site and is shared by all of Rico's projects. It
 * reads `?from=` to name this project and tags the Stripe payment with the
 * same slug, so the slug here must match ricos.site's `donationSources.ts`.
 * This app carries no payment code of its own.
 *
 * ── `?supported=1` IS RECORDED AND THEN REMOVED ────────────────────────────
 *
 * After a payment the donate page links back here with `?supported=1`. The
 * time is stored under a key every project shares, so that a later inline ask
 * can stay quiet for a while after a donation. Nothing reads it yet.
 *
 * Only that one parameter leaves the URL. `?doc=` names the sketch to open and
 * the hash may carry state too, so dropping the whole query would open the
 * wrong document. Removing it at all matters for the same reason: a reload or
 * a copied link would otherwise record a donation that never happened.
 */

export const DONATE_URL = "https://ricos.site/donate/chemistry-sketcher";

export const DONATION_SUPPORTED_KEY = "donation-supported-at";

const SUPPORTED_PARAM = "supported";

/** Record a return from the donate page, and take the marker off the URL. */
export function recordDonationReturn(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (url.searchParams.get(SUPPORTED_PARAM) !== "1") return;

  try {
    window.localStorage.setItem(DONATION_SUPPORTED_KEY, String(Date.now()));
  } catch {
    // Private mode, or storage disabled. The URL is still cleaned below.
  }

  url.searchParams.delete(SUPPORTED_PARAM);
  // `history.state` is passed through: Next keeps its router state there.
  window.history.replaceState(window.history.state, "", url.href);
}
