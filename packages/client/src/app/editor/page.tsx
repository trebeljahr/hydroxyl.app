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
 *
 * ── THE LOAD DECISION IS MADE ON THE DOCUMENT'S ID, NOT ON EMPTINESS ───────
 *
 * It used to read `?doc=` only inside `if (isEmpty(molecule))`, and that was
 * silently wrong for every visit after the first. `editorStore` is a module
 * singleton that survives a client-side navigation, so ANY prior visit to the
 * editor in the same tab left the molecule non-empty, the whole load branch
 * was skipped, and the leftover document was baselined instead. Measured: the
 * URL said one id, the top bar reported another, the formula was the previous
 * sketch's — and the first edit forked a new record while autosave reported
 * "Saved". The chemist edits what they believe is their saved sketch, is told
 * it saved, and the sketch never changes.
 *
 * Comparing `state.document.id` with the requested id is what makes the effect
 * both correct and idempotent: StrictMode's double mount and a Fast Refresh
 * both find the requested document already open and baseline it, while a
 * genuine change of `?doc=` loads. The emptiness check survives only where it
 * still means something — bare `/editor`, where there is no id to compare.
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
  holdEditorDocument,
  journalEditorDocument,
  loadDocument as readStoredDocument,
  onDocumentChange,
  recoverJournaledDocuments,
  releaseEditorDocument,
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
 * `?storage=full` swaps the IndexedDB store for one that refuses every write
 * with a quota error.
 *
 * SAME FAMILY AS `?fixture=stress`. "A rejected or quota-exhausted write
 * surfaces visibly" is a claim about the running app, and the alternative ways
 * to test it are to genuinely exhaust a browser's storage — minutes of writes,
 * and flaky — or to assert it only in a unit test, which proves the save path
 * and not the wiring from that path to the indicator a person reads.
 *
 * THERE WAS A `?storage=memory` HERE AND IT HAD TO GO. It swapped in a store
 * that silently kept nothing while the indicator went on reporting "Saved",
 * which is the exact silent-loss failure this whole task exists to remove —
 * reachable in the production bundle by anyone who pasted a URL out of a bug
 * report. `full` and `crash` stay because they are self-announcing: both put a
 * visible error on the screen, so nobody who lands on one is misled about the
 * state of their work. A debug affordance may break the app; it may not lie
 * about it.
 */
