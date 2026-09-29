import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Curly arrows in the shipped app: a sketch file carrying two stored arrows
 * opens with both drawn on the canvas, each as a stroked shaft and a filled
 * head filed under its annotation id, and a style switch redraws them rather
 * than dropping them.
 *
 * The fixture is chem-render's `cyanideAdditionToAcetone` written through
 * shared's `encodeDocument`, so it is the same two arrows the unit tests and
 * the goldens pin. Nothing in the app draws an arrow yet (the arrow tools are
 * a later task), so a dropped file is the only way one reaches the canvas.
 */

const CANVAS = "[data-canvas-root]";

// From the repo root, which is where Playwright runs.
const SKETCH = readFileSync(
  join(process.cwd(), "e2e", "fixtures", "cyanide-addition-curly-arrows.json"),
  "utf8",
);

async function openEditor(page: Page): Promise<void> {
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

test("a sketch's stored curly arrows are drawn as shaft and head, and survive a style switch", async ({
  page,
}) => {
  await openEditor(page);
  await dropFile(page, "cyanide-addition.chemsketch.json", SKETCH);

  for (const id of ["ann_1", "ann_2"]) {
    const arrow = page.locator(`${CANVAS} [data-annotation-id="${id}"]`);
    await expect(arrow).toHaveCount(2);
    const shaft = page.locator(`${CANVAS} path[data-annotation-id="${id}"]`);
    await expect(shaft).toHaveAttribute("id", `annotation:${id}:shaft`);
    // An open curve with no fill would render as a black blob.
    await expect(shaft).toHaveAttribute("fill", "none");
    await expect(page.locator(`${CANVAS} polygon[data-annotation-id="${id}"]`)).toHaveAttribute(
      "id",
      `annotation:${id}:head`,
    );
    // Never filed under the atom it points at, which would grow its pick target.
    await expect(arrow.first()).not.toHaveAttribute("data-atom-id", /.*/);
  }

  const shaft = page.locator(`${CANVAS} path[data-annotation-id="ann_1"]`);
  const screenPath = await shaft.getAttribute("d");
  await page.locator('[data-shell="style-preset"] [data-command="view.style-publication"]').click();
  await expect(shaft).not.toHaveAttribute("d", screenPath ?? "");
  await expect(page.locator(`${CANVAS} [data-annotation-id]`)).toHaveCount(4);
});
