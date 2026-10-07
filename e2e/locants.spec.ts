import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Locants in a real browser: the document's numbering reaches the canvas and
 * the exported file, and the view-options switch is live exactly when there
 * is something to number (decisions 37, 56, 168).
 *
 * The chemistry is unit-tested in chem-core and the wiring in the client's
 * `canvas/locants.test.ts`. What only a browser proves is the chain in the
 * shipped app: an inserted sugar makes the switch live, the switch reaches the
 * canvas's build, and the downloaded SVG carries the same number beside the
 * same atom as the canvas.
 *
 * /editor opens on benzene, which nothing numbers. Open-chain D-glucose is
 * inserted beside it: C1 (the aldehyde) to C6.
 */

const CANVAS = "[data-canvas-root]";
const SCENE = `${CANVAS} [data-layer="scene"]`;
const FORMULA = '[data-status="formula"]';
const DIALOG = '[data-shell="export-dialog"]';
const LOCANTS_BOX = '[data-view-flag="showLocants"]';

async function openEditor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/editor");
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(6);
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");
}

/** Each locant the canvas draws, keyed by its atom id. */
async function canvasLocants(page: Page): Promise<Record<string, string>> {
  return page.evaluate((scene) => {
    const drawn: Record<string, string> = {};
    for (const node of document.querySelectorAll(`${scene} [id$=":locant"]`)) {
      const atomId = /^atom:(.+):locant$/.exec(node.id)?.[1];
      if (atomId !== undefined) drawn[atomId] = node.textContent ?? "";
    }
    return drawn;
  }, SCENE);
}

/** Each locant the downloaded file's skeletal panel draws, keyed by atom id. */
function fileLocants(svg: string): Record<string, string> {
  const drawn: Record<string, string> = {};
  const pattern = /<text id="p-panel-skeletal\.atom:[^"]+:locant" data-atom="([^"]+)"[^>]*><tspan>([^<]*)<\/tspan>/g;
  for (const [, atomId, text] of svg.matchAll(pattern)) drawn[atomId!] = text!;
  return drawn;
}

async function downloadSvg(page: Page): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(`${DIALOG} [data-command="figure.export-svg"]`).click(),
  ]);
  return readFileSync(await download.path()).toString("utf8");
}

test("an inserted sugar makes the locants switch live, and the file carries the canvas's numbers", async ({
  page,
}) => {
  await openEditor(page);

  // Benzene: nothing is numbered, so the switch is refused and says why.
  await page.locator('[data-shell="view-options"]').click();
  await expect(page.locator(LOCANTS_BOX)).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.locator('[data-command="structure.insert"]').click();
  await page.locator('[data-shell="insert-input"]').fill("aldehydo-D-glucose");
  await expect(page.locator('[data-shell="insert-candidates"] [role="option"]').first()).toContainText(
    "D-glucose (open chain)",
  );
  await page.keyboard.press("Enter");
  // The inserted sugar stays selected and the bar measures it (decision 235).
  await expect(page.locator(FORMULA)).toHaveText("C₆H₁₂O₆");
  await page.keyboard.press("ControlOrMeta+Shift+a");
  await expect(page.locator(FORMULA)).toHaveText("C₁₂H₁₈O₆");

  // Now something is numbered: the switch is live, and turning it on draws
  // C1 to C6 — Screen, the new document's style, has room for all six.
  await page.locator('[data-shell="view-options"]').click();
  await expect(page.locator(LOCANTS_BOX)).toBeEnabled();
  await page.locator(LOCANTS_BOX).check();
  await page.keyboard.press("Escape");
  await expect(page.locator(`${SCENE} [id$=":locant"]`)).toHaveCount(6);
  const onCanvas = await canvasLocants(page);
  expect(Object.values(onCanvas).sort()).toEqual(["1", "2", "3", "4", "5", "6"]);

  // Exported as shown on the canvas: the same number beside the same atom.
  await page.locator('[data-command="figure.export-dialog"]').click();
  await expect(page.locator(DIALOG)).toBeVisible();
  await page.locator('[data-shell="figure-style"] input[value="canvas"]').check();
  expect(fileLocants(await downloadSvg(page))).toEqual(onCanvas);

  // At Publication, the export's default, the file prints no number the
  // canvas does not give that atom.
  await page.locator('[data-shell="figure-style"] input[value="publication"]').check();
  const publication = fileLocants(await downloadSvg(page));
  expect(Object.keys(publication).length).toBeGreaterThan(0);
  for (const [atomId, text] of Object.entries(publication)) expect(onCanvas[atomId]).toBe(text);
});
