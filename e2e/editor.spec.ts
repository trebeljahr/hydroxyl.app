import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * /editor, driven through a real browser.
 *
 * THE FAILURE THIS FILE EXISTS TO CATCH IS A CANVAS THAT PAINTS NOTHING.
 *
 * Every other assertion here can pass against a blank rectangle: the DOM can
 * hold six lines and six circles, the store can hold a viewport, the overlay
 * can appear on click — and the user can still be looking at white. The ways
 * to get there are all quiet ones. A scene whose coordinates were scaled a
 * second time by `bondLengthPx` lands a hundred bond lengths off-screen. A
 * second y-flip mirrors the structure into the half of the plane the viewport
 * is not looking at. A `zoomToFit` handed model units instead of px picks a
 * zoom of 0.05 and draws benzene four pixels wide. None of those throw, none
 * of them log, and none of them change a single node count.
 *
 * So the assertions below are geometric wherever they can be. Not "an element
 * exists" but "its box has real width and height, it lies inside the canvas,
 * and the six bonds of the ring measure the same non-zero length on screen".
 * A snapshot would catch the same class of bug and would also fail every time
 * a colour changes; measuring the geometry states the invariant instead of
 * photographing it.
 *
 * Everything here is READ-ONLY on the molecule. This task's canvas hovers,
 * selects, pans and zooms and edits nothing, so the atom and bond counts are
 * invariant across every gesture in this file — several tests re-assert them
 * after acting for exactly that reason.
 */

/**
 * Benzene is C6H6: six ring carbons, six ring bonds.
 *
 * These are chemistry, not tuning knobs. /editor opens the benzene fixture;
 * chem-core keeps hydrogens implicit so they are never atoms and never drawn;
 * and today's renderer emits one line per bond whatever its order, so the
 * Kekule ring is six lines rather than nine. If these numbers ever need to
 * change, it is because the fixture molecule changed.
 */
const RING_CARBONS = 6;
const RING_BONDS = 6;

const CANVAS = "[data-canvas-root]";
const SCENE = '[data-canvas-root] [data-layer="scene"]';
const OVERLAY = '[data-canvas-root] [data-layer="overlay"]';
/** The single pan/zoom group: the only child of the canvas root. */
const VIEW_GROUP = "[data-canvas-root] > g";

/** Slack for comparing DOM boxes, which are rounded to device pixels. */
const BOX_SLACK_PX = 1;

/**
 * How far the anchored point may drift under a wheel zoom, in px.
 *
 * `zoomAt` solves for the pan exactly rather than nudging it, so the residual
 * is not the algorithm's — it is the browser's. `clientX`/`clientY` are
 * integers, so the wheel event's anchor is the driver's requested position
 * rounded to a whole pixel, and half a pixel of anchor error survives the
 * zoom as a fraction of a pixel of drift (about 0.5px in practice). 2px keeps
 * that from flaking while staying an order of magnitude under what an
 * unanchored zoom does, which is to slide the anchor by tens of px.
 */
const ANCHOR_TOLERANCE_PX = 2;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface BondSegment {
  readonly id: string;
  readonly a: Point;
  readonly b: Point;
}

interface AtomMark {
  readonly id: string;
  readonly centre: Point;
}

interface CanvasGeometry {
  readonly bonds: readonly BondSegment[];
  readonly atoms: readonly AtomMark[];
}

/**
 * The three components of the canvas transform, as numbers.
 *
 * EditorCanvas emits `translate(w/2, h/2) scale(zoom) translate(-pan)` and
 * that spelling is load-bearing — it is `toScreen` from state/viewport.ts
 * written forwards, which is what makes the picture and the hit test the same
 * map. Parsing it rather than reading the store is deliberate: a spec that
 * asked the page for its viewport would still pass if the transform stopped
 * being built from it.
 */
interface ViewTransform {
  readonly centre: Point;
  readonly zoom: number;
  /** The third translate, i.e. the NEGATED pan. */
  readonly translate: Point;
}

