import { expect, test } from "@playwright/test";

import { E2E_COMMIT } from "./support/release";

/**
 * A tab whose release left the site's `/releases.json` saves its sketch, then
 * reloads into THAT sketch (decision 258). A sketch started from a
 * bare `/editor/` has no `?doc=` in its URL, so a plain reload used to open a
 * new blank sketch and leave the saved one in the recents grid.
 *
 * The edit is made right before the check, inside autosave's debounce, so the
 * save the reload waits for is the only one that can have stored it.
 */

const SCENE = '[data-canvas-root] [data-layer="scene"]';

test("a release reload saves the open sketch and lands back in it", async ({ page }) => {
  await page.goto("/editor/");
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(6);
  expect(await page.locator('meta[name="build-sha"]').getAttribute("content")).toBe(E2E_COMMIT);

  await page.locator('[data-command="structure.insert"]').click();
  await page.locator('[data-shell="insert-input"]').fill("caffeine");
  await expect(page.locator('[data-shell="insert-candidates"] [role="option"]').first()).toContainText(
    "caffeine",
  );
  await page.keyboard.press("Enter");
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(6 + 14);
  expect(new URL(page.url()).searchParams.get("doc")).toBeNull();

  // A newer release that no longer carries this tab's chunks.
  const newer = "f".repeat(40);
  await page.route("**/releases.json*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ schema: 2, head: newer, window: [newer], releases: [newer] }),
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

  await page.waitForURL(/\/editor\/\?doc=doc_/);
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(6 + 14);
  await expect(page.locator('[data-testid="release-reload-blocked"]')).toHaveCount(0);
});
