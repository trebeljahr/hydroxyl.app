/**
 * The 3D panel's wiring: it asks for a conformer only after the drawing has
 * been still for the debounce, it reports an empty drawing and a refusal in
 * words, and it never writes to the document. The worker and WebGL are
 * stubbed; the conformer itself is tested in `embed.node.test.ts`.
 */

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { benzene, emptyMolecule } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { editorStore } from "@/state";

const requestConformer = vi.fn();

vi.mock("@/lib/conformer", () => ({
  requestConformer: (molblock: string) => requestConformer(molblock),
  disposeConformerWorker: vi.fn(),
}));

vi.mock("@/lib/three-d/viewer", () => ({
  MoleculeViewer: class {
    setStructure(): void {}
    setMode(): void {}
    aspect(): number {
      return 1;
    }
    dispose(): void {}
  },
}));

import { REFRESH_DELAY_MS, ThreeDPanel } from "./ThreeDPanel";

beforeEach(() => {
  vi.useFakeTimers();
  requestConformer.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

function show(molecule: Molecule): void {
  act(() => {
    editorStore.getState().openDocument(createDocument({ molecule }));
  });
}

function status(): string {
  return document.querySelector('[data-shell="three-d-status"]')?.textContent ?? "";
}

describe("ThreeDPanel", () => {
  it("asks for nothing and says so when the drawing is empty", () => {
    show(emptyMolecule());
    render(<ThreeDPanel />);
    act(() => vi.advanceTimersByTime(REFRESH_DELAY_MS * 2));
    expect(requestConformer).not.toHaveBeenCalled();
    expect(status()).toBe("Draw a structure to see it in 3D.");
  });

  it("waits for the debounce, then sends the drawing as a molblock", async () => {
    requestConformer.mockResolvedValue({
      ok: true,
      atoms: new Array(12).fill({ element: "C", x: 0, y: 0, z: 0 }),
      bonds: [],
      energy: 16.2,
      attempts: 1,
    });
    show(benzene());
    const before = editorStore.getState().document;
    render(<ThreeDPanel />);
    expect(status()).toBe("Computing the 3D geometry…");
    act(() => vi.advanceTimersByTime(REFRESH_DELAY_MS - 1));
    expect(requestConformer).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(requestConformer).toHaveBeenCalledTimes(1);
    expect(requestConformer.mock.calls[0]?.[0]).toMatch(/V2000/);
    expect(status()).toBe("MMFF94s+ geometry, 12 atoms with hydrogens.");
    // Derived, never stored: the document is the same object it was.
    expect(editorStore.getState().document).toBe(before);
  });

  it("shows the worker's refusal as an alert", async () => {
    requestConformer.mockResolvedValue({
      ok: false,
      reason: "stereo",
      message: "No 3D geometry kept the drawn stereochemistry after 5 attempts, so none is shown.",
    });
    show(benzene());
    render(<ThreeDPanel />);
    await act(async () => {
      vi.advanceTimersByTime(REFRESH_DELAY_MS);
      await Promise.resolve();
    });
    // querySelector rather than getByRole: role queries walk the whole
    // accessibility tree, which is slow enough in jsdom to time out a test.
    expect(document.querySelector('[role="alert"]')).toHaveTextContent(/kept the drawn stereochemistry/);
  });
});