const TRANSFORM_PATTERN =
  /^translate\((-?[\d.]+), (-?[\d.]+)\) scale\((-?[\d.]+)\) translate\((-?[\d.]+), (-?[\d.]+)\)$/;

function parseViewTransform(value: string): ViewTransform {
  const match = TRANSFORM_PATTERN.exec(value.trim());
  if (match === null) {
    throw new Error(`Unrecognised canvas transform: ${JSON.stringify(value)}`);
  }
  const n = (index: number): number => Number(match[index]);
  return {
    centre: { x: n(1), y: n(2) },
    zoom: n(3),
    translate: { x: n(4), y: n(5) },
  };
}

/**
 * Every console error and every uncaught exception, from before `goto`.
 *
 * Attached before navigation because the interesting ones fire during mount,
 * and nothing fails on console output unless a test looks — which is what this
 * does. What it actually catches here is uncaught exceptions and genuine
 * `console.error` output while the page mounts and while the gestures run: a
 * throw out of a render, a null deref in a pointer handler, a failed asset.
 *
 * Two things it deliberately does NOT catch, so nobody trusts it for them.
 * `playwright.config.ts` serves a `next build` + `next start`, i.e. React's
 * PRODUCTION build, which strips the development key warning entirely — an
 * index-keyed layer would sail past this collector, and the unit tests are
 * where that is pinned. And Chrome's "Unable to preventDefault inside passive
 * event listener" is an intervention at warning level, filtered out by the
 * `type() !== "error"` guard below; the non-passive wheel listener has its own
 * dedicated test asserting `defaultPrevented` on a cancelable wheel event.
 */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    errors.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}

async function viewTransform(page: Page): Promise<string> {
  return (await page.locator(VIEW_GROUP).getAttribute("transform")) ?? "";
}

/**
 * Waits for the canvas to stop moving.
 *
 * The opening sequence is three commits deep — the gesture hook seeds the
 * viewport size, the page effect opens the fixture document, and only then
 * does the fit effect frame it — so the first transform a spec can read is
 * not the one the user ends up looking at. Polling for two identical readings
 * is the honest way to wait for the end of that chain; a fixed sleep would be
 * either flaky or slow, and there is no single DOM signal that says "fitted".
 */
async function settle(page: Page): Promise<void> {
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const current = await viewTransform(page);
        const stable = current !== "" && current === previous;
        previous = current;
        return stable;
      },
      { timeout: 10_000, intervals: [50, 100, 100, 200] },
    )
    .toBe(true);
}

async function openEditor(page: Page): Promise<void> {
  await page.goto("/editor");
  // The fixture arrives from a mount effect, so the first paint is an empty
  // document. Waiting on the atom count waits for the molecule itself.
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(
    RING_CARBONS,
  );
  await settle(page);
}

/**
 * Where the scene actually is on screen, in the same px `page.mouse` uses.
 *
 * Read through `getScreenCTM()` rather than `getBoundingClientRect()` because
 * a bounding box is the *stroked* box: for the two horizontal bonds of a
 * flat-bottomed hexagon it reports a height of one line width, and a spec
 * that measured bond length from it would be comparing a length against a
 * length-plus-stroke and would need a tolerance wide enough to hide a real
 * defect. The CTM gives the endpoints exactly.
 */
