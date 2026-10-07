import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// chem-render's own source, not a copy: the point of this spec is that the
// numbers the guide prints are these constants. Only type imports leave
// physical.ts, so nothing else of chem-render loads.
import {
  JOURNAL_WIDTHS_CM,
  MIN_PRINTED_LABEL_PT,
  PRINTED_BOND_LENGTH_CM,
  RASTER_DPI_CHOICES,
} from "../packages/chem-render/src/figure/physical";
// Pure data with no imports, so it loads here by relative path.
import {
  GUIDES,
  guideBySlug,
  releasedGuides,
  unreleasedGuides,
} from "../packages/client/src/components/guides/guides";

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

/**
 * Unreleased guides are linked from nowhere (decision 243): not from the
 * landing, the about page, the index or another guide, not from the sitemap,
 * and their pages ask crawlers to stay away. Releasing a guide in guides.ts
 * moves it out of this test and into the index's.
 */
test("every unreleased guide is linked from nowhere and kept out of search", async ({
  page,
  request,
}) => {
  const unreleased = unreleasedGuides();
  const pages = ["/", "/about", "/guides", ...GUIDES.map((g) => `/guides/${g.slug}`)];
  for (const path of pages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const g of unreleased) {
      await expect(
        page.locator(`a[href*="guides/${g.slug}"], a[href*="guides-${g.slug}"]`),
        `${path} → ${g.slug}`,
      ).toHaveCount(0);
    }
  }

  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const g of unreleased) {
    expect(sitemap, g.slug).not.toContain(g.slug);
    const html = await (await request.get(`/guides/${g.slug}`)).text();
    expect(html, g.slug).toMatch(/<meta name="robots" content="noindex, follow"/);
  }
});

test("the guides index lists exactly the released guides", async ({ page, request }) => {
  const released = releasedGuides();
  await page.goto("/guides");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Guides");
  const listed = await page
    .locator('[data-guides="entry"]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-guide-slug")));
  expect(listed).toEqual(released.map((g) => g.slug));

  // While nothing is released, the index itself is unlinked and unindexed.
  const html = await (await request.get("/guides")).text();
  const navLinks = async (path: string): Promise<number> => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    return page.locator('a[data-nav="guides"]').count();
  };
  if (released.length === 0) {
    await page.goto("/guides");
    await expect(page.locator('[data-guides="empty"]')).toBeVisible();
    expect(html).toMatch(/<meta name="robots" content="noindex, follow"/);
    for (const path of ["/", "/about"]) expect(await navLinks(path), path).toBe(0);
  } else {
    expect(html).not.toMatch(/<meta name="robots"/);
    for (const path of ["/", "/about"]) expect(await navLinks(path), path).toBe(1);
  }
});

