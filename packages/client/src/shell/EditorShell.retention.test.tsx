/**
 * WHAT THE MOUNTED SHELL IS ALLOWED TO ACCUMULATE.
 *
 * The other half of `src/state/editing-session.test.ts`. That file drives the
 * model with no React in sight; this one mounts the whole shell and drives the
 * same edits through it, because the retainers React makes easy are different
 * ones: a `window.addEventListener` registered in a render rather than in an
 * effect, a store subscription per render, a portal that is opened and never
 * closed, a live region that grows a node per announcement.
 *
 * Each of those shows up as a COUNT that climbs with the work done, so that is
 * what is asserted — as a DELTA against the count at mount, never as an
 * absolute, which depends on the jsdom version and on what testing-library
 * registers of its own.
 *
 * THE WORK IS DONE TWICE, IN TWO SHAPES, because edits and renders do not
 * reach the same code. Driving 200 transactions re-renders whatever subscribes
 * to the document — the canvas and the status bar — and leaves every other
 * render body untouched: `TopBar` selects a title and an id that do not change
 * all session, and `EditorShell` selects nothing at all. A `window.addEvent-
 * Listener` in either one is registered once, at mount, and lands in the
 * baseline rather than in the growth. Measured: that mutation in `TopBar` left
 * this test green. So the tree is also re-rendered on its own afterwards, 50
 * times, which is what makes every render body in the shell observable.
 *
 * The console counters are here for a related reason, and the reason is a
 * SUSPICION rather than a measurement — said plainly because the rest of this
 * file is measured. The crash report in manual notes 3 is a NODE heap, not a
 * browser one, and `next dev` resolves reported errors back to original source
 * through the bundler; a render that logged once per frame could therefore be
 * a memory bug in a process this repo's code never runs in. Nobody has
 * profiled `next dev` to confirm that. The counters are worth their line
 * regardless: a render body that logs per frame is a defect in the browser
 * too.
 */

import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

import { setAtomPositions } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";

import { fixtureDocument } from "@/canvas/fixture";
import { editorStore } from "@/state";

import { EditorShell } from "./EditorShell";

const EDITS = 200;
/** Enough re-renders that one listener per render is unmissable, and cheap:
 *  the fixture is six atoms. */
const RERENDERS = 50;

/** Net window+document listeners registered since the counter was installed.
 *  Negative after an unmount that removes listeners added before it. */
type ListenerArgs = [
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | AddEventListenerOptions,
];

function countGlobalListeners(): () => number {
  let added = 0;
  let removed = 0;
  for (const target of [window, document] as const) {
    // Both methods are overloaded, so `Parameters<>` resolves to one
    // signature's tuple and a spread of it does not typecheck. The tuple above
    // is the widest of the overloads and is all a counting wrapper needs.
    const add = target.addEventListener.bind(target) as (...args: ListenerArgs) => void;
    const remove = target.removeEventListener.bind(target) as (...args: ListenerArgs) => void;
    vi.spyOn(target, "addEventListener").mockImplementation(((...args: ListenerArgs) => {
      added += 1;
      add(...args);
    }) as typeof target.addEventListener);
    vi.spyOn(target, "removeEventListener").mockImplementation(((...args: ListenerArgs) => {
      removed += 1;
      remove(...args);
    }) as typeof target.removeEventListener);
  }
  return () => added - removed;
}

function drive(edits: number): void {
  const state = () => editorStore.getState();
  for (let i = 1; i <= edits; i += 1) {
    act(() => {
      state().beginTransaction(`Move ${i}`);
      for (let f = 0; f < 5; f += 1) {
        const id = state().document.molecule.atomIds[0]!;
        state().applyMoleculeEdit("Move", (m: Molecule) =>
          setAtomPositions(m, [[id, { x: (i % 7) + f * 0.01, y: (i % 5) + f * 0.01 }]]),
        );
      }
      state().commitTransaction();
      if (i % 3 === 0) state().undo();
      if (i % 7 === 0) state().redo();
      if (i % 11 === 0) state().setStylePreset(i % 22 === 0 ? "publication" : "screen");
    });
  }
}

describe("the mounted shell", () => {
  it("registers no listeners, nodes or console output per edit", () => {
    // NO `matchMedia` STUB, deliberately. jsdom has none, and `useTheme`'s
    // mount effect used to read it unguarded — so mounting the shell threw
    // before it rendered anything, which is why no unit test had ever mounted
    // it. Removing the stub is what keeps that guard honest.
    const errors: unknown[] = [];
    const warnings: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      errors.push(a[0]);
    });
    vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
      warnings.push(a[0]);
    });

    act(() => {
      editorStore.getState().loadDocument(fixtureDocument("2024-01-01T00:00:00.000Z"));
    });

    const live = countGlobalListeners();
    const view = render(<EditorShell />);
    const listenersAtMount = live();
    const nodesAtMount = document.querySelectorAll("*").length;

    drive(EDITS);

    expect(live()).toBe(listenersAtMount);

    // DRIVING EDITS ONLY COVERS WHAT RE-RENDERS PER EDIT, which is the canvas
    // and the status bar. `TopBar`'s selectors return the same title and id all
    // session and `EditorShell` subscribes to nothing, so a listener in either
    // render body would be registered once, at mount, and counted into the
    // baseline — invisible. Re-rendering the whole tree is what makes the
    // render bodies of components the edits do not touch observable, and it is
    // what a parent state change does in the running app anyway.
    const beforeRerenders = live();
    const nodesBeforeRerenders = document.querySelectorAll("*").length;
    for (let i = 0; i < RERENDERS; i += 1) {
      act(() => {
        view.rerender(<EditorShell />);
      });
    }
    expect(live()).toBe(beforeRerenders);
    expect(document.querySelectorAll("*").length).toBe(nodesBeforeRerenders);
    // Within one node of the mount count: the status bar's text changes as the
    // document does, and a React text node can be split or merged. What is
    // ruled out is growth proportional to the edits.
    expect(Math.abs(document.querySelectorAll("*").length - nodesAtMount)).toBeLessThanOrEqual(4);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);

    view.unmount();
    // Everything the shell registered is gone; the residue is negative because
    // testing-library's own container listeners predate the counter.
    expect(live()).toBeLessThanOrEqual(0);
  });
});