function installStorageOverride(search: string): void {
  const mode = new URLSearchParams(search).get("storage");
  // Reset FIRST, unconditionally. The store is a module singleton, so
  // navigating from `?storage=full` back to a plain `/editor` would otherwise
  // keep the refusing store for the life of the tab.
  setDocumentStore(null);
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
    //
    // THE JOURNAL GOES FIRST, AND IT IS THE ONE THAT ACTUALLY SAVES THE WORK.
    // A flush to IndexedDB started here does not commit — measured in Chrome
    // against the production build, with the connection warm and the whole
    // path to `IDBObjectStore.put` made synchronous: the three requests are
    // queued, `pagehide` fires, and no `complete` event ever arrives.
    // Navigating 50 ms after an edit loses it exactly as reliably as
    // navigating in the same tick. `localStorage.setItem` returns with the
    // value already committed, so that is what the rescue uses; see
    // `persistence/journal.ts`. The flush stays because it is the write that
    // matters whenever the page SURVIVES — a tab switch, a hidden tab — and
    // the next successful save deletes the journal again.
    const rescue = (): void => {
      journalEditorDocument();
      void flushEditorDocument();
    };
    const onPageHide = (): void => {
      rescue();
    };
    window.addEventListener("pagehide", onPageHide);
    // Earlier than `pagehide`: `visibilitychange` fires while the tab is still
    // fully alive — on a tab switch, on an app switch, and on mobile before
    // the OS suspends the page, which may never deliver anything later.
    const onHidden = (): void => {
      if (document.visibilityState === "hidden") rescue();
    };
    document.addEventListener("visibilitychange", onHidden);

    let cancelled = false;
    const state = editorStore.getState();
    const savedId = documentIdFromSearch(search);

    // Started ONCE, on every mount, whichever document this page is about.
    // The journal holds work whose write the last teardown interrupted, and
    // that work is not necessarily about the sketch being opened now — the way
    // to strand an edit is to navigate away from it, so the journalled
    // document is usually the one the chemist just left. Recovery writes it
    // back to IndexedDB under its own id and never touches this canvas.
    const recovered = recoverJournaledDocuments();

    if (savedId !== null) {
      if (state.document.id === savedId) {
        // Already the one the URL names. StrictMode's second mount and a Fast
        // Refresh both land here, and neither may re-read a document the user
        // has since drawn on.
        baselineEditorDocument(state.document);
      } else {
        // Baselined BEFORE the read, so the leftover cannot be written. The
        // autosave loop is already running by this point (see above) and it
        // has no reference document until something baselines one; a state
        // change arriving during the few milliseconds of a database read
        // would otherwise be debounced into a write of the PREVIOUS route's
        // document, under an id the URL never named.
        baselineEditorDocument(state.document);
        // AWAITED BEFORE THE READ. If the journal is about THIS document,
        // reading storage first would restore the older copy over it and then
        // baseline that older copy as correct. Recovery puts the newer content
        // back under its own id, so the read below sees it.
        void recovered
          .then(() => readStoredDocument(savedId))
          .then((result) => {
            if (cancelled) return;
            const next = editorStore.getState();
            // NOT re-checked for emptiness. The URL names the document and that
            // is the whole contract of the route; whatever is on the canvas
            // during a few milliseconds of a local database read is the previous
            // route's leftover, not work the visitor did here.
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
      }
    } else if (isEmpty(state.document.molecule)) {
      // Bare `/editor`, nothing open. There is no id to compare against, so
      // emptiness is still the honest test for "this is a fresh mount".
      const requested = documentFromSearch(search);
      state.openDocument(requested ?? fixtureDocument(),
        requested === null ? "Open Benzene" : "Open stress fixture");
      baselineEditorDocument(editorStore.getState().document);
    } else {
      baselineEditorDocument(state.document);
    }

    // Another tab is writing the same library. One origin has one IndexedDB
    // and the recents cards are ordinary links, so two tabs on one document is
    // a single gesture away; without this, the later write wins in silence and
    // a document deleted over there is resurrected by this tab's next
    // autosave. Reported rather than reconciled — see persistence/broadcast.ts.
    const unlisten = onDocumentChange((change) => {
      const open = editorStore.getState().document;
      if (change.id !== open.id) return;
      if (change.kind === "remove") {
        // HELD, not merely reported: this tab's next autosave would otherwise
        // put the deleted rows straight back and replace this warning with
        // "Saved". Only an explicit Save brings it back.
        holdEditorDocument(
          open.id,
          `“${open.metadata.title}” was deleted in another tab, so this tab has stopped saving it. ` +
            `Use Save to keep it, or it will only exist on this screen.`,
        );
        return;
      }
      // Written back by the other tab, so it exists again and there is nothing
      // left to hold. A NOTICE, not a save failure: this tab's own writes are
      // still landing. There is no compare-and-swap on `modifiedAt` and
      // reconciling two divergent edits of one molecule is a different
      // feature, so the honest thing is to say that the last writer wins and
      // let the chemist decide.
      if (change.kind === "put") releaseEditorDocument(open.id);
      editorStore
        .getState()
        .setStatusMessage(
          `“${open.metadata.title}” is open in another tab, which has just written over it — ` +
            `whichever tab saves last wins.`,
        );
    });

    return () => {
      cancelled = true;
      unlisten();
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onHidden);
      // Flushed on the way out: a route change away from the editor is exactly
      // as much of a "the tab is gone" moment as a close, from the document's
      // point of view.
      void flushEditorDocument();
      stopEditorPersistence();
    };
  }, []);

  return <EditorShell />;
}
