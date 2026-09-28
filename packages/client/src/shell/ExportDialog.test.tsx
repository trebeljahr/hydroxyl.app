/**
 * The export dialog's size warnings (decisions 51 and 60): the dialog shows
 * what `lib/export/figure` finds, names which text prints small, and never
 * disables an export for it.
 */

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { butan2olWedged } from "@starter/chem-render";
import { bonds, setBondStereo, withStereoGroups } from "@starter/chem-core";
import { createDocument, createPanel } from "@starter/shared";
import type { SketchDocument } from "@starter/shared";

import { molblockVersionNotice, wedgelessStereoGroupNotice } from "@/lib/rdkit/translate";
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

describe("ExportDialog molfile generation notice (decision 49)", () => {
  /** butan-2-ol with its one centre marked racemic — the `rac-` case. */
  function racemateDoc(): SketchDocument {
    const doc = descriptorDoc(true);
    return {
      ...doc,
      molecule: withStereoGroups(doc.molecule, [{ kind: "and", index: 1, atomIds: ["a2"] }]),
    };
  }

  const notice = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('[data-shell="molfile-version"]');

  it("says V3000 was chosen, and names the group the way the figure prints it", () => {
    openDialog(racemateDoc(), 60);
    const shown = notice();
    expect(shown).not.toBeNull();
    expect(shown!.getAttribute("data-molfile-version")).toBe("V3000");
    // The sentence is `translate.ts`'s, so the dialog cannot promise one
    // generation while the bytes carry another.
    expect(shown!.textContent).toBe(molblockVersionNotice(racemateDoc().molecule));
    expect(shown!.textContent).toContain("(and1)");
  });

  it("is silent for a structure that states no group, where V2000 is still the default", () => {
    // A notice on every export would be noise on the ordinary case, and would
    // train the reader to ignore the one that matters.
    openDialog(descriptorDoc(true), 60);
    expect(notice()).toBeNull();
  });
});

describe("ExportDialog wedgeless stereo group notice (decision 95)", () => {
  const notice = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('[data-shell="wedgeless-stereo-group"]');

  it("names the grouped atoms an RDKit reader will drop, and still exports", () => {
    // A flat skeleton marked racemic is an ordinary scheme drawing, so the mark is
    // not refused (decision 95) — but RDKit builds its collection out of the atoms
    // carrying a chiral tag, and this one has none. The dialog says what will be
    // lost and names the atoms, since the drop is per atom.
    const doc = descriptorDoc(true);
    const flat = bonds(doc.molecule).reduce(
      (mol, bond) => setBondStereo(mol, bond.id, "none"),
      doc.molecule,
    );
    const molecule = withStereoGroups(flat, [{ kind: "and", index: 1, atomIds: ["a2"] }]);
    openDialog({ ...doc, molecule }, 60);
    const shown = notice();
    expect(shown).not.toBeNull();
    // The sentence has one owner, as decision 49's does.
    expect(shown!.textContent).toBe(wedgelessStereoGroupNotice(molecule));
    expect(shown!.textContent).toContain("a2");
    // Informing, not refusing.
    for (const command of ["figure.export-svg", "figure.copy-molblock"]) {
      const button = document.querySelector<HTMLButtonElement>(`[data-command="${command}"]`);
      expect(button, command).not.toBeNull();
      expect(button!.disabled, command).toBe(false);
    }
  });

  it("is silent when every grouped atom carries a wedge", () => {
    // butan-2-ol as drawn: its centre has the wedge, so RDKit keeps the
    // collection and there is nothing to warn about. A notice on every grouped
    // export would train the reader to ignore this one.
    const doc = descriptorDoc(true);
    const molecule = withStereoGroups(doc.molecule, [{ kind: "and", index: 1, atomIds: ["a2"] }]);
    openDialog({ ...doc, molecule }, 60);
    expect(notice()).toBeNull();
    // And the generation notice is still there, so the two are independent.
    expect(document.querySelector('[data-shell="molfile-version"]')).not.toBeNull();
  });

  it("is silent for a structure that states no group at all", () => {
    openDialog(descriptorDoc(true), 60);
    expect(notice()).toBeNull();
  });
});

describe("ExportDialog panel chooser", () => {
  it("sits beside the preview, and a view added there reaches the preview at once", () => {
    act(() => {
      const state = editorStore.getState();
      state.openDocument(createDocument({ molecule: butan2olWedged(), now: NOW }));
      state.setFigureExport({ width: "single", dpi: 300, style: "publication" });
      state.setExportDialogOpen(true);
    });
    render(<ExportDialog />);
    const dialog = document.querySelector('[data-shell="export-dialog"]')!;
    const chooser = dialog.querySelector('[data-shell="panel-chooser"]');
    expect(chooser).not.toBeNull();
    // The dialog no longer sends the reader elsewhere to choose panels.
    expect(dialog.textContent).not.toMatch(/Edit the panels in the properties panel/);

    const preview = (): string =>
      dialog.querySelector<HTMLImageElement>('[data-shell="figure-preview"]')!.src;
    const before = decodeURIComponent(preview());
    expect(before).toContain('data-panel-label="(b)"');
    expect(before).not.toContain('data-panel-label="(c)"');

    act(() => {
      (chooser!.querySelector('[data-add-view="lewis"]') as HTMLButtonElement).click();
    });
    const after = decodeURIComponent(preview());
    expect(after).toContain('data-panel-label="(c)"');
    expect([...after.matchAll(/data-view="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "skeletal",
      "sumFormula",
      "lewis",
    ]);
  });
});
