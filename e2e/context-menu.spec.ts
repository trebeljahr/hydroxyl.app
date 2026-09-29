import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The canvas context menu in a real browser.
 *
 * The menu's model and every entry's command are unit-tested; the component
 * tests drive the real canvas under jsdom. What only Chromium can prove is the
 * chain from a real right-button press on real pixels: the browser's own menu
 * stays shut, the pick lands on the bond under the pointer, the menu opens
 * there, and choosing an order redraws that bond. And the colours: jsdom runs
 * no cascade, so the contrast of each row state is measured here, as the
 * picker-state convention requires.
 *
 * Butan-2-ol rather than the benzene the editor opens with: every ring bond of
 * benzene draws as one line under the aromatic circle whatever its order, so
 * "the bond is now double" would not be visible on it.
 */

const CANVAS = "[data-canvas-root]";
const SCENE = `${CANVAS} [data-layer="scene"]`;
const MENU = "[data-context-menu]";

const MOLFILE = readFileSync(join(process.cwd(), "e2e", "fixtures", "butan2ol-wedge.mol"), "utf8");

async function openEditor(page: Page): Promise<void> {
  await page.goto("/editor");
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(6);
}

async function dropMolfile(page: Page, name: string, text: string): Promise<void> {
  const transfer = await page.evaluateHandle(
    ({ name: fileName, text: contents }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([contents], fileName, { type: "text/plain" }));
      return dt;
    },
    { name, text },
  );
  await page.dispatchEvent("body", "drop", { dataTransfer: transfer });
}

interface DrawnBond {
  readonly id: string;
  readonly lines: number;
  readonly midpoint: { readonly x: number; readonly y: number };
  /** The drawn axis's length on screen: shorter than the bond where a label trims it. */
  readonly length: number;
}

/**
 * Every bond drawn as plain lines, with how many lines it draws and where its
 * axis's midpoint is on screen. Through `getScreenCTM`, for the reason
 * editor.spec.ts gives: a bounding box is the stroked box.
 */
async function drawnBonds(page: Page): Promise<DrawnBond[]> {
  return page.evaluate((scene) => {
    const byId = new Map<string, SVGLineElement[]>();
    for (const line of document.querySelectorAll<SVGLineElement>(`${scene} line[data-bond-id]`)) {
      const id = line.getAttribute("data-bond-id") ?? "";
      byId.set(id, [...(byId.get(id) ?? []), line]);
    }
    return [...byId].map(([id, lines]) => {
      const axis = lines[0]!;
      const ctm = axis.getScreenCTM()!;
      const a = new DOMPoint(axis.x1.baseVal.value, axis.y1.baseVal.value).matrixTransform(ctm);
      const b = new DOMPoint(axis.x2.baseVal.value, axis.y2.baseVal.value).matrixTransform(ctm);
      return {
        id,
        lines: lines.length,
        midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        length: Math.hypot(b.x - a.x, b.y - a.y),
      };
    });
  }, SCENE);
}

async function linesOf(page: Page, bondId: string): Promise<number> {
  return page.locator(`${SCENE} line[data-bond-id="${bondId}"]`).count();
}

test("right-click a single bond, choose Double: that bond is redrawn double", async ({ page }) => {
  await openEditor(page);
  await dropMolfile(page, "butan2ol-wedge.mol", MOLFILE);
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(5);

  // The LONGEST single line: one no label trims. The stub a label cuts short
  // is the next test's subject.
  const single = (await drawnBonds(page))
    .filter((bond) => bond.lines === 1)
    .sort((a, b) => b.length - a.length)[0];
  if (single === undefined) throw new Error("butan-2-ol drew no single bond as a line");

  // Recorded AFTER React's root listener has run, so it reads what the
  // browser is left to do with the event.
  await page.evaluate(() => {
    (window as unknown as { contextMenuDefaults: boolean[] }).contextMenuDefaults = [];
    window.addEventListener("contextmenu", (event) => {
      (window as unknown as { contextMenuDefaults: boolean[] }).contextMenuDefaults.push(
        event.defaultPrevented,
      );
    });
  });

  await page.mouse.click(single.midpoint.x, single.midpoint.y, { button: "right" });

  const menu = page.locator(MENU);
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("data-context-menu", "bond");
  await expect(page.locator("[data-context-menu-title]")).toHaveText(/^Single bond, [A-Z][a-z]?–[A-Z][a-z]?$/);
  expect(
    await page.evaluate(
      () => (window as unknown as { contextMenuDefaults: boolean[] }).contextMenuDefaults,
    ),
  ).toEqual([true]);

  // The shortcut is shown beside the entry, and it is the registry's key.
  const double = page.locator('[data-menu-entry="bond.order.2"]');
  await expect(double.locator("[data-shortcut]")).toHaveText("2");
  await expect(page.locator('[data-menu-entry="bond.order.1"]')).toHaveAttribute("aria-checked", "true");

  await double.click();

  await expect(menu).toHaveCount(0);
  await expect.poll(() => linesOf(page, single.id)).toBe(2);
  // Only that bond: the others kept their line counts.
  const after = await drawnBonds(page);
  expect(after.filter((bond) => bond.id !== single.id && bond.lines !== 1)).toEqual([]);
});

