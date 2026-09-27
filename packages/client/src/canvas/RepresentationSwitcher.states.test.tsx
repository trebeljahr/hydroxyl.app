/**
 * THE STRIP'S VISUAL STATES: what is unavailable must not look like what is
 * merely not a drawing.
 *
 * WHY THIS FILE EXISTS. Measured on the shipped static export, the "(b) Sum
 * formula" panel button painted rgb(115,115,115) in light mode — the very same
 * grey as the genuinely disabled locants label in the view-options popover —
 * although that button is fully clickable and nothing refuses it. One grey did
 * two jobs, so the whole strip read as all-disabled-except-the-selected-one.
 * These tests pin the two jobs apart, and pin every state to declaring both of
 * its colours rather than inheriting one.
 *
 * jsdom runs no cascade, so no contrast ratio is claimed here; the real computed
 * colours are measured in Chromium, in e2e/shell.spec.ts.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { benzene } from "@starter/chem-core";
import { representationAvailability } from "@starter/chem-render";
import { DEFAULT_PANELS, createDocument, createPanel } from "@starter/shared";
import type { Panel } from "@starter/shared";

import { editorStore } from "@/state";

import {
  declaredColours,
  hasFocusRing,
  variantColours,
} from "../../test/picker-colours";
import { RepresentationSwitcher } from "./RepresentationSwitcher";

/**
 * A CONDENSED panel over benzene: the one panel in this document that is
 * genuinely unavailable, because a ring has no condensed formula. Its
 * availability is read from chem-render here rather than assumed, so the test
 * fails loudly if that ever stops being a blocked case instead of quietly
 * asserting the "blocked" branch against a panel that is fine.
 */
const condensed: Panel = createPanel("condensed");

beforeEach(() => {
  act(() => {
    editorStore.getState().openDocument(
      createDocument({
        molecule: benzene(),
        panels: [...DEFAULT_PANELS, condensed],
        now: "2024-01-01T00:00:00.000Z",
      }),
    );
  });
});

