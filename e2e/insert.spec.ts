import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The insert box and the functional-group tool, in a real browser.
 *
 * Both are unit-tested down to the atom (`lib/io/insert.test.ts`,
 * `editor/commands/insert.test.ts`, chem-core's `groups.test.ts`), and the
 * SMILES leg is checked against real RDKit in `insert-fidelity.node.test.ts`.
 * What only a browser proves is the wiring: that the top bar opens the box,
 * that Enter inserts what the list highlights, that a name never fetches the
 * wasm while a SMILES does, that nothing is sent anywhere for a name outside
 * the list until "Look up on PubChem" is clicked (and then only to a routed,
 * never the real, PubChem), and that a click on a drawn atom with the group tool armed lands
 * the group on that atom.
 *
 * The assertions read the STATUS BAR's formula, because a formula is the
 * cheapest statement of "the right atoms, with the right hydrogens, arrived".
 * /editor opens on benzene, C6H6, so every expected formula below is benzene
 * plus whatever was inserted.
 */

const SCENE = '[data-canvas-root] [data-layer="scene"]';
const FORMULA = '[data-status="formula"]';
const MESSAGE = '[data-status="message"]';
const INPUT = '[data-shell="insert-input"]';
const OPTIONS = '[data-shell="insert-candidates"] [role="option"]';
const RDKIT_ASSET = /RDKit_minimal|rdkit\.worker|\.wasm(\?|$)/;

async function openEditor(page: Page): Promise<void> {
  await page.goto("/editor");
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(6);
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");
}

async function openInsertBox(page: Page): Promise<void> {
  await page.locator('[data-command="structure.insert"]').click();
  await expect(page.locator(INPUT)).toBeFocused();
}

/** Every drawn atom's centre in page px, read through the SVG's own CTM. */
async function atomCentres(page: Page): Promise<{ id: string; x: number; y: number }[]> {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll<SVGCircleElement>(
        '[data-canvas-root] [data-layer="scene"] circle[data-atom-id]',
      ),
    ].flatMap((circle) => {
      const ctm = circle.getScreenCTM();
      if (ctm === null) return [];
      const p = new DOMPoint(circle.cx.baseVal.value, circle.cy.baseVal.value).matrixTransform(ctm);
      return [{ id: circle.getAttribute("data-atom-id") ?? "", x: p.x, y: p.y }];
    }),
  );
}

test("a name inserts the listed structure beside the drawing, without fetching RDKit", async ({ page }) => {
  const rdkitRequests: string[] = [];
  page.on("request", (request) => {
    if (RDKIT_ASSET.test(request.url())) rdkitRequests.push(request.url());
  });
  await openEditor(page);
  await openInsertBox(page);

  await page.locator(INPUT).fill("caffeine");
  await expect(page.locator(OPTIONS).first()).toContainText("caffeine");
  await page.keyboard.press("Enter");

  await expect(page.locator('[data-shell="insert-dialog"]')).toBeHidden();
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(6 + 14);
  await expect(page.locator(FORMULA)).toHaveText("C₁₄H₁₆N₄O₂");
  await expect(page.locator(MESSAGE)).toHaveText("Inserted caffeine (C₈H₁₀N₄O₂)");
  expect(rdkitRequests).toEqual([]);

  // One undo entry takes the whole insert back.
  await page.locator('[data-command="edit.undo"]').click();
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(6);
});

test("a formula lists every listed compound it matches, and inserts the one picked", async ({ page }) => {
  await openEditor(page);
  await openInsertBox(page);

  await page.locator(INPUT).fill("C6H12O6");
  await expect(page.locator(OPTIONS)).toHaveCount(7);
  await expect(page.locator('[data-shell="insert-notice"]')).toContainText(
    "matches 7 compounds in the built-in list",
  );
  await page.locator(OPTIONS, { hasText: "β-D-galactopyranose" }).click();

  await expect(page.locator(FORMULA)).toHaveText("C₁₂H₁₈O₆");
  await expect(page.locator(MESSAGE)).toHaveText("Inserted β-D-galactopyranose (C₆H₁₂O₆)");
});