test("each guide figure opens in the editor as a new sketch", async ({ page }) => {
  const [twoPerRow, oneRow] = guideBySlug("journal-figure-size").figures;
  for (const [figure, columns] of [
    [twoPerRow, "2"],
    [oneRow, "4"],
  ] as const) {
    await page.goto(GUIDE);
    await page.locator(`a[data-guide-open-example="${figure!.example}"]`).click();
    await expect(page).toHaveURL(new RegExp(`\\?example=${figure!.example}$`));
    await expect(page.locator('[data-status="formula"]')).toHaveText("C₂H₄O₂");
    await expect(page.locator('[data-shell="figure-panels"] [data-panel-id]')).toHaveCount(4);
    // The figure's own layout, which is what tells the two figures apart.
    const input = page.locator("[data-figure-columns]");
    await expect
      .poll(async () => (await input.inputValue()) || (await input.getAttribute("placeholder")))
      .toBe(columns);
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

/**
 * The glycine-zwitterion guide. Its readings are chem-core's, computed at
 * build time; here they are held to what the editor's status bar shows for
 * the same two figures, and its four steps are run as written.
 */
const GLYCINE_GUIDE = "/guides/glycine-zwitterion";
const STATUS_FORMULA = '[data-status="formula"]';

/** The centre of a drawn atom in page px. A labelled atom (N, O) is drawn
 *  as its label text, not a circle, so the box of whichever element carries
 *  the id is what a click aims at. */
async function atomCentre(page: Page, atomId: string): Promise<{ x: number; y: number }> {
  const box = await page
    .locator(`[data-canvas-root] [data-layer="scene"] [data-atom-id="${atomId}"]`)
    .first()
    .boundingBox();
  if (box === null) throw new Error(`atom ${atomId} is not drawn`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("the glycine guide's readings are what the editor shows for each figure", async ({ page }) => {
  const response = await page.goto(GLYCINE_GUIDE);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Glycine as a neutral molecule and as a zwitterion",
  );
  const formula = (await page.locator('[data-guide-number="formula"]').textContent()) ?? "";
  const exact = (await page.locator('[data-guide-number="exact-mass"]').textContent()) ?? "";
  expect(formula).toBe("C₂H₅NO₂");
  await expect(page.locator('[data-guide-row][data-guide-same="false"]')).toHaveCount(3);
  await expect(page.locator('[data-guide-figure="zwitterion"] [data-view]')).toHaveCount(2);

  for (const figure of guideBySlug("glycine-zwitterion").figures) {
    await page.goto(GLYCINE_GUIDE);
    await page.locator(`a[data-guide-open-example="${figure.example}"]`).click();
    await expect(page).toHaveURL(new RegExp(`\\?example=${figure.example}$`));
    await expect(page.locator(STATUS_FORMULA)).toHaveText(formula);
    await expect(page.locator('[data-status="exact-mass"]')).toHaveText(`Exact ${exact}`);
    await expect(page.locator('[data-status="charge"]')).toHaveText("Charge neutral");
    await expect(page.locator('[data-shell="figure-panels"] [data-panel-id]')).toHaveCount(2);
  }
});

test("the glycine guide's steps turn neutral glycine into the zwitterion", async ({ page }) => {
  const [neutral] = guideBySlug("glycine-zwitterion").figures;
  await page.goto(GLYCINE_GUIDE);
  const formula = (await page.locator('[data-guide-number="status-formula"]').textContent()) ?? "";
  const exact = (await page.locator('[data-guide-number="status-exact-mass"]').textContent()) ?? "";
  const increase = (await page.locator('[data-guide="shortcut-increase"]').textContent()) ?? "";
  const decrease = (await page.locator('[data-guide="shortcut-decrease"]').textContent()) ?? "";

  // Step 1: the link under the neutral figure.
  await page.locator(`a[data-guide-open-example="${neutral.example}"]`).click();
  await expect(page.locator(STATUS_FORMULA)).toHaveText(formula);
  const scene = page.locator('[data-canvas-root] [data-layer="scene"]');
  await expect(scene).not.toContainText("+");

  // Steps 2 and 3. glycineMolecule adds N first and the hydroxyl O last.
  const nitrogen = await atomCentre(page, "a1");
  await page.mouse.click(nitrogen.x, nitrogen.y);
  await expect(page.locator('[data-overlay="selected-atom"]')).toHaveCount(1);
  await page.keyboard.press(increase);
  const oxygen = await atomCentre(page, "a5");
  await page.mouse.click(oxygen.x, oxygen.y);
  await page.keyboard.press(decrease === "−" ? "-" : decrease);

  // Step 4: clear the selection, so the bar measures the whole structure.
  await page.locator("[data-canvas-root]").click({ position: { x: 8, y: 8 } });
  await expect(page.locator('[data-overlay="selected-atom"]')).toHaveCount(0);
  await expect(scene).toContainText("+");
  await expect(page.locator(STATUS_FORMULA)).toHaveText(formula);
  await expect(page.locator('[data-status="exact-mass"]')).toHaveText(`Exact ${exact}`);
  await expect(page.locator('[data-status="charge"]')).toHaveText("Charge neutral");
});

/**
 * The formal-charges guide quotes the editor's issue label, list row and fix
 * button. This opens the guide's mistake figure in the real editor and holds
 * the page to what the editor then shows, click by click.
 */
test("the formal-charges guide's mistake opens with the error it quotes, and its fix clears it", async ({
  page,
}) => {
  const guide = "/guides/formal-charges-and-lone-pairs";
  await page.goto(guide);
  const label = (await page.locator('[data-guide="canvas-label"]').textContent()) ?? "";
  const counter = (await page.locator('[data-guide="counter"]').textContent()) ?? "";
  const message = (await page.locator('[data-guide="issue-message"]').textContent()) ?? "";
  const fix = (await page.locator('[data-guide="fix-title"]').textContent()) ?? "";
  const ion = (await page.locator('[data-guide="formula-ion"]').textContent()) ?? "";

  await page.locator('a[data-guide-open-example="formal-charges-mistake"]').click();
  await expect(page).toHaveURL(/\?example=formal-charges-mistake$/);
  await expect(page.locator('[data-overlay="issue-label"]')).toHaveText(label);
  const status = page.locator('[data-status="issues"]');
  await expect(status).toHaveText(counter);

  await status.click();
  const row = page.locator("[data-issue-row]");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(message);
  await row.getByRole("button", { name: fix }).click();
  await expect(status).toHaveText("0 chemistry errors");
  // The fix leaves the nitrogen selected, and the formula then reads the
  // selection; the whole structure is what the guide's figure shows.
  await page.keyboard.press("ControlOrMeta+Shift+A");
  await expect(page.locator('[data-status="formula"]')).toHaveText("H₄N⁺");

  await page.goto(guide);
  await page.locator('a[data-guide-open-example="formal-charges-acetate"]').click();
  await expect(page.locator('[data-status="formula"]')).toHaveText(ion);
});

/**
 * The multi-panel guide (manual notes 3, "Content and guides", P1.2).
 *
 * Its sizes are unit-tested against the export path; what only a browser can
 * prove is that the nine steps, read off the page and clicked in that order,
 * build the figure the page shows.
 */

const MULTI_PANEL = "/guides/multi-panel-figure";
const PANELS = '[data-shell="figure-panels"]';

test("the multi-panel guide prerenders, with chem-render's column and label numbers", async ({
  page,
}) => {
  const response = await page.goto(MULTI_PANEL);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    guideBySlug("multi-panel-figure").title,
  );
  expect([...new Set(await page.locator('[data-guide-number="single-cm"]').allTextContents())]).toEqual([
    String(JOURNAL_WIDTHS_CM.single),
  ]);
  await expect(page.locator('[data-guide-number="min-label-pt"]')).toHaveText(
    String(MIN_PRINTED_LABEL_PT),
  );
  const width = Number(await page.locator('[data-guide-number="finished-width-cm"]').first().textContent());
  expect(width).toBeLessThan(JOURNAL_WIDTHS_CM.single);
  await expect(page.locator('[data-guide-figure="finished"] [data-panel-label]')).toHaveCount(4);
  await expect(page.locator('[data-guide-figure="automatic"] [data-panel-label]')).toHaveCount(4);
});

test("each multi-panel figure opens in the editor with its captions and columns", async ({
  page,
}) => {
  const [finished, automatic] = guideBySlug("multi-panel-figure").figures;
  for (const [figure, columns] of [
    [finished, "2"],
    [automatic, "3"],
  ] as const) {
    await page.goto(MULTI_PANEL);
    const captions = await page.locator('[data-guide="caption-text"]').allTextContents();
    await page.locator(`a[data-guide-open-example="${figure!.example}"]`).click();
    await expect(page).toHaveURL(new RegExp(`\\?example=${figure!.example}$`));
    await expect(page.locator('[data-status="formula"]')).toHaveText("C₉H₈O₄");
    await expect(page.locator(`${PANELS} [data-panel-id]`)).toHaveCount(4);
    await expect
      .poll(() => page.locator(`${PANELS} [data-panel-caption]`).evaluateAll((inputs) =>
        inputs.map((i) => (i as HTMLInputElement).value),
      ))
      .toEqual(captions);
    const input = page.locator("[data-figure-columns]");
    await expect
      .poll(async () => (await input.inputValue()) || (await input.getAttribute("placeholder")))
      .toBe(columns);
  }
});

test("the multi-panel guide's steps, clicked in order, build the figure it shows", async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto(MULTI_PANEL);
  const control = async (k: string): Promise<string> =>
    (await page.locator(`[data-guide-control="${k}"]`).first().textContent()) ?? "";
  const views = { b: await control("view-b"), c: await control("view-c") };
  const captions = await page.locator('[data-guide="caption-text"]').allTextContents();
  const columns = (await page.locator('[data-guide-number="columns"]').first().textContent()) ?? "";
  const singleColumn = await control("single-column");
  const insertText = (await page.locator('[data-guide="insert-text"]').textContent()) ?? "";
  const size = (await page.locator('[data-guide-number="finished-size"]').first().textContent()) ?? "";
  const newSketch = await page.locator('[data-guide="new-sketch-view"]').allTextContents();
  const insert = await control("insert");
  const addPanel = await control("add-panel");
  const captionLabel = await control("caption");
  const columnsLabel = await control("columns");

  // 1. Open the editor and clear the benzene it opens on.
  await page.locator('[data-guide="open-editor"]').click();
  await expect(page.locator('[data-status="formula"]')).toHaveText("C₆H₆");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await expect(page.locator('[data-canvas-root] [data-layer="scene"] [data-atom-id]')).toHaveCount(0);

  // 2. Insert aspirin by name.
  await page.getByRole("button", { name: insert }).click();
  await page.locator('[data-shell="insert-input"]').fill(insertText);
  await expect(page.locator('[data-shell="insert-candidates"] [role="option"]').first()).toContainText(
    insertText,
  );
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-shell="insert-dialog"]')).toBeHidden();

  // 3. The two panels a new sketch has.
  const rows = page.locator(`${PANELS} [data-panel-id]`);
  await expect(rows).toHaveCount(2);
  expect(
    await rows.evaluateAll((r) => r.map((row) => row.getAttribute("aria-label") ?? "")),
  ).toEqual(newSketch.map((view, i) => `Panel (${"ab"[i]}), ${view}. Alt+Up and Alt+Down reorder.`));

  // 4 and 5. Add (c) and (d) from the menu under the list.
  for (const view of [views.b, views.c]) {
    await page.getByLabel("View for the new panel").click();
    await page.getByRole("option", { name: view, exact: true }).click();
    await page.getByRole("button", { name: addPanel }).click();
  }
  await expect(rows).toHaveCount(4);

  // 6. The second panel moves down twice, to (d).
  await page.getByRole("button", { name: "Move panel (b) down" }).click();
  await page.getByRole("button", { name: "Move panel (c) down" }).click();
  await expect
    .poll(() => rows.evaluateAll((r) => r.map((row) => row.getAttribute("data-panel-kind"))))
    .toEqual(["skeletal", "explicitH", "lewis", "sumFormula"]);

  // 7. Captions.
  const fields = page.getByLabel(captionLabel, { exact: true });
  for (const [i, caption] of captions.entries()) {
    await fields.nth(i).fill(caption);
    await fields.nth(i).press("Enter");
  }

  // 8. Columns.
  const columnsField = page.getByLabel(columnsLabel, { exact: true });
  await columnsField.fill(columns);
  await columnsField.press("Enter");

  // 9. Export at a single column: the size the guide prints.
  await page.keyboard.press("ControlOrMeta+Shift+E");
  const dialog = page.locator(DIALOG);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(singleColumn).check();
  await expect(dialog.locator('[data-shell="figure-size"]')).toContainText(`Prints ${size}`);
  await expect(dialog.locator('[data-shell="figure-fit"]')).toHaveText("Printed at its natural size.");
});
