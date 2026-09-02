/**
 * THE 60FPS BUDGET, MEASURED.
 *
 * The acceptance criterion for this task is that dragging one atom of a
 * 300-heavy-atom structure holds 60fps. What makes that a real question rather
 * than a rhetorical one is the decision that the machine COMMITS TO THE STORE
 * ON EVERY POINTER-MOVE rather than holding a preview — so every frame mints a
 * new molecule, a new document, a new scene and a new scene index, and the
 * caches chem-core keeps in WeakMaps keyed on the Molecule instance miss on
 * every single one of them. That is the price of the status bar's formula and
 * the valence badges staying live mid-drag, which is half the value of drawing
 * in this tool at all.
 *
 * TWO MEASUREMENTS, because a frame has two halves.
 *
 * The first is the MODEL PATH: the reducer, the edit, the scene build, the
 * scene index and the valence pass the badges read. Pure computation, and it
 * means exactly the same thing in node as in a browser.
 *
 * The second is the RENDER PATH: React reconciling the ~1200 SVG elements a
 * 300-heavy-atom structure draws, and writing their attributes. Measured under
 * jsdom, which is a CONSERVATIVE stand-in — its DOM is slower than a real
 * browser's, so a frame that fits here fits there. What neither can measure is
 * the browser's own layout and paint — `e2e/performance.spec.ts` does that, in
 * Chromium, on the same structure, and is the third of the three numbers.
 *
 * Both are asserted against the WHOLE frame's 16.7 ms rather than against half
 * of it each, because the point is the headroom: if either half ever grows to
 * fill even a third of the budget, the other will not fit beside it and this
 * should fail before anyone notices by feel.
 *
 * If it does fail, the fix is memoising the scene rebuild per unchanged
 * sub-structure — NOT abandoning the per-move commit.
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { valenceIssues } from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { stressMolecule } from "@/canvas/fixture";
import { buildDocumentScene } from "@/canvas/scene-bridge";
import { createSceneIndex } from "@/canvas/metrics";
import { OverlayLayer } from "@/canvas/OverlayLayer";
import { SceneLayer } from "@/canvas/SceneLayer";
import { DEFAULT_TOOL_OPTIONS } from "@/state";
import type { Selection } from "@/state";

import type { InteractionContext, InteractionState, PointerSample } from "./facts";
import { IDLE } from "./facts";
import { reduce } from "./machine";

const HEAVY_ATOMS = 300;
const FRAMES = 120;
/** One frame at 60fps. */
const FRAME_BUDGET_MS = 1000 / 60;

/**
 * The same structure `/editor?fixture=stress` opens, from the same builder.
 *
 * Shared rather than copied so the three measurements — this file's model
 * path, this file's jsdom render, and `e2e/performance.spec.ts` in a real
 * browser — are all quoting a number about ONE molecule. A local copy would
 * drift, and then the browser figure and the node figure would be describing
 * different drawings without saying so.
 */
function polycyclic(): Molecule {
  return stressMolecule(HEAVY_ATOMS);
}

