import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Stereo descriptors in a real browser, and what the status bar says about the
 * ones that could not be placed (decisions 62 and 69).
 *
 * Everything else that tests this is a unit test: jsdom draws nothing and the
 * annotation pass is pure. What only a browser proves is that the chain holds
 * in the shipped app — an imported file's wedge becomes a stereocentre, the
 * switcher's checkbox reaches the canvas's build, the descriptor is drawn (or
 * deliberately is not), and the count in the status bar comes from that same
 * build rather than a second opinion.
 *
 * Butan-2-ol rather than a ring: one stereocentre and four heavy atoms. Its
 * "(R)" is drawn in both styles and in every view, so the status bar stays
 * quiet (decision 70). Before decision 219, C2 drew "HC" at Publication and
 * the (R) was dropped once the hydrogens were shown; a dropped annotation's
 * count is now pinned on the steroid in shell/StatusBar.test.tsx.
 */

const CANVAS = "[data-canvas-root]";
const STATUS_BAR = '[data-shell="status-bar"]';
const UNPLACED = '[data-status="annotations"]';

// From the repo root, which is where Playwright runs: the spec is compiled
// to CommonJS, so `import.meta.url` is not available to locate it.
const MOLFILE = readFileSync(join(process.cwd(), "e2e", "fixtures", "butan2ol-wedge.mol"), "utf8");

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

test("keeps quiet while the descriptor is drawn, in both styles and with every hydrogen shown", async ({
  page,
}) => {
  await openEditor(page);
  await dropMolfile(page, "butan2ol.mol", MOLFILE);
  await expect(page.locator('[data-status="formula"]')).toHaveText("C₄H₁₀O");
  // Nothing is annotated yet, so there is nothing to report.
  await expect(page.locator(UNPLACED)).toHaveCount(0);

  // An imported structure opens in Publication (decision 135), which sets
  // the descriptor at 8 pt on a 24 px bond. With C2 a bare vertex
  // (decision 219) it has a clear slot, and the status bar says nothing.
  const presets = page.locator('[data-shell="style-preset"]');
  await expect(presets).toHaveAttribute("data-style-preset", "publication");
  await setViewFlag(page, "showStereoDescriptors");
  const descriptor = page.locator(`${CANVAS} [id$=":descriptor"]`);
  const unplaced = page.locator(UNPLACED);
  await expect(descriptor).toHaveCount(1);
  await expect(descriptor).toHaveText("(R)");
  await expect(unplaced).toHaveCount(0);

  // Screen's 44 px bond leaves the (R) a clear slot: it is drawn and nothing
  // is reported.
  await presets.locator('[data-command="view.style-screen"]').click();
  await expect(presets).toHaveAttribute("data-style-preset", "screen");
  await expect(descriptor).toHaveCount(1);
  await expect(descriptor).toHaveText("(R)");
  await expect(unplaced).toHaveCount(0);
  await presets.locator('[data-command="view.style-publication"]').click();
  await expect(presets).toHaveAttribute("data-style-preset", "publication");

  // With the hydrogens shown, and in the Explicit H view that draws every
  // one of them, the (R) still keeps its clearance: C2 itself draws no "HC"
  // since decision 219, so nothing is dropped and the bar stays quiet. The
  // count for an annotation that IS dropped (the steroid's C13 and C10 (S)
  // in Explicit H) is pinned in shell/StatusBar.test.tsx.
  await setViewFlag(page, "showImplicitHydrogens");
  await expect(descriptor).toHaveCount(1);
  await expect(unplaced).toHaveCount(0);
  await page.locator('[data-shell="figure-panels"] [data-panel-kind="skeletal"] [role="combobox"]').click();
  await page.getByRole("option", { name: "Explicit H", exact: true }).click();
  await expect(page.locator('[data-shell="figure-panels"] [data-panel-kind="explicitH"]')).toHaveCount(1);
  await expect(descriptor).toHaveCount(1);
  await expect(descriptor).toHaveText("(R)");
  await expect(unplaced).toHaveCount(0);
});
