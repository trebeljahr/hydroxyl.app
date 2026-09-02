import { describe, expect, it } from "vitest";

import {
  abortTransaction,
  beginTransaction,
  canRedo,
  canUndo,
  commitTransaction,
  createHistory,
  DEFAULT_HISTORY_LIMIT,
  type History,
  record,
  redo,
  redoLabel,
  undo,
  undoLabel,
} from "./history";

/**
 * Stands in for the real `UndoableState`. A plain object compared by reference
 * mirrors how the store will use this: chem-core values are immutable, so
 * `Object.is` is a complete equality test for them.
 */
interface State {
  readonly x: number;
}

const same = (a: State, b: State): boolean => Object.is(a, b);
const byValue = (a: State, b: State): boolean => a.x === b.x;

function s(x: number): State {
  return { x };
}

describe("createHistory", () => {
  it("starts empty with the default limit", () => {
    const h = createHistory<State>();
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
    expect(h.transaction).toBeNull();
    expect(h.limit).toBe(DEFAULT_HISTORY_LIMIT);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(undoLabel(h)).toBeUndefined();
    expect(redoLabel(h)).toBeUndefined();
  });

  it("refuses a limit below one", () => {
    expect(createHistory<State>(0).limit).toBe(1);
    expect(createHistory<State>(-5).limit).toBe(1);
    expect(createHistory<State>(Number.NaN).limit).toBe(DEFAULT_HISTORY_LIMIT);
  });
});

describe("record", () => {
  it("pushes the BEFORE state so an undo returns to it", () => {
    const before = s(1);
    const after = s(2);
    const h = record(createHistory<State>(), "Add atom", before, after, same);
    expect(h.past).toHaveLength(1);
    expect(h.past[0]?.state).toBe(before);
    expect(undoLabel(h)).toBe("Add atom");
    expect(canUndo(h)).toBe(true);
  });

  it("records nothing for a no-op edit", () => {
    const value = s(1);
    const h = createHistory<State>();
    expect(record(h, "Set carbon", value, value, same)).toBe(h);
    // Value equality is the caller's call, and it must be honoured too.
    expect(record(h, "Set carbon", s(1), s(1), byValue)).toBe(h);
  });

  it("clears the redo branch", () => {
    let h = record(createHistory<State>(), "First", s(1), s(2), same);
    const undone = undo(h, s(2));
    expect(undone).not.toBeNull();
    h = undone!.history;
    expect(canRedo(h)).toBe(true);

    h = record(h, "Divergent", s(1), s(9), same);
    expect(canRedo(h)).toBe(false);
    expect(h.future).toEqual([]);
  });

  it("drops the oldest entry once the cap is reached", () => {
    let h = createHistory<State>(3);
    for (let i = 0; i < 10; i++) {
      h = record(h, `Step ${i}`, s(i), s(i + 1), same);
    }
    expect(h.past).toHaveLength(3);
    expect(h.past.map((e) => e.label)).toEqual(["Step 7", "Step 8", "Step 9"]);
    expect(h.past[0]?.state.x).toBe(7);
  });
});

describe("undo / redo", () => {
  it("returns null when there is nothing to do", () => {
    const h = createHistory<State>();
    expect(undo(h, s(0))).toBeNull();
    expect(redo(h, s(0))).toBeNull();
  });

  it("round trips undo -> redo -> undo", () => {
    const a = s(1);
    const b = s(2);
    const h0 = record(createHistory<State>(), "Edit", a, b, same);

    const undone = undo(h0, b);
    expect(undone?.state).toBe(a);
    expect(undoLabel(h0)).toBe("Edit");
    expect(redoLabel(undone!.history)).toBe("Edit");

    const redone = redo(undone!.history, a);
    expect(redone?.state).toBe(b);
    expect(canRedo(redone!.history)).toBe(false);
    expect(canUndo(redone!.history)).toBe(true);

    const again = undo(redone!.history, b);
    expect(again?.state).toBe(a);
  });

  it("walks a multi-step stack back and forward", () => {
    const states = [s(0), s(1), s(2), s(3)];
    let h: History<State> = createHistory<State>();
    for (let i = 1; i < states.length; i++) {
      h = record(h, `Step ${i}`, states[i - 1]!, states[i]!, same);
    }

    let current = states[3]!;
    for (let i = 2; i >= 0; i--) {
      const step = undo(h, current);
      expect(step).not.toBeNull();
      h = step!.history;
      current = step!.state;
      expect(current).toBe(states[i]);
    }
    expect(canUndo(h)).toBe(false);

    for (let i = 1; i < states.length; i++) {
      const step = redo(h, current);
      expect(step).not.toBeNull();
      h = step!.history;
      current = step!.state;
      expect(current).toBe(states[i]);
    }
    expect(canRedo(h)).toBe(false);
  });
});

