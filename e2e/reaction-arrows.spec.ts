import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Reaction schemes in the shipped app: a sketch holding straight arrows,
 * conditions, plus signs, a transition state's bracket, partial bonds and
 * deltas opens with all of them drawn on the canvas, the conditions set at
 * the width the renderer measured them at, and the exported figure holds
 * every mark inside its viewBox.
 *
 * The fixtures are chem-render's `prolineAldol` and `sn2TransitionState`
 * written through shared's `encodeDocument` (a shared unit test keeps them in
 * step). Nothing in the app draws a scheme mark yet — the arrow tools are a
 * later task — so a dropped file is the only way one reaches the canvas.
 */

const CANVAS = "[data-canvas-root]";
const DIALOG = '[data-shell="export-dialog"]';

const fixture = (name: string): string => readFileSync(join(process.cwd(), "e2e", "fixtures", name), "utf8");
const ALDOL = fixture("proline-aldol-scheme.json");
const SN2 = fixture("sn2-transition-state-scheme.json");

async function openEditor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/editor");
  await page.locator(`${CANVAS} [data-layer="scene"]`).waitFor();
}

async function dropFile(page: Page, name: string, text: string): Promise<void> {
  const transfer = await page.evaluateHandle(
    ({ name: fileName, text: contents }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([contents], fileName, { type: "application/json" }));
      return dt;
    },
    { name, text },
  );
  await page.dispatchEvent("body", "drop", { dataTransfer: transfer });
}

test("the aldol's arrow is drawn geometry, its conditions set above and below at the width they were measured at", async ({
  page,
}) => {
  await openEditor(page);
  await dropFile(page, "proline-aldol.chemsketch.json", ALDOL);

  // Shaft, head, and one run above and one below; the plus as a stroked path.
  await expect(page.locator(`${CANVAS} [data-annotation-id="ann_2"]`)).toHaveCount(4);
  await expect(page.locator(`${CANVAS} line[data-annotation-id="ann_2"]`)).toHaveAttribute("id", "annotation:ann_2:shaft");
  await expect(page.locator(`${CANVAS} polygon[data-annotation-id="ann_2"]`)).toHaveAttribute("id", "annotation:ann_2:head");
  const plus = page.locator(`${CANVAS} path[data-annotation-id="ann_1"]`);
  await expect(plus).toHaveAttribute("fill", "none");
  // No arrow and no plus is a glyph.
  await expect(page.locator(`${CANVAS} text`, { hasText: /[→⇌⇒↔]/ })).toHaveCount(0);

  const measured = await page.evaluate((root) => {
    const scope = document.querySelector(root)!;
    const shaft = scope.querySelector('line[data-annotation-id="ann_2"]')!;
    const head = scope.querySelector('polygon[data-annotation-id="ann_2"]')!;
    const [tipX, tipY] = head.getAttribute("points")!.split(/[\s,]+/).map(Number);
    const tailX = Number(shaft.getAttribute("x1"));
    const lines = [...scope.querySelectorAll<SVGTextElement>('text[data-annotation-id="ann_2"]')].map((text) => ({
      id: text.id,
      text: text.textContent,
      x: Number(text.getAttribute("x")),
      y: Number(text.getAttribute("y")),
      fontSize: Number(text.getAttribute("font-size")),
      rendered: text.getComputedTextLength(),
    }));
    return { tailX, tipX: tipX!, tipY: tipY!, lines };
  }, CANVAS);

  expect(measured.lines.map((l) => [l.id, l.text])).toEqual([
    ["annotation:ann_2:conditions-above-0", "L-proline (30 mol%)"],
    ["annotation:ann_2:conditions-below-0", "DMSO, rt"],
  ]);
  const middle = (measured.tailX + measured.tipX) / 2;
  const [above, below] = measured.lines;
  expect(above!.y).toBeLessThan(measured.tipY);
  expect(below!.y).toBeGreaterThan(measured.tipY);
  for (const line of measured.lines) expect(Math.abs(line.x - middle)).toBeLessThan(0.01);
  // The shaft is the widest line's MEASURED advance plus an em (decision
  // 203): what the browser renders for that line must be the same width, or
  // the text sits off-centre over the shaft by half the difference.
  const lengthPx = measured.tipX - measured.tailX;
  const measuredWidest = lengthPx - above!.fontSize;
  expect(Math.abs(above!.rendered - measuredWidest)).toBeLessThan(0.5);
  expect(below!.rendered).toBeLessThan(above!.rendered);
});

