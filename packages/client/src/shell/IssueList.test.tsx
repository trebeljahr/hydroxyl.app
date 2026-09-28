/**
 * The issue list: every row is a place, and a fix is one click.
 *
 * Driven through the status bar's own counter, because that is how a user
 * reaches it — the counter is the only way in — and asserted on the store as
 * well as the DOM, since "clicking the row takes me to the atom" is a claim
 * about the selection and the viewport, not about a class name.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { buildMolecule, vec } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import { modelToPx } from "@starter/chem-render";
import { createDocument } from "@starter/shared";

import { buildCanvasScene } from "@/canvas/scene-bridge";
import { editorStore } from "@/state";

import { StatusBar } from "./StatusBar";

const NOW = "2024-01-01T00:00:00.000Z";

/** Ethane beside a tetramethylammonium drawn without its charge, and a
 *  correctly drawn allene: one error with a fix, one warning without. */
function molecule(): Molecule {
  return buildMolecule((b) => {
    b.bond(b.atom("C", vec(-4, 0)), b.atom("C", vec(-3, 0)), 1);
    const n = b.atom("N", vec(5, 3));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      b.bond(n, b.atom("C", vec(5 + dx, 3 + dy)), 1);
    }
    const c1 = b.atom("C", vec(0, -4));
    const c2 = b.atom("C", vec(1, -4));
    const c3 = b.atom("C", vec(2, -4));
    const c4 = b.atom("C", vec(3, -4));
    const c5 = b.atom("C", vec(4, -4));
    b.bond(c1, c2, 1);
    b.bond(c2, c3, 2);
    b.bond(c3, c4, 2);
    b.bond(c4, c5, 1);
  });
}

function nitrogenOf(mol: Molecule): string {
  return mol.atomIds.find((id) => mol.atoms[id]!.element === "N")!;
}

beforeEach(() => {
  const state = editorStore.getState();
  state.openDocument(createDocument({ molecule: molecule(), now: NOW }));
  state.clearSelection();
  state.setStatusMessage(null);
  state.setViewportSize({ width: 800, height: 600 });
  state.resetViewport();
});

function openList(): HTMLElement {
  fireEvent.click(document.querySelector('[data-status="issues"]')!);
  return document.querySelector('[data-shell="issue-list"]') as HTMLElement;
}

describe("IssueStatus", () => {
  it("counts the error in red and the warning in amber, both opening the list", () => {
    render(<StatusBar />);
    const errors = document.querySelector('[data-status="issues"]')!;
    expect(errors.tagName).toBe("BUTTON");
    expect(errors.textContent).toBe("1 chemistry error");
    expect(errors.className).toContain("text-destructive");
    const warnings = document.querySelector('[data-status="structure-warnings"]')!;
    expect(warnings.textContent).toBe("1 feature not expressible");

    fireEvent.click(warnings);
    expect(document.querySelector('[data-shell="issue-list"]')).not.toBeNull();
  });

  it("lists the error under its heading and the warning under its own", () => {
    render(<StatusBar />);
    const list = openList();
    const rows = [...list.querySelectorAll("[data-issue-row]")];
    expect(rows.map((row) => row.getAttribute("data-issue-severity"))).toEqual([
      "error",
      "warning",
    ]);
    const mol = editorStore.getState().document.molecule;
    expect(rows[0]!.getAttribute("data-issue-target")).toBe(nitrogenOf(mol));
    expect(rows[0]!.textContent).toContain("N · atom 3");
    expect(rows[0]!.textContent).toContain("N has 4 bonds but allows at most 3");
    expect(screen.getByText("Chemistry errors")).toBeInTheDocument();
    expect(screen.getByText("Not expressible in this build")).toBeInTheDocument();
    // The allene has nothing to fix, so its row offers nothing.
    expect(rows[1]!.querySelector("[data-issue-fix]")).toBeNull();
  });

  it("takes the user to the atom: selected, and centred in the view", () => {
    render(<StatusBar />);
    const list = openList();
    const zoom = editorStore.getState().viewport.zoom;

    act(() => {
      fireEvent.click(list.querySelector("[data-issue-row] [data-issue-locate]")!);
    });

    const state = editorStore.getState();
    const nitrogen = nitrogenOf(state.document.molecule);
    expect(state.selection.atomIds).toEqual([nitrogen]);
    const style = buildCanvasScene(state.document, null).style;
    const centre = modelToPx(style, state.document.molecule.atoms[nitrogen]!.pos);
    expect(state.viewport.pan).toEqual(centre);
    expect(state.viewport.zoom).toBe(zoom);
  });

  it("fixes the error in one click, and the counter says so", () => {
    render(<StatusBar />);
    const list = openList();
    const fix = list.querySelector('[data-issue-fix="set-charge"]')!;
    expect(fix.textContent).toBe("Make it N⁺");

    act(() => {
      fireEvent.click(fix);
    });

    expect(document.querySelector('[data-status="issues"]')!.textContent).toBe(
      "0 chemistry errors",
    );
    const state = editorStore.getState();
    expect(state.document.molecule.atoms[nitrogenOf(state.document.molecule)]!.charge).toBe(1);
    expect(state.history.past.at(-1)?.label).toBe("Make it N⁺");
    // The warning is still there to be found: fixing an error removes that
    // error and nothing else.
    expect(document.querySelector('[data-status="structure-warnings"]')).not.toBeNull();
  });

  it("does not reopen by itself when a new issue arrives after the list emptied", () => {
    // The open flag used to outlive the last fix, so the next issue — a
    // refused "Clean up" — opened the list over the canvas unasked.
    const ammoniumOnly = (): Molecule =>
      buildMolecule((b) => {
        const n = b.atom("N", vec(0, 0));
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          b.bond(n, b.atom("C", vec(dx, dy)), 1);
        }
      });
    act(() => {
      editorStore.getState().openDocument(createDocument({ molecule: ammoniumOnly(), now: NOW }));
    });
    render(<StatusBar />);
    const list = openList();
    act(() => {
      fireEvent.click(list.querySelector('[data-issue-fix="set-charge"]')!);
    });
    expect(document.querySelector('[data-shell="issue-list"]')).toBeNull();

    act(() => {
      editorStore.getState().openDocument(createDocument({ molecule: ammoniumOnly(), now: NOW }));
    });
    expect(document.querySelector('[data-status="issues"]')!.textContent).toBe("1 chemistry error");
    expect(document.querySelector('[data-shell="issue-list"]')).toBeNull();
  });

  it("is plain text reading zero when there is nothing to list", () => {
    act(() => {
      editorStore
        .getState()
        .openDocument(
          createDocument({
            molecule: buildMolecule((b) => {
              b.bond(b.atom("C", vec(0, 0)), b.atom("O", vec(1, 0)), 1);
            }),
            now: NOW,
          }),
        );
    });
    render(<StatusBar />);
    const counter = document.querySelector('[data-status="issues"]')!;
    expect(counter.tagName).toBe("SPAN");
    expect(counter.textContent).toBe("0 chemistry errors");
  });
});
