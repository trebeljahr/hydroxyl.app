import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  expectGroundMatchesScheme,
  freezeColourTransitions,
  paintedText,
  paintsOwnGround,
  parkPointerOn,
} from "./support/colours";

/**
 * The figure panel chooser, in a real browser, on the export flow.
 *
 * Reported: "not sure what the a/b stuff is while exporting", and "the panels
 * for the export are a bit weird, it would make sense to have the choice".
 * So these follow that path: open the export dialog, read what a panel and its
 * letter are, choose the views, and check the downloaded file carries the
 * letters in the order the chooser showed. The planned projections are there,
 * greyed out, with the reason.
 *
 * The startup document is benzene, which has no condensed formula, so the
 * "unavailable" state is reachable without drawing anything.
 */

const CANVAS = "[data-canvas-root]";
const DIALOG = '[data-shell="export-dialog"]';
const CHOOSER = `${DIALOG} [data-shell="panel-chooser"]`;

async function openEditor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/editor");
  await page.locator(`${CANVAS} [data-layer="scene"]`).waitFor();
}

async function openExportDialog(page: Page): Promise<void> {
  await page.locator('[data-command="figure.export-dialog"]').click();
  await expect(page.locator(DIALOG)).toBeVisible();
}

async function chooserKinds(page: Page, root: string): Promise<string[]> {
  return page
    .locator(`${root} [data-chooser-panel]`)
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-panel-kind") ?? ""));
}

/** The preview is a data: URI of the exact SVG the export writes. */
async function previewViews(page: Page): Promise<string[]> {
  const src = await page.locator('[data-shell="figure-preview"]').getAttribute("src");
  const svg = decodeURIComponent(src ?? "");
  return [...svg.matchAll(/data-view="([^"]+)"/g)].map((m) => m[1] ?? "");
}

test("the export dialog explains the panel letters and chooses the figure's views", async ({
  page,
}) => {
  await openEditor(page);
  await openExportDialog(page);

  // ── What a panel is, and what the letter means ──────────────────────────
  await expect(page.locator(CHOOSER)).toBeVisible();
  await expect(page.locator(`${CHOOSER} [data-shell="panel-chooser-help"]`)).toContainText(
    "(a) is the first panel",
  );
  await expect(page.locator(DIALOG)).not.toContainText("Edit the panels in the properties panel");
  expect(await chooserKinds(page, CHOOSER)).toEqual(["skeletal", "sumFormula"]);
  expect(await previewViews(page)).toEqual(["skeletal", "sumFormula"]);

  // ── Choose: add, reorder, remove — each reaches the preview at once ─────
  await page.locator(`${CHOOSER} [data-add-view="lewis"]`).click();
  await expect.poll(() => chooserKinds(page, CHOOSER)).toEqual(["skeletal", "sumFormula", "lewis"]);
  await expect.poll(() => previewViews(page)).toEqual(["skeletal", "sumFormula", "lewis"]);

  await page.locator(`${CHOOSER} [aria-label="Move panel (c) earlier"]`).click();
  await expect.poll(() => previewViews(page)).toEqual(["skeletal", "lewis", "sumFormula"]);

  await page.locator(`${CHOOSER} [aria-label="Remove panel (a) from the figure"]`).click();
  await expect.poll(() => chooserKinds(page, CHOOSER)).toEqual(["lewis", "sumFormula"]);
  await expect.poll(() => previewViews(page)).toEqual(["lewis", "sumFormula"]);

  // ── Refused views say why, and a click changes nothing ──────────────────
  const condensed = page.locator(`${CHOOSER} [data-add-view="condensed"]`);
  await expect(condensed).toBeDisabled();
  await expect(page.locator(`${CHOOSER} [data-add-view-reason="condensed"]`)).toContainText(
    "A ring has no condensed formula",
  );
  const fischer = page.locator(`${CHOOSER} [data-planned-view="fischer"]`);
  await expect(fischer).toBeVisible();
  await expect(fischer).toBeDisabled();
  await expect(fischer).toContainText("horizontal bonds point toward you");
  await expect(page.locator(`${CHOOSER} [data-shell="planned-projection-reason"]`)).toContainText(
    "Not built yet",
  );
  for (const id of ["fischer", "haworth", "chair", "newman", "sawhorse", "natta", "mills"]) {
    await expect(page.locator(`${CHOOSER} [data-planned-view="${id}"]`), id).toBeDisabled();
  }
  await fischer.click({ force: true });
  expect(await chooserKinds(page, CHOOSER)).toEqual(["lewis", "sumFormula"]);

  // ── The file carries the letters in the order the chooser showed ────────
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(`${DIALOG} [data-command="figure.export-svg"]`).click(),
  ]);
  const svg = readFileSync(await download.path()).toString("utf8");
  expect([...svg.matchAll(/data-panel-label="([^"]+)"/g)].map((m) => m[1])).toEqual([
    "(a)",
    "(b)",
  ]);
  expect([...svg.matchAll(/data-view="([^"]+)"/g)].map((m) => m[1])).toEqual([
    "lewis",
    "sumFormula",
  ]);

  // ── And the strip above the canvas follows, naming the letters ──────────
  await page.keyboard.press("Escape");
  await expect(page.locator(DIALOG)).toBeHidden();
  await expect(page.locator("[data-switcher-panel]").first()).toHaveAttribute(
    "title",
    "Panel (a) of the exported figure: Lewis",
  );
});