test("a SMILES is read by RDKit and arrives with its hydrogens", async ({ page }) => {
  await openEditor(page);
  await openInsertBox(page);

  // Pyrrole: the [nH] is the hydrogen a careless reader loses.
  await page.locator(INPUT).fill("c1cc[nH]c1");
  await expect(page.locator(OPTIONS).first()).toContainText("Read as SMILES");
  await page.keyboard.press("Enter");

  await expect(page.locator(MESSAGE)).toHaveText("Inserted c1cc[nH]c1 (C₄H₅N)", { timeout: 30_000 });
  await expect(page.locator(FORMULA)).toHaveText("C₁₀H₁₁N");
});

test("a name outside the list is refused, and nothing is sent anywhere", async ({ page, baseURL }) => {
  await openEditor(page);
  const elsewhere: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(baseURL ?? "")) elsewhere.push(request.url());
  });
  await openInsertBox(page);

  await page.locator(INPUT).fill("2-methylpropan-1-ol");
  await expect(page.locator('[data-shell="insert-refusal"]')).toContainText(
    "is not a name in the built-in list",
  );
  await expect(page.locator('[data-shell="insert-submit"]')).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");
  expect(elsewhere).toEqual([]);
});

test("PubChem is asked only on a click, with only the typed text, and its SMILES is inserted", async ({
  page,
  baseURL,
}) => {
  // Never the real NIH server: the route answers with a reply copied from it.
  const asked: string[] = [];
  await page.route("https://pubchem.ncbi.nlm.nih.gov/**", async (route) => {
    asked.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        PropertyTable: {
          Properties: [{ CID: 2519, SMILES: "CN1C=NC2=C1C(=O)N(C(=O)N2C)C", Title: "Caffeine" }],
        },
      }),
    });
  });
  await openEditor(page);
  const elsewhere: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(baseURL ?? "") && !url.startsWith("https://pubchem.")) elsewhere.push(url);
  });
  await openInsertBox(page);

  await page.locator(INPUT).fill("58-08-2");
  const lookUp = page.locator('[data-shell="insert-pubchem"]');
  await expect(lookUp).toHaveText("Look up “58-08-2” on PubChem");
  // Enter does not press it: nothing is highlighted, and nothing is sent.
  await page.keyboard.press("Enter");
  expect(asked).toEqual([]);

  await lookUp.click();
  await expect(page.locator(MESSAGE)).toContainText("Caffeine (PubChem CID 2519)", { timeout: 30_000 });
  await expect(page.locator(FORMULA)).toHaveText("C₁₄H₁₆N₄O₂");
  expect(asked).toEqual([
    "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/58-08-2/property/SMILES,Title/JSON",
  ]);
  expect(elsewhere).toEqual([]);
});

test("PubChem's not-found is shown in the box, and nothing is inserted", async ({ page }) => {
  await page.route("https://pubchem.ncbi.nlm.nih.gov/**", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ Fault: { Code: "PUGREST.NotFound", Message: "No CID found" } }),
    }),
  );
  await openEditor(page);
  await openInsertBox(page);

  await page.locator(INPUT).fill("notacompoundxyz");
  await page.locator('[data-shell="insert-pubchem"]').click();
  await expect(page.locator('[data-shell="insert-error"]')).toHaveText(
    "PubChem has no compound named “notacompoundxyz”. Check the spelling, or paste a SMILES or a molfile.",
  );
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");
});

test("the group tool stamps the picked group on the clicked atom", async ({ page }) => {
  await openEditor(page);

  await page.getByRole("button", { name: "Functional group options" }).click();
  await page.locator('[data-option="group-COOH"]').click();
  await expect(page.locator('[data-tool="group"]')).toHaveAttribute("aria-pressed", "true");

  const [atom] = await atomCentres(page);
  await page.mouse.click(atom!.x, atom!.y);

  // Benzoic acid.
  await expect(page.locator(FORMULA)).toHaveText("C₇H₆O₂");
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(9);
});

test("J arms the group tool, and a click on empty canvas says what it wants", async ({ page }) => {
  await openEditor(page);
  await page.locator("[data-canvas-root]").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("j");
  await expect(page.locator('[data-tool="group"]')).toHaveAttribute("aria-pressed", "true");

  await page.locator("[data-canvas-root]").click({ position: { x: 20, y: 20 } });
  await expect(page.locator(MESSAGE)).toHaveText("Click an atom to attach OH");
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");
});
