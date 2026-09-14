import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { benzylAlcoholAbbreviated, ethanol } from "@starter/chem-render";
import { createDocument, createPanel, defaultPanelsFor } from "@starter/shared";

import { createEditorStore, type EditorStore } from "@/state";

// jsdom has no SVG rasteriser; the raster path is exercised in Playwright.
// jsdom has no canvas either, so the size probe is a stand-in each test sets.
const canvas = vi.hoisted(() => ({ canHold: true, asked: [] as string[] }));
vi.mock("@/lib/export/png", () => ({
  rasterizeSvg: vi.fn(async () => new Blob([new Uint8Array([0x89, 0x50])], { type: "image/png" })),
  canvasCanHold: vi.fn((widthPx: number, heightPx: number) => {
    canvas.asked.push(`${widthPx}x${heightPx}`);
    return canvas.canHold;
  }),
}));

import { copyFigure, copyMolblock } from "./figure";

const NOW = "2024-01-01T00:00:00.000Z";

/** A ClipboardItem stand-in that records what it was built with. */
class FakeClipboardItem {
  static supports = (type: string): boolean =>
    ["image/svg+xml", "image/png", "text/plain"].includes(type);
  readonly parts: Record<string, Promise<Blob>>;
  constructor(parts: Record<string, Promise<Blob>>) {
    this.parts = parts;
  }
  get types(): string[] {
    return Object.keys(this.parts);
  }
}

let writes: FakeClipboardItem[][];
let store: EditorStore;

function editor(molecule = ethanol()): EditorStore {
  const [skeletal, sum] = defaultPanelsFor("screen");
  return createEditorStore({
    document: createDocument({
      molecule,
      panels: [skeletal!, createPanel("lewis"), sum!],
      now: NOW,
    }),
    viewportSize: { width: 800, height: 600 },
  });
}

beforeEach(() => {
  canvas.canHold = true;
  canvas.asked = [];
  writes = [];
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      write: vi.fn(async (items: FakeClipboardItem[]) => {
        writes.push(items);
      }),
    },
  });
  store = editor();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Copy figure", () => {
  it("writes ONE ClipboardItem carrying svg, png and plain text", async () => {
    const pending = copyFigure(store);
    // Issued synchronously, before any await, so it stays inside the gesture.
    expect(writes).toHaveLength(1);
    await pending;
    const [items] = writes;
    expect(items).toHaveLength(1);
    const item = items![0]!;
    expect(item.types.sort()).toEqual(["image/png", "image/svg+xml", "text/plain"]);
    const svg = await (await item.parts["image/svg+xml"]!).text();
    expect(svg).toContain('width="8.25cm"');
    expect(await (await item.parts["text/plain"]!).text()).toBe(svg);
    expect(store.getState().ui.statusMessage).toMatch(/^Copied the figure/);
  });

  it("leaves out a type the browser cannot write instead of failing the whole copy", async () => {
    FakeClipboardItem.supports = (type) => type !== "image/svg+xml";
    try {
      await copyFigure(store);
      expect(writes[0]![0]!.types.sort()).toEqual(["image/png", "text/plain"]);
    } finally {
      FakeClipboardItem.supports = (type) =>
        ["image/svg+xml", "image/png", "text/plain"].includes(type);
    }
  });

  it("keeps the PNG past Safari's canvas area when this browser can hold it, and says why when it cannot", async () => {
    // Double column at 600 dpi: a 2-column grid 4205 px wide and taller than
    // 16,777,216 px of area, the size the dialog must not refuse everywhere.
    const grid = (): EditorStore => {
      const s = createEditorStore({
        document: createDocument({
          molecule: ethanol(),
          panels: (["skeletal", "lewis", "skeletal", "lewis", "sumFormula", "sumFormula"] as const).map(
            (kind) => createPanel(kind),
          ),
          figure: { columns: 2 },
          now: NOW,
        }),
        viewportSize: { width: 800, height: 600 },
      });
      s.getState().setFigureExport({ width: "double", dpi: 600 });
      return s;
    };

    store = grid();
    await copyFigure(store);
    expect(canvas.asked).toHaveLength(1);
    expect(canvas.asked[0]).toMatch(/^4205x\d+$/);
    expect(writes[0]![0]!.types.sort()).toEqual(["image/png", "image/svg+xml", "text/plain"]);
    expect(store.getState().ui.statusMessage).toMatch(/^Copied the figure \([^)]*png/);

    canvas.canHold = false;
    writes = [];
    store = grid();
    await copyFigure(store);
    expect(writes[0]![0]!.types.sort()).toEqual(["image/svg+xml", "text/plain"]);
    expect(store.getState().ui.statusMessage).toMatch(/without a PNG\. A 4205 × \d+ px PNG is larger than this browser's canvas/);
  });

  it("refuses, without touching the clipboard, when a panel cannot be drawn", async () => {
    store = editor(benzylAlcoholAbbreviated());
    await copyFigure(store);
    expect(writes).toHaveLength(0);
    expect(store.getState().ui.statusMessage).toMatch(/Panel \(c\) cannot be drawn/);
  });
});

describe("Copy as molfile", () => {
  it("copies a V2000 molblock as plain text", async () => {
    await copyMolblock(store);
    const text = await (await writes[0]![0]!.parts["text/plain"]!).text();
    expect(text).toContain("V2000");
    expect(text).toContain("M  END");
  });

  it("surfaces MolblockLabelError with the atom, and selects it (decision 8)", async () => {
    store = editor(benzylAlcoholAbbreviated());
    const labelled = store
      .getState()
      .document.molecule.atomIds.filter(
        (id) => store.getState().document.molecule.atoms[id]?.label !== undefined,
      );
    expect(labelled).toHaveLength(1);
    await copyMolblock(store);
    expect(writes).toHaveLength(0);
    const message = store.getState().ui.statusMessage ?? "";
    expect(message).toContain(labelled[0]!);
    expect(message).toContain('"Ph"');
    expect(store.getState().selection.atomIds).toEqual(labelled);
  });
});