test("the strip's Figure panels button opens the same chooser", async ({ page }) => {
  await openEditor(page);
  const strip = '[data-shell="representation-switcher"]';
  await page.locator('[data-shell="panel-chooser-trigger"]').click();
  const popover = '[data-radix-popper-content-wrapper] [data-shell="panel-chooser"]';
  await expect(page.locator(popover)).toBeVisible();
  await page.locator(`${popover} [data-add-view="kekule"]`).click();
  await expect(page.locator(`${strip} [data-switcher-panel]`)).toHaveCount(3);
  await expect(page.locator(`${strip} [data-switcher-panel]`).nth(2)).toContainText("(c)Kekulé");
});

/**
 * The chooser's states against the 4.5:1 floor, resting AND hovered, in both
 * schemes — the same bar `shell.spec.ts` holds the strip and the tool rail to.
 * The muted ink is the one most at risk: it is 4.742:1 on the popover ground
 * in light mode and 4.349:1 on the accent ground, so an unavailable entry that
 * moved to the accent on hover would fail here and nowhere else.
 */
for (const scheme of ["light", "dark"] as const) {
  test.describe(`panel chooser colours, ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("every chooser state paints its own ground and clears 4.5:1, hovered too", async ({
      page,
    }) => {
      await openEditor(page);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
        .toBe(scheme === "dark");
      await freezeColourTransitions(page);
      await openExportDialog(page);

      const states = {
        live: `${CHOOSER} [data-add-view="lewis"]`,
        unavailable: `${CHOOSER} [data-add-view="condensed"]`,
        planned: `${CHOOSER} [data-planned-view="fischer"]`,
        panel: `${CHOOSER} [data-chooser-panel]`,
        help: `${CHOOSER} [data-shell="panel-chooser-help"]`,
        reason: `${CHOOSER} [data-add-view-reason="condensed"]`,
        plannedReason: `${CHOOSER} [data-shell="planned-projection-reason"]`,
      } as const;

      for (const [what, selector] of Object.entries(states)) {
        await page.locator(selector).first().scrollIntoViewIfNeeded();
        const resting = await paintedText(page, selector);
        expect(
          resting.contrast,
          `${what} resting at ${resting.colour} on ${resting.background}`,
        ).toBeGreaterThanOrEqual(4.5);
        expectGroundMatchesScheme(resting, scheme, `${what} resting`);
      }

      // The three pickable-looking entries paint a ground of their own.
      for (const what of ["live", "unavailable", "planned", "panel"] as const) {
        expect(await paintsOwnGround(page, states[what]), `${what} has no ground`).toBe(true);
      }

      // Hovered: the live entry lights up, the refused ones hold still, and
      // every one of them still clears the floor.
      const hoveredGround: Record<string, string> = {};
      for (const what of ["live", "unavailable", "planned"] as const) {
        await page.locator(states[what]).scrollIntoViewIfNeeded();
        await parkPointerOn(page, states[what], 0.3);
        const hovered = await paintedText(page, states[what]);
        expect(
          hovered.contrast,
          `${what} hovered at ${hovered.colour} on ${hovered.background}`,
        ).toBeGreaterThanOrEqual(4.5);
        expectGroundMatchesScheme(hovered, scheme, `${what} hovered`);
        hoveredGround[what] = hovered.background;
      }
      expect(hoveredGround.live).not.toBe(hoveredGround.unavailable);
      expect(hoveredGround.unavailable).toBe(hoveredGround.planned);

      // Muted means unavailable: at rest, a live entry never wears the
      // refused ink.
      await page.mouse.move(0, 0);
      const live = await paintedText(page, states.live);
      const refused = await paintedText(page, states.unavailable);
      expect(live.colour).not.toBe(refused.colour);
    });
  });
}
