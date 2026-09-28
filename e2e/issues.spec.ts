import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Chemistry issues in a real browser: WHERE a problem is, WHAT it is, and the
 * click that fixes it.
 *
 * The unit tests prove each piece — chem-core's ids and fixes, the overlay's
 * marks, the list's routing into the store. What only a browser proves is the
 * whole loop a chemist goes through: the canvas rings the atom, the status bar
 * counter opens a list, a row brings the atom to the middle of the view, and
 * a fix clears the ring. And the one path no unit test can take with the real
 * wasm in a page: a "Clean up" RDKit refuses, whose atom index has to land on
 * the right atom of the drawing.
 */

const CANVAS = "[data-canvas-root]";
const OVERLAY = `${CANVAS} [data-layer="overlay"]`;
const ISSUES = '[data-status="issues"]';
const LIST = '[data-shell="issue-list"]';
const MESSAGE = '[data-status="message"]';

function fixture(name: string): string {
  // From the repo root, which is where Playwright runs: the spec is compiled
  // to CommonJS, so `import.meta.url` is not available to locate it.
  return readFileSync(join(process.cwd(), "e2e", "fixtures", name), "utf8");
}

async function openEditor(page: Page): Promise<void> {
  await page.goto("/editor");
  await page.locator(`${CANVAS} [data-layer="scene"]`).waitFor();
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

/** Where an overlay mark's centre is on the screen. */
async function centreOf(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("rings each error, takes the user to it, and fixes it in one click", async ({ page }) => {
  await openEditor(page);
  // 2-nitroethyl-trimethylammonium drawn the two ways chemists get it wrong:
  // the nitro nitrogen with two N=O bonds, the quaternary nitrogen uncharged.
  await dropMolfile(page, "nitro-ammonium-uncharged.mol", fixture("nitro-ammonium-uncharged.mol"));
  await expect(page.locator(ISSUES)).toHaveText("2 chemistry errors");

  // WHERE and WHAT, on the canvas itself.
  await expect(page.locator(`${OVERLAY} [data-overlay="issue-halo"]`)).toHaveCount(2);
  await expect(page.locator(`${OVERLAY} [data-overlay="issue-label"]`)).toHaveText([
    "N has 5 bonds; max 3",
    "N has 4 bonds; max 3",
  ]);

  await page.locator(ISSUES).click();
  const rows = page.locator(`${LIST} [data-issue-row]`);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("N · atom 6");

  // Clicking the row selects the atom and brings it to the middle of the view.
  await rows.nth(1).locator("[data-issue-locate]").click();
  const target = await rows.nth(1).getAttribute("data-issue-target");
  const selected = `${OVERLAY} [data-overlay="selected-atom"][data-overlay-target="${target}"]`;
  await expect(page.locator(selected)).toHaveCount(1);
  const canvas = await page.locator(CANVAS).boundingBox();
  if (canvas === null) throw new Error("no canvas box");
  const atom = await centreOf(page, selected);
  expect(Math.abs(atom.x - (canvas.x + canvas.width / 2))).toBeLessThan(2);
  expect(Math.abs(atom.y - (canvas.y + canvas.height / 2))).toBeLessThan(2);

  // The obvious repairs: the ammonium's missing charge, then the nitro group
  // drawn charge-separated, which keeps the structure's net charge.
  await rows.nth(1).locator('[data-issue-fix="set-charge"]').click();
  await expect(page.locator(ISSUES)).toHaveText("1 chemistry error");
  await expect(page.locator('[data-status="charge"]')).toHaveText("Charge +1");

  await page.locator(`${LIST} [data-issue-fix="charge-separate"]`).click();
  await expect(page.locator(ISSUES)).toHaveText("0 chemistry errors");
  await expect(page.locator(`${OVERLAY} [data-overlay="issue-halo"]`)).toHaveCount(0);
  await expect(page.locator('[data-status="charge"]')).toHaveText("Charge +1");
  await expect(page.locator(MESSAGE)).toHaveText("Draw it as N⁺–O⁻ (N · atom 3). Undo puts it back.");
});

test("a refused Clean up rings the atom RDKit named, not an index", async ({ page }) => {
  test.setTimeout(60_000);
  await openEditor(page);
  // Iodine heptafluoride, drawn after an ethane so RDKit names the iodine
  // "atom # 2" and a mapping that ignored the offset would ring a carbon.
  // chem-core already marks it — both tables stop iodine at 5 — and the
  // refusal has to land on that same atom, not beside it.
  await dropMolfile(page, "iodine-heptafluoride.mol", fixture("iodine-heptafluoride.mol"));
  await expect(page.locator(ISSUES)).toHaveText("1 chemistry error");
  const halos = page.locator(`${OVERLAY} [data-overlay="issue-halo"]`);
  await expect(halos).toHaveCount(1);
  const iodine = await halos.first().getAttribute("data-overlay-target");
  await expect(
    page.locator(`${CANVAS} [data-layer="scene"] [data-atom-id="${iodine}"]`).first(),
  ).toContainText("I");

  await page.locator('[data-command="structure.clean-up"]').click();
  await expect(page.locator(MESSAGE)).toContainText("Clean up stopped at the selected atom", {
    timeout: 30_000,
  });
  await expect(page.locator(MESSAGE)).toContainText("atom # 2");

  // RDKit's refusal joins chem-core's error on the SAME atom, stacked.
  await expect(page.locator(ISSUES)).toHaveText("2 chemistry errors");
  await expect(halos).toHaveCount(2);
  for (const target of await halos.evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-overlay-target")),
  )) {
    expect(target).toBe(iodine);
  }
  await expect(page.locator(`${OVERLAY} [data-overlay="issue-label"]`)).toHaveText([
    "I has 7 bonds; max 5",
    "Clean up stopped here",
  ]);
  await expect(
    page.locator(`${OVERLAY} [data-overlay="selected-atom"][data-overlay-target="${iodine}"]`),
  ).toHaveCount(1);

  // The refusal describes the molecule that was refused; the next edit —
  // here an undo — takes it away.
  await page.locator(CANVAS).focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(halos).toHaveCount(0);
});
