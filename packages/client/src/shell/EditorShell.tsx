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

import { CommandPalette } from "./CommandPalette";
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

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      <div className="bg-background text-foreground flex h-screen flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <ToolRail />
          <main className="min-w-0 flex-1">
            <EditorCanvas />
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
