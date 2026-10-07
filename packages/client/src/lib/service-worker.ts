/**
 * Registers the offline service worker (`src/sw/service-worker.ts`,
 * decision 239) where it can work, and nowhere else.
 *
 * Not in the static export: a `file://` page and a shell's custom protocol
 * cannot register one, and the export ships no `sw.js`. Not in `next dev`
 * either, where it UNREGISTERS instead: dev and `next start` share port 6337,
 * and a worker left by a production run would otherwise keep controlling
 * the dev origin.
 */

import { isFileExportBuild } from "@/lib/deployment";
import { conformerWorkerUrl } from "@/lib/conformer/client";
import { rdkitOfflineAssetUrls } from "@/lib/rdkit/asset-base";

export const SERVICE_WORKER_URL = "/sw.js";

export type ServiceWorkerPlan = "register" | "unregister" | "none";

export function serviceWorkerPlan(env: {
  readonly fileExport: boolean;
  readonly production: boolean;
  readonly supported: boolean;
  readonly protocol: string;
}): ServiceWorkerPlan {
  if (env.fileExport || !env.supported) return "none";
  if (!env.production) return "unregister";
  // Browsers also allow http://localhost; anything else they refuse anyway.
  return env.protocol === "https:" || env.protocol === "http:" ? "register" : "none";
}

/**
 * Whether to fetch RDKit and the 3D conformer worker ahead of first use: on
 * the editor, and only in the INSTALLED app (decisions 239 and 253).
 *
 * In a browser tab the rule in `e2e/rdkit.spec.ts` stands — loading the
 * editor must not cost 6.9 MB, on conference wifi least of all — and the
 * worker caches each file the first time the editor really asks for it.
 * Someone who installed the app has said they want it offline, and the first
 * offline import or 3D view should not be the one that discovers a file is
 * missing.
 */
export function shouldWarmOfflineAssets(pathname: string, installed: boolean): boolean {
  return installed && (pathname === "/editor" || pathname.startsWith("/editor/"));
}

/** Every versioned file the service worker should hold for offline use. */
export function offlineAssetUrls(): string[] {
  return [...rdkitOfflineAssetUrls(), conformerWorkerUrl()];
}

/** True when the page runs as an installed app rather than in a tab. */
export function runsInstalled(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Home Screen apps report this instead of the display-mode query.
  if ((navigator as { standalone?: boolean }).standalone === true) return true;
  return ["standalone", "minimal-ui", "fullscreen", "window-controls-overlay"].some(
    (mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches === true,
  );
}

export async function setUpServiceWorker(): Promise<void> {
  const plan = serviceWorkerPlan({
    fileExport: isFileExportBuild(),
    production: process.env.NODE_ENV === "production",
    supported: typeof navigator !== "undefined" && "serviceWorker" in navigator,
    protocol: typeof location === "undefined" ? "" : location.protocol,
  });
  try {
    if (plan === "unregister") {
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        await registration.unregister();
      }
      return;
    }
    if (plan !== "register") return;
    await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
    if (!shouldWarmOfflineAssets(location.pathname, runsInstalled())) return;
    // Fetch the RDKit worker, glue and wasm and the conformer worker now, so
    // a SMILES import and the 3D view work offline even if this visit never
    // used them.
    const ready = await navigator.serviceWorker.ready;
    ready.active?.postMessage({ type: "warm-assets", urls: offlineAssetUrls() });
  } catch {
    // Private windows, blocked storage and disabled workers all land here.
    // The app works online without a worker, so there is nothing to report.
  }
}