test("right-click the middle of a bond stub cut short by a label: the bond menu opens", async ({ page }) => {
  await openEditor(page);
  await dropMolfile(page, "butan2ol-wedge.mol", MOLFILE);
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(5);

  // An import opens in Publication (decision 135), where C2's "HC" trims
  // C1-C2 to the SHORTEST single line, well under half the untrimmed ones.
  // Its middle is inside bare C1's 0.18-bond radius plus the grab slack, and
  // before decision 198 a right-click there opened the atom menu for C1.
  const singles = (await drawnBonds(page))
    .filter((bond) => bond.lines === 1)
    .sort((a, b) => a.length - b.length);
  const stub = singles[0];
  const full = singles[singles.length - 1];
  if (stub === undefined || full === undefined) throw new Error("butan-2-ol drew no single bond as a line");
  expect(stub.length / full.length).toBeLessThan(0.5);

  await page.mouse.click(stub.midpoint.x, stub.midpoint.y, { button: "right" });

  const menu = page.locator(MENU);
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("data-context-menu", "bond");
  await expect(page.locator("[data-context-menu-title]")).toHaveText("Single bond, C–C");

  await page.locator('[data-menu-entry="bond.order.2"]').click();
  await expect.poll(() => linesOf(page, stub.id)).toBe(2);
});

interface PaintedText {
  readonly colour: string;
  readonly background: string;
  readonly contrast: number;
}

/** The ink, the first opaque ground behind it, and the WCAG ratio between them. */
async function paintedText(page: Page, selector: string): Promise<PaintedText> {
  return page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (node === null) throw new Error(`nothing matches ${sel}`);
    const parse = (value: string): number[] =>
      (/rgba?\(([^)]+)\)/.exec(value)?.[1]?.split(",") ?? []).map((p) => Number(p.trim()));
    let ground = "rgb(255, 255, 255)";
    for (let el: Element | null = node; el !== null; el = el.parentElement) {
      const value = getComputedStyle(el).backgroundColor;
      const rgba = parse(value);
      if (rgba.length >= 3 && (rgba[3] ?? 1) > 0.99) {
        ground = value;
        break;
      }
    }
    const colour = getComputedStyle(node).color;
    const luminance = (value: string): number => {
      const [r = 0, g = 0, b = 0] = parse(value);
      const channel = (c: number): number => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const [hi, lo] = [luminance(colour), luminance(ground)].sort((a, b) => b - a) as [number, number];
    return { colour, background: ground, contrast: (hi + 0.05) / (lo + 0.05) };
  }, selector);
}

/**
 * BOTH SCHEMES, like the pickers' check: a light-only run would leave the dark
 * half of the claim unmeasured. `shell/theme.ts` follows `prefers-color-scheme`
 * when nothing is stored, and the run asserts the class landed.
 */
for (const scheme of ["light", "dark"] as const) {
  test.describe(`context menu colours, ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("every row clears 4.5:1 at rest and under the pointer, the unavailable ones included", async ({
      page,
    }) => {
      await openEditor(page);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
        .toBe(scheme === "dark");

      // The middle of the ring: empty canvas, so the canvas menu, where Paste
      // and Redo are unavailable on a fresh document.
      const box = await page.locator(CANVAS).boundingBox();
      if (box === null) throw new Error("no canvas");
      const ring = await page.evaluate((scene) => {
        const circles = [...document.querySelectorAll(`${scene} circle[data-atom-id]`)];
        const centres = circles.map((c) => {
          const r = c.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        return {
          x: centres.reduce((s, p) => s + p.x, 0) / centres.length,
          y: centres.reduce((s, p) => s + p.y, 0) / centres.length,
        };
      }, SCENE);
      await page.mouse.click(ring.x, ring.y, { button: "right" });
      await expect(page.locator(MENU)).toHaveAttribute("data-context-menu", "canvas");

      const refused = '[data-menu-entry="edit.paste"]';
      const live = '[data-menu-entry="select.all"]';
      await expect(page.locator(refused)).toHaveAttribute("data-unavailable", "");
      await expect(page.locator(`${refused} [data-disabled-reason]`)).toBeVisible();

      const measure = async (selector: string, state: string): Promise<void> => {
        const painted = await paintedText(page, selector);
        expect(
          painted.contrast,
          `${selector} ${state}: ${painted.colour} on ${painted.background}`,
        ).toBeGreaterThanOrEqual(4.5);
      };

      await page.mouse.move(box.x + 2, box.y + 2);
      await measure(refused, "at rest");
      await measure(live, "at rest");

      for (const selector of [refused, live]) {
        const row = await page.locator(selector).boundingBox();
        if (row === null) throw new Error(`${selector} has no box`);
        await page.mouse.move(row.x + row.width / 2, row.y + row.height * 0.3);
        await measure(selector, "under the pointer");
      }
      // Under the pointer the live row lit up and the refused one did not.
      const livePainted = await paintedText(page, live);
      const refusedPainted = await paintedText(page, refused);
      expect(livePainted.background).not.toBe(refusedPainted.background);
    });
  });
}
