import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The landing page, and the local-only library around it (decisions 108 and
 * 109).
 *
 * Each Playwright test gets its own browser context and so its own empty
 * IndexedDB, which is exactly a first visit.
 *
 * `showSaveFilePicker` and `showOpenFilePicker` both EXIST in Playwright's
 * Chromium, and a test that lets either open hangs on a native dialog. Both
 * are deleted, so the export takes the download fallback and the import takes
 * the `<input type="file">` fallback — the paths Firefox and Safari use anyway.
 */

const HEADLINE = "Draw the molecule once. Export every view your figure needs.";
const FORMULA = '[data-status="formula"]';
const SAVE_STATE = '[data-status="save-state"]';

const ETHANOL_MOLBLOCK = `Ethanol
  chemcore          2D

  3  2  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.5000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    2.2500    1.2990    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0  0  0  0
  2  3  1  0  0  0  0
M  END
`;

const ACETONE_MOLBLOCK = `Acetone
  chemcore          2D

  4  3  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.2990    0.7500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    2.5981    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.2990    2.2500    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0  0  0  0
  2  3  1  0  0  0  0
  2  4  2  0  0  0  0
M  END
`;

async function withoutNativePickers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { showSaveFilePicker?: unknown; showOpenFilePicker?: unknown };
    delete w.showSaveFilePicker;
    delete w.showOpenFilePicker;
  });
}

/** Two sketches in storage, the way a chemist gets them: an SDF dropped on
 *  the editor, which decision 7 splits into one sketch per record. */
async function seedTwoSketches(page: Page): Promise<void> {
  await page.goto("/editor");
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");
  const transfer = await page.evaluateHandle((contents) => {
    const dt = new DataTransfer();
    dt.items.add(new File([contents], "two.sdf", { type: "text/plain" }));
    return dt;
  }, `${ETHANOL_MOLBLOCK}$$$$\n${ACETONE_MOLBLOCK}$$$$\n`);
  await page.dispatchEvent("body", "drop", { dataTransfer: transfer });
  await expect(page.locator(FORMULA)).toHaveText("C₂H₆O");
  await expect(page.locator(`${SAVE_STATE}[data-save-status="saved"]`)).toBeVisible({ timeout: 10_000 });
}

test("a first visit to / shows what the editor is for, with a real exported figure", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.locator('[data-recents="empty"]')).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADLINE);
  // The figure is the export path's own SVG, so its panels carry the views.
  const figure = page.locator('[data-landing="figure"]');
  await expect(figure.locator("[data-view]")).toHaveCount(4);
  await expect(figure.locator('[data-view="lewis"]')).toBeVisible();
  await expect(figure.locator("figcaption")).toContainText(/prints \d+\.\d × \d+\.\d cm/);

  // Nothing to export yet; a library from another computer can still come in.
  await expect(page.locator('[data-recents="import"]')).toBeVisible();
  await expect(page.locator('[data-recents="export-all"]')).toHaveCount(0);

  await page.locator('[data-landing="start"]').click();
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");
});

test("/about is the same page on its own, and links back to the sketches", async ({ page }) => {
  const response = await page.goto("/about");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADLINE);
  await expect(page.getByRole("heading", { name: "Not in this version" })).toBeVisible();

  const notices = await page.request.get(
    (await page.getByText("Third-party licences").getAttribute("href")) ?? "",
  );
  expect(notices.status()).toBe(200);

  await page.locator('[data-about="sketches"]').click();
  await expect(page.locator('[data-recents="empty"]')).toBeVisible();
});

test("once a sketch exists, / is the grid and the landing page moves behind About", async ({
  page,
}) => {
  await seedTwoSketches(page);
  await page.goto("/");

  await expect(page.locator('[data-recents="card"]')).toHaveCount(2);
  await expect(page.getByText(HEADLINE)).toHaveCount(0);
  await expect(page.locator('[data-recents="storage"]')).toContainText(
    "stored in this browser only",
  );

  await page.locator('[data-recents="about"]').click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADLINE);
});

test("Export all sketches writes one file that Import restores in an empty browser", async ({
  page,
  browser,
}) => {
  await withoutNativePickers(page);
  await seedTwoSketches(page);
  await page.goto("/");
  await expect(page.locator('[data-recents="card"]')).toHaveCount(2);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('[data-recents="export-all"]').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^chemistry-sketcher-library-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.locator('[data-recents="notice"]')).toContainText("Exported 2 sketches");
  const path = await download.path();
  const file = JSON.parse(await readFile(path, "utf8")) as { format: string; documents: unknown[] };
  expect(file.format).toBe("chemistry-sketcher-library");
  expect(file.documents).toHaveLength(2);

  // Another computer: a fresh context has its own, empty IndexedDB.
  const other = await browser.newContext();
  const fresh = await other.newPage();
  await withoutNativePickers(fresh);
  await fresh.goto("/");
  await expect(fresh.locator('[data-recents="empty"]')).toBeVisible();

  const [chooser] = await Promise.all([
    fresh.waitForEvent("filechooser"),
    fresh.locator('[data-recents="import"]').click(),
  ]);
  await chooser.setFiles(path);

  await expect(fresh.locator('[data-recents="card"]')).toHaveCount(2);
  await expect(fresh.locator('[data-recents="notice"]')).toHaveText("Imported 2 sketches.");
  const titles = await fresh.locator('[data-recents="title"]').allTextContents();
  expect(titles.sort()).toEqual(["Acetone", "Ethanol"]);

  // And the restored sketch is the same chemistry, not only the same title.
  await fresh.locator('[data-recents="card"]', { hasText: "Acetone" }).locator('[data-recents="open"]').click();
  await expect(fresh.locator(FORMULA)).toHaveText("C₃H₆O");
  await other.close();
});
