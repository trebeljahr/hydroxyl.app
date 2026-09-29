import { expect, test } from "@playwright/test";
import type { CDPSession, Page } from "@playwright/test";

/**
 * Pan, zoom and multi-select on the canvas, by mouse and by touch
 * (decision 106).
 *
 * The rule under test: a primary drag always belongs to the active tool — so
 * a drag over empty space stays a marquee — and every device has a way to pan
 * and zoom that never collides with it. A mouse wheels to pan and holds
 * Ctrl/Cmd to zoom; a trackpad scrolls and pinches, which the browser delivers
 * as the same two wheel events; a finger does the tool, two fingers navigate.
 *
 * The gesture reducer is unit-tested with synthetic input. What only a browser
 * can prove is that real pointer and touch events — Chromium's own, with its
 * own pointer ids, capture rules and `touch-action` — reach it the way the
 * unit tests assume, and that the drawing on screen moves under the fingers.
 */

const CANVAS = "[data-canvas-root]";
const SCENE = '[data-canvas-root] [data-layer="scene"]';
const VIEW_GROUP = "[data-canvas-root] > g";
const SELECTED_ATOMS = '[data-overlay="selected-atom"]';
const SELECTED_ANY = '[data-overlay="selected-atom"], [data-overlay="selected-bond"]';
const RING_CARBONS = 6;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface AtomMark {
  readonly id: string;
  readonly centre: Point;
}

interface ViewTransform {
  readonly zoom: number;
  /** The negated pan. */
  readonly translate: Point;
}

const TRANSFORM_PATTERN =
  /^translate\((-?[\d.]+), (-?[\d.]+)\) scale\((-?[\d.]+)\) translate\((-?[\d.e-]+), (-?[\d.e-]+)\)$/;

async function view(page: Page): Promise<ViewTransform> {
  const value = (await page.locator(VIEW_GROUP).getAttribute("transform")) ?? "";
  const match = TRANSFORM_PATTERN.exec(value.trim());
  if (match === null) throw new Error(`Unrecognised canvas transform: ${value}`);
  return { zoom: Number(match[3]), translate: { x: Number(match[4]), y: Number(match[5]) } };
}

/** Polls until two readings of the transform agree. */
async function settle(page: Page): Promise<void> {
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const current = (await page.locator(VIEW_GROUP).getAttribute("transform")) ?? "";
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
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(RING_CARBONS);
  await settle(page);
}

/** Atom centres in page px, through the CTM rather than a stroked box. */
async function atoms(page: Page): Promise<AtomMark[]> {
  return page.evaluate(() => {
    const out: { id: string; centre: { x: number; y: number } }[] = [];
    const circles = document.querySelectorAll<SVGCircleElement>(
      '[data-canvas-root] [data-layer="scene"] circle[data-atom-id]',
    );
    for (const circle of circles) {
      const ctm = circle.getScreenCTM();
      if (ctm === null) continue;
      const p = new DOMPoint(circle.cx.baseVal.value, circle.cy.baseVal.value).matrixTransform(ctm);
      out.push({ id: circle.getAttribute("data-atom-id") ?? "", centre: { x: p.x, y: p.y } });
    }
    return out;
  });
}

function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error("expected at least one item");
  return item;
}

function centreOf(marks: readonly AtomMark[]): Point {
  const sum = marks.reduce((acc, a) => ({ x: acc.x + a.centre.x, y: acc.y + a.centre.y }), {
    x: 0,
    y: 0,
  });
  return { x: sum.x / marks.length, y: sum.y / marks.length };
}

async function atomAt(page: Page, id: string): Promise<Point> {
  const found = (await atoms(page)).find((a) => a.id === id);
  if (found === undefined) throw new Error(`atom ${id} is gone`);
  return found.centre;
}

async function canvasBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator(CANVAS).boundingBox();
  if (box === null) throw new Error("no canvas box");
  return box;
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

// ---------------------------------------------------------------------------
// Mouse and trackpad
// ---------------------------------------------------------------------------

