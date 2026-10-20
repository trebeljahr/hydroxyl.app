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
 * time is stored under a key every project shares, so that the support line
 * below stays quiet for 90 days after a donation.
 *
 * Only that one parameter leaves the URL. `?doc=` names the sketch to open and
 * the hash may carry state too, so dropping the whole query would open the
 * wrong document. Removing it at all matters for the same reason: a reload or
 * a copied link would otherwise record a donation that never happened.
 *
 * ── ONE SUPPORT LINE, AFTER AN EXPORT, ONCE ────────────────────────────────
 *
 * When an export finishes while the Export dialog is open, the dialog shows
 * one light line under its buttons that links the donate page. It is part of
 * the dialog the chemist opened, never a dialog of its own. It shows once per
 * browser: the mark is written when it appears, so it does not return on the
 * next export, closed or not. Someone who donated in the last 90 days is not
 * asked, and is asked once after that. The static export (what an app-store
 * shell packages) never shows it, like the status bar's Donate link.
 */

import { isFileExportBuild } from "@/lib/deployment";

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

export const SUPPORT_LINE_KEY = "chemistry-sketcher.support-line-shown";

/** ricos.site's own ask stays quiet this long after a donation, and so does this one. */
export const SUPPORT_QUIET_AFTER_DONATION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Whether this finished export shows the support line, and if so, records
 * that it was shown. Storage that throws shows nothing: a line that cannot
 * remember being shown would come back after every export.
 */
export function claimSupportLine(now: number = Date.now()): boolean {
  if (isFileExportBuild() || typeof window === "undefined") return false;
  try {
    const storage = window.localStorage;
    if (storage.getItem(SUPPORT_LINE_KEY) !== null) return false;
    const supportedAt = Number(storage.getItem(DONATION_SUPPORTED_KEY));
    if (supportedAt > 0 && now - supportedAt < SUPPORT_QUIET_AFTER_DONATION_MS) return false;
    storage.setItem(SUPPORT_LINE_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/*
 * Finished exports in this tab, as an event the figure commands send and the
 * Export dialog listens to. Kept here rather than in the editor store because
 * it is nothing a document or an undo step should carry.
 */
const exportListeners = new Set<() => void>();

/** A figure or structure export reached its file or the clipboard. */
export function noteExportFinished(): void {
  for (const listener of exportListeners) listener();
}

export function subscribeExportsFinished(listener: () => void): () => void {
  exportListeners.add(listener);
  return () => {
    exportListeners.delete(listener);
  };
}
