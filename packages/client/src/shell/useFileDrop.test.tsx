/**
 * The paste half of the import surface.
 *
 * Drop is proven in a real browser (`e2e/persistence.spec.ts`) because
 * `DataTransfer` and `File` need one. Paste is here because what has to be
 * pinned is a DECISION — when the handler claims the event and when it lets it
 * go — and that is answerable with a synthetic `ClipboardEvent`.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { benzene } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { createMemoryDocumentStore } from "@/persistence/memory-store";
import { setDocumentStore } from "@/persistence/documents";
import { createEditorStore } from "@/state";
import type { EditorStore } from "@/state";

import { ETHANOL_MOLBLOCK } from "@/lib/io/fixtures";
import { useFileDrop } from "./useFileDrop";

let store: EditorStore;

beforeEach(() => {
  document.body.innerHTML = "";
  setDocumentStore(createMemoryDocumentStore());
  store = createEditorStore({
    document: createDocument({ molecule: benzene(), now: "2024-01-01T00:00:00.000Z" }),
    viewportSize: { width: 800, height: 600 },
  });
});

afterEach(() => {
  setDocumentStore(null);
});

/** jsdom builds a `ClipboardEvent` but leaves `clipboardData` null, so the
 *  payload is attached by hand. */
function paste(text: string, target: EventTarget = document.body): ClipboardEvent {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => (type === "text/plain" ? text : "") },
    configurable: true,
  });
  Object.defineProperty(event, "target", { value: target, configurable: true });
  window.dispatchEvent(event);
  return event;
}

describe("pasting into the editor", () => {
  it("imports a molblock and claims the event", async () => {
    renderHook(() => {
      useFileDrop({ store });
    });

    let event!: ClipboardEvent;
    act(() => {
      event = paste(ETHANOL_MOLBLOCK);
    });

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(store.getState().document.molecule.atomIds).toHaveLength(3);
    });
    expect(store.getState().document.metadata.title).toBe("Ethanol");
  });

  it("LETS ORDINARY PROSE THROUGH rather than swallowing it", () => {
    // Sniffed BEFORE the event is claimed. A paste that is not a structure
    // must reach whatever else wants it, instead of being eaten and reported
    // back as "that is not a structure".
    renderHook(() => {
      useFileDrop({ store });
    });

    let event!: ClipboardEvent;
    act(() => {
      event = paste("Dear editor, please find attached");
    });

    expect(event.defaultPrevented).toBe(false);
    expect(store.getState().document.molecule.atomIds).toHaveLength(6);
  });

  it("ignores a paste aimed at a text field", () => {
    // Pasting into the title field is pasting into the title field.
    renderHook(() => {
      useFileDrop({ store });
    });
    const input = document.createElement("input");
    document.body.append(input);

    let event!: ClipboardEvent;
    act(() => {
      event = paste(ETHANOL_MOLBLOCK, input);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(store.getState().document.molecule.atomIds).toHaveLength(6);
  });

  it("stops listening when it unmounts", () => {
    const { unmount } = renderHook(() => {
      useFileDrop({ store });
    });
    unmount();

    let event!: ClipboardEvent;
    act(() => {
      event = paste(ETHANOL_MOLBLOCK);
    });
    expect(event.defaultPrevented).toBe(false);
  });
});