test.describe("mouse and trackpad", () => {
  test("a plain wheel pans the drawing and leaves the zoom alone", async ({ page }) => {
    const errors = collectPageErrors(page);
    await openEditor(page);
    const before = await view(page);
    const atom = first(await atoms(page));
    await page.mouse.move(atom.centre.x, atom.centre.y);

    // A wheel turned toward you, or two fingers pushed up a trackpad, scrolls
    // down the drawing: the structure moves UP by the scroll distance.
    await page.mouse.wheel(0, 120);
    await settle(page);

    const after = await view(page);
    expect(after.zoom).toBeCloseTo(before.zoom, 6);
    const moved = await atomAt(page, atom.id);
    expect(moved.x - atom.centre.x).toBeCloseTo(0, 0);
    expect(moved.y - atom.centre.y).toBeCloseTo(-120, 0);

    // And a trackpad's sideways swipe pans sideways.
    await page.mouse.wheel(-80, 0);
    await settle(page);
    const sideways = await atomAt(page, atom.id);
    expect(sideways.x - moved.x).toBeCloseTo(80, 0);

    // A pan is not an edit and not a selection.
    await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(RING_CARBONS);
    await expect(page.locator(SELECTED_ANY)).toHaveCount(0);
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
    expect(errors).toEqual([]);
  });

  test("Shift + wheel pans horizontally, for a mouse with one wheel", async ({ page }) => {
    await openEditor(page);
    const atom = first(await atoms(page));
    await page.mouse.move(atom.centre.x, atom.centre.y);
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, 100);
    await page.keyboard.up("Shift");
    await settle(page);

    const moved = await atomAt(page, atom.id);
    expect(moved.x - atom.centre.x).toBeCloseTo(-100, 0);
    expect(moved.y - atom.centre.y).toBeCloseTo(0, 0);
  });

  test("Cmd/Ctrl + wheel zooms about the cursor, the atom under it stays put", async ({
    page,
  }) => {
    await openEditor(page);
    const before = await view(page);
    const atom = first(await atoms(page));
    await page.mouse.move(atom.centre.x, atom.centre.y);
    await page.keyboard.down("ControlOrMeta");
    await page.mouse.wheel(0, -120);
    await page.keyboard.up("ControlOrMeta");
    await settle(page);

    const after = await view(page);
    // One mouse notch is the capped step, x1.22.
    expect(after.zoom / before.zoom).toBeCloseTo(1.2214, 3);
    const moved = await atomAt(page, atom.id);
    expect(Math.hypot(moved.x - atom.centre.x, moved.y - atom.centre.y)).toBeLessThan(2);
  });

  test("marquee and pan co-exist: drag empty space selects, Space-drag pans, then marquee again", async ({
    page,
  }) => {
    await openEditor(page);
    const box = await canvasBox(page);
    const ring = await atoms(page);
    const centre = centreOf(ring);

    // Space held: the same left drag that would marquee moves the view.
    await page.keyboard.down("Space");
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 60, centre.y + 30, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    await settle(page);
    await expect(page.locator(SELECTED_ANY)).toHaveCount(0);
    const shifted = await atomAt(page, first(ring).id);
    expect(shifted.x - first(ring).centre.x).toBeCloseTo(60, 0);

    // Space released: a drag from empty space around the whole ring selects it.
    const now = centreOf(await atoms(page));
    const from = { x: box.x + 8, y: box.y + 8 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(now.x + (now.x - from.x), now.y + (now.y - from.y), { steps: 8 });
    await page.mouse.up();
    await expect(page.locator(SELECTED_ATOMS)).toHaveCount(RING_CARBONS);
  });

  test("Mod+= and Mod+- zoom about the centre; Fit and Reset frame the drawing", async ({
    page,
  }) => {
    await openEditor(page);
    const fitted = await view(page);
    // Focus somewhere neutral, as a user who just clicked the canvas is.
    const ring = centreOf(await atoms(page));
    await page.mouse.click(ring.x, ring.y);

    await page.keyboard.press("ControlOrMeta+Equal");
    await settle(page);
    const zoomedIn = await view(page);
    expect(zoomedIn.zoom / fitted.zoom).toBeCloseTo(Math.SQRT2, 4);
    // About the centre: the pan is untouched.
    expect(zoomedIn.translate.x).toBeCloseTo(fitted.translate.x, 4);
    expect(zoomedIn.translate.y).toBeCloseTo(fitted.translate.y, 4);

    await page.keyboard.press("ControlOrMeta+Minus");
    await settle(page);
    expect((await view(page)).zoom).toBeCloseTo(fitted.zoom, 4);

    // The status-bar buttons do the same through the same commands.
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await settle(page);
    expect((await view(page)).zoom / fitted.zoom).toBeCloseTo(2, 4);

    // Reset is the readout's 100%: a 44 px reference bond on screen (decision
    // 107). The fixture opens in Publication (decision 135), whose 24 px bond
    // needs a viewport zoom of 44/24 for that.
    await page.getByRole("button", { name: "Reset" }).click();
    await settle(page);
    expect((await view(page)).zoom).toBeCloseTo(44 / 24, 6);
    await expect(page.locator('[data-status="zoom"]')).toHaveText("100%");

    await page.getByRole("button", { name: "Fit" }).click();
    await settle(page);
    const refitted = await view(page);
    expect(refitted.zoom).toBeCloseTo(fitted.zoom, 4);
    expect(refitted.translate.x).toBeCloseTo(fitted.translate.x, 2);
    expect(refitted.translate.y).toBeCloseTo(fitted.translate.y, 2);
  });
});