test("the SN2 transition state is bracketed with its dagger and charge, dashed partial bonds and deltas; the export encloses it all", async ({
  page,
}, testInfo) => {
  await openEditor(page);
  await dropFile(page, "sn2.chemsketch.json", SN2);

  await expect(page.locator(`${CANVAS} polyline[data-annotation-id="ann_7"]`)).toHaveCount(2);
  // The double dagger is three strokes, never a U+2021 glyph.
  await expect(page.locator(`${CANVAS} line[data-annotation-id="ann_7"]`)).toHaveCount(3);
  await expect(page.locator(`${CANVAS} text`, { hasText: "‡" })).toHaveCount(0);
  await expect(page.locator(`${CANVAS} text[data-annotation-id="ann_7"]`)).toHaveText("−");
  for (const id of ["ann_3", "ann_4"]) {
    await expect(page.locator(`${CANVAS} line[data-annotation-id="${id}"]`)).toHaveAttribute("stroke-dasharray", /\d/);
  }
  // The deltas, placed by the label pass and sourced to their annotations.
  for (const id of ["ann_5", "ann_6"]) {
    const delta = page.locator(`${CANVAS} text[data-annotation-id="${id}"]`);
    await expect(delta).toHaveText("δ−");
    await expect(delta).toHaveAttribute("id", /:partialCharge$/);
  }
  // Both arrows stop outside the bracket.
  const extents = await page.evaluate((root) => {
    const scope = document.querySelector(root)!;
    const xs = (selector: string) =>
      [...scope.querySelectorAll(selector)].flatMap((el) => {
        const box = (el as SVGGraphicsElement).getBBox();
        return [box.x, box.x + box.width];
      });
    return {
      bracket: xs('polyline[data-annotation-id="ann_7"]'),
      into: xs('[data-annotation-id="ann_2"]'),
      out: xs('[data-annotation-id="ann_8"]'),
    };
  }, CANVAS);
  expect(Math.max(...extents.into)).toBeLessThan(Math.min(...extents.bracket));
  expect(Math.min(...extents.out)).toBeGreaterThan(Math.max(...extents.bracket));

  // The exported figure draws every mark, and opened on its own clips none.
  await page.locator('[data-command="figure.export-dialog"]').click();
  await expect(page.locator(DIALOG)).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(`${DIALOG} [data-command="figure.export-svg"]`).click(),
  ]);
  const svg = readFileSync(await download.path(), "utf8");
  for (const id of ["ann_1", "ann_2", "ann_3", "ann_4", "ann_5", "ann_6", "ann_7", "ann_8", "ann_9"]) {
    expect(svg, id).toContain(`data-annotation="${id}"`);
  }
  const file = testInfo.outputPath("sn2-scheme.svg");
  writeFileSync(file, svg);
  const standalone = await page.context().newPage();
  try {
    await standalone.goto(`file://${file}`);
    const clipped = await standalone.evaluate(() => {
      const root = document.documentElement.getBoundingClientRect();
      return [...document.querySelectorAll("[data-annotation]")].flatMap((el) => {
        const box = el.getBoundingClientRect();
        const inside =
          box.left >= root.left - 0.5 &&
          box.right <= root.right + 0.5 &&
          box.top >= root.top - 0.5 &&
          box.bottom <= root.bottom + 0.5;
        return inside ? [] : [el.id];
      });
    });
    expect(clipped).toEqual([]);
    await standalone.screenshot({ path: testInfo.outputPath("sn2-scheme.png") });
  } finally {
    await standalone.close();
  }
});
