import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The element picker's "Show all elements" table, end to end: open it from
 * the rail, place an element the quick picker does not carry, find one by
 * search and by the arrow keys, and find the pick pinned in the quick picker
 * afterwards — across a reload too.
 *
 * Every placement starts from a NEW sketch, so the status bar's formula is the
 * placed atom and nothing else, and "Pt" in it cannot be a leftover.
 */

const CANVAS = "[data-canvas-root]";
const SCENE = '[data-canvas-root] [data-layer="scene"]';
const TABLE = '[data-shell="periodic-table"]';
const FORMULA = '[data-status="formula"]';

async function openEmptyEditor(page: Page): Promise<void> {
  await page.goto("/editor");
  await page.locator(SCENE).waitFor();
  await page.keyboard.press("ControlOrMeta+k");
  await page.click('[data-palette-command="file.new"]');
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(0);
}

async function openTableFromRail(page: Page): Promise<void> {
  await page.click('[aria-label="Element options"]');
  await page.click('[data-option="element-show-all"]');
  await expect(page.locator(TABLE)).toBeVisible();
}

async function clickCanvasCentre(page: Page): Promise<void> {
  const box = await page.locator(CANVAS).boundingBox();
  if (box === null) throw new Error("the canvas has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test("places platinum from the full table and pins it in the quick picker", async ({ page }) => {
  await openEmptyEditor(page);
  await openTableFromRail(page);

  // All 118, laid out as a table: platinum under palladium under nickel.
  await expect(page.locator(`${TABLE} [data-periodic-element]`)).toHaveCount(118);
  const column = async (symbol: string): Promise<string | null> =>
    page
      .locator(`${TABLE} [data-periodic-element="${symbol}"]`)
      .locator("xpath=..")
      .getAttribute("aria-colindex");
  expect(await column("Pt")).toBe("10");
  expect(await column("Pd")).toBe("10");

  await page.getByRole("button", { name: "Platinum (Pt), atomic number 78" }).click();
  await expect(page.locator(TABLE)).toBeHidden();
  await expect(page.locator('[data-tool="element"]')).toHaveAttribute("aria-pressed", "true");

  await clickCanvasCentre(page);
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(1);
  await expect(page.locator(SCENE)).toContainText("Pt");
  // A metal carries no implicit hydrogens, so the formula is the bare symbol.
  await expect(page.locator(FORMULA)).toHaveText("Pt");

  await page.click('[aria-label="Element options"]');
  const pinned = page.locator('[data-element-recent] [data-element="Pt"]');
  await expect(pinned).toBeVisible();
  await expect(pinned).toHaveAttribute("aria-pressed", "true");

  // Kept across a reload: the list is a per-browser preference, restored
  // after hydration.
  await page.reload();
  await page.locator(SCENE).waitFor();
  await page.click('[aria-label="Element options"]');
  await expect(page.locator('[data-element-recent] [data-element="Pt"]')).toBeVisible();
});

test("finds selenium by name from the palette and places it with Enter", async ({ page }) => {
  await openEmptyEditor(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.click('[data-palette-command="element.table"]');
  await expect(page.locator(TABLE)).toBeVisible();

  // The search box has the focus when the table opens, so typing is enough.
  await expect(page.locator("[data-periodic-search]")).toBeFocused();
  await page.keyboard.type("selen");
  await expect(page.locator(`${TABLE} [data-periodic-element]`)).toHaveCount(1);
  await expect(page.locator("[data-periodic-count]")).toHaveText("1 element matches");
  await page.keyboard.press("Enter");
  await expect(page.locator(TABLE)).toBeHidden();

  await clickCanvasCentre(page);
  await expect(page.locator(SCENE)).toContainText("Se");
  await expect(page.locator(FORMULA)).toContainText("Se");
  // Selenium is divalent: the lone atom is H2Se.
  await expect(page.locator(FORMULA)).toContainText("H");
});

test("walks the table with the arrow keys and places what it lands on", async ({ page }) => {
  await openEmptyEditor(page);
  await openTableFromRail(page);

  // Down from the search box lands on the armed element, carbon by default.
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(`${TABLE} [data-periodic-element="C"]`)).toBeFocused();
  // Carbon, down to silicon, down to germanium, right to arsenic.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  const arsenic = page.locator(`${TABLE} [data-periodic-element="As"]`);
  await expect(arsenic).toBeFocused();
  await expect(page.locator("[data-periodic-detail]")).toContainText("Arsenic");
  await page.keyboard.press("Enter");
  await expect(page.locator(TABLE)).toBeHidden();

  await clickCanvasCentre(page);
  await expect(page.locator(SCENE)).toContainText("As");
  await expect(page.locator(FORMULA)).toContainText("As");
});

test("Escape closes the table without changing the tool", async ({ page }) => {
  await openEmptyEditor(page);
  await page.click('[data-tool="bond"]');
  await openTableFromRail(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(TABLE)).toBeHidden();
  // Radix took the Escape; the key layer must not also put the tool down.
  await expect(page.locator('[data-tool="bond"]')).toHaveAttribute("aria-pressed", "true");
});
