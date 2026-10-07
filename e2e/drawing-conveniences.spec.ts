import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Three conveniences every other sketcher has ("Drawing conveniences seen
 * everywhere else", manual notes 3): the cyclooctane and cyclopentadiene
 * templates, the Alt lasso beside the marquee (decision 231), and Mod+V
 * pasting at the pointer.
 *
 * Each is unit tested where its logic lives — the templates in chem-core, the
 * lasso in the interaction machine, the paste offset in the registry. What
 * only a browser answers is the wiring: whether Alt reaches the gesture as a
 * real pointer modifier, whether the canvas hears where the mouse rests, and
 * whether the popover's new entries place what they name.
 */

const CANVAS = "[data-canvas-root]";
const SELECTED_ATOMS = '[data-overlay="selected-atom"]';

interface Point {
  readonly x: number;
  readonly y: number;
}

async function openEditor(page: Page): Promise<void> {
  await page.goto("/editor");
  await page.locator(`${CANVAS} [data-layer="scene"]`).waitFor();
}

/** Distinct bonds, not the lines that depict them: a double bond draws two. */
async function bondCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const ids = new Set<string>();
    document
      .querySelectorAll("[data-bond-id]")
      .forEach((node) => ids.add(node.getAttribute("data-bond-id") ?? ""));
    return ids.size;
  });
}

async function lineCount(page: Page): Promise<number> {
  return page.locator("line[data-bond-id]").count();
}

async function ringCircleCount(page: Page): Promise<number> {
  return page.locator("circle[data-ring-atom-ids]").count();
}

/** Every drawn atom's id and screen centre. */
async function atomCentres(page: Page): Promise<{ id: string; x: number; y: number }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-atom-id]")].map((node) => {
      const box = node.getBoundingClientRect();
      return {
        id: node.getAttribute("data-atom-id") ?? "",
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      };
    }),
  );
}

async function selectedAtomIds(page: Page): Promise<string[]> {
  return page.evaluate(
    (selector) =>
      [...document.querySelectorAll(selector)]
        .map((node) => node.getAttribute("data-overlay-target") ?? "")
        .sort(),
    SELECTED_ATOMS,
  );
}

/** The centre of the box round every selected atom's halo, in screen px. */
async function selectionCentre(page: Page): Promise<Point> {
  return page.evaluate((selector) => {
    const boxes = [...document.querySelectorAll(selector)].map((node) =>
      node.getBoundingClientRect(),
    );
    const xs = boxes.map((box) => box.x + box.width / 2);
    const ys = boxes.map((box) => box.y + box.height / 2);
    return {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
  }, SELECTED_ATOMS);
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

test("the ring popover places cyclooctane and cyclopentadiene", async ({ page }) => {
  await openEditor(page);
  const box = (await page.locator(CANVAS).boundingBox())!;
  const baseBonds = await bondCount(page);
  const baseLines = await lineCount(page);
  const baseCircles = await ringCircleCount(page);

  await page.click('[data-tool="ring"]');
  await page.click('[aria-label="Ring template options"]');
  await page.click('[data-option="ring-cyclooctane"]');
  await page.mouse.click(box.x + 100, box.y + box.height - 100);

  // Eight single bonds, drawn as eight lines.
  expect(await bondCount(page)).toBe(baseBonds + 8);
  expect(await lineCount(page)).toBe(baseLines + 8);

  await page.click('[aria-label="Ring template options"]');
  await page.click('[data-option="ring-cyclopentadiene"]');
  await page.mouse.click(box.x + box.width - 100, box.y + 100);

  // Five bonds, two of them double: seven lines. A diene is not an arene, so
  // no delocalisation circle appears for it.
  expect(await bondCount(page)).toBe(baseBonds + 8 + 5);
  expect(await lineCount(page)).toBe(baseLines + 8 + 7);
  expect(await ringCircleCount(page)).toBe(baseCircles);

  // And neither is over-valent, which a cumulated diene would be.
  await expect(page.locator('[data-status="issues"]')).toContainText("0 chemistry errors");
});

test("Alt-drag from empty canvas lassos; a plain drag stays the marquee", async ({ page }) => {
  await openEditor(page);
  // Zoomed out, so the lasso can start well clear of the drawing and still on
  // the canvas: the editor opens benzene filling it.
  await page.locator(CANVAS).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ControlOrMeta+Minus");
  const atoms = await atomCentres(page);
  expect(atoms.length).toBeGreaterThanOrEqual(3);

  // Two atoms whose bounding box holds a third, joined by a path that passes
  // no other atom: a lasso can take the pair, a marquee cannot.
  let pair: { a: (typeof atoms)[number]; b: (typeof atoms)[number] } | undefined;
  for (const a of atoms) {
    for (const b of atoms) {
      if (a.id >= b.id) continue;
      const others = atoms.filter((atom) => atom.id !== a.id && atom.id !== b.id);
      const boxed = others.some(
        (atom) =>
          atom.x >= Math.min(a.x, b.x) - 2 &&
          atom.x <= Math.max(a.x, b.x) + 2 &&
          atom.y >= Math.min(a.y, b.y) - 2 &&
          atom.y <= Math.max(a.y, b.y) + 2,
      );
      const clear = others.every((atom) => distanceToSegment(atom, a, b) > 24);
      if (boxed && clear) pair ??= { a, b };
    }
  }
  if (pair === undefined) throw new Error("the default drawing has no pair a box cannot isolate");
  const { a, b } = pair;

  // A strip 14 px either side of the segment. It starts most of a bond
  // beyond `a`, on the side away from `b`, so the press lands on empty canvas
  // rather than inside `a`'s pick target (a fifth of a bond plus a few px) —
  // a press there would draw a bond instead.
  const bond = Math.min(
    ...atoms.flatMap((p) =>
      atoms.filter((q) => q.id !== p.id).map((q) => Math.hypot(q.x - p.x, q.y - p.y)),
    ),
  );
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const n = { x: -d.y * 14, y: d.x * 14 };
  const start = { x: a.x - d.x * bond * 0.6, y: a.y - d.y * bond * 0.6 };
  const end = { x: b.x + d.x * 16, y: b.y + d.y * 16 };
  const path = [
    { x: start.x + n.x, y: start.y + n.y },
    { x: end.x + n.x, y: end.y + n.y },
    { x: end.x - n.x, y: end.y - n.y },
    { x: start.x - n.x, y: start.y - n.y },
  ];

  const first = path[0]!;
  await page.mouse.move(first.x, first.y);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  for (const point of path.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps: 8 });
  }
  await expect(page.locator('[data-overlay="lasso"]')).toHaveCount(1);
  await page.mouse.up();
  await page.keyboard.up("Alt");

  expect(await selectedAtomIds(page)).toEqual([a.id, b.id].sort());
  await expect(page.locator('[data-overlay="lasso"]')).toHaveCount(0);

  // The same start without Alt is the marquee, as decision 106 keeps it.
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(path[2]!.x, path[2]!.y, { steps: 8 });
  await expect(page.locator('[data-overlay="marquee"]')).toHaveCount(1);
  await expect(page.locator('[data-overlay="lasso"]')).toHaveCount(0);
  await page.mouse.up();
});

