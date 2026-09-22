/**
 * The export dialog's size warnings (decisions 51 and 60): the dialog shows
 * what `lib/export/figure` finds, names which text prints small, and never
 * disables an export for it.
 */

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { butan2olWedged } from "@starter/chem-render";
import { createDocument, createPanel } from "@starter/shared";
import type { SketchDocument } from "@starter/shared";

import { editorStore } from "@/state";

import { ExportDialog } from "./ExportDialog";

const NOW = "2024-01-01T00:00:00.000Z";

function descriptorDoc(show: boolean): SketchDocument {
  const panel = createPanel("skeletal", undefined, "publication");
  return createDocument({
    molecule: butan2olWedged(),
    stylePreset: "publication",
    panels: [
      {
        ...panel,
        representation: {
          ...panel.representation,
          display: { ...panel.representation.display, showStereoDescriptors: show },
        },
      },
    ],
    now: NOW,
  });
}

function openDialog(doc: SketchDocument, customWidthCm: number): void {
  act(() => {
    const state = editorStore.getState();
    state.openDocument(doc);
    state.setFigureExport({ width: "custom", customWidthCm, dpi: 300, style: "publication" });
    state.setExportDialogOpen(true);
  });
  render(<ExportDialog />);
}

const warning = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-shell="figure-annotation-size"]');

beforeEach(() => {
  act(() => {
    editorStore.getState().setExportDialogOpen(false);
  });
});

describe("ExportDialog annotation size warning (decision 60)", () => {
  it("names the stereo descriptors that print under 8 pt, and keeps every export enabled", () => {
    // Three butan-2-ol panels are wider than 2 cm, the narrowest custom
    // width, so the figure is scaled down and its 8 pt descriptors with it.
    const wide = descriptorDoc(true);
    const doc: SketchDocument = { ...wide, panels: [wide.panels[0]!, { ...wide.panels[0]!, id: "p2" }, { ...wide.panels[0]!, id: "p3" }] };
    openDialog(doc, 2);
    expect(document.querySelector('[data-shell="figure-scaled"]')).not.toBeNull();
    const shown = warning();
    expect(shown).not.toBeNull();
    expect(shown!.getAttribute("data-annotation-kinds")).toBe("descriptor");
    expect(shown!.textContent).toMatch(/^Stereo descriptors print at \d+\.\d pt, below the 8 pt minimum ACS asks for in figures\./);
    expect(shown!.getAttribute("data-annotation-pt")).toBe(/at (\d+\.\d) pt/.exec(shown!.textContent!)![1]);
    for (const command of ["figure.export-svg", "figure.export-png", "figure.copy"]) {
      const button = document.querySelector<HTMLButtonElement>(`[data-command="${command}"]`);
      expect(button, command).not.toBeNull();
      expect(button!.disabled, command).toBe(false);
    }
  });

  it("shows nothing when no descriptor is drawn, however small the figure", () => {
    const wide = descriptorDoc(false);
    const doc: SketchDocument = { ...wide, panels: [wide.panels[0]!, { ...wide.panels[0]!, id: "p2" }, { ...wide.panels[0]!, id: "p3" }] };
    openDialog(doc, 2);
    expect(document.querySelector('[data-shell="figure-scaled"]')).not.toBeNull();
    expect(warning()).toBeNull();
  });

  it("shows nothing at Publication's natural size, where descriptors print at 8 pt", () => {
    openDialog(descriptorDoc(true), 60);
    expect(document.querySelector('[data-shell="figure-fit"]')).not.toBeNull();
    expect(warning()).toBeNull();
  });
});
