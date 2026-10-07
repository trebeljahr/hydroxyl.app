import { elementCounts } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import { dictionaryEntryById, dictionaryMolecule } from "@starter/chem-core/dictionary";
import {
  JOURNAL_WIDTHS_CM,
  MIN_PRINTED_LABEL_PT,
  VIEW_KIND_TITLES,
  defaultFigureColumns,
} from "@starter/chem-render";
import { DEFAULT_PANELS, createDocument, createPanel } from "@starter/shared";
import { describe, expect, it } from "vitest";

import { exampleNamed } from "@/components/landing/example-document";
import { createEditorStore } from "@/state/store";

import {
  ASPIRIN_MOLBLOCK,
  MULTI_PANEL_COLUMNS,
  MULTI_PANEL_VIEWS,
  aspirinMolecule,
} from "./multi-panel-examples";
import { singleColumnFigure } from "./guide-figure";

import { ACS_FIGURE_CAPTION, multiPanelNumbers, printedSize } from "./multi-panel-figure";

const numbers = multiPanelNumbers();

describe("the multi-panel guide's molecule", () => {
  it("is the insert box's aspirin, byte for byte", () => {
    // The guide says to type "aspirin" into the insert box. If the generated
    // dictionary changes, copy its molblock into ASPIRIN_MOLBLOCK again.
    const entry = dictionaryEntryById("aspirin");
    expect(entry?.molblock).toBe(ASPIRIN_MOLBLOCK);
    const drawn = (mol: Molecule): unknown[] =>
      Object.values(mol.atoms).map((a) => [a.element, a.pos.x, a.pos.y]);
    expect(drawn(aspirinMolecule())).toEqual(drawn(dictionaryMolecule(entry!)));
    expect(drawn(aspirinMolecule())).toHaveLength(13);
    expect(elementCounts(aspirinMolecule())).toEqual({ C: 9, H: 8, O: 4 });
  });
});

describe("the multi-panel guide's steps", () => {
  it("start from the two panels a new sketch opens with", () => {
    // Steps 3 to 6 keep panel (a), add (b) and (c) after the second panel,
    // then move that second panel down to (d).
    expect(DEFAULT_PANELS.map((p) => p.representation.kind)).toEqual([
      MULTI_PANEL_VIEWS[0]?.kind,
      MULTI_PANEL_VIEWS[3]?.kind,
    ]);
    expect(numbers.newSketchViews).toEqual(["Skeletal", "Sum formula"]);
  });

  it("name the views the panel menus show", () => {
    expect(numbers.panels.map((p) => p.label)).toEqual(["(a)", "(b)", "(c)", "(d)"]);
    expect(numbers.panels.map((p) => p.view)).toEqual(
      MULTI_PANEL_VIEWS.map((v) => VIEW_KIND_TITLES[v.kind]),
    );
  });

  it("are right that a sum-formula panel switched to explicit H draws its C and H labels", () => {
    // The page says a view change re-seeds the flags the chemist left alone
    // (decision 254). Build the figure that way instead of the steps' way —
    // switch the new sketch's Sum formula panel, then add Lewis and Sum
    // formula — and it prints the guide's figure exactly.
    const store = createEditorStore({
      document: createDocument({
        molecule: aspirinMolecule(),
        stylePreset: "publication",
        now: "2026-01-01T00:00:00.000Z",
      }),
      now: () => "2026-01-01T00:00:00.000Z",
    });
    const second = DEFAULT_PANELS[1]!.id;
    const state = (): ReturnType<typeof store.getState> => store.getState();
    state().updatePanel(second, { kind: "explicitH" });
    const switched = state().document.panels.find((p) => p.id === second)!.representation;
    const added = createPanel("explicitH", undefined, "publication").representation;
    expect(switched).toEqual(added);
    expect(switched.display.showCarbonLabels).toBe(true);
    expect(switched.display.showImplicitHydrogens).toBe(true);

    state().addPanel("lewis");
    state().addPanel("sumFormula");
    state().setFigureColumns(MULTI_PANEL_COLUMNS);
    state().document.panels.forEach((panel, index) => {
      state().setPanelCaption(panel.id, MULTI_PANEL_VIEWS[index]!.caption);
    });
    expect(state().document.panels.map((p) => p.representation.kind)).toEqual(
      MULTI_PANEL_VIEWS.map((v) => v.kind),
    );
    expect(printedSize(singleColumnFigure(state().document))).toBe(printedSize(numbers.finished));
  });

  it("explain (d) with the editor's own refusal of a condensed formula", () => {
    expect(numbers.condensedRefusal).toBe(
      "A ring has no condensed formula; use the sum formula instead.",
    );
  });
});

describe("the finished figure", () => {
  it("prints two to a row at full size inside a single column", () => {
    const { finished } = numbers;
    expect(finished.columns).toBe(2);
    expect(finished.scaleNotice).toBeNull();
    expect(finished.labelNotice).toBeNull();
    expect(finished.widthCm).toBeCloseTo(finished.naturalWidthCm, 9);
    expect(finished.widthCm).toBeLessThan(JOURNAL_WIDTHS_CM.single);
    expect(finished.fontSizePt).toBe("10.0");
    expect(printedSize(finished)).toMatch(/^\d+\.\d\d × \d+\.\d\d cm$/);
  });

  it("letters and captions every panel", () => {
    for (const { label, caption } of numbers.panels) {
      expect(numbers.finished.svg).toContain(`data-panel-label="${label}"`);
      expect(numbers.finished.svg).toContain(caption);
    }
  });
});

describe("the automatic layout", () => {
  it("puts three panels in a row and shrinks under the label minimum", () => {
    const { automatic } = numbers;
    expect(numbers.automaticColumns).toBe(defaultFigureColumns(4));
    expect(automatic.columns).toBe(numbers.automaticColumns);
    expect(automatic.naturalWidthCm).toBeGreaterThan(JOURNAL_WIDTHS_CM.single);
    expect(automatic.widthCm).toBe(JOURNAL_WIDTHS_CM.single);
    expect(automatic.scaleNotice).toBe(
      `Scaled to ${numbers.automaticScalePercent}% to fit a single column.`,
    );
    expect(Number(automatic.fontSizePt)).toBeLessThan(MIN_PRINTED_LABEL_PT);
    expect(automatic.labelNotice).toContain(`below the ${MIN_PRINTED_LABEL_PT} pt minimum`);
  });

  it("gives the two inline figures different element ids", () => {
    const ids = (svg: string): string[] => [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] ?? "");
    const shared = ids(numbers.finished.svg).filter((id) => ids(numbers.automatic.svg).includes(id));
    expect(shared).toEqual([]);
  });
});

describe("the examples the figures open", () => {
  it("are the documents the figures draw", () => {
    expect(exampleNamed("multi-panel-figure")?.figure).toEqual({ columns: 2 });
    expect(exampleNamed("multi-panel-figure-automatic-columns")?.figure).toBeUndefined();
    expect(exampleNamed("multi-panel-figure")?.panels.map((p) => p.caption)).toEqual(
      MULTI_PANEL_VIEWS.map((v) => v.caption),
    );
  });
});

describe("the ACS caption rule", () => {
  it("quotes a short fragment from the page the figure-size guide cites", () => {
    expect(ACS_FIGURE_CAPTION.url).toMatch(/^https:\/\/researcher-resources\.acs\.org\//);
    expect(ACS_FIGURE_CAPTION.quote.split(/\s+/).length).toBeLessThan(15);
    expect(ACS_FIGURE_CAPTION.fetched).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
