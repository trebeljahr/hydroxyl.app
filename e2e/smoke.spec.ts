import { expect, test } from "@playwright/test";

/**
 * `/` is the recents grid. It used to be a placeholder printing benzene's
 * formula from chem-core, and this spec pinned that — the placeholder is what
 * `persistence-and-file-io` replaced, so the spec was rewritten rather than
 * deleted. With no sketches the grid shows the landing page (decision 109),
 * whose headline is the page's h1; `landing.spec.ts` covers that page.
 *
 * Each Playwright test gets its own browser context and therefore its own
 * empty IndexedDB, so "no sketches yet" is the correct first state here.
 */
test("the landing page is the recents grid, and it starts empty", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Chemistry Sketcher").first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.locator('[data-recents="empty"]')).toBeVisible();
  // A regex, because `trailingSlash` is true for the standalone build and
  // false for the static export — see next.config.ts — so the same Link emits
  // `/editor/` in one and `/editor` in the other.
  await expect(page.locator('[data-recents="new"]')).toHaveAttribute(
    "href",
    /^\/editor\/?$/,
  );
});

test("the editor opens from the landing page and draws benzene", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-recents="new"]').click();

  // Produced by molecularFormulaUnicode() in @starter/chem-core, so this
  // fails if the workspace build chain did not reach the served bundle.
  await expect(page.locator('[data-status="formula"]')).toHaveText("C₆H₆");
});
