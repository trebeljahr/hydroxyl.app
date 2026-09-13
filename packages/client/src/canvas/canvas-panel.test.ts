import { describe, expect, it } from "vitest";

import { benzylAlcoholAbbreviated, ethanol } from "@starter/chem-render";
import { emptyMolecule } from "@starter/chem-core";
import { createDocument, createPanel, defaultPanelsFor } from "@starter/shared";

import { buildCanvasScene, canvasPanelFor, canvasRefusal } from "./scene-bridge";

const NOW = "2024-01-01T00:00:00.000Z";

function doc(molecule = ethanol()) {
  const [skeletal, sum] = defaultPanelsFor("screen");
  const lewis = createPanel("lewis");
  return {
    document: createDocument({ molecule, panels: [skeletal!, lewis, sum!], now: NOW }),
    ids: { skeletal: skeletal!.id, lewis: lewis.id, sum: sum!.id },
  };
}

describe("canvasPanelFor — what the canvas draws for the active panel", () => {
  it("draws the default structural panel when nothing is active", () => {
    const { document, ids } = doc();
    expect(canvasPanelFor(document, null)?.id).toBe(ids.skeletal);
  });

  it("draws an active structural panel through its own view", () => {
    const { document, ids } = doc();
    expect(canvasPanelFor(document, ids.lewis)?.id).toBe(ids.lewis);
    expect(buildCanvasScene(document, ids.lewis).representation.kind).toBe("lewis");
  });

  it("keeps the structure for an active text view, and says why", () => {
    const { document, ids } = doc();
    expect(canvasPanelFor(document, ids.sum)?.id).toBe(ids.skeletal);
    const sum = document.panels.find((p) => p.id === ids.sum)!;
    expect(canvasRefusal(document, sum)).toMatch(/text view/);
  });

  it("keeps the structure for an active view whose availability fails", () => {
    const { document, ids } = doc(benzylAlcoholAbbreviated());
    // Lewis of a Ph label is available; the sum formula is not.
    expect(canvasPanelFor(document, ids.lewis)?.id).toBe(ids.lewis);
    expect(canvasPanelFor(document, ids.sum)?.id).toBe(ids.skeletal);
  });

  it("lets an empty drawing show an active structural view — that is where drawing starts", () => {
    const { document, ids } = doc(emptyMolecule());
    expect(canvasPanelFor(document, ids.lewis)?.id).toBe(ids.lewis);
  });

  it("falls back when the active id names no panel (a stale reference)", () => {
    const { document, ids } = doc();
    expect(canvasPanelFor(document, "gone")?.id).toBe(ids.skeletal);
  });
});
