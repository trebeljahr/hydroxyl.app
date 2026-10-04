"use client";

import { useEffect, useState } from "react";
import { saveBeforeReleaseReload } from "@/persistence/session";

const RELOAD_GUARD_MS = 60_000;

/**
 * Reload a tab whose release has left the server's retained set, but only
 * after its open sketch is safely stored.
 *
 * During a rolling release two servers share browser assets through the
 * release volume (scripts/RETAINED-ASSETS.md), so an old tab keeps working
 * until its release expires. Then its next lazy chunk could be gone. The check
 * runs on focus and every minute; a chunk that fails to load triggers it too.
 * When the save fails the tab stays as it is and says why, so the chemist can
 * keep working and export the sketch.
 */
export function shouldReload(commit: string, data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const { schema, releases } = data as { schema?: unknown; releases?: unknown };
  return (
    schema === 2 &&
    Array.isArray(releases) &&
    releases.length >= 1 &&
    releases.length <= 6 &&
    releases.every((id) => typeof id === "string" && /^[a-f0-9]{40}$/.test(id)) &&
    !releases.includes(commit)
  );
}

export function ReleaseLifetime() {
  const [blocked, setBlocked] = useState<string | null>(null);
  useEffect(() => {
    const commit = process.env.NEXT_PUBLIC_BUILD_COMMIT;
    // The desktop and mobile shells load a bundled export, never a release.
    if (process.env.NEXT_PUBLIC_FILE_EXPORT === "1" || !commit || !/^[a-f0-9]{40}$/.test(commit)) return;
    let stopped = false;
    let reloading = false;
    const reload = async () => {
      if (reloading || stopped) return;
      reloading = true;
      try {
        // A persistent asset or network problem must not become a reload loop.
        const key = `chemistry-release-reload:${commit}`;
        try {
          if (Date.now() - Number(sessionStorage.getItem(key) || 0) < RELOAD_GUARD_MS) return;
        } catch {
          /* Storage can be disabled; the save below still decides. */
        }
        const saved = await saveBeforeReleaseReload();
        if (stopped) return;
        if (!saved.ok) {
          setBlocked(saved.message);
          return;
        }
        try {
          sessionStorage.setItem(key, String(Date.now()));
        } catch {
          /* See above. */
        }
        setBlocked(null);
        window.location.reload();
      } finally {
        reloading = false;
      }
    };
    const check = async () => {
      try {
        const response = await fetch(`/releases.json?at=${Date.now()}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok || stopped) return;
        if (shouldReload(commit, await response.json())) await reload();
      } catch {
        /* A transient network failure does not discard an open sketch. */
      }
    };
    const resourceError = (event: Event) => {
      const source = event.target;
      if (source instanceof HTMLScriptElement && source.src.includes("/_next/static/")) void check();
    };
    const rejection = (event: PromiseRejectionEvent) => {
      if (event.reason?.name === "ChunkLoadError") void check();
    };
    const focus = () => {
      void check();
    };
    const interval = window.setInterval(check, 60_000);
    window.addEventListener("error", resourceError, true);
    window.addEventListener("unhandledrejection", rejection);
    window.addEventListener("focus", focus);
    void check();
    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener("error", resourceError, true);
      window.removeEventListener("unhandledrejection", rejection);
      window.removeEventListener("focus", focus);
    };
  }, []);
  if (blocked === null) return null;
  return (
    <div
      role="alert"
      data-testid="release-reload-blocked"
      className="fixed inset-x-4 bottom-4 z-50 rounded-md border border-destructive bg-background p-3 text-sm shadow-lg"
    >
      A newer version is available, but this tab did not reload because the sketch could not be
      saved: {blocked} The sketch stays open here. Export it before you reload.
    </div>
  );
}