// ---------------------------------------------------------------------------
// Touch
// ---------------------------------------------------------------------------

/**
 * Multi-touch through the DevTools protocol. Playwright's `touchscreen` taps
 * one finger at a time; two fingers need `Input.dispatchTouchEvent`, which
 * Chromium turns into real `pointerType: "touch"` pointer events — the same
 * path a phone or tablet takes. Each call lists every finger still down.
 */
class Fingers {
  private constructor(private readonly cdp: CDPSession) {}

  static async on(page: Page): Promise<Fingers> {
    return new Fingers(await page.context().newCDPSession(page));
  }

  private points(fingers: readonly Point[]): { x: number; y: number; id: number }[] {
    return fingers.map((p, id) => ({ x: Math.round(p.x), y: Math.round(p.y), id }));
  }

  async down(fingers: readonly Point[]): Promise<void> {
    await this.cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: this.points(fingers),
    });
  }

  /** Moves every finger from `from` to `to` in `steps` frames. */
  async move(from: readonly Point[], to: readonly Point[], steps = 8): Promise<void> {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const frame = from.map((p, k) => {
        const q = to[k] as Point;
        return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
      });
      await this.cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: this.points(frame),
      });
    }
  }

  /** Lifts every finger. */
  async up(): Promise<void> {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
}