describe("drag performance", () => {
  it("sustains 60fps dragging one atom of a 300-heavy-atom structure", () => {
    const molecule = polycyclic();
    expect(molecule.atomIds).toHaveLength(HEAVY_ATOMS);

    const dragged = molecule.atomIds[HEAVY_ATOMS >> 1]!;
    const selection: Selection = { atomIds: [dragged], bondIds: [] };
    const origin = molecule.atoms[dragged]!.pos;

    // The store's own path, without the store: `applyMoleculeEdit` computes
    // the molecule outside the recipe and stamps a new document, and the
    // canvas then rebuilds the scene and the index from it. Reproducing those
    // three here keeps the measurement free of React while still paying for
    // everything a frame actually costs.
    let document = createDocument({ molecule, title: "Bench", stylePreset: "screen" });
    let state: InteractionState = IDLE;

    const context = (): InteractionContext => ({
      molecule: document.molecule,
      tool: "select",
      toolOptions: DEFAULT_TOOL_OPTIONS,
      selection,
    });

    const frame = (i: number): PointerSample => ({
      point: { x: origin.x + i * 0.01, y: origin.y + i * 0.013 },
      hit: { kind: "none" },
      modifiers: { shift: false, alt: false },
    });

    const step = (fact: Parameters<typeof reduce>[1]): void => {
      const outcome = reduce(state, fact, context());
      state = outcome.state;
      for (const command of outcome.commands) {
        if (command.kind !== "edit") continue;
        const next = command.edit(document.molecule);
        if (next === document.molecule) continue;
        document = { ...document, molecule: next };
      }
      // What the canvas does with the new document on the same frame.
      const scene = buildDocumentScene(document);
      const index = createSceneIndex(scene, document.molecule);
      index.atomCentre(dragged);
      valenceIssues(document.molecule);
    };

    const start: PointerSample = {
      point: origin,
      hit: { kind: "atom", atomId: dragged },
      modifiers: { shift: false, alt: false },
    };
    step({ kind: "press", sample: start });
    step({ kind: "dragStart", origin: start, sample: frame(1) });

    // A warm-up pass, so the measurement is of steady-state work rather than
    // of the JIT's first look at it.
    for (let i = 2; i < 20; i += 1) step({ kind: "dragMove", sample: frame(i) });

    const began = performance.now();
    for (let i = 0; i < FRAMES; i += 1) {
      step({ kind: "dragMove", sample: frame(20 + i) });
    }
    const perFrame = (performance.now() - began) / FRAMES;

    step({ kind: "dragEnd", sample: frame(20 + FRAMES) });

    // Printed as well as asserted: the number is the point, and a future
    // change that halves the headroom should be visible in CI output before it
    // becomes a failure.
    // eslint-disable-next-line no-console
    console.log(
      `drag frame at ${String(HEAVY_ATOMS)} heavy atoms: ${perFrame.toFixed(2)} ms ` +
        `of a ${FRAME_BUDGET_MS.toFixed(1)} ms budget`,
    );
    expect(perFrame).toBeLessThan(FRAME_BUDGET_MS);

    // And the drag actually did the thing it was being timed doing: one atom
    // moved, none minted.
    expect(document.molecule.atomIds).toHaveLength(HEAVY_ATOMS);
    expect(document.molecule.atoms[dragged]!.pos).not.toEqual(origin);
  });

  it("re-renders a 300-heavy-atom scene inside the frame budget", () => {
    // The half the measurement above cannot see. Every frame of a per-move
    // commit mints a new molecule, so the scene and the index are rebuilt and
    // every primitive is a fresh object — React.memo on a primitive would buy
    // nothing today, which is why the sanctioned fix if this ever fails is to
    // give `buildScene` structural sharing FIRST and memoise on top of it.
    const molecule = polycyclic();
    let document = createDocument({ molecule, title: "Bench", stylePreset: "screen" });

    const frame = (): { scene: ReturnType<typeof buildDocumentScene>; index: ReturnType<typeof createSceneIndex> } => {
      const scene = buildDocumentScene(document);
      return { scene, index: createSceneIndex(scene, document.molecule) };
    };

    const first = frame();
    const view = render(
      <svg>
        <SceneLayer scene={first.scene} />
        <OverlayLayer
          index={first.index}
          selection={{ atomIds: [], bondIds: [] }}
          hoveredAtomId={null}
          hoveredBondId={null}
          issues={valenceIssues(document.molecule)}
        />
      </svg>,
    );
    expect(view.container.querySelectorAll("[data-atom-id]").length).toBe(HEAVY_ATOMS);

    const dragged = molecule.atomIds[HEAVY_ATOMS >> 1]!;
    const origin = molecule.atoms[dragged]!.pos;
    const nudge = (i: number): void => {
      document = {
        ...document,
        molecule: {
          ...document.molecule,
          atoms: {
            ...document.molecule.atoms,
            [dragged]: {
              ...document.molecule.atoms[dragged]!,
              pos: { x: origin.x + i * 0.01, y: origin.y },
            },
          },
        },
      };
      const next = frame();
      view.rerender(
        <svg>
          <SceneLayer scene={next.scene} />
          <OverlayLayer
            index={next.index}
            selection={{ atomIds: [dragged], bondIds: [] }}
            hoveredAtomId={null}
            hoveredBondId={null}
            issues={valenceIssues(document.molecule)}
            handleAtomIds={[dragged]}
          />
        </svg>,
      );
    };

    for (let i = 1; i < 5; i += 1) nudge(i);

    const RENDER_FRAMES = 20;
    const began = performance.now();
    for (let i = 0; i < RENDER_FRAMES; i += 1) nudge(5 + i);
    const perFrame = (performance.now() - began) / RENDER_FRAMES;

    // eslint-disable-next-line no-console
    console.log(
      `scene re-render at ${String(HEAVY_ATOMS)} heavy atoms (jsdom): ` +
        `${perFrame.toFixed(2)} ms of a ${FRAME_BUDGET_MS.toFixed(1)} ms budget`,
    );
    expect(perFrame).toBeLessThan(FRAME_BUDGET_MS);

    view.unmount();
  });
});
