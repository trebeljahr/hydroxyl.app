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

import { performBatch, resetGestureFailureLog } from "./adapter";
import type { InteractionCommand } from "./facts";

const BOOM = "chem-core refused this geometry";

beforeEach(() => {
  vi.useFakeTimers();
  resetGestureFailureLog();
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
  vi.useRealTimers();
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

/**
 * A REFUSED GESTURE REFUSES ONCE PER POINTER FRAME, and a batch runs per
 * pointer event. Unbounded logging of an unchanging failure is a console
 * nobody can read. (It is ALSO suspected to feed the dev server's heap,
 * because `next dev` resolves reported errors back through the bundler — but
 * nobody has measured that, so it is not what these tests are for. See
 * `reportGestureFailure`.)
 */
describe("repeated gesture failures", () => {
  it("logs the first, then only powers of two, and always a new message", () => {
    const logged = vi.mocked(console.error);
    logged.mockClear();

    for (let i = 0; i < 60; i += 1) {
      performBatch([{ kind: "beginTransaction", label: "Add ring" }, throwingEdit]);
    }

    // Occurrences 1, 2, 4, 8, 16, 32 of sixty identical refusals.
    expect(logged.mock.calls).toHaveLength(6);
    // Every one of them still reached the person, in full.
    expect(editorStore.getState().ui.statusMessage).toBe(BOOM);

    const other: InteractionCommand = {
      kind: "edit",
      label: "Add ring",
      edit: () => {
        throw new Error("a different refusal");
      },
    };
    performBatch([{ kind: "beginTransaction", label: "Add ring" }, other]);
    expect(logged.mock.calls).toHaveLength(7);
  });

  // THE FIGURE THE COMMENT BESIDE THE CODE GETS WRONG IF NOBODY PINS IT. A
  // held drag refuses every frame, so consecutive occurrences are ~16 ms apart
  // and NEVER cross FAILURE_BURST_MS: ten seconds of refusal is one burst of
  // ~600, not ten bursts of sixty. The bound is therefore logarithmic in the
  // pointer rate — floor(log2 600) + 1 = 10 lines — and not, as an earlier
  // draft of that comment claimed, a per-second cost set by the clock.
  it("bounds a ten-second refused drag at ten lines, as one burst", () => {
    const logged = vi.mocked(console.error);
    logged.mockClear();

    const FRAMES = 600;
    for (let i = 0; i < FRAMES; i += 1) {
      // A 60 fps pointer stream, advanced through the same fake clock
      // `reportGestureFailure` reads with `Date.now()`.
      vi.setSystemTime(new Date(Date.now() + 16));
      performBatch([{ kind: "beginTransaction", label: "Add ring" }, throwingEdit]);
    }

    // 1, 2, 4, 8, 16, 32, 64, 128, 256, 512 — the powers of two up to 600.
    expect(logged.mock.calls).toHaveLength(10);
    expect(logged.mock.calls.at(-1)?.[0]).toBe(
      "Editing gesture failed and was rolled back (512 times in a row)",
    );
    // And the person saw every single one of them.
    expect(editorStore.getState().ui.statusMessage).toBe(BOOM);
  });

  // A RUN THAT NEVER RESET WOULD LIE IN THE TEXT. The counter used to be
  // per-session, so two refusals a minute apart read "(2 times in a row)" —
  // and the run it carried was what silenced the case below.
  it("starts a new run when the same refusal comes back much later", () => {
    const logged = vi.mocked(console.error);
    logged.mockClear();

    performBatch([{ kind: "beginTransaction", label: "Add ring" }, throwingEdit]);
    vi.setSystemTime(new Date(Date.now() + 60_000));
    performBatch([{ kind: "beginTransaction", label: "Add ring" }, throwingEdit]);

    expect(logged.mock.calls.map((call) => call[0])).toEqual([
      "Editing gesture failed and was rolled back",
      "Editing gesture failed and was rolled back",
    ]);
  });

  // THE CASE THE SUPPRESSION MUST NOT SWALLOW. After a 40-frame drag the
  // per-session counter sat at 40, so an isolated refusal an hour later was
  // occurrence 41 — not a power of two — and produced no output at all. One
  // refusal on its own is the one worth reading.
  it("logs an isolated refusal that follows a long refused drag", () => {
    const logged = vi.mocked(console.error);
    for (let i = 0; i < 40; i += 1) {
      performBatch([{ kind: "beginTransaction", label: "Add ring" }, throwingEdit]);
    }
    logged.mockClear();

    vi.setSystemTime(new Date(Date.now() + 3_600_000));
    performBatch([{ kind: "beginTransaction", label: "Add ring" }, throwingEdit]);

    expect(logged.mock.calls).toHaveLength(1);
  });
});