describe("transactions", () => {
  it("collapses 30 recorded steps into one entry that fully reverts", () => {
    const origin = s(0);
    let h = beginTransaction(createHistory<State>(), "Move atom", origin);

    // The drag: one recorded step per pointer-move frame.
    let current = origin;
    for (let frame = 1; frame <= 30; frame++) {
      const next = s(frame);
      h = record(h, "Move atom", current, next, same);
      current = next;
    }
    expect(h.past).toHaveLength(0);
    expect(canUndo(h)).toBe(false);

    h = commitTransaction(h, current, same);
    expect(h.transaction).toBeNull();
    expect(h.past).toHaveLength(1);

    const undone = undo(h, current);
    expect(undone?.state).toBe(origin);
    expect(canUndo(undone!.history)).toBe(false);
  });

  it("produces 30 entries without a transaction, proving the collapse", () => {
    let h = createHistory<State>();
    let current = s(0);
    for (let frame = 1; frame <= 30; frame++) {
      const next = s(frame);
      h = record(h, "Move atom", current, next, same);
      current = next;
    }
    expect(h.past).toHaveLength(30);
  });

  it("is not undoable while in flight", () => {
    let h = record(createHistory<State>(), "Earlier", s(0), s(1), same);
    expect(canUndo(h)).toBe(true);

    h = beginTransaction(h, "Move atom", s(1));
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(undoLabel(h)).toBeUndefined();
    expect(undo(h, s(1))).toBeNull();
    expect(redo(h, s(1))).toBeNull();

    h = commitTransaction(h, s(2), same);
    expect(canUndo(h)).toBe(true);
  });

  it("keeps the outermost base and label when nested", () => {
    const outerBase = s(0);
    let h = beginTransaction(createHistory<State>(), "Draw ring", outerBase);
    h = beginTransaction(h, "Add bond", s(1));
    h = beginTransaction(h, "Add atom", s(2));
    expect(h.transaction?.depth).toBe(3);
    expect(h.transaction?.label).toBe("Draw ring");
    expect(h.transaction?.base).toBe(outerBase);

    h = commitTransaction(h, s(3), same);
    expect(h.transaction?.depth).toBe(2);
    expect(h.past).toHaveLength(0);

    h = commitTransaction(h, s(4), same);
    expect(h.transaction?.depth).toBe(1);
    expect(h.past).toHaveLength(0);

    h = commitTransaction(h, s(5), same);
    expect(h.transaction).toBeNull();
    expect(h.past).toHaveLength(1);
    expect(h.past[0]?.label).toBe("Draw ring");
    expect(h.past[0]?.state).toBe(outerBase);
  });

  it("records nothing when the transaction changed nothing", () => {
    const base = s(0);
    let h = beginTransaction(createHistory<State>(), "Move atom", base);
    h = record(h, "Move atom", base, base, same);
    h = commitTransaction(h, base, same);
    expect(h.transaction).toBeNull();
    expect(h.past).toHaveLength(0);
    expect(canUndo(h)).toBe(false);
  });

  it("leaves 'did it move?' entirely to the caller's predicate", () => {
    // A drag out and back: the value returned equals the base, but it is a
    // different object — which is what chem-core produces, since every frame
    // mints a new molecule. Under the store's reference-identity predicate
    // that is a step; under a by-value one it is not. The module takes no
    // position, and the store's choice is documented on `commitTransaction`.
    const base = s(0);
    const roundTripped = s(0);

    let byRef = beginTransaction(createHistory<State>(), "Move atom", base);
    byRef = commitTransaction(byRef, roundTripped, same);
    expect(byRef.past).toHaveLength(1);

    let byVal = beginTransaction(createHistory<State>(), "Move atom", base);
    byVal = commitTransaction(byVal, roundTripped, byValue);
    expect(byVal.past).toHaveLength(0);
  });

  it("clears the redo branch when a transaction actually commits", () => {
    let h = record(createHistory<State>(), "First", s(1), s(2), same);
    h = undo(h, s(2))!.history;
    expect(canRedo(h)).toBe(true);

    h = beginTransaction(h, "Move atom", s(1));
    h = commitTransaction(h, s(7), same);
    expect(h.future).toEqual([]);
  });

  it("aborts every nesting level and hands back the outermost base", () => {
    const base = s(0);
    let h = beginTransaction(createHistory<State>(), "Draw chain", base);
    h = beginTransaction(h, "Add atom", s(1));
    h = record(h, "Add atom", s(1), s(2), same);

    const aborted = abortTransaction(h);
    expect(aborted.state).toBe(base);
    expect(aborted.history.transaction).toBeNull();
    expect(aborted.history.past).toHaveLength(0);
    expect(canUndo(aborted.history)).toBe(false);
  });

  it("reports null state when aborting with nothing in flight", () => {
    const h = createHistory<State>();
    const aborted = abortTransaction(h);
    expect(aborted.state).toBeNull();
    expect(aborted.history).toBe(h);
  });

  it("ignores a commit with nothing in flight", () => {
    const h = createHistory<State>();
    expect(commitTransaction(h, s(1), same)).toBe(h);
  });

  it("respects the cap when committing", () => {
    let h = createHistory<State>(2);
    for (let i = 0; i < 5; i++) {
      h = beginTransaction(h, `Gesture ${i}`, s(i));
      h = commitTransaction(h, s(i + 1), same);
    }
    expect(h.past).toHaveLength(2);
    expect(h.past.map((e) => e.label)).toEqual(["Gesture 3", "Gesture 4"]);
  });
});
