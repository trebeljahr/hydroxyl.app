import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Enhanced stereochemistry in a real browser: mark a racemate, read `rac-` off
 * the figure, and see the export dialog say the file changed generation.
 *
 * Everything else about this feature is a unit test — chem-core's codec, the
 * coverage query, the four commands, the annotation geometry. What only a
 * browser proves is that the chain holds in the shipped app, and it is a long
 * one: an imported V2000 file's wedges become stereocentres, a palette command
 * writes a collection onto the document, chem-core's coverage query turns that
 * into `rac-`, the one annotation pass draws it above the structure's own ink
 * (decision 88), and the export dialog's sentence about V3000 comes from the
 * same function that picks the bytes (decision 49).
 *
 * WHY THE PREFIX AND NOT A STATUS LINE. Decision 88 rejected a status-bar-only
 * prefix precisely because the exported FIGURE would then read as a single
 * enantiomer. So the assertion that matters is on the canvas, and the status
 * line is checked only as the thing that reports the edit.
 *
 * 3-chlorobutan-2-ol: two stereocentres, one wedge and one hash, so marking the
 * whole selection puts both in one AND group — which is the case decision 40
 * says reads `rac-` with the per-centre tags OMITTED, and both halves of that
 * are asserted.
 */

const CANVAS = "[data-canvas-root]";
const STATUS_BAR = '[data-shell="status-bar"]';
const MESSAGE = '[data-status="message"]';
const DIALOG = '[data-shell="export-dialog"]';
const PREFIX = `${CANVAS} [id="structure:stereoPrefix"]`;
const GROUP_TAG = `${CANVAS} [id$=":stereoGroup"]`;

// From the repo root, which is where Playwright runs: the spec is compiled
// to CommonJS, so `import.meta.url` is not available to locate it.
const MOLFILE = readFileSync(
  join(process.cwd(), "e2e", "fixtures", "chlorobutan2ol-wedges.mol"),
  "utf8",
);

async function openEditor(page: Page): Promise<void> {
  await page.goto("/editor");
  await page.locator(`${CANVAS} [data-layer="scene"]`).waitFor();
  await expect(page.locator(STATUS_BAR)).toBeVisible();
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

async function setViewFlag(page: Page, flag: string): Promise<void> {
  await page.locator('[data-shell="view-options"]').click();
  await page.locator(`[data-view-flag="${flag}"]`).check();
  await page.keyboard.press("Escape");
}

/** Decision 89's commands are palette-only: no shortcut is worth taking from a
 *  tool or an element for a mark a figure needs once. */
async function runFromPalette(page: Page, id: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(`[data-palette-command="${id}"]`)).toBeVisible();
  await page.click(`[data-palette-command="${id}"]`);
  await expect(page.locator(`[data-palette-command="${id}"]`)).toHaveCount(0);
}

test("marks a racemate, says rac- on the figure, and exports V3000", async ({ page }) => {
  await openEditor(page);
  await dropMolfile(page, "chlorobutan2ol.mol", MOLFILE);
  await expect(page.locator('[data-status="formula"]')).toHaveText("C₄H₉ClO");

  // The flag is the one switch a figure has for stereochemistry, and decision
  // 40 gates the tag and the prefix on it along with the descriptors.
  await setViewFlag(page, "showStereoDescriptors");
  await expect(page.locator(`${CANVAS} [id$=":descriptor"]`)).toHaveCount(2);
  // Nothing states a group yet, so there is no prefix and no tag. This is also
  // the assertion that a molecule with no `stereoGroups` asks the annotation
  // pass for nothing new (decision 71).
  await expect(page.locator(PREFIX)).toHaveCount(0);
  await expect(page.locator(GROUP_TAG)).toHaveCount(0);

  // The ordinary gesture: select the whole molecule and mark it racemic. It
  // acts on the CENTRES among the selection, so the methyls, the OH and the Cl
  // do not arrive in the collection.
  await page.keyboard.press("ControlOrMeta+a");
  await runFromPalette(page, "structure.stereo-group-and");

  await expect(page.locator(`${STATUS_BAR} ${MESSAGE}`)).toHaveText(
    "2 stereocentres in stereo group and1; the figure now reads rac-",
  );

  // Decision 88: on the figure, not merely in the status bar.
  const prefix = page.locator(PREFIX);
  await expect(prefix).toHaveCount(1);
  await expect(prefix).toHaveText("rac-");
  // Decision 40: one AND group over every centre, so the per-centre tags are
  // omitted — the prefix already says the same thing about both of them.
  await expect(page.locator(GROUP_TAG)).toHaveCount(0);

  // Decision 49: the app picked V3000 because the structure states a group, and
  // the dialog says so BEFORE anything is written — a chemist handing the file
  // to old instrument software needs to know it is not V2000.
  await page.locator('[data-command="figure.export-dialog"]').click();
  await expect(page.locator(DIALOG)).toBeVisible();
  const notice = page.locator(`${DIALOG} [data-shell="molfile-version"]`);
  await expect(notice).toHaveAttribute("data-molfile-version", "V3000");
  // It names the group with the same spelling the figure would print beside the
  // centres, so the sentence and the drawing need no translating between them.
  await expect(notice).toContainText("V3000 molfile");
  await expect(notice).toContainText("(and1)");
  await page.keyboard.press("Escape");

  // And clearing the group takes both away again, which is what makes the
  // switch reversible rather than a one-way door.
  await runFromPalette(page, "structure.stereo-group-clear");
  await expect(page.locator(`${STATUS_BAR} ${MESSAGE}`)).toHaveText(
    "Cleared the stereo group on 2 atoms",
  );
  await expect(page.locator(PREFIX)).toHaveCount(0);

  await page.locator('[data-command="figure.export-dialog"]').click();
  await expect(page.locator(DIALOG)).toBeVisible();
  // V2000 is the default again, and the dialog is silent about the generation:
  // a notice on every export would be noise on the ordinary case.
  await expect(page.locator(`${DIALOG} [data-shell="molfile-version"]`)).toHaveCount(0);
});
