/**
 * The one failure this design cannot survive: a transaction that is opened and
 * never closed.
 *
 * Every gesture that edits opens a store transaction on its first frame and
 * closes it on release, so undo sees one entry for a whole drag. An `edit`
 * closure calls chem-core, chem-core throws on geometry it cannot honour, and
 * `applyMoleculeEdit` rethrows by design — so without a net the throw escapes
 * the pointer handler between the begin and the commit, and the store stays
 * inside a transaction FOR THE REST OF THE SESSION. Nothing reports it: undo
 * and redo simply stop working and every later edit records against a stale
 * base.
 *
 * The reducer's own stale-transaction guard cannot recover that, which is the
 * subtle half. It only fires on the next `dragStart`, and only when the machine
 * is still holding a committing state — but the click paths (a ring template, a
 * bond click) have already returned it to `idle` by the time the command batch
 * runs, and `gestureBase(idle)` is null. So the net has to be at the point of
 * performance, which is `performBatch`.
 *
 * This file drives the module singleton the adapter writes to, because that is
 * the store whose transaction would leak.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { benzene } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { editorStore } from "@/state";
import { guardedOps } from "@/state/chem-guard";

import { performBatch } from "./adapter";
import type { InteractionCommand } from "./facts";

const BOOM = "chem-core refused this geometry";

beforeEach(() => {
  editorStore.getState().abortTransaction();
  editorStore
    .getState()
    .openDocument(
      createDocument({ molecule: benzene(), title: "Probe", stylePreset: "screen" }),
      "Open probe",
    );
  editorStore.getState().setStatusMessage(null);
  // The catch reports through console.error on purpose — silenced so a
  // deliberate failure does not read as a broken test run.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const throwingEdit: InteractionCommand = {
  kind: "edit",
  label: "Add ring",
  edit: () => {
    throw new Error(BOOM);
  },
};

describe("performBatch", () => {
  it("closes the transaction a throwing edit would have left open", () => {
    const ok = performBatch([
      { kind: "beginTransaction", label: "Add ring" },
      throwingEdit,
      { kind: "commitTransaction" },
    ]);

    expect(ok).toBe(false);
    expect(editorStore.getState().history.transaction).toBeNull();
  });

  it("leaves undo working afterwards", () => {
    // The symptom that made this worth a net: with the transaction leaked,
    // every later edit records under the stale base and `canUndo` never
    // becomes true again.
    performBatch([
      { kind: "beginTransaction", label: "Add ring" },
      throwingEdit,
      { kind: "commitTransaction" },
    ]);

    const first = editorStore.getState().document.molecule.atomIds[0]!;
    performBatch([
      { kind: "beginTransaction", label: "Erase" },
      {
        kind: "edit",
        label: "Erase",
        edit: (m) => guardedOps.removeAtoms(m, [first]),
      },
      { kind: "commitTransaction" },
    ]);

    expect(editorStore.getState().canUndo()).toBe(true);
    expect(editorStore.getState().undo()).toBe(true);
    expect(editorStore.getState().document.molecule.atomIds).toHaveLength(6);
  });

  it("rolls the document back to where the gesture started", () => {
    const before = editorStore.getState().document;
    const first = before.molecule.atomIds[0]!;

    performBatch([
      { kind: "beginTransaction", label: "Add ring" },
      {
        kind: "edit",
        label: "Add ring",
        edit: (m) => guardedOps.removeAtoms(m, [first]),
      },
      throwingEdit,
      { kind: "commitTransaction" },
    ]);

    // `abortTransaction` restores the base VERBATIM, so the half-applied
    // deletion is gone by object identity rather than by equality.
    expect(editorStore.getState().document).toBe(before);
  });

  it("surfaces chem-core's own words on the status bar", () => {
    performBatch([{ kind: "beginTransaction", label: "Add ring" }, throwingEdit]);
    expect(editorStore.getState().ui.statusMessage).toBe(BOOM);
  });

  it("falls back to a generic message for a non-Error throw", () => {
    performBatch([
      { kind: "beginTransaction", label: "Add ring" },
      {
        kind: "edit",
        label: "Add ring",
        edit: () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw "not an Error";
        },
      },
    ]);
    expect(editorStore.getState().ui.statusMessage).toBe(
      "That edit could not be applied",
    );
  });

  it("performs a batch that does not throw, and says so", () => {
    const first = editorStore.getState().document.molecule.atomIds[0]!;
    const ok = performBatch([
      { kind: "beginTransaction", label: "Erase" },
      {
        kind: "edit",
        label: "Erase",
        edit: (m) => guardedOps.removeAtoms(m, [first]),
      },
      { kind: "commitTransaction" },
    ]);

    expect(ok).toBe(true);
    expect(editorStore.getState().document.molecule.atomIds).toHaveLength(5);
    expect(editorStore.getState().history.transaction).toBeNull();
  });
});