test("Mod+V pastes centred at the pointer over the canvas, and beside the source otherwise", async ({
  page,
}) => {
  await openEditor(page);
  const canvas = page.locator(CANVAS);
  const box = (await canvas.boundingBox())!;

  await canvas.focus();
  // Zoomed out first: the editor opens benzene filling the canvas, and a copy
  // that lands partly out of view refits the view, which would move it off
  // the pointer it was pasted at.
  for (let i = 0; i < 3; i++) await page.keyboard.press("ControlOrMeta+Minus");
  const source = await atomCentres(page);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");

  // Aimed at the canvas's lower-left quarter, clear of the drawing.
  const aim = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.75 };
  await page.mouse.move(aim.x, aim.y);
  await page.keyboard.press("ControlOrMeta+v");

  await expect(page.locator("[data-atom-id]")).toHaveCount(source.length * 2);
  const landed = await selectionCentre(page);
  expect(Math.abs(landed.x - aim.x)).toBeLessThan(2);
  expect(Math.abs(landed.y - aim.y)).toBeLessThan(2);

  // With the pointer off the canvas the paste goes back to landing beside
  // its source (decision 200): on the source's own row, to its right.
  // Measured against the source in the same frame, because a copy that lands
  // out of view refits the view.
  await page.mouse.move(box.x + box.width / 2, box.y - 2);
  test.skip(box.y < 4, "the canvas reaches the top of the window; there is no off-canvas point above it");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator("[data-atom-id]")).toHaveCount(source.length * 3);
  const sourceIds = source.map((atom) => atom.id);
  const rows = await page.evaluate(
    ({ ids, selector }) => {
      const centreOf = (nodes: Element[]) => {
        const boxes = nodes.map((node) => node.getBoundingClientRect());
        const xs = boxes.map((r) => r.x + r.width / 2);
        const ys = boxes.map((r) => r.y + r.height / 2);
        return {
          x: (Math.min(...xs) + Math.max(...xs)) / 2,
          y: (Math.min(...ys) + Math.max(...ys)) / 2,
        };
      };
      const sourceNodes = ids
        .map((id) => document.querySelector(`[data-atom-id="${id}"]`))
        .filter((node): node is Element => node !== null);
      return {
        source: centreOf(sourceNodes),
        pasted: centreOf([...document.querySelectorAll(selector)]),
      };
    },
    { ids: sourceIds, selector: SELECTED_ATOMS },
  );
  expect(Math.abs(rows.pasted.y - rows.source.y)).toBeLessThan(1);
  expect(rows.pasted.x).toBeGreaterThan(rows.source.x);
});