test.describe("touch", () => {
  test.use({ hasTouch: true });

  test("two fingers pan and pinch-zoom, and the drawing stays under them", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await openEditor(page);
    const before = await view(page);
    const ring = await atoms(page);
    const atom = first(ring);
    const centre = centreOf(ring);

    // Finger A starts ON an atom; finger B across the ring from it.
    const a0 = atom.centre;
    const b0 = { x: 2 * centre.x - a0.x, y: 2 * centre.y - a0.y };
    // Spread by 1.5x about the midpoint, and carry the whole pinch 40px left.
    const mid = { x: (a0.x + b0.x) / 2 - 40, y: (a0.y + b0.y) / 2 };
    const a1 = { x: mid.x + (a0.x - centre.x) * 1.5, y: mid.y + (a0.y - centre.y) * 1.5 };
    const b1 = { x: mid.x + (b0.x - centre.x) * 1.5, y: mid.y + (b0.y - centre.y) * 1.5 };

    const fingers = await Fingers.on(page);
    await fingers.down([a0]);
    await fingers.down([a0, b0]);
    await fingers.move([a0, b0], [a1, b1], 10);
    await fingers.up();
    await settle(page);

    const after = await view(page);
    // Per-frame ratios telescope, so the net zoom is the net span ratio —
    // up to the whole-pixel rounding of each touch point.
    expect(after.zoom / before.zoom).toBeCloseTo(1.5, 1);
    const moved = await atomAt(page, atom.id);
    expect(Math.hypot(moved.x - a1.x, moved.y - a1.y)).toBeLessThan(3);

    // Navigating is not selecting and not editing.
    await expect(page.locator(SELECTED_ANY)).toHaveCount(0);
    await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(RING_CARBONS);
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
    expect(errors).toEqual([]);
  });

  test("one finger on empty canvas draws a marquee, and a tap selects", async ({ page }) => {
    await openEditor(page);
    const box = await canvasBox(page);
    const ring = await atoms(page);
    const centre = centreOf(ring);
    const before = await view(page);

    const from = { x: box.x + 10, y: box.y + 10 };
    const to = { x: centre.x + (centre.x - from.x), y: centre.y + (centre.y - from.y) };
    const fingers = await Fingers.on(page);
    await fingers.down([from]);
    await fingers.move([from], [to], 10);
    await fingers.up();

    await expect(page.locator(SELECTED_ATOMS)).toHaveCount(RING_CARBONS);
    // One finger never moved the view.
    expect((await view(page)).zoom).toBeCloseTo(before.zoom, 6);

    // A tap on empty space clears; a tap on an atom selects it alone.
    await page.touchscreen.tap(centre.x, centre.y);
    await expect(page.locator(SELECTED_ANY)).toHaveCount(0);
    const atom = first(ring);
    await page.touchscreen.tap(atom.centre.x, atom.centre.y);
    await expect(page.locator(SELECTED_ATOMS)).toHaveCount(1);
  });

  test("a second finger turns a marquee in progress into a pan, and selects nothing", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await openEditor(page);
    const box = await canvasBox(page);
    const ring = await atoms(page);
    const centre = centreOf(ring);
    const atom = first(ring);

    const a0 = { x: box.x + 10, y: box.y + 10 };
    const a1 = { x: centre.x, y: centre.y };
    const fingers = await Fingers.on(page);
    await fingers.down([a0]);
    await fingers.move([a0], [a1], 6);
    await expect(page.locator('[data-overlay="marquee"]')).toHaveCount(1);

    // The second finger lands: the marquee is cancelled, not committed.
    const b0 = { x: a1.x + 120, y: a1.y };
    await fingers.down([a1, b0]);
    await expect(page.locator('[data-overlay="marquee"]')).toHaveCount(0);

    // Both fingers slide 50px down together: a pure pan.
    const shift = { x: 0, y: 50 };
    await fingers.move(
      [a1, b0],
      [
        { x: a1.x + shift.x, y: a1.y + shift.y },
        { x: b0.x + shift.x, y: b0.y + shift.y },
      ],
      6,
    );
    await fingers.up();
    await settle(page);

    await expect(page.locator(SELECTED_ANY)).toHaveCount(0);
    const moved = await atomAt(page, atom.id);
    expect(moved.y - atom.centre.y).toBeCloseTo(50, 0);
    await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(RING_CARBONS);
    expect(errors).toEqual([]);
  });

  test("a second finger discards a half-drawn bond and leaves undo working", async ({
    page,
  }) => {
    // A drag from an atom draws, and a drawing drag holds an open store
    // transaction. A second finger used to overwrite the first finger's press,
    // so that transaction was never closed and undo went dead for the rest
    // of the session.
    const errors = collectPageErrors(page);
    await openEditor(page);
    const ring = await atoms(page);
    const centre = centreOf(ring);
    const atom = first(ring);
    const outward = {
      x: atom.centre.x + (atom.centre.x - centre.x) * 0.8,
      y: atom.centre.y + (atom.centre.y - centre.y) * 0.8,
    };

    const fingers = await Fingers.on(page);
    await fingers.down([atom.centre]);
    await fingers.move([atom.centre], [outward], 6);
    // Mid-drag the new atom is already in the document.
    await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(RING_CARBONS + 1);

    await fingers.down([outward, centre]);
    await fingers.up();
    await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(RING_CARBONS);

    // Undo still records: delete an atom, undo, and it is back.
    await page.touchscreen.tap(atom.centre.x, atom.centre.y);
    await expect(page.locator(SELECTED_ATOMS)).toHaveCount(1);
    await page.keyboard.press("Delete");
    await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(RING_CARBONS - 1);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(RING_CARBONS);
    expect(errors).toEqual([]);
  });
});
