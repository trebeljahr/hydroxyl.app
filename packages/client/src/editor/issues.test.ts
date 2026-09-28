/**
 * Going to an issue and fixing it, through the store.
 *
 * The chemistry of which fixes exist is chem-core's and tested there. What is
 * tested here is the routing: that "go to" selects the atom the overlay rings
 * and puts it where the view is looking, that a fix is ONE undoable edit, that
 * a fix computed for an older molecule is refused rather than applied by stale
 * id, and that a toolkit's refusal joins the list in the same shape.
 */

import { describe, expect, it } from "vitest";

import { buildMolecule, netCharge, removeAtom, vec } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import { modelToPx } from "@starter/chem-render";
import { createDocument } from "@starter/shared";

import { buildCanvasScene } from "@/canvas/scene-bridge";
import { createEditorStore } from "@/state";
import type { EditorStore } from "@/state";

import { applyFix, editorIssues, fixesFor, issueAtomName, locateIssue } from "./issues";

const NOW = "2024-01-01T00:00:00.000Z";

function storeWith(molecule: Molecule): EditorStore {
  return createEditorStore({
    document: createDocument({ molecule, now: NOW }),
    viewportSize: { width: 800, height: 600 },
    now: () => NOW,
  });
}

/** Ethane, then tetramethylammonium drawn without its charge, off to one side
 *  so that centring on the nitrogen has somewhere to move to. */
function withUnchargedAmmonium(): Molecule {
  return buildMolecule((b) => {
    b.bond(b.atom("C", vec(-4, 0)), b.atom("C", vec(-3, 0)), 1);
    const n = b.atom("N", vec(5, 3));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      b.bond(n, b.atom("C", vec(5 + dx, 3 + dy)), 1);
    }
  });
}

/** Atoms and bonds draw ids from one counter, so the nitrogen is a4: after
 *  the two ethane carbons and the bond between them. */
const NITROGEN = "a4";

describe("editorIssues", () => {
  it("adds one refusal row per named atom the molecule still has", () => {
    const mol = withUnchargedAmmonium();
    const issues = editorIssues(mol, {
      source: "Clean up",
      atomIds: [NITROGEN, "a1", "a999"],
      message: "Explicit valence for atom # 2 N, 4, is greater than permitted",
    });
    expect(issues.map((issue) => issue.kind)).toEqual([
      "over-valent",
      "toolkit-refusal",
      "toolkit-refusal",
    ]);
    const refusal = issues[1]!;
    expect(refusal.atomId).toBe(NITROGEN);
    expect(refusal.severity).toBe("error");
    expect(refusal.label).toBe("Clean up stopped here");
    expect(refusal.message).toContain("Clean up stopped at this N");
    expect(refusal.message).toContain("Explicit valence");
    expect(fixesFor(mol, refusal)).toEqual([]);
  });

  it("is chem-core's list, by reference, when nothing was refused", () => {
    const mol = withUnchargedAmmonium();
    expect(editorIssues(mol, null)).toBe(editorIssues(mol, null));
  });
});

describe("locateIssue", () => {
  it("selects the anchor atom and centres the view on where the overlay rings it", () => {
    const store = storeWith(withUnchargedAmmonium());
    const [issue] = editorIssues(store.getState().document.molecule, null);
    expect(issue!.atomId).toBe(NITROGEN);
    const zoom = store.getState().viewport.zoom;

    locateIssue(store, issue!);

    const state = store.getState();
    expect(state.selection.atomIds).toEqual([NITROGEN]);
    const style = buildCanvasScene(state.document, state.ui.activePanelId).style;
    const expected = modelToPx(style, state.document.molecule.atoms[NITROGEN]!.pos);
    expect(state.viewport.pan.x).toBeCloseTo(expected.x, 9);
    expect(state.viewport.pan.y).toBeCloseTo(expected.y, 9);
    // Going to an atom does not rescale the drawing under the reader.
    expect(state.viewport.zoom).toBe(zoom);
  });

  it("does nothing for an atom that is gone", () => {
    const store = storeWith(withUnchargedAmmonium());
    const [issue] = editorIssues(store.getState().document.molecule, null);
    store.getState().applyMoleculeEdit("Erase", (mol) => removeAtom(mol, NITROGEN));
    const pan = store.getState().viewport.pan;
    locateIssue(store, issue!);
    expect(store.getState().selection.atomIds).toEqual([]);
    expect(store.getState().viewport.pan).toBe(pan);
  });
});

describe("applyFix", () => {
  it("applies chem-core's fix as ONE undoable edit named after it", () => {
    const store = storeWith(withUnchargedAmmonium());
    const before = store.getState().document.molecule;
    const [issue] = editorIssues(before, null);
    const [fix] = fixesFor(before, issue!);
    expect(fix!.title).toBe("Make it N⁺");
    const entries = store.getState().history.past.length;

    applyFix(store, issue!, fix!);

    const state = store.getState();
    expect(editorIssues(state.document.molecule, null)).toEqual([]);
    expect(netCharge(state.document.molecule)).toBe(1);
    expect(state.history.past.length).toBe(entries + 1);
    expect(state.history.past.at(-1)?.label).toBe("Make it N⁺");
    expect(state.selection.atomIds).toEqual([NITROGEN]);
    expect(state.ui.statusMessage).toBe(
      `Make it N⁺ (${issueAtomName(before, NITROGEN)}). Undo puts it back.`,
    );

    state.undo();
    expect(store.getState().document.molecule).toBe(before);
  });

  it("refuses a fix the current molecule no longer has, rather than edit by stale id", () => {
    const store = storeWith(withUnchargedAmmonium());
    const before = store.getState().document.molecule;
    const [issue] = editorIssues(before, null);
    const [fix] = fixesFor(before, issue!);
    // The charge is drawn by hand while the list is open.
    store
      .getState()
      .applyMoleculeEdit("Charge", (mol) => ({
        ...mol,
        atoms: { ...mol.atoms, [NITROGEN]: { ...mol.atoms[NITROGEN]!, charge: 1 } },
      }));
    const drawn = store.getState().document.molecule;
    const entries = store.getState().history.past.length;

    applyFix(store, issue!, fix!);

    expect(store.getState().document.molecule).toBe(drawn);
    expect(store.getState().history.past.length).toBe(entries);
    expect(store.getState().ui.statusMessage).toContain("no longer applies");
  });
});

describe("issueAtomName", () => {
  it("names the element and the document position", () => {
    const mol = withUnchargedAmmonium();
    expect(issueAtomName(mol, NITROGEN)).toBe("N · atom 3");
  });
});
