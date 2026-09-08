"use client";

/**
 * /editor — the drawing surface.
 *
 * A LITERAL ROUTE SEGMENT, and it has to stay one. This app is also built with
 * `NEXT_FILE_EXPORT=1` (`output: "export"`, see next.config.ts) for the
 * desktop and mobile shells, and a static export has no server to resolve a
 * dynamic segment against: `/editor/[id]` would fail the build unless every id
 * were enumerated up front, and `generateStaticParams` cannot enumerate ids
 * that only exist in a visitor's IndexedDB. Hence `?doc=<id>` — a QUERY
 * PARAMETER, which the export does not have to know about at build time.
 *
 * NO ROUTE-LEVEL `metadata` HERE, and the reason is a real trade-off rather
 * than an oversight. `export const metadata` is a server-component-only API,
 * and this page is a client component because it drives the store on mount.
 * The two ways out are (a) split it into a server shell that exports metadata
 * and renders a client child, or (b) let the root layout's title template
 * stand. (b) wins: the shell would exist solely to carry one static string
 * that the layout already supplies ("Chemistry Sketcher"), and the title worth
 * showing — the document's own — is not knowable at build time anyway, so it
 * would still be wrong on a route the user opened with a different sketch
 * loaded. The document title is rendered in the header below instead, where it
 * can be live.
 *
 * THE PAGE IS A LOADER AND A PERSISTENCE HOST, and nothing else. The tool
 * rail, the top bar, the properties panel, the status bar, the keyboard layer
 * and the command palette are all `@/shell`'s; what is left here is deciding
 * which document to open and keeping it saved.
 *
 * ── BARE `/editor` MEANS A NEW SKETCH, NOT THE MOST RECENT ─────────────────
 *
 * A deliberate fork. "Most recent" would make the route unpredictable — the
 * same URL showing different chemistry depending on what you last drew — and
 * would break every existing spec that navigates to `/editor` expecting
 * benzene. The recents grid at `/` is where a previous sketch is reopened, and
 * it links to `/editor?doc=<id>`.
 *
 * Consequently the fixture is BASELINED rather than saved: `startAutosave`'s
 * `baseline` marks it as already accounted for, so opening the editor and
 * closing it again does not leave an untouched benzene in the grid. The first
 * real edit is the first write.
 */

import { useEffect, type ReactElement } from "react";
import { isEmpty } from "@starter/chem-core";
import type { SketchDocument } from "@starter/shared";

import { fixtureDocument, stressDocument, STRESS_HEAVY_ATOMS } from "@/canvas";
import { armCanvasCrash, CRASH_GLOBAL } from "@/canvas/crash";
import { EditorShell } from "@/shell";
import { editorStore } from "@/state";
import {
  baselineEditorDocument,
  createMemoryDocumentStore,
  flushEditorDocument,
  loadDocument as readStoredDocument,
  setDocumentStore,
  startEditorPersistence,
  stopEditorPersistence,
} from "@/persistence";

/**
 * The fixture the query string asks for, or null when it asks for nothing.
 *
 * `?fixture=stress` (optionally `&atoms=300`) opens the fused polycyclic
 * ladder the performance budget is quoted against, instead of benzene.
 *
 * IT IS HERE BECAUSE THE 60FPS CRITERION IS A CLAIM ABOUT A REAL BROWSER. The
 * two in-repo measurements cover the model path and a jsdom render, and
 * neither can see layout and paint — the half most likely to blow the budget
 * at a thousand-odd SVG nodes. Without a way to get a 300-atom document into
 * the running app, that number rests on someone having once swapped the
 * fixture by hand and put it back, which is not a measurement anyone can
 * reproduce. `e2e/performance.spec.ts` drives this.
 *
 * READ OFF `window.location.search` RATHER THAN `useSearchParams`. The route is
 * statically exported (`output: "export"`, see next.config.ts) and the hook
 * would push the whole page behind a Suspense boundary for the sake of a
 * measurement affordance. The read happens in the mount effect below, where
 * `window` exists and the URL is settled.
 */
export function documentFromSearch(search: string): SketchDocument | null {
  const params = new URLSearchParams(search);
  if (params.get("fixture") !== "stress") return null;
  const requested = Number(params.get("atoms"));
  // Clamped rather than trusted: this is reachable from a URL, and an
  // unbounded value would hang the tab building a molecule nobody asked for.
  const atoms =
    Number.isFinite(requested) && requested >= 4 && requested <= 5000
      ? Math.floor(requested)
      : STRESS_HEAVY_ATOMS;
  return stressDocument(atoms);
}

