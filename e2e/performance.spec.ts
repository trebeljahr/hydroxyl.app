import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The 60fps budget, in a REAL BROWSER.
 *
 * The acceptance criterion for the editing machine is that dragging one atom
 * of a 300-heavy-atom structure holds 60fps, and it is a real question because
 * the machine commits to the store on EVERY pointer-move rather than holding a
 * preview: each frame mints a new molecule, a new document, a new scene and a
 * new scene index, and chem-core's caches — WeakMaps keyed on the Molecule
 * instance — miss on all of them. That is the price of the valence badges and
 * the status bar staying live mid-drag.
 *
 * `packages/client/src/editor/interaction/drag-performance.test.tsx` measures
 * the two halves that node can see: the model path, and a React re-render
 * under jsdom. WHAT NEITHER CAN SEE IS LAYOUT AND PAINT, which at roughly 670
 * SVG nodes is the half most likely to blow the budget — so this spec exists,
 * it runs against the same structure from the same builder, and the number it
 * prints is reproducible from the repository rather than quoted from a
 * hand-swapped fixture that no longer exists.
 *
 * MEASURED AS DELIVERED FRAME INTERVALS, not as scripting time. A `rAF` loop
 * installed in the page records the gap between successive frames while the
 * driver moves the pointer; if the main thread stalls, or style, layout and
 * paint overrun, the gap grows. That is exactly the quantity the criterion is
 * about, and it needs no profiler.
 *
 * THE ASSERTION IS 55FPS, NOT 60, AND THE MEAN IS PRINTED EITHER WAY. The
 * browser will not deliver more than its display rate, an occasional frame is
 * lost to GC or to the test runner itself, and a spec that failed the build on
 * a single dropped frame would be noise. 55 still fails long before a
 * regression that halves the frame rate — the thing worth catching — and the
 * printed number is what a person reads when they want to know the real
 * figure. A drag that produced almost no frames is rejected outright, since a
 * high mean over a handful of samples means nothing.
 */

/** What the criterion is quoted at. `?atoms=` is honoured by the editor page. */
const HEAVY_ATOMS = 300;

/** Frames per second the run must average over. See the header. */
const MIN_FPS = 55;

/** Below this many samples the mean is not a measurement. */
const MIN_FRAMES = 30;

const CANVAS = "[data-canvas-root]";

interface FrameStats {
  readonly frames: number;
  readonly meanMs: number;
  readonly p95Ms: number;
  readonly worstMs: number;
}

/** Starts a rAF sampler in the page. Resolves when the recorder is armed. */
async function startSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __frameGaps?: number[]; __sampling?: boolean };
    w.__frameGaps = [];
    w.__sampling = true;
    let previous = performance.now();
    const tick = (now: number): void => {
      if (!w.__sampling) return;
      w.__frameGaps?.push(now - previous);
      previous = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopSampling(page: Page): Promise<FrameStats> {
  return page.evaluate(() => {
    const w = window as unknown as { __frameGaps?: number[]; __sampling?: boolean };
    w.__sampling = false;
    // The first gap spans from "sampler installed" to "first frame", which is
    // idle time rather than work, so it is dropped.
    const gaps = (w.__frameGaps ?? []).slice(1);
    if (gaps.length === 0) return { frames: 0, meanMs: 0, p95Ms: 0, worstMs: 0 };
    const sorted = [...gaps].sort((a, b) => a - b);
    const total = gaps.reduce((sum, gap) => sum + gap, 0);
    return {
      frames: gaps.length,
      meanMs: total / gaps.length,
      p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
      worstMs: sorted[sorted.length - 1] ?? 0,
    };
  });
}

test("dragging one atom of a 300-heavy-atom structure holds 60fps", async ({
  page,
}) => {
  test.slow();

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto(`/editor?fixture=stress&atoms=${HEAVY_ATOMS}`);
  // The fixture arrives from a mount effect, so waiting on the atom count is
  // what waits for the molecule — and it also proves the query-string
  // affordance actually loaded the big structure rather than benzene.
  await expect(page.locator(`${CANVAS} [data-atom-id]`)).toHaveCount(HEAVY_ATOMS);

  // An atom in the middle of the ladder, whose neighbourhood is dense: the
  // easy case is an end atom, and this is not it.
  const target = await page.evaluate(() => {
    const marks = Array.from(document.querySelectorAll("[data-atom-id]"));
    const middle = marks[Math.floor(marks.length / 2)];
    if (!middle) return null;
    const box = middle.getBoundingClientRect();
    return {
      id: middle.getAttribute("data-atom-id"),
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };
  });
  expect(target).not.toBeNull();
  if (target === null) return;

  // Selecting it first is what makes the drag a MOVE rather than a draw —
  // moving is the gesture the criterion names, and it is also the expensive
  // one, since every frame rewrites a position and re-derives the whole scene.
  await page.mouse.click(target.x, target.y);
  await expect(page.locator('[data-overlay="selected-atom"]')).toHaveCount(1);

  // THE SWEEP HAPPENS IN EMPTY CANVAS, BELOW THE LADDER. Not for speed — the
  // per-frame work is identical — but because the ladder is dense, and a drag
  // that wanders back through it drops the atom on a neighbour and merges,
  // which is correct behaviour and a structural change this spec is not here
  // to make. `canvas.height * 0.35` clears the fitted structure, which sits in
  // a thin horizontal band, while staying inside the viewport.
  const canvas = await page.locator(CANVAS).boundingBox();
  expect(canvas).not.toBeNull();
  if (canvas === null) return;
  const restY = Math.min(target.y + canvas.height * 0.35, canvas.y + canvas.height - 20);
  const leftX = Math.max(target.x - 80, canvas.x + 20);
  const rightX = Math.min(target.x + 80, canvas.x + canvas.width - 20);

  // A warm-up leg, discarded: the first frames of any gesture pay for JIT
  // warm-up and the first scene rebuild, which is not what "sustains" means.
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(leftX, restY, { steps: 20 });

  await startSampling(page);
  // A long sweep in small steps: 180 pointer-moves, each of which commits.
  for (let i = 0; i < 3; i += 1) {
    await page.mouse.move(rightX, restY, { steps: 30 });
    await page.mouse.move(leftX, restY, { steps: 30 });
  }
  const stats = await stopSampling(page);
  await page.mouse.up();

  const fps = stats.meanMs > 0 ? 1000 / stats.meanMs : 0;
  console.log(
    `drag at ${HEAVY_ATOMS} heavy atoms: ${fps.toFixed(1)} fps mean over ` +
      `${stats.frames} frames (mean ${stats.meanMs.toFixed(2)} ms, ` +
      `p95 ${stats.p95Ms.toFixed(2)} ms, worst ${stats.worstMs.toFixed(2)} ms)`,
  );

  expect(stats.frames).toBeGreaterThanOrEqual(MIN_FRAMES);
  expect(fps).toBeGreaterThanOrEqual(MIN_FPS);

  // The drag has to have actually done something, or the frame rate is the
  // frame rate of a still picture: the atom moved, and nothing was minted.
  await expect(page.locator("[data-atom-id]")).toHaveCount(HEAVY_ATOMS);
  const moved = await page.evaluate((id: string) => {
    const mark = document.querySelector(`[data-atom-id="${id}"]`);
    if (!mark) return null;
    const box = mark.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, target.id ?? "");
  expect(moved).not.toBeNull();
  if (moved === null) return;
  expect(Math.hypot(moved.x - target.x, moved.y - target.y)).toBeGreaterThan(20);

  expect(errors).toEqual([]);
});