async function readGeometry(page: Page): Promise<CanvasGeometry> {
  return page.evaluate(() => {
    const toClient = (
      element: SVGGraphicsElement,
      x: number,
      y: number,
    ): { x: number; y: number } | null => {
      const ctm = element.getScreenCTM();
      if (ctm === null) return null;
      const mapped = new DOMPoint(x, y).matrixTransform(ctm);
      return { x: mapped.x, y: mapped.y };
    };

    const bonds: { id: string; a: { x: number; y: number }; b: { x: number; y: number } }[] =
      [];
    const lines = document.querySelectorAll<SVGLineElement>(
      '[data-canvas-root] [data-layer="scene"] line[data-bond-id]',
    );
    for (const line of lines) {
      const a = toClient(line, line.x1.baseVal.value, line.y1.baseVal.value);
      const b = toClient(line, line.x2.baseVal.value, line.y2.baseVal.value);
      if (a === null || b === null) continue;
      bonds.push({ id: line.getAttribute("data-bond-id") ?? "", a, b });
    }

    const atoms: { id: string; centre: { x: number; y: number } }[] = [];
    const circles = document.querySelectorAll<SVGCircleElement>(
      '[data-canvas-root] [data-layer="scene"] circle[data-atom-id]',
    );
    for (const circle of circles) {
      const centre = toClient(
        circle,
        circle.cx.baseVal.value,
        circle.cy.baseVal.value,
      );
      if (centre === null) continue;
      atoms.push({ id: circle.getAttribute("data-atom-id") ?? "", centre });
    }

    return { bonds, atoms };
  });
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`No bounding box for ${selector}`);
  return box;
}

