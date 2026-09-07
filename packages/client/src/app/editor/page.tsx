"use client";

/**
 * /editor — the drawing surface.
 *
 * A LITERAL ROUTE SEGMENT, and it has to stay one. This app is also built with
 * `NEXT_FILE_EXPORT=1` (`output: "export"`, see next.config.ts) for the
 * desktop and mobile shells, and a static export has no server to resolve a
 * dynamic segment against: `/editor/[id]` would fail the build unless every id
 * were enumerated up front, which is not a thing a local sketch has. When
 * documents become addressable they belong in a query string or in local
 * storage, not in the path.
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
 * THE PAGE IS NOW ONLY A LOADER. The tool rail, the top bar, the properties
 * panel, the status bar, the keyboard layer and the command palette are all
 * `@/shell`'s; what is left here is deciding which document to open and
 * rendering the shell around it. The header and the line of instructions that
 * stood in for the chrome are gone, because the chrome exists.
 */

import { useEffect } from "react";
import { isEmpty } from "@starter/chem-core";
import type { SketchDocument } from "@starter/shared";

import { fixtureDocument, stressDocument, STRESS_HEAVY_ATOMS } from "@/canvas";
import { EditorShell } from "@/shell";
import { editorStore } from "@/state";

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

export default function EditorPage() {
  useEffect(() => {
    const state = editorStore.getState();
    // Load the fixture only into an empty sketch.
    //
    // The guard is what makes this idempotent, and it has to be: React runs
    // effects twice on mount in development StrictMode, and a Fast Refresh
    // remounts the page while the module-level store keeps its state. An
    // unconditional `openDocument` would therefore throw away whatever was on
    // the canvas — and, because `openDocument` is undoable, would do it as a
    // history entry the user never asked for. Checking the molecule rather
    // than a "have I loaded" flag also survives the module being re-evaluated,
    // since the answer lives in the store rather than in this closure.
    if (!isEmpty(state.document.molecule)) return;
    const requested = documentFromSearch(window.location.search);
    if (requested !== null) {
      state.openDocument(requested, "Open stress fixture");
      return;
    }
    state.openDocument(fixtureDocument(), "Open Benzene");
  }, []);

  return <EditorShell />;
}
