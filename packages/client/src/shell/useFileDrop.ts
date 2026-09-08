"use client";

/**
 * Drag-and-drop and paste, both routed through the same content sniffer.
 *
 * ── ON THE WINDOW, NOT ON THE CANVAS ───────────────────────────────────────
 *
 * A chemist dropping a molfile aims at the drawing, at the tool rail, or at
 * whitespace, and a drop target that only covered the `<svg>` would silently
 * eat two of those three — the browser's default for a dropped file is to
 * NAVIGATE to it, so a near miss replaces the editor with a plain-text view of
 * the molfile and loses the sketch. `dragover` must be prevented across the
 * whole window for that not to happen.
 *
 * ── THE PASTE LISTENER ONLY WORKS BECAUSE Mod+V IS LET THROUGH ─────────────
 *
 * `edit.paste` claims Mod+V in the registry, and the key layer calls
 * `preventDefault()` on any registry match BEFORE checking `enabled` — which
 * also suppresses the browser's `paste` event, so this listener would never
 * fire. `edit.paste` therefore carries `passThroughWhenDisabled`, and the key
 * layer skips the prevent when the internal clipboard is empty. With something
 * copied inside the editor, Mod+V still pastes that; with nothing, the
 * platform's clipboard reaches here. Both are wanted and they cannot both be
 * the same keystroke in the same state.
 *
 * ── A .MOL DROP MUST NOT START THE WORKER ──────────────────────────────────
 *
 * Which is a property of `@/lib/io/open` — its RDKit import is inside the
 * SMILES branch — and of this file only in that it imports `openText` and not
 * the bridge. Do not add a static `@/lib/rdkit` import here to "warm it up".
 */

import { useEffect } from "react";

import { importText } from "@/editor/commands/file";
import { sniffFormat } from "@/lib/io/sniff";
import { editorStore } from "@/state";
import type { EditorStore } from "@/state";

import { isTextEntryTarget } from "@/editor/useKeyBindings";

export interface FileDropOptions {
  readonly store?: EditorStore | undefined;
}

/** Read every dropped file as text, in the order they were dropped. */
async function textsFrom(transfer: DataTransfer): Promise<readonly { name: string; text: string }[]> {
  const files = [...transfer.files];
  if (files.length > 0) {
    return Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() })));
  }
  // A drag from another page carries text rather than a file — a SMILES out
  // of a table, a molblock out of a `<pre>`.
  const text = transfer.getData("text/plain");
  return text.trim() === "" ? [] : [{ name: "", text }];
}

export function useFileDrop(options: FileDropOptions = {}): void {
  const injected = options.store;
  useEffect(() => {
    const store = injected ?? editorStore;

    const onDragOver = (event: DragEvent): void => {
      if (event.dataTransfer === null) return;
      // Without this the browser navigates to the file and the sketch is gone.
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };

    const onDrop = (event: DragEvent): void => {
      const transfer = event.dataTransfer;
      if (transfer === null) return;
      event.preventDefault();
      void (async () => {
        const items = await textsFrom(transfer);
        for (const item of items) {
          await importText(store, item.text, item.name === "" ? {} : { name: item.name });
        }
      })();
    };

    const onPaste = (event: ClipboardEvent): void => {
      // Pasting into the title field is pasting into the title field.
      if (isTextEntryTarget(event.target)) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (text.trim() === "") return;
      // SNIFFED BEFORE THE EVENT IS CLAIMED. A paste of ordinary prose must
      // fall through to whatever else wants it rather than being swallowed and
      // reported as "that is not a structure".
      if (sniffFormat(text).kind === "unknown") return;
      event.preventDefault();
      void importText(store, text);
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, [injected]);
}