/** The saved document the URL names, if it names one. */
export function documentIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get("doc");
  return id === null || id.trim() === "" ? null : id;
}

/**
 * `?storage=memory` swaps the IndexedDB store for one that keeps nothing, and
 * `?storage=full` for one that refuses every write with a quota error.
 *
 * SAME FAMILY AS `?fixture=stress`. "A rejected or quota-exhausted write
 * surfaces visibly" is a claim about the running app, and the alternative ways
 * to test it are to genuinely exhaust a browser's storage — minutes of writes,
 * and flaky — or to assert it only in a unit test, which proves the save path
 * and not the wiring from that path to the indicator a person reads.
 */
function installStorageOverride(search: string): void {
  const mode = new URLSearchParams(search).get("storage");
  // Reset FIRST, unconditionally. The store is a module singleton, so
  // navigating from `?storage=full` back to a plain `/editor` would otherwise
  // keep the refusing store for the life of the tab.
  setDocumentStore(null);
  if (mode === "memory") {
    setDocumentStore(createMemoryDocumentStore());
    return;
  }
  if (mode === "full") {
    const store = createMemoryDocumentStore();
    store.failWith(
      "quota",
      "There is no room left in this browser's storage, so this sketch was not saved.",
    );
    setDocumentStore(store);
  }
}

export default function EditorPage(): ReactElement {
  useEffect(() => {
    const search = window.location.search;
    installStorageOverride(search);

    if (new URLSearchParams(search).get("crash") === "canvas") {
      // Only reachable with the parameter present — see canvas/crash.ts.
      (window as unknown as Record<string, unknown>)[CRASH_GLOBAL] = armCanvasCrash;
    }

    // Started BEFORE the document is chosen, so that an edit landing between
    // the two — a Fast Refresh, a very fast hand — is still caught. Every path
    // below baselines whatever it opened, which is what stops the loop
    // re-saving a document it just read.
    startEditorPersistence(editorStore);

    // A pointer-frame-accurate save is autosave's job; this is the last-resort
    // one. `pagehide` fires on a closed tab and on a back/forward navigation
    // where `beforeunload` does not, and it is the only lifecycle event
    // Safari on iOS reliably delivers.
    const onPageHide = (): void => {
      void flushEditorDocument();
    };
    window.addEventListener("pagehide", onPageHide);

    let cancelled = false;
    const state = editorStore.getState();

    // Load into an EMPTY sketch only.
    //
    // The guard is what makes this idempotent, and it has to be: React runs
    // effects twice on mount in development StrictMode, and a Fast Refresh
    // remounts the page while the module-level store keeps its state. An
    // unconditional open would therefore throw away whatever was on the
    // canvas. Checking the molecule rather than a "have I loaded" flag also
    // survives the module being re-evaluated, since the answer lives in the
    // store rather than in this closure.
    if (isEmpty(state.document.molecule)) {
      const savedId = documentIdFromSearch(search);
      if (savedId !== null) {
        void readStoredDocument(savedId).then((result) => {
          if (cancelled) return;
          const next = editorStore.getState();
          // Re-checked after the await: the store is a singleton and the user
          // has had a moment in which to draw.
          if (!isEmpty(next.document.molecule)) return;
          if (result.ok) {
            // NOT `openDocument`, which is undoable by design. A restore is
            // not an edit: routing it through the undo stack would make the
            // first Ctrl+Z after a reload wipe the canvas, and autosave would
            // then persist the empty document over the good one.
            next.loadDocument(result.value);
            baselineEditorDocument(editorStore.getState().document);
          } else {
            next.setStatusMessage(result.error.message);
            next.openDocument(fixtureDocument(), "Open Benzene");
            baselineEditorDocument(editorStore.getState().document);
          }
        });
      } else {
        const requested = documentFromSearch(search);
        state.openDocument(requested ?? fixtureDocument(),
          requested === null ? "Open Benzene" : "Open stress fixture");
        baselineEditorDocument(editorStore.getState().document);
      }
    } else {
      baselineEditorDocument(state.document);
    }

    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", onPageHide);
      // Flushed on the way out: a route change away from the editor is exactly
      // as much of a "the tab is gone" moment as a close, from the document's
      // point of view.
      void flushEditorDocument();
      stopEditorPersistence();
    };
  }, []);

  return <EditorShell />;
}
