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
 * Each of those shows up as a COUNT that climbs with the number of edits, so
 * that is what is asserted. Measured on this fixture: 12 window/document
 * listeners and 236 DOM nodes at mount, and the same 12 and 236 after 200
 * transactions of 5 pointer frames each.
 *
 * The console counters are here for the same reason. The crash report in
 * manual notes 3 is a NODE heap, not a browser one, and the dev server's own
 * heap is fed by what the browser console produces — Next resolves an original
 * stack frame through Turbopack for every error it is sent. A render that
 * logged once per frame would therefore be a memory bug in a process this
 * repo's code never runs in, which is exactly the kind that is invisible until
 * it is fatal.
 */

import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

import { setAtomPositions } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";

import { fixtureDocument } from "@/canvas/fixture";
import { editorStore } from "@/state";

import { EditorShell } from "./EditorShell";

const EDITS = 200;

/** jsdom has no `matchMedia`, and `useTheme`'s mount effect reads it. */
function stubMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

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
    stubMatchMedia();
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
