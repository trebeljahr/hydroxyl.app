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
 * the wiring: the insert box's open-chain entry, the palette rows, that
 * Duplicate lays the copies out in a row with nothing on top of anything
 * (decision 200), that ONE clicked atom is enough to name a sugar, and that
 * what lands on the canvas is the right pair of anomers.
 *
 * WHAT THE ANOMERS ARE READ FROM. The status line is built from chem-core's
 * own reading of the product, so it is checked, but the stronger assertion
 * is the CIP letters the canvas DRAWS: alpha-D-glucopyranose is
 * (1S,2R,3S,4S,5R) and beta (1R,2R,3S,4S,5R), so the ring closed alpha
 * carries three S and two R, the beta one two S and three R, and the open
 * chain (2R,3S,4R,5R) four letters and no fifth. Two alphas, two betas or a
 * copy left open would each read differently. Every letter must be drawn:
 * the status bar's "not shown" notice is asserted absent, because when the
 * copies landed half a bond apart they crowded four letters off the canvas.
 *
 * AT SCREEN, ON PURPOSE. New documents open in Publication, and there a
 * sugar's letters have no slot decision 71's geometry allows even with the
 * sugar alone on the page: the "HC" and "OH" labels at every carbon leave
 * no ink-free room within 0.85 of the way to a neighbour. That is a ruled
 * outcome, reported in the status bar, and not what this spec is about.
 */

const CANVAS = "[data-canvas-root]";
const SCENE = `${CANVAS} [data-layer="scene"]`;
const FORMULA = '[data-status="formula"]';
const MESSAGE = '[data-status="message"]';
const SELECTED = '[data-overlay="selected-atom"]';
const DESCRIPTORS = `${SCENE} [id$=":descriptor"]`;
const NOT_SHOWN = '[data-status="annotations"]';

async function openEmptyEditor(page: Page): Promise<void> {
  await page.goto("/editor");
  await expect(page.locator(`${SCENE} circle[data-atom-id]`)).toHaveCount(6);
  await page.locator('[data-command="view.style-screen"]').click();
  await expect(page.locator('[data-shell="style-preset"]')).toHaveAttribute("data-style-preset", "screen");
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

/** The drawn CIP letters, keyed by the atom they sit beside (`atom:a2:descriptor`). */
async function descriptors(page: Page): Promise<Map<string, string>> {
  const pairs = await page
    .locator(DESCRIPTORS)
    .evaluateAll((nodes) =>
      nodes.map((node) => [node.id.split(":")[1] ?? "", node.textContent?.trim() ?? ""] as const),
    );
  return new Map(pairs);
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

  // Duplicated twice. Each duplicate selects its copy and lands it clear of
  // everything drawn, to the right, with the view refitted to show it.
  await runFromPalette(page, "edit.duplicate");
  const alphaCopy = await selectedAtomIds(page);
  await runFromPalette(page, "edit.duplicate");
  const betaCopy = await selectedAtomIds(page);
  await expect(page.locator(FORMULA)).toHaveText("C₁₈H₃₆O₁₈");
  expect(new Set([...chain, ...alphaCopy, ...betaCopy]).size).toBe(36);

  // Three separate columns of atoms, left to right, with no dragging.
  const spans = await Promise.all(
    [chain, alphaCopy, betaCopy].map(async (ids) => {
      const xs = (await centres(page, ids)).map((p) => p.x);
      return [Math.min(...xs), Math.max(...xs)] as const;
    }),
  );
  expect(spans[0]![1]).toBeLessThan(spans[1]![0]);
  expect(spans[1]![1]).toBeLessThan(spans[2]![0]);

  await page.locator(CANVAS).click({ position: { x: 4, y: 4 } });
  await page.locator('[data-shell="view-options"]').click();
  await page.locator('[data-view-flag="showStereoDescriptors"]').check();
  await page.keyboard.press("Escape");
  await expect(page.locator(DESCRIPTORS)).toHaveCount(12);
  await expect(page.locator(NOT_SHOWN)).toHaveCount(0);

  // The second copy, then the first, each by ONE clicked atom.
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
  await expect(page.locator(DESCRIPTORS)).toHaveCount(14);
  await expect(page.locator(NOT_SHOWN)).toHaveCount(0);
  const printed = await descriptors(page);
  expect(letters(printed, chain)).toBe("3R 1S");
  expect(letters(printed, alphaCopy)).toBe("2R 3S");
  expect(letters(printed, betaCopy)).toBe("3R 2S");

  // One undo takes back one closure, and only that one.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(DESCRIPTORS)).toHaveCount(13);
  expect(letters(await descriptors(page), alphaCopy)).toBe("3R 1S");
  expect(letters(await descriptors(page), betaCopy)).toBe("3R 2S");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator(DESCRIPTORS)).toHaveCount(14);
  expect(letters(await descriptors(page), alphaCopy)).toBe("2R 3S");
});
