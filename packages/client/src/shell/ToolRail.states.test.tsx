/**
 * THE PICKERS' FOUR VISUAL STATES — idle, hover, selected, disabled — pinned on
 * the shipped components.
 *
 * WHY THIS FILE EXISTS. The owner reported the chain-length picker, the atom
 * picker and the view options rendering "weirdly transparent except the selected
 * entry", with the chain numbers missing. The structural cause was that an idle
 * entry declared NO colour of its own: the inactive branch was a hover pair and
 * nothing else, so an idle entry had no ground and borrowed its ink from
 * `PopoverContent`, while the selected entry was the one entry naming both. Any
 * hiccup in the cascade therefore erased every entry except the selected one.
 *
 * SO THE ASSERTIONS ARE ABOUT WHAT EACH STATE DECLARES, not about a particular
 * shade. jsdom runs no cascade and no layout, so no contrast ratio is claimed
 * here — the real computed colours are measured in Chromium, in
 * e2e/shell.spec.ts. What jsdom can answer honestly is which classes and
 * attributes the real component puts on the real element, which is exactly
 * where the bug lived.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COMMON_ORGANIC_ELEMENTS, benzene, elementBySymbol } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { TooltipProvider } from "@/components/ui/tooltip";
import { CHAIN_LENGTHS } from "@/editor/commands/registry";
import { editorStore } from "@/state";

import {
  declaredColours,
  hasFocusRing,
  variantColours,
} from "../../test/picker-colours";
import { OptionButton, ToolRail } from "./ToolRail";

/** The rail's four option popovers, by the label their chevron carries. */
const PICKERS = [
  "Draw bond options",
  "Element options",
  "Ring template options",
  "Chain options",
] as const;

beforeEach(() => {
  const state = editorStore.getState();
  state.openDocument(
    createDocument({ molecule: benzene(), now: "2024-01-01T00:00:00.000Z" }),
  );
  state.setTool("select");
  // Tool options survive a tool change by design, so they survive between tests
  // too and have to be put back by hand.
  state.setToolOption("element", "C");
  state.setToolOption("bondStereo", "none");
  state.setToolOption("bondOrder", 1);
  state.setToolOption("ringTemplate", "benzene");
  state.setToolOption("chainLength", 6);
});

function renderRail(): void {
  render(
    <TooltipProvider>
      <ToolRail />
    </TooltipProvider>,
  );
}

/** Fresh rail, one popover open. Radix opens on pointerdown in some versions
 *  and on click in others; a click fires both paths jsdom supports. */
function openPicker(label: string): void {
  renderRail();
  const trigger = document.querySelector(`[aria-label="${label}"]`);
  if (!(trigger instanceof HTMLElement)) throw new Error(`no trigger for ${label}`);
  act(() => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
  });
}

function entries(): readonly HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-option]")];
}