function panelButton(id: string): HTMLElement {
  const node = document.querySelector(`[data-switcher-panel="${id}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`no panel button for ${id}`);
  return node;
}

function openViewOptions(): void {
  const trigger = screen.getByText("View options");
  act(() => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
  });
}

function label(flag: string): HTMLLabelElement {
  const box = document.querySelector<HTMLInputElement>(`[data-view-flag="${flag}"]`);
  expect(box, flag).not.toBeNull();
  return box!.closest("label")!;
}

describe("the panel strip's states", () => {
  it("is set up with one genuinely unavailable panel", () => {
    // The premise of every assertion below.
    const verdict = representationAvailability(benzene(), "condensed");
    expect(verdict.available).toBe(false);
    if (!verdict.available) expect(verdict.reason).toBe("cyclic");
  });

  it("gives every panel button a ground, an ink and a focus ring", () => {
    render(<RepresentationSwitcher />);
    for (const panel of editorStore.getState().document.panels) {
      const button = panelButton(panel.id);
      const { ground, ink } = declaredColours(button);
      expect(ground, panel.id).not.toHaveLength(0);
      expect(ink, panel.id).not.toHaveLength(0);
      expect(hasFocusRing(button), panel.id).toBe(true);
    }
  });

  it("does NOT paint a usable text panel in the disabled grey", () => {
    // The deterministic half of the report: a sum-formula panel is clickable
    // and its click does something, so it paints at full contrast.
    render(<RepresentationSwitcher />);
    const sumFormula = panelButton("panel-sum-formula");
    expect(sumFormula.getAttribute("aria-pressed")).toBe("false");
    expect(sumFormula).toBeEnabled();
    expect(declaredColours(sumFormula).ink).toContain("text-foreground");
    expect(declaredColours(sumFormula).ink).not.toContain("text-muted-foreground");
    expect(sumFormula.getAttribute("class")).not.toContain("line-through");
    // And it still changes colour under the pointer, both parts of it.
    const hover = variantColours(sumFormula, "hover:");
    expect(hover.ground).not.toHaveLength(0);
    expect(hover.ink).not.toHaveLength(0);
  });

  it("keeps the unavailable panel visibly unavailable, and DIFFERENT from a usable one", () => {
    render(<RepresentationSwitcher />);
    const blocked = panelButton(condensed.id);
    const usable = panelButton("panel-sum-formula");

    expect(declaredColours(blocked).ink).toContain("text-muted-foreground");
    expect(blocked.getAttribute("class")).toContain("line-through");
    const verdict = representationAvailability(benzene(), "condensed");
    if (verdict.available) throw new Error("condensed benzene should be unavailable");
    expect(blocked.getAttribute("title")).toBe(verdict.message);

    // The assertion the bug would fail: one grey no longer means both things.
    expect(declaredColours(blocked).ink).not.toEqual(declaredColours(usable).ink);
  });

  it("does not hold the unavailable panel's muted ink across its own hover", () => {
    // The button is deliberately NOT `disabled` — the next test pins that its
    // click is how the refusal is read — so WCAG 1.4.3's exemption for inactive
    // controls never reached it, and `text-muted-foreground` on `bg-accent` is
    // 4.349:1 in light mode: under the floor e2e/shell.spec.ts enforces, at
    // exactly the moment the pointer is on the button to read the message.
    // Only Chromium can say what these classes resolve to; what jsdom can say
    // is that the hover no longer re-states the muted ink, and that it pairs an
    // ink with the ground that ink is painted on.
    render(<RepresentationSwitcher />);
    const blocked = panelButton(condensed.id);
    const hover = variantColours(blocked, "hover:");
    expect(hover.ground).toContain("bg-accent");
    expect(hover.ink).toContain("text-accent-foreground");
    expect(hover.ink).not.toContain("text-muted-foreground");
    // And "unavailable" is still said, by the two signals that are not a colour
    // and so were never the contrast floor's to take away.
    expect(blocked.getAttribute("class")).toContain("line-through");
    expect(blocked.getAttribute("title")).not.toBeNull();
  });

  it("leaves the unavailable panel CLICKABLE — its click is how the refusal is read", () => {
    render(<RepresentationSwitcher />);
    const blocked = panelButton(condensed.id);
    expect(blocked).toBeEnabled();
    act(() => {
      fireEvent.click(blocked);
    });
    expect(editorStore.getState().ui.activePanelId).toBe(condensed.id);
    // The canvas keeps a drawing it can make, and the strip says why.
    expect(document.querySelector('[data-shell="switcher-notice"]')?.textContent ?? "")
      .not.toBe("");
  });

  it("paints the panel on the canvas with a pair of its own", () => {
    render(<RepresentationSwitcher />);
    const pressed = [...document.querySelectorAll<HTMLElement>("[data-switcher-panel]")].filter(
      (node) => node.getAttribute("aria-pressed") === "true",
    );
    expect(pressed).toHaveLength(1);
    const { ground, ink } = declaredColours(pressed[0]!);
    expect(ground).toContain("bg-accent");
    expect(ink).toContain("text-accent-foreground");
  });
});

describe("the view options' states", () => {
  it("states an ink for a LIVE label, not only for a disabled one", () => {
    // A live label used to carry no colour at all and was legible only by
    // inheriting from PopoverContent, while the disabled one was the single
    // label naming an ink — so a half-applied cascade left the greyed-out rows
    // as the readable ones.
    render(<RepresentationSwitcher />);
    openViewOptions();
    expect(declaredColours(label("aromaticCircles")).ink).toContain(
      "text-popover-foreground",
    );
  });

  it("gives EVERY label a ground of its own, not only an ink", () => {
    // Naming one half of a pair is naming neither. `text-popover-foreground` is
    // a promise about a ratio, and the ratio does not exist until the ground it
    // is measured against is on the same element — until then the label is
    // legible only by inheriting PopoverContent's background, which is the
    // dependency the panel buttons already had removed and these labels did
    // not. Asserted over every flag, live and refused alike, so a future key
    // cannot be added with an ink and no ground.
    render(<RepresentationSwitcher />);
    openViewOptions();
    for (const box of document.querySelectorAll("[data-view-flag]")) {
      const key = box.getAttribute("data-view-flag") ?? "?";
      const row = box.closest("label")!;
      const { ground, ink } = declaredColours(row);
      expect(ground, key).toContain("bg-popover");
      expect(ink, key).not.toHaveLength(0);
    }
  });

  it("gives EVERY label a hover pair too, the refused row included", () => {
    // "This row does not react" is a decision, and a decision left out of the
    // class list is not a decision — it is whatever the cascade does. So the
    // disabled branch states its hover colours and they are its resting ones:
    // the row must NOT move to `bg-accent`, because `--muted-foreground` there
    // is 4.349:1 in light mode, the same failure fixed on the blocked panel
    // button. The live row does move, and that difference is the affordance:
    // hovering the column shows which switches are actually yours without
    // either row going dim. The ratios themselves are measured in Chromium.
    render(<RepresentationSwitcher />);
    openViewOptions();

    const live = variantColours(label("aromaticCircles"), "hover:");
    expect(live.ground).toContain("bg-accent");
    expect(live.ink).toContain("text-accent-foreground");

    const refused = variantColours(label("showLocants"), "hover:");
    expect(refused.ground).toContain("bg-popover");
    expect(refused.ink).toContain("text-muted-foreground");
    // Not `bg-accent`: that pairing is the 4.349:1 one.
    expect(refused.ground).not.toContain("bg-accent");
    // And the two rows still behave differently under the pointer.
    expect(refused.ground).not.toEqual(live.ground);
  });

  it("keeps the genuinely disabled label in the muted ink, and the box unusable", () => {
    render(<RepresentationSwitcher />);
    openViewOptions();
    const locants = document.querySelector<HTMLInputElement>('[data-view-flag="showLocants"]')!;
    expect(locants.disabled).toBe(true);
    expect(declaredColours(label("showLocants")).ink).toContain("text-muted-foreground");
    // Which is a DIFFERENT ink from a live label's — the point of the change.
    expect(declaredColours(label("showLocants")).ink).not.toEqual(
      declaredColours(label("aromaticCircles")).ink,
    );
  });

  it("gives the checkboxes a focus-visible ring", () => {
    render(<RepresentationSwitcher />);
    openViewOptions();
    for (const box of document.querySelectorAll("[data-view-flag]")) {
      expect(hasFocusRing(box), box.getAttribute("data-view-flag") ?? "?").toBe(true);
    }
  });
});
