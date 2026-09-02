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
 * NO TOOLBAR. Drawing tools are a later task; this page is the frame around
 * the canvas and nothing more.
 */

import { useEffect } from "react";
import { isEmpty } from "@starter/chem-core";

import { EditorCanvas, fixtureDocument } from "@/canvas";
import { editorStore, useEditorStore } from "@/state";

export default function EditorPage() {
  const title = useEditorStore((state) => state.document.metadata.title);

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
    state.openDocument(fixtureDocument(), "Open Benzene");
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-baseline gap-3 border-b px-4 py-2">
        <h1 className="text-sm font-medium">{title}</h1>
        <p className="text-muted-foreground text-xs">
          Drag to pan, scroll to zoom, click to select
        </p>
      </header>
      <main className="min-h-0 flex-1">
        <EditorCanvas />
      </main>
    </div>
  );
}
