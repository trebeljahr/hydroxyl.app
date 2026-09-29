import { expect, test } from "@playwright/test";

// chem-render's own source, not a copy: the point of this spec is that the
// numbers the guide prints are these constants. Only type imports leave
// physical.ts, so nothing else of chem-render loads.
import {
  JOURNAL_WIDTHS_CM,
  MIN_PRINTED_LABEL_PT,
  PRINTED_BOND_LENGTH_CM,
  RASTER_DPI_CHOICES,
} from "../packages/chem-render/src/figure/physical";

/**
 * The journal-figure-size guide (manual notes 3, "Landing page and launch").
 *
 * The page is a server component, so its numbers are in the prerendered HTML;
 * each product number sits in a `data-guide-number` span. In the static export
 * the page is moved to `guides-journal-figure-size.html` (decision 137), which
 * `scripts/check-export.mjs` checks for — this spec runs against the
 * standalone build, like every other.
 */

const GUIDE = "/guides/journal-figure-size";
const DIALOG = '[data-shell="export-dialog"]';

test("the guide prerenders, and its product numbers are chem-render's constants", async ({
  page,
}) => {
  const response = await page.goto(GUIDE);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "How big should a chemical structure be in a single-column figure?",
  );

  const expected: Record<string, readonly string[]> = {
    "bond-cm": [String(PRINTED_BOND_LENGTH_CM)],
    "single-cm": [String(JOURNAL_WIDTHS_CM.single)],
    "double-cm": [String(JOURNAL_WIDTHS_CM.double)],
    "min-label-pt": [String(MIN_PRINTED_LABEL_PT)],
    "max-dpi": [String(Math.max(...RASTER_DPI_CHOICES))],
  };
  for (const [key, values] of Object.entries(expected)) {
    const shown = await page.locator(`[data-guide-number="${key}"]`).allTextContents();
    expect(shown.length, key).toBeGreaterThan(0);
    expect([...new Set(shown)], key).toEqual(values);
  }
  expect(await page.locator('[data-guide-number="dpi"]').allTextContents()).toEqual(
    RASTER_DPI_CHOICES.map(String),
  );

  // The derived width: labels at `label-pt` reach the minimum at min/label of
  // full size, so a single column takes a figure up to single × label / min.
  const labelPt = Number(await page.locator('[data-guide-number="label-pt"]').first().textContent());
  const maxNatural = Number(
    await page.locator('[data-guide-number="max-natural-single-cm"]').textContent(),
  );
  expect(maxNatural).toBeCloseTo((JOURNAL_WIDTHS_CM.single * labelPt) / MIN_PRINTED_LABEL_PT, 1);

  // The one-row example is shrunk to the column, labels and all.
  await expect(page.locator('[data-guide-number="one-row-width-cm"]')).toHaveText(
    String(JOURNAL_WIDTHS_CM.single),
  );
  expect(
    Number(await page.locator('[data-guide-number="one-row-label-pt"]').textContent()),
  ).toBeLessThan(MIN_PRINTED_LABEL_PT);
  await expect(page.locator('[data-guide-figure="one-row"] [data-view]')).toHaveCount(4);

  // In the HTML the server sent, not only after hydration.
  const html = await (await page.request.get(GUIDE)).text();
  expect(html).toContain(`data-guide-number="bond-cm">${PRINTED_BOND_LENGTH_CM}<`);
});

test("nothing links to the guide yet", async ({ page }) => {
  // Not from the landing header, the about page or the grid until Rico has
  // read it. When that changes, this test goes with it.
  for (const path of ["/", "/about"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('a[href*="guides"]'), path).toHaveCount(0);
  }
});

test("the guide ends at the export dialog it describes", async ({ page }) => {
  await page.goto(GUIDE);
  const choice = (await page.locator('[data-guide="single-column-choice"]').textContent()) ?? "";
  expect(choice).toBe(`Single column (up to ${JOURNAL_WIDTHS_CM.single} cm)`);

  await page.locator('[data-guide="open-editor"]').click();
  await expect(page.locator('[data-status="formula"]')).toHaveText("C₆H₆");

  // The shortcut the guide names, not the toolbar button.
  await page.keyboard.press("ControlOrMeta+Shift+E");
  const dialog = page.locator(DIALOG);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(choice)).toBeChecked();
  await expect(dialog.locator('[data-shell="figure-style"]')).toHaveAttribute(
    "data-style-preset",
    "publication",
  );
  await expect(dialog.locator('[data-shell="figure-size"]')).toContainText(
    `bond ${(PRINTED_BOND_LENGTH_CM * 10).toFixed(2)} mm`,
  );
  await expect(dialog.locator('[data-shell="figure-size"]')).toContainText("labels 10.0 pt");
});
