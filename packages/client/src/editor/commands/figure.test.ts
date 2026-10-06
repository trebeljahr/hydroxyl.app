import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildMolecule, insertFragment, withStereoGroups } from "@starter/chem-core";
import { benzylAlcoholAbbreviated, butan2olWedged, ethanol } from "@starter/chem-render";
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

// The worker is not reachable from jsdom; the real InChI is asserted against
// the wasm in `fidelity.node.test.ts`. This stands in for the bridge only.
const inchi = vi.hoisted(() => ({
  molecules: [] as unknown[],
  key: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N",
}));
vi.mock("@/lib/rdkit/client", () => ({
  toInchi: vi.fn(async (mol: unknown) => {
    inchi.molecules.push(mol);
    return {
      ok: true,
      value: { inchi: "InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3", inchiKey: inchi.key },
    };
  }),
}));

import { copyElementalAnalysis, copyFigure, copyInchi, copyMolblock } from "./figure";
import { molblockVersionNotice } from "@/lib/rdkit/translate";

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
  inchi.molecules = [];
  inchi.key = "LFQSCWFLJHTTHZ-UHFFFAOYSA-N";
  canvas.canHold = true;
  canvas.asked = [];
  writes = [];
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      write: vi.fn(async (items: FakeClipboardItem[]) => {
        writes.push(items);
        // A real ClipboardItem consumes its parts, and a rejected part rejects
        // the write; without this a failed part is an unhandled rejection.
        await Promise.all(items.flatMap((item) => Object.values(item.parts)));
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
    // At its natural size: the column is a maximum, and this figure is small.
    expect(svg).toMatch(/<svg[^>]*\swidth="[\d.]+cm"/);
    expect(svg).not.toContain('width="8.25cm"');
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
    // Double column at 600 dpi: a figure filling it is 4205 px wide, and a
    // 40-bond square is taller than 16,777,216 px of area at that width — the
    // size the dialog must not refuse everywhere.
    const grid = (): EditorStore => {
      const s = createEditorStore({
        document: createDocument({
          molecule: buildMolecule((b) => {
            for (const [x, y] of [[0, 0], [40, 0], [0, 40], [40, 40]] as const) {
              b.atom("C", { x, y });
            }
          }),
          panels: [createPanel("skeletal")],
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

describe("Copy as InChI / InChIKey", () => {
  it("puts the InChI alone on the clipboard, issued inside the gesture", async () => {
    const pending = copyInchi(store, "structure", "inchi");
    expect(writes).toHaveLength(1);
    await pending;
    const text = await (await writes[0]![0]!.parts["text/plain"]!).text();
    expect(text).toBe("InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3");
    expect(store.getState().ui.statusMessage).toBe(
      "Copied InChI InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3",
    );
  });

  it("puts the key alone on the clipboard for Copy as InChIKey", async () => {
    await copyInchi(store, "structure", "inchikey");
    const text = await (await writes[0]![0]!.parts["text/plain"]!).text();
    expect(text).toBe("LFQSCWFLJHTTHZ-UHFFFAOYSA-N");
    expect(store.getState().ui.statusMessage).toBe("Copied InChIKey LFQSCWFLJHTTHZ-UHFFFAOYSA-N");
  });

  it("reports an empty key as a failure rather than copying nothing", async () => {
    inchi.key = "";
    await copyInchi(store, "structure", "inchikey");
    expect(store.getState().ui.statusMessage).toBe(
      "The InChIKey could not be copied: RDKit produced no InChIKey for this structure.",
    );
  });

  it("sends only the selected atoms for the selection scope", async () => {
    store.getState().setSelection({ atomIds: ["a1", "a2"], bondIds: [], annotationIds: [] });
    await copyInchi(store, "selection", "inchi");
    const sent = inchi.molecules[0] as { atomIds: readonly string[] };
    expect(sent.atomIds).toHaveLength(2);
  });

  it("refuses an empty selection without touching the clipboard", async () => {
    store.getState().setSelection({ atomIds: [], bondIds: [], annotationIds: [] });
    await copyInchi(store, "selection", "inchikey");
    expect(writes).toHaveLength(0);
    expect(store.getState().ui.statusMessage).toBe(
      "No atoms are selected, so there is no InChIKey to copy.",
    );
  });

  it("names a labelled atom before the wasm is asked (decision 8)", async () => {
    store = editor(benzylAlcoholAbbreviated());
    await copyInchi(store, "structure", "inchi");
    expect(writes).toHaveLength(0);
    expect(inchi.molecules).toHaveLength(0);
    expect(store.getState().ui.statusMessage).toContain('"Ph"');
  });
});

describe("Copy as molfile", () => {
  it("copies a V2000 molblock as plain text", async () => {
    await copyMolblock(store);
    const text = await (await writes[0]![0]!.parts["text/plain"]!).text();
    expect(text).toContain("V2000");
    expect(text).toContain("M  END");
  });

  it("says V2000 was the default by saying nothing about the generation", async () => {
    await copyMolblock(store);
    // Ethanol states no group, so `molblockVersionNotice` is null and the status
    // line is the bare one. That is what keeps the notice meaningful when it does
    // appear.
    expect(molblockVersionNotice(store.getState().document.molecule)).toBeNull();
    expect(store.getState().ui.statusMessage).toBe("Copied the structure as a molfile");
  });

  it("repeats decision 49's generation sentence in the status line", async () => {
    // The copy may be made from the palette, with no dialog on screen, so the
    // line that says the copy happened is the ONLY place a V3000 switch is
    // stated. Deleting this note left the whole client suite green: the dialog
    // owns the sentence and is tested, and nothing checked that this caller
    // repeats it.
    const racemate = withStereoGroups(butan2olWedged(), [
      { kind: "and", index: 1, atomIds: ["a2"] },
    ]);
    store = editor(racemate);
    await copyMolblock(store);
    const text = await (await writes[0]![0]!.parts["text/plain"]!).text();
    expect(text).toContain("V3000");
    expect(text).toContain("MDLV30/STERAC1");
    // Read from `translate.ts`, the sentence's one owner, so the assertion cannot
    // freeze a second wording here.
    const note = molblockVersionNotice(racemate)!;
    expect(note).toContain("V3000");
    expect(store.getState().ui.statusMessage).toBe(
      `Copied the structure as a molfile. ${note}`,
    );
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

describe("Copy selection as molfile", () => {
  it("writes only the selected atoms, and the bonds between them", async () => {
    store.getState().selectAtoms(["a1", "a2"]);
    await copyMolblock(store, "selection");
    const text = await (await writes[0]![0]!.parts["text/plain"]!).text();
    // The V2000 counts line: two atoms, one bond. Ethanol's oxygen and the
    // C–O bond stayed behind.
    expect(text).toMatch(/^\s*2\s+1\s/m);
    expect(store.getState().ui.statusMessage).toBe("Copied the selection as a molfile");
  });

  it("names and selects the DOCUMENT's atom when a label refuses the copy", async () => {
    // Benzyl alcohol drawn AFTER an ethanol, so its "Ph" atom is a6 on the
    // canvas but a1 in the fragment the copy cuts out — extraction mints ids
    // afresh. A refusal quoting the fragment's id would point at ethanol's
    // methyl, and selecting it would highlight the wrong atom.
    const pasted = insertFragment(ethanol(), benzylAlcoholAbbreviated());
    store = editor(pasted.molecule);
    const ph = pasted.atomIds.find((id) => pasted.molecule.atoms[id]?.label === "Ph")!;
    expect(ph).not.toBe("a1");
    store.getState().selectAtoms(pasted.atomIds);

    await copyMolblock(store, "selection");

    expect(writes).toHaveLength(0);
    const message = store.getState().ui.statusMessage ?? "";
    expect(message).toContain(`${ph} ("Ph")`);
    expect(message).not.toMatch(/\ba1\b/);
    expect(store.getState().selection.atomIds).toEqual([ph]);
  });

  it("refuses with nothing selected, without touching the clipboard", async () => {
    store.getState().clearSelection();
    await copyMolblock(store, "selection");
    expect(writes).toHaveLength(0);
    expect(store.getState().ui.statusMessage).toMatch(/No atoms are selected/);
  });
});

describe("Copy elemental analysis", () => {
  it("copies the Anal. Calcd line and repeats it in the status bar", async () => {
    await copyElementalAnalysis(store);
    const text = await (await writes[0]![0]!.parts["text/plain"]!).text();
    expect(text).toBe("Anal. Calcd for C2H6O: C, 52.14; H, 13.13.");
    expect(store.getState().ui.statusMessage).toBe(
      `Copied the structure's elemental analysis: ${text}`,
    );
  });

  it("refuses two compounds with chem-core's sentence and writes nothing", async () => {
    store = editor(
      buildMolecule((b) => {
        b.bond(b.atom("C"), b.atom("O"), 1);
        b.atom("C", { x: 5, y: 0 });
      }),
    );
    await copyElementalAnalysis(store);
    expect(writes).toHaveLength(0);
    expect(store.getState().ui.statusMessage).toContain("more than one compound");
  });
});
