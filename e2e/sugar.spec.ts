import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The mutarotation figure, built the way decision 104 says it is built: the
 * open chain inserted once, duplicated twice, and each copy closed from the
 * palette — one alpha, one beta. Three species in one document, each closure
 * one undo step.
 *
 * Unit tests already drive the commands through a real store on the same
 * molecules (`editor/commands/sugar.test.ts`). What only a browser proves is
 * the wiring: the insert box's open-chain entry, the palette rows, that ONE
 * clicked atom is enough to name a sugar, and that what lands on the canvas
 * is the right pair of anomers.
 *
 * WHAT THE ANOMERS ARE READ FROM. The status line is built from chem-core's
 * own reading of the product, so it is checked, but the stronger assertion
 * is the CIP letters the canvas states: alpha-D-glucopyranose is
 * (1S,2R,3S,4S,5R) and beta (1R,2R,3S,4S,5R), so the ring closed alpha
 * carries three S and two R, the beta one two S and three R, and the open
 * chain (2R,3S,4R,5R) four letters and no fifth. Two alphas, two betas or a
 * copy left open would each read differently.
 */

const CANVAS = "[data-canvas-root]";
const SCENE = `${CANVAS} [data-layer="scene"]`;
const FORMULA = '[data-status="formula"]';
const MESSAGE = '[data-status="message"]';
const SELECTED = '[data-overlay="selected-atom"]';

async function openEmptyEditor(page: Page): Promise<void> {
  await page.goto("/editor");
  await expect(page.locator(`${SCENE} circle[data-atom-id]`)).toHaveCount(6);
  await page.locator(CANVAS).click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await expect(page.locator(`${SCENE} circle[data-atom-id]`)).toHaveCount(0);
}

/** Decision 169's rows are palette-only, like decision 89's. */
async function runFromPalette(page: Page, id: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+k");
  const row = page.locator(`[data-palette-command="${id}"]`);
  await expect(row).toBeVisible();
  await expect(row).not.toHaveAttribute("data-disabled", "true");
  await row.click();
  await expect(row).toHaveCount(0);
}

async function selectedAtomIds(page: Page): Promise<string[]> {
  return page
    .locator(SELECTED)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-overlay-target") ?? ""));
}

/**
 * Every CIP letter the canvas states, keyed by its atom: the ones drawn, plus
 * the ones the annotation pass had no room for, which the status bar lists
 * under "Not shown" (decisions 62 and 70). A crowded open chain drops some,
 * and which ones depends on the layout, so neither half alone is the set.
 */
async function descriptors(page: Page): Promise<Map<string, string>> {
  const drawn = await page
    .locator(`${SCENE} [id$=":descriptor"]`)
    .evaluateAll((nodes) =>
      nodes.map((node) => [node.id.split(":")[1] ?? "", node.textContent?.trim() ?? ""] as const),
    );
  const report = page.locator('[data-status="annotations"]');
  const title = (await report.count()) === 0 ? "" : ((await report.getAttribute("title")) ?? "");
  const notShown = title.split("\n").find((line) => line.startsWith("Not shown:")) ?? "";
  const dropped = [...notShown.matchAll(/(a\d+) (\([RS]\))/g)].map((m) => [m[1]!, m[2]!] as const);
  return new Map([...drawn, ...dropped]);
}

/** How many CIP letters the canvas states, drawn or listed as not shown. */
async function descriptorCount(page: Page): Promise<number> {
  return (await descriptors(page)).size;
}

/** How many of `atomIds` carry each letter: "3R 2S". */
function letters(printed: Map<string, string>, atomIds: readonly string[]): string {
  const on = atomIds.flatMap((id) => {
    const text = printed.get(id);
    return text === undefined ? [] : [text];
  });
  const r = on.filter((text) => text === "(R)").length;
  const s = on.filter((text) => text === "(S)").length;
  return `${String(r)}R ${String(s)}S`;
}

/**
 * Each atom's drawn centre in page px: its hit circle where it has one (a
 * skeletal carbon), else the middle of its label.
 */
async function centres(page: Page, atomIds: readonly string[]): Promise<{ x: number; y: number }[]> {
  return page.evaluate(
    ({ scene, ids }) =>
      ids.map((id) => {
        const circle = document.querySelector<SVGCircleElement>(`${scene} circle[data-atom-id="${id}"]`);
        const ctm = circle?.getScreenCTM();
        if (circle !== null && ctm !== null && ctm !== undefined) {
          const p = new DOMPoint(circle.cx.baseVal.value, circle.cy.baseVal.value).matrixTransform(ctm);
          return { x: p.x, y: p.y };
        }
        const drawn = document.querySelector(`${scene} [data-atom-id="${id}"]`);
        if (drawn === null) throw new Error(`${id} is not drawn`);
        const box = drawn.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }),
    { scene: SCENE, ids: [...atomIds] },
  );
}

/** Click one atom by its drawn centre, as a user picks a structure. */
async function clickAtom(page: Page, atomId: string): Promise<void> {
  const [centre] = await centres(page, [atomId]);
  await page.mouse.click(centre!.x, centre!.y);
}

