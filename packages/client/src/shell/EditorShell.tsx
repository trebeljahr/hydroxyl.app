"use client";

/**
 * The frame: top bar, tool rail, canvas, properties panel, status bar — and
 * the one place the keyboard layer and the palette are mounted.
 *
 * ONE KEYBOARD LAYER, MOUNTED ONCE. `useKeyBindings` registers a single
 * `keydown` listener on `window`; nothing else in the shell listens for keys.
 * Two listeners would be two orders of precedence, and the guard order — the
 * canvas's Escape first, then the palette, then text entry — is the design.
 *
 * `TooltipProvider` WRAPS THE WHOLE SHELL rather than each tooltip. The
 * provider owns the shared open/close delay, so a pointer sweeping down the
 * tool rail shows the second tooltip immediately instead of waiting the full
 * delay again at every button.
 *
 * THE CANVAS IS WRAPPED IN AN ERROR BOUNDARY and the rest of the shell is
 * not. A throw from the tool rail is a bug in a button; a throw from the
 * canvas is a bug in geometry over a molecule the user is free to draw into
 * any shape, and unmounting the tree would cost them the drawing. Keeping the
 * chrome mounted also means the fallback appears in place, with the title, the
 * status bar and the save-state indicator still readable.
 *
 * THE LIVE REGION IS HERE, not in the canvas, because it announces things the
 * canvas does not own: the keyboard traversal is dispatched by the key layer,
 * and a region that lived inside the component being navigated would be
 * re-created by any re-render that replaced it, which silences some readers.
 */

import { useCallback, useState } from "react";
import type { ReactElement } from "react";

import { EditorCanvas } from "@/canvas";
import { useKeyBindings } from "@/editor/useKeyBindings";
import { TooltipProvider } from "@/components/ui/tooltip";
import { flushEditorDocument } from "@/persistence/session";

import { CanvasErrorBoundary } from "./CanvasErrorBoundary";
import { CommandPalette } from "./CommandPalette";
import { useFileDrop } from "./useFileDrop";
import { PropertiesPanel } from "./PropertiesPanel";
import { StatusBar } from "./StatusBar";
import { ToolRail } from "./ToolRail";
import { TopBar } from "./TopBar";

export function EditorShell(): ReactElement {
  const [announcement, setAnnouncement] = useState("");
  const announce = useCallback((message: string) => {
    setAnnouncement(message);
  }, []);

  useKeyBindings({ onAnnounce: announce });
  // Mounted beside the keyboard layer and for the same reason: both listen on
  // `window`, both must exist exactly once, and the order they are registered
  // in is part of how Mod+V resolves. See useFileDrop's header.
  useFileDrop();

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      <div className="bg-background text-foreground flex h-screen flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <ToolRail />
          <main className="min-w-0 flex-1">
            {/* OUTSIDE the canvas, necessarily: the scene is built in a
                `useMemo` inside `EditorCanvas`, so a boundary mounted within
                it could not catch its own render throw. */}
            <CanvasErrorBoundary onFlush={flushEditorDocument}>
              <EditorCanvas />
            </CanvasErrorBoundary>
          </main>
          <PropertiesPanel />
        </div>
        <StatusBar />
      </div>

      {/* Off-screen, and never removed from the DOM: a live region that is
          mounted at the moment it gets its text is not announced by most
          readers. It is fed by the key layer's traversal callback. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <CommandPalette />
    </TooltipProvider>
  );
}
