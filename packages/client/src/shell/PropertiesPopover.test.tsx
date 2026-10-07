/**
 * The properties popover (decision 235): the masses at full length, and the
 * descriptors asked of RDKit only once it opens.
 *
 * The bridge is mocked: the wasm runs in the `rdkit` project's
 * `descriptors.node.test.ts`, and what this file asserts is the popover's
 * side of the contract — lazy, never blocking, never a zero for a refusal.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildMolecule } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { fixtureDocument } from "@/canvas";
import { editorStore } from "@/state";

import { StatusBar } from "./StatusBar";

const computeDescriptors = vi.fn();

vi.mock("@/lib/rdkit", () => ({
  computeDescriptors: (...args: unknown[]) => computeDescriptors(...args) as unknown,
}));

const DOC = fixtureDocument("2024-01-01T00:00:00.000Z");

beforeEach(() => {
  computeDescriptors.mockReset();
  computeDescriptors.mockResolvedValue({
    ok: true,
    value: { tpsa: 0, clogp: 1.6866, hbd: 0, hba: 0 },
    report: {},
  });
  editorStore.getState().openDocument(DOC);
  editorStore.getState().clearSelection();
});

function property(name: string): string {
  const node = document.querySelector(`[data-property="${name}"]`);
  if (node === null) throw new Error(`no [data-property="${name}"]`);
  return node.textContent ?? "";
}

function openPopover(): void {
  fireEvent.click(document.querySelector('[data-status="formula"]')!);
}

describe("PropertiesPopover", () => {
  it("asks RDKit nothing until it opens", async () => {
    render(<StatusBar />);
    expect(computeDescriptors).not.toHaveBeenCalled();

    openPopover();
    expect(await screen.findByText("1.69")).toBeTruthy();
    expect(computeDescriptors).toHaveBeenCalledTimes(1);
    expect(property("tpsa")).toBe("0.00 Å²");
    expect(property("hba")).toBe("0");
    expect(property("exact-mass")).toBe("78.0470");
  });

  it("says Unavailable, with the reason, when RDKit refuses", async () => {
    computeDescriptors.mockResolvedValue({
      ok: false,
      error: { kind: "worker-unavailable", message: "The RDKit worker could not be started.", notes: [] },
    });
    // A molecule of its own: descriptors are cached per molecule, and the
    // fixture's already holds the first test's answer.
    const methanol = buildMolecule((b) => {
      b.bond(b.atom("C", { x: 0, y: 0 }), b.atom("O", { x: 1, y: 0 }), 1);
    });
    act(() => {
      editorStore
        .getState()
        .openDocument(createDocument({ molecule: methanol, now: DOC.metadata.createdAt }));
    });
    render(<StatusBar />);
    openPopover();
    expect(await screen.findByText("The RDKit worker could not be started.")).toBeTruthy();
    expect(property("clogp")).toBe("Unavailable");
  });

  it("asks again after a transient failure instead of caching it", async () => {
    const ethane = buildMolecule((b) => {
      b.bond(b.atom("C", { x: 0, y: 0 }), b.atom("C", { x: 1, y: 0 }), 1);
    });
    act(() => {
      editorStore
        .getState()
        .openDocument(createDocument({ molecule: ethane, now: DOC.metadata.createdAt }));
    });
    computeDescriptors.mockResolvedValueOnce({
      ok: false,
      error: { kind: "timeout", message: "RDKit did not answer.", notes: [] },
    });
    render(<StatusBar />);
    openPopover();
    expect(await screen.findByText("RDKit did not answer.")).toBeTruthy();
    openPopover(); // closes
    openPopover(); // and opens again
    expect(await screen.findByText("1.69")).toBeTruthy();
    expect(computeDescriptors).toHaveBeenCalledTimes(2);
  });

  it("refuses a sum over several compounds instead of computing one", async () => {
    const twoCompounds = buildMolecule((b) => {
      b.atom("C", { x: 0, y: 0 });
      b.atom("O", { x: 5, y: 0 });
    });
    act(() => {
      editorStore
        .getState()
        .openDocument(createDocument({ molecule: twoCompounds, now: DOC.metadata.createdAt }));
    });
    render(<StatusBar />);
    openPopover();
    expect(await screen.findByText(/2 separate compounds/)).toBeTruthy();
    expect(computeDescriptors).not.toHaveBeenCalled();
  });

  it("states a missing exact mass as unavailable, naming the element", () => {
    const exotic = buildMolecule((b) => {
      b.atom("Tc", { x: 0, y: 0 });
    });
    act(() => {
      editorStore
        .getState()
        .openDocument(createDocument({ molecule: exotic, now: DOC.metadata.createdAt }));
    });
    render(<StatusBar />);
    openPopover();
    expect(property("exact-mass")).toBe("Unavailable");
    const marker = document.querySelector('[data-property="exact-mass"] [data-unavailable]');
    expect(marker?.getAttribute("title") ?? "").toContain("Tc");
  });

  it("measures the selection, and says so", async () => {
    const [first] = editorStore.getState().document.molecule.atomIds;
    act(() => {
      editorStore.getState().selectAtoms([first!]);
    });
    render(<StatusBar />);
    openPopover();
    expect(await screen.findByText("Selection, 1 atom")).toBeTruthy();
    expect(property("formula")).toBe("CH");
  });
});