/**
 * Drag the selected copy to the right until it is clear of the structure it
 * was duplicated from. A duplicate lands half a bond off its original, so a
 * figure of three copies is unreadable until they are moved apart — which is
 * what an author does next, and what this does by hand.
 */
async function dragClearOf(page: Page, copy: readonly string[], original: readonly string[]): Promise<void> {
  const from = await centres(page, original);
  const moving = await centres(page, copy);
  const right = Math.max(...from.map((p) => p.x));
  const left = Math.min(...moving.map((p) => p.x));
  const width = right - Math.min(...from.map((p) => p.x));
  const grab = moving[0]!;
  const dx = right - left + width * 0.4;
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + dx / 2, grab.y, { steps: 6 });
  await page.mouse.move(grab.x + dx, grab.y, { steps: 6 });
  await page.mouse.up();
}

test("builds the mutarotation figure: an open chain and both pyranose anomers", async ({ page }) => {
  await openEmptyEditor(page);

  // The open chain, from the insert box's dictionary: RDKit laid it out with
  // its four wedges, so C5's configuration is stated and alpha/beta can be read.
  await page.locator('[data-command="structure.insert"]').click();
  await page.locator('[data-shell="insert-input"]').fill("open chain glucose");
  await expect(page.locator('[data-shell="insert-candidates"] [role="option"]').first()).toContainText(
    "D-glucose (open chain)",
  );
  await page.keyboard.press("Enter");
  await expect(page.locator(FORMULA)).toHaveText("C₆H₁₂O₆");
  const chain = await selectedAtomIds(page);
  expect(chain).toHaveLength(12);

  // Room to lay three structures side by side: the insert fitted the view
  // to the chain alone.
  for (let i = 0; i < 3; i++) await runFromPalette(page, "view.zoom-out");

  // Duplicated twice, each copy dragged clear of the one before. Each
  // duplicate selects its copy, and a drag on a selected atom moves them all.
  await runFromPalette(page, "edit.duplicate");
  const alphaCopy = await selectedAtomIds(page);
  await dragClearOf(page, alphaCopy, chain);
  await runFromPalette(page, "view.fit");
  for (let i = 0; i < 2; i++) await runFromPalette(page, "view.zoom-out");
  await runFromPalette(page, "edit.duplicate");
  const betaCopy = await selectedAtomIds(page);
  await dragClearOf(page, betaCopy, alphaCopy);
  await expect(page.locator(FORMULA)).toHaveText("C₁₈H₃₆O₁₈");
  expect(new Set([...chain, ...alphaCopy, ...betaCopy]).size).toBe(36);
  // Three separate columns of atoms, left to right.
  const spans = await Promise.all(
    [chain, alphaCopy, betaCopy].map(async (ids) => {
      const xs = (await centres(page, ids)).map((p) => p.x);
      return [Math.min(...xs), Math.max(...xs)] as const;
    }),
  );
  expect(spans[0]![1]).toBeLessThan(spans[1]![0]);
  expect(spans[1]![1]).toBeLessThan(spans[2]![0]);

  await page.locator(`${CANVAS}`).click({ position: { x: 4, y: 4 } });
  await page.locator('[data-shell="view-options"]').click();
  await page.locator('[data-view-flag="showStereoDescriptors"]').check();
  await page.keyboard.press("Escape");
  await expect.poll(() => descriptorCount(page)).toBe(12);

  // The second copy, then the first, each by ONE clicked atom.
  await runFromPalette(page, "view.fit");
  await clickAtom(page, betaCopy[0]!);
  await expect(page.locator(SELECTED)).toHaveCount(1);
  await runFromPalette(page, "structure.cyclise-sugar-pyranose-beta");
  await expect(page.locator(MESSAGE)).toHaveText("Closed C1 onto the C5 hydroxyl: β-D-pyranose");

  await clickAtom(page, alphaCopy[0]!);
  await expect(page.locator(SELECTED)).toHaveCount(1);
  await runFromPalette(page, "structure.cyclise-sugar-pyranose-alpha");
  await expect(page.locator(MESSAGE)).toHaveText("Closed C1 onto the C5 hydroxyl: α-D-pyranose");

  // Same atoms, same formula: the ring-chain edit is an isomerisation.
  await expect(page.locator(FORMULA)).toHaveText("C₁₈H₃₆O₁₈");
  await expect.poll(() => descriptorCount(page)).toBe(14);
  const printed = await descriptors(page);
  expect(letters(printed, chain)).toBe("3R 1S");
  expect(letters(printed, alphaCopy)).toBe("2R 3S");
  expect(letters(printed, betaCopy)).toBe("3R 2S");

  // One undo takes back one closure, and only that one.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => descriptorCount(page)).toBe(13);
  expect(letters(await descriptors(page), alphaCopy)).toBe("3R 1S");
  expect(letters(await descriptors(page), betaCopy)).toBe("3R 2S");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => descriptorCount(page)).toBe(14);
  expect(letters(await descriptors(page), alphaCopy)).toBe("2R 3S");
});