function toolButton(id: string): HTMLElement {
  const node = document.querySelector(`[data-tool="${id}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`no button for ${id}`);
  return node;
}

describe("picker entry states", () => {
  it("opens every picker with entries in it — otherwise the rest pins nothing", () => {
    for (const label of PICKERS) {
      openPicker(label);
      expect(entries().length, label).toBeGreaterThan(0);
      cleanup();
    }
  });

  it("gives every IDLE entry a ground and an ink of its own", () => {
    // The whole defect in one assertion: an entry that names no colour is an
    // entry that disappears when the cascade is half-applied.
    for (const label of PICKERS) {
      openPicker(label);
      for (const entry of entries()) {
        const where = `${label} / ${entry.getAttribute("data-option") ?? "?"}`;
        if (entry.getAttribute("aria-pressed") === "true") continue;
        const { ground, ink } = declaredColours(entry);
        expect(ground, `${where} declares no background`).not.toHaveLength(0);
        expect(ink, `${where} declares no foreground`).not.toHaveLength(0);
      }
      cleanup();
    }
  });

  it("gives every idle entry a HOVER pair, so the pointer changes both colours", () => {
    for (const label of PICKERS) {
      openPicker(label);
      for (const entry of entries()) {
        if (entry.getAttribute("aria-pressed") === "true") continue;
        const where = `${label} / ${entry.getAttribute("data-option") ?? "?"}`;
        const hover = variantColours(entry, "hover:");
        expect(hover.ground, `${where} has no hover background`).not.toHaveLength(0);
        expect(hover.ink, `${where} has no hover foreground`).not.toHaveLength(0);
      }
      cleanup();
    }
  });

  it("gives every entry a focus-visible ring", () => {
    // The element grid had none, so a keyboard user could not see where they
    // stood among thirteen identical cells.
    for (const label of PICKERS) {
      openPicker(label);
      for (const entry of entries()) {
        expect(
          hasFocusRing(entry),
          `${label} / ${entry.getAttribute("data-option") ?? "?"}`,
        ).toBe(true);
      }
      cleanup();
    }
  });

  it("paints the SELECTED entry with its own pair and marks it pressed", () => {
    openPicker("Chain options");
    const six = document.querySelector<HTMLElement>('[data-option="chain-6"]')!;
    expect(six.getAttribute("aria-pressed")).toBe("true");
    const { ground, ink } = declaredColours(six);
    expect(ground).toContain("bg-primary");
    expect(ink).toContain("text-primary-foreground");

    // And it is a DIFFERENT pair from the idle one, or "selected" would not be
    // visible at all.
    const eight = document.querySelector<HTMLElement>('[data-option="chain-8"]')!;
    expect(eight.getAttribute("aria-pressed")).toBe("false");
    expect(declaredColours(eight).ground).not.toEqual(ground);
    expect(declaredColours(eight).ink).not.toEqual(ink);
  });

  it("moves the selection when another entry is clicked", () => {
    // Guards the click path against the disabled guard added beside it.
    openPicker("Chain options");
    act(() => {
      fireEvent.click(document.querySelector('[data-option="chain-8"]')!);
    });
    expect(editorStore.getState().toolOptions.chainLength).toBe(8);

    // The popover closes on a choice by design, so the entry has to be looked
    // at again on a second opening rather than in place.
    const trigger = document.querySelector<HTMLElement>('[aria-label="Chain options"]')!;
    act(() => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
    });
    expect(
      document.querySelector('[data-option="chain-8"]')!.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      document.querySelector('[data-option="chain-6"]')!.getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("paints a DISABLED entry as unavailable, refuses its click, and does not also paint it selected", () => {
    // Rendered directly because every option command is `enabled: always`
    // today, so no popover in the shipped rail can reach this branch. `active`
    // is passed as well: disabled has to win, or an armed-but-unavailable
    // option would invite the click that does nothing.
    const onSelect = vi.fn();
    render(
      <OptionButton active disabled label="6 atoms" testId="chain-6" onSelect={onSelect}>
        <span className="font-mono">6</span>
      </OptionButton>,
    );
    const entry = screen.getByRole("button", { name: "6 atoms" });
    expect(entry).toBeDisabled();

    const { ground, ink } = declaredColours(entry);
    expect(ground).toContain("bg-muted");
    expect(ink).toContain("text-muted-foreground");
    expect(ground).not.toContain("bg-primary");
    expect(ink).not.toContain("text-primary-foreground");
    expect(entry.getAttribute("class")).toContain("cursor-not-allowed");

    // No hover pair: an entry that lights up and then refuses the click is
    // worse than one that never lights up.
    expect(variantColours(entry, "hover:").ground).toHaveLength(0);

    fireEvent.click(entry);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("names every element button for a screen reader, not just for the eye", () => {
    // Measured before this change: thirteen buttons, zero title attributes and
    // zero aria-labels, so the accessible name of each was a bare symbol.
    openPicker("Element options");
    for (const symbol of COMMON_ORGANIC_ELEMENTS) {
      const expected = `${elementBySymbol(symbol)?.name ?? symbol} (${symbol})`;
      const button = screen.getByRole("button", { name: expected });
      expect(button.getAttribute("data-element"), symbol).toBe(symbol);
      expect(button.getAttribute("title"), symbol).toBe(expected);
      // The SYMBOL stays on screen — the name is for the tooltip and the
      // screen reader, not a replacement for the glyph.
      expect(button.textContent, symbol).toBe(symbol);
    }
  });

  it("shows every chain length, each number inside an entry that states its own ink", () => {
    // "The chain-length numbers do not show" was the degraded half of the
    // report: the numbers inherited their colour and had nothing to fall back
    // on. Each number is still a child of its entry, and the entry now names
    // the ink the number inherits.
    openPicker("Chain options");
    for (const n of CHAIN_LENGTHS) {
      const entry = document.querySelector<HTMLElement>(`[data-option="chain-${String(n)}"]`);
      expect(entry, String(n)).not.toBeNull();
      expect(entry!.textContent, String(n)).toBe(String(n));
      expect(declaredColours(entry!).ink, String(n)).not.toHaveLength(0);
      expect(entry!.getAttribute("aria-label"), String(n)).toBe(`${String(n)} atoms`);
    }
  });
});

describe("the rail says what each tool is armed with", () => {
  it("shows the armed CHAIN LENGTH, like the ring template and the element", () => {
    // The chain tool was the only option-carrying tool whose rail button did
    // not say what it would draw: 12 and 2 looked identical.
    renderRail();
    expect(toolButton("chain").textContent).toContain("6");
    act(() => {
      editorStore.getState().setToolOption("chainLength", 12);
    });
    expect(toolButton("chain").textContent).toContain("12");
  });

  it("keeps the chain ICON as well as the number", () => {
    // A bare "12" beside a hexagon reads as a ring size, so the glyph is the
    // icon plus the count rather than the count alone.
    renderRail();
    expect(toolButton("chain").querySelector("svg")).not.toBeNull();
    expect(toolButton("chain").textContent).toContain("Chain");
  });
});
