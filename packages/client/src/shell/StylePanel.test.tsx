/**
 * The figure-style panel (decision 237): a typed value reaches the document
 * on Enter, in print units, and "Reset to preset" takes it away again.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PUBLICATION_STYLE, styleParams } from "@starter/chem-render";
import { createDocument } from "@starter/shared";

import { TooltipProvider } from "@/components/ui/tooltip";
import { editorStore } from "@/state";

import { StylePanelButton, formatStyleNumber, overridesWith, parseStyleNumber } from "./StylePanel";

function input(param: string): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`[data-style-param="${param}"]`);
  if (el === null) throw new Error(`no field ${param}`);
  return el;
}

beforeEach(() => {
  act(() => editorStore.getState().loadDocument(createDocument({ stylePreset: "publication" })));
});

afterEach(() => {
  act(() => editorStore.getState().loadDocument(createDocument()));
});

describe("the style panel's helpers", () => {
  it("shows print units to three decimals", () => {
    const p = styleParams(PUBLICATION_STYLE);
    expect(formatStyleNumber(p.lineWidthPt)).toBe("0.6");
    expect(formatStyleNumber(p.bondLengthMm)).toBe("5.08");
    expect(formatStyleNumber(p.fontSizePt)).toBe("10");
  });

  it("drops a field typed back to the preset's value", () => {
    const preset = styleParams(PUBLICATION_STYLE);
    expect(overridesWith({ lineWidthPt: 1 }, preset, "lineWidthPt", 0.6)).toEqual({});
    expect(overridesWith({}, preset, "bondColor", "#ff0000")).toEqual({ bondColor: "#ff0000" });
  });

  it("refuses a number outside the range, and accepts a decimal comma", () => {
    expect(parseStyleNumber("lineWidthPt", "0")).toEqual({ ok: false, message: "Between 0.05 and 10." });
    expect(parseStyleNumber("lineWidthPt", "abc").ok).toBe(false);
    expect(parseStyleNumber("lineWidthPt", "0,8")).toEqual({ ok: true, value: 0.8 });
  });
});

describe("the style panel", () => {
  it("writes a typed line width on Enter and resets to the preset", () => {
    render(
      <TooltipProvider>
        <StylePanelButton />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Figure style" }));
    expect(input("lineWidthPt").value).toBe("0.6");

    fireEvent.change(input("lineWidthPt"), { target: { value: "0.8" } });
    fireEvent.keyDown(input("lineWidthPt"), { key: "Enter" });
    expect(editorStore.getState().document.styleOverrides).toEqual({
      publication: { lineWidthPt: 0.8 },
    });

    fireEvent.change(input("fontSizePt"), { target: { value: "200" } });
    fireEvent.keyDown(input("fontSizePt"), { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe("Between 2 and 72.");
    expect(editorStore.getState().document.styleOverrides?.publication?.fontSizePt).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Reset to Publication" }));
    expect(editorStore.getState().document.styleOverrides).toBeUndefined();
    expect(input("lineWidthPt").value).toBe("0.6");
  });

  it("offers only the vendored faces and weights, and writes a choice as one edit", () => {
    render(
      <TooltipProvider>
        <StylePanelButton />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Figure style" }));
    const face = input("fontFace") as unknown as HTMLSelectElement;
    const weight = input("fontWeight") as unknown as HTMLSelectElement;
    expect([...face.options].map((o) => o.value)).toEqual(["arimo", "tinos"]);
    expect([...weight.options].map((o) => o.value)).toEqual(["normal", "bold"]);
    expect(face.value).toBe("arimo");
    expect(weight.value).toBe("normal");
    expect(document.querySelector('[data-style-param="font"]')).toBeNull();

    fireEvent.change(face, { target: { value: "tinos" } });
    fireEvent.change(weight, { target: { value: "bold" } });
    expect(editorStore.getState().document.styleOverrides).toEqual({
      publication: { fontFace: "tinos", fontWeight: "bold" },
    });
    expect(face.value).toBe("tinos");

    // Choosing the preset's own face again is not an edit.
    fireEvent.change(face, { target: { value: "arimo" } });
    expect(editorStore.getState().document.styleOverrides).toEqual({
      publication: { fontWeight: "bold" },
    });
    act(() => editorStore.getState().undo());
    expect(editorStore.getState().document.styleOverrides?.publication?.fontFace).toBe("tinos");
  });
});