function nth<T>(items: readonly T[], index: number, what: string): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Expected at least ${String(index + 1)} ${what}`);
  }
  return item;
}

function midpoint(segment: BondSegment): Point {
  return {
    x: (segment.a.x + segment.b.x) / 2,
    y: (segment.a.y + segment.b.y) / 2,
  };
}

function length(segment: BondSegment): number {
  return Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * The centroid of the ring, which for benzene is the one point guaranteed to
 * be empty canvas while still being on screen.
 *
 * Preferred over "a corner of the canvas" because a corner is only empty as
 * long as the fit leaves one. The ring centre sits an apothem — 0.866 bond
 * lengths — from every bond, which is two orders of magnitude past the 6px
 * pick tolerance at any sane zoom, and it stays empty however the view is
 * framed.
 */
function ringCentre(atoms: readonly AtomMark[]): Point {
  const sum = atoms.reduce(
    (acc, atom) => ({ x: acc.x + atom.centre.x, y: acc.y + atom.centre.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / atoms.length, y: sum.y / atoms.length };
}

function containsPoint(box: Box, point: Point): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

test("renders the benzene fixture as six bonds and six atoms", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await openEditor(page);

  const scene = page.locator(SCENE);
  await expect(scene.locator("[data-atom-id]")).toHaveCount(RING_CARBONS);
  await expect(scene.locator("[data-bond-id]")).toHaveCount(RING_BONDS);

  // The counts have to hold for the WHOLE PAGE, not just inside the scene
  // layer. `[data-atom-id]` is the selector that means "a drawn atom", and an
  // overlay halo wearing it would turn a structural fact into a stateful one
  // — the count would then depend on what happened to be hovered.
  await expect(page.locator("[data-atom-id]")).toHaveCount(RING_CARBONS);
  await expect(page.locator("[data-bond-id]")).toHaveCount(RING_BONDS);

  // The overlay group exists, is a SIBLING of the scene rather than part of
  // it, and claims no model entities of its own.
  await expect(page.locator(OVERLAY)).toHaveCount(1);
  await expect(page.locator(`${SCENE} [data-overlay]`)).toHaveCount(0);
  await expect(
    page.locator(`${OVERLAY} [data-atom-id], ${OVERLAY} [data-bond-id]`),
  ).toHaveCount(0);

  // Primitive ids derive from their source id, never from a loop counter —
  // that is what makes an exported figure byte-identical between two runs.
  // Checking the derivation in the DOM checks it end to end.
  const primitiveIds = await page
    .locator(`${SCENE} [data-atom-id]`)
    .evaluateAll((elements) =>
      elements.map((element) => ({
        atomId: element.getAttribute("data-atom-id"),
        primitiveId: element.getAttribute("data-primitive-id"),
      })),
    );
  for (const entry of primitiveIds) {
    expect(entry.primitiveId).toBe(`atom:${String(entry.atomId)}:dot`);
  }

  expect(errors).toEqual([]);
});

test("paints the structure inside the viewport rather than an empty rectangle", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await openEditor(page);

  const canvasBox = await boxOf(page, CANVAS);
  const sceneBox = await boxOf(page, SCENE);

  // Real ink, and enough of it that the fit actually framed the molecule
  // rather than leaving it at some default scale in a corner. `zoomToFit`
  // fills one axis of the canvas with the scene's bounds; the ring itself is
  // most of that, so anything under 40% of the canvas height means the fit
  // was computed against the wrong space.
  expect(sceneBox.width).toBeGreaterThan(100);
  expect(sceneBox.height).toBeGreaterThan(100);
  expect(sceneBox.height).toBeGreaterThan(canvasBox.height * 0.4);

  // ...and it is inside the canvas, not parked off-screen.
  expect(sceneBox.x).toBeGreaterThanOrEqual(canvasBox.x - BOX_SLACK_PX);
  expect(sceneBox.y).toBeGreaterThanOrEqual(canvasBox.y - BOX_SLACK_PX);
  expect(sceneBox.x + sceneBox.width).toBeLessThanOrEqual(
    canvasBox.x + canvasBox.width + BOX_SLACK_PX,
  );
  expect(sceneBox.y + sceneBox.height).toBeLessThanOrEqual(
    canvasBox.y + canvasBox.height + BOX_SLACK_PX,
  );

  const geometry = await readGeometry(page);
  expect(geometry.bonds).toHaveLength(RING_BONDS);
  expect(geometry.atoms).toHaveLength(RING_CARBONS);

  // Every vertex on screen.
  for (const atom of geometry.atoms) {
    expect(
      containsPoint(canvasBox, atom.centre),
      `atom ${atom.id} is off-canvas at ${JSON.stringify(atom.centre)}`,
    ).toBe(true);
  }

  // Benzene is a REGULAR hexagon — chem-core builds it from `carbocycle` at a
  // unit bond length — so all six bonds must measure the same on screen. This
  // is the assertion that fails when the y-flip or the scale is applied twice
  // on one axis: the ring squashes into an ellipse and the six lengths fan
  // out, while every count and every box stays plausible.
  const lengths = geometry.bonds.map(length);
  const shortest = Math.min(...lengths);
  const longest = Math.max(...lengths);
  expect(shortest).toBeGreaterThan(50);
  expect(longest - shortest).toBeLessThan(0.5);

  expect(errors).toEqual([]);
});

test("wheel zooms about the cursor and keeps the page from scrolling", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await openEditor(page);

  const before = parseViewTransform(await viewTransform(page));
  const geometry = await readGeometry(page);
  const anchorAtom = nth(geometry.atoms, 0, "atoms");
  const anchor = anchorAtom.centre;

  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, -240);
  await settle(page);

  const after = parseViewTransform(await viewTransform(page));
  // exp(240 * 0.002) is about 1.62; asserting only 1.2 leaves room for the
  // wheel rate to be retuned without rewriting the spec, while still failing
  // outright if the wheel does nothing.
  expect(after.zoom).toBeGreaterThan(before.zoom * 1.2);

  // The page must not have scrolled. A wheel handler attached through React's
  // `onWheel` cannot preventDefault — React registers wheel passively at the
  // root — and the symptom is the document sliding out from under a user who
  // was only trying to zoom.
  const scroll = await page.evaluate(() => ({
    x: window.scrollX,
    y: window.scrollY,
  }));
  expect(scroll).toEqual({ x: 0, y: 0 });

  const zoomed = await readGeometry(page);
  expect(zoomed.atoms).toHaveLength(RING_CARBONS);
  expect(zoomed.bonds).toHaveLength(RING_BONDS);

  // THE ANCHOR INVARIANT, stated the way the user experiences it: the atom
  // that was under the cursor is still under the cursor. Nothing here reads
  // the store — if `zoomAt` stopped solving for the pan, this atom would slide
  // away from the pointer by a distance that grows with the zoom factor.
  const movedAtom = zoomed.atoms.find((atom) => atom.id === anchorAtom.id);
  expect(movedAtom).toBeDefined();
  if (movedAtom === undefined) return;
  expect(distance(movedAtom.centre, anchor)).toBeLessThan(ANCHOR_TOLERANCE_PX);

  // Still on screen after the zoom.
  const canvasBox = await boxOf(page, CANVAS);
  const onScreen = zoomed.atoms.filter((atom) =>
    containsPoint(canvasBox, atom.centre),
  );
  expect(onScreen.length).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test("the wheel listener is registered non-passively", async ({ page }) => {
  const errors = collectPageErrors(page);
  await openEditor(page);

  // A direct statement of the thing the previous test can only infer: a
  // cancellable wheel event dispatched at the canvas comes back cancelled.
  // Move the handler to React's `onWheel` prop and this reads false, with no
  // error anywhere — which is exactly why it is asserted rather than assumed.
  const cancelled = await page.evaluate(() => {
    const svg = document.querySelector("[data-canvas-root]");
    if (svg === null) return null;
    const rect = svg.getBoundingClientRect();
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      deltaY: 120,
    });
    svg.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(cancelled).toBe(true);

  expect(errors).toEqual([]);
});

/**
 * One pan drag, asserted three ways.
 *
 * The drag deliberately STARTS ON AN ATOM. A pan that ended over empty space
 * and still counted as a click would clear the selection; a pan that started
 * on an atom and still counted as a click would select it. Both are the same
 * bug — a missing click-suppression threshold — and starting on a vertex is
 * what makes this spec able to see it.
 */
async function assertPanDrag(
  page: Page,
  drag: (from: Point, to: Point) => Promise<void>,
  delta: Point,
): Promise<void> {
  const before = parseViewTransform(await viewTransform(page));
  const geometry = await readGeometry(page);
  const atom = nth(geometry.atoms, 0, "atoms");
  const from = atom.centre;
  const to = { x: from.x + delta.x, y: from.y + delta.y };

  await drag(from, to);
  await settle(page);

  const after = parseViewTransform(await viewTransform(page));
  expect(after.zoom).toBeCloseTo(before.zoom, 5);

  // The transform's third component is the negated pan, and `panBy` divides
  // the screen delta by the zoom — so a drag of `delta` screen px moves it by
  // `delta / zoom` scene px. Getting the sign wrong here is the classic
  // "canvas runs away from the cursor" bug, and it is a sign error, not a
  // magnitude one, so a signed comparison is what catches it.
  expect(after.translate.x - before.translate.x).toBeCloseTo(
    delta.x / before.zoom,
    1,
  );
  expect(after.translate.y - before.translate.y).toBeCloseTo(
    delta.y / before.zoom,
    1,
  );

  // And the same statement in the space the user can see: the drawing moved
  // with the pointer, by the pointer's own distance.
  const moved = await readGeometry(page);
  const movedAtom = moved.atoms.find((candidate) => candidate.id === atom.id);
  expect(movedAtom).toBeDefined();
  if (movedAtom === undefined) return;
  expect(movedAtom.centre.x - from.x).toBeCloseTo(delta.x, 0);
  expect(movedAtom.centre.y - from.y).toBeCloseTo(delta.y, 0);

  // Nothing was selected on the way past.
  await expect(
    page.locator('[data-overlay="selected-atom"], [data-overlay="selected-bond"]'),
  ).toHaveCount(0);

  // And nothing was edited: panning is a view gesture.
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(
    RING_CARBONS,
  );
  await expect(page.locator(`${SCENE} [data-bond-id]`)).toHaveCount(RING_BONDS);
}

// Up and to the left, so the drag stays clear of both the canvas edges and
// the fit/zoom chrome in the bottom-right corner.
const PAN_DELTA: Point = { x: -90, y: -60 };

test("middle-button drag pans the view without selecting anything", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await openEditor(page);

  await assertPanDrag(
    page,
    async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up({ button: "middle" });
    },
    PAN_DELTA,
  );

  expect(errors).toEqual([]);
});

test("space-held left drag pans the view without selecting anything", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await openEditor(page);

  await assertPanDrag(
    page,
    async (from, to) => {
      // Space is tracked on `window`, so it works before the canvas has focus
      // — which is the state a user is actually in, hand on the mouse.
      await page.keyboard.down("Space");
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.up("Space");
    },
    PAN_DELTA,
  );

  expect(errors).toEqual([]);
});

test("a left drag past the click threshold does not select what it started on", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await openEditor(page);

  const geometry = await readGeometry(page);
  const atom = nth(geometry.atoms, 0, "atoms");

  // No space, no middle button: this is a plain left drag, which today pans
  // nothing. It must still not fire a select, or every future drag tool would
  // leave a selection behind it.
  await page.mouse.move(atom.centre.x, atom.centre.y);
  await page.mouse.down();
  await page.mouse.move(atom.centre.x + 40, atom.centre.y + 30, { steps: 6 });
  await page.mouse.up();

  await expect(
    page.locator('[data-overlay="selected-atom"], [data-overlay="selected-bond"]'),
  ).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("clicking bonds selects them, shift extends, empty space clears", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await openEditor(page);

  const geometry = await readGeometry(page);
  // Two bonds picked from the RENDERED geometry, not from hard-coded pixels:
  // the click lands on the midpoint of the line that is actually on screen,
  // so a change of style preset, viewport size or fit margin moves the click
  // with the drawing instead of breaking the spec.
  const first = nth(geometry.bonds, 0, "bonds");
  const second = nth(geometry.bonds, 2, "bonds");
  expect(first.id).not.toBe(second.id);

  const firstMid = midpoint(first);
  await page.mouse.click(firstMid.x, firstMid.y);

  const selectedBonds = page.locator('[data-overlay="selected-bond"]');
  await expect(selectedBonds).toHaveCount(1);
  await expect(selectedBonds).toHaveAttribute("data-overlay-target", first.id);

  const secondMid = midpoint(second);
  await page.keyboard.down("Shift");
  await page.mouse.click(secondMid.x, secondMid.y);
  await page.keyboard.up("Shift");

  await expect(selectedBonds).toHaveCount(2);
  const targets = await selectedBonds.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-overlay-target")),
  );
  expect([...targets].sort()).toEqual([first.id, second.id].sort());

  // The highlights are React-only siblings of the scene. If one had been
  // pushed into `scene.primitives` instead, it would live under the scene
  // layer — and would then be in every exported figure.
  await expect(page.locator(`${SCENE} [data-overlay]`)).toHaveCount(0);
  await expect(page.locator("[data-bond-id]")).toHaveCount(RING_BONDS);

  // The ring centre is empty canvas at any zoom; an unmodified click there
  // means "I am done with this selection".
  const centre = ringCentre(geometry.atoms);
  await page.mouse.click(centre.x, centre.y);
  await expect(selectedBonds).toHaveCount(0);
  await expect(page.locator('[data-overlay="selected-atom"]')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("clicking an atom selects it and clicking another replaces the selection", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await openEditor(page);

  const geometry = await readGeometry(page);
  const first = nth(geometry.atoms, 0, "atoms");
  const second = nth(geometry.atoms, 3, "atoms");

  await page.mouse.click(first.centre.x, first.centre.y);
  const selectedAtoms = page.locator('[data-overlay="selected-atom"]');
  await expect(selectedAtoms).toHaveCount(1);
  await expect(selectedAtoms).toHaveAttribute("data-overlay-target", first.id);

  // Unmodified, so it replaces rather than extends.
  await page.mouse.click(second.centre.x, second.centre.y);
  await expect(selectedAtoms).toHaveCount(1);
  await expect(selectedAtoms).toHaveAttribute("data-overlay-target", second.id);

  // Selection is a view concern: the molecule is untouched.
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(
    RING_CARBONS,
  );

  expect(errors).toEqual([]);
});
