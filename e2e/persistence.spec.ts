import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Persistence and file I/O, driven through a real browser.
 *
 * EVERYTHING HERE NEEDS ONE. IndexedDB does not exist in jsdom or in node, the
 * File System Access API and `DataTransfer` do not either, and the RDKit
 * worker is only lazy in a place that can actually fetch. The unit tests prove
 * the decisions — when autosave fires, what the sniffer calls a molblock,
 * which formats need the wasm; these prove the wiring.
 *
 * Each test gets its own browser context and therefore its own empty
 * IndexedDB, so a spec never inherits another's library.
 */

const RDKIT_ASSET = /RDKit_minimal|rdkit\.worker|\.wasm(\?|$)/;

const CANVAS = "[data-canvas-root]";
const FORMULA = '[data-status="formula"]';
const CHARGE = '[data-status="charge"]';
const SAVE_STATE = '[data-status="save-state"]';

const BENZENE_MOLBLOCK = `Benzene
  chemcore          2D

  6  6  0  0  0  0  0  0  0  0999 V2000
    0.0000   -1.5000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.2990   -0.7500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.2990    0.7500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.0000    1.5000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
   -1.2990    0.7500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
   -1.2990   -0.7500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0  0  0  0
  2  3  2  0  0  0  0
  3  4  1  0  0  0  0
  4  5  2  0  0  0  0
  5  6  1  0  0  0  0
  6  1  2  0  0  0  0
M  END
`;

const ETHANOL_MOLBLOCK = `Ethanol
  chemcore          2D

  3  2  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.5000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    2.2500    1.2990    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0  0  0  0
  2  3  1  0  0  0  0
M  END
`;

const THREE_RECORD_SDF = `${BENZENE_MOLBLOCK}$$$$\n${ETHANOL_MOLBLOCK}$$$$\nMethanol-ish
  chemcore          2D

  2  1  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.5000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0  0  0  0
M  END
$$$$
`;

/** The id of the document currently loaded, which is what `?doc=` takes. */
async function currentDocId(page: Page): Promise<string> {
  const id = await page.locator('[data-shell="top-bar"]').getAttribute("data-doc-id");
  expect(id, "the top bar should carry the loaded document's id").toBeTruthy();
  return id!;
}

/**
 * One edit with no pointer geometry in it: select everything, then raise the
 * charge. Used wherever a spec needs the document to have CHANGED and does not
 * care how — a drag would drag in the whole hit-testing story with it.
 */
async function chargeUpEverything(page: Page): Promise<void> {
  await page.locator(CANVAS).click({ position: { x: 8, y: 8 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("+");
}

async function waitForSaved(page: Page): Promise<void> {
  await expect(page.locator(`${SAVE_STATE}[data-save-status="saved"]`)).toBeVisible({
    timeout: 10_000,
  });
}

/** Fire a real `drop` carrying a file, the way a file manager does. */
async function dropFile(page: Page, name: string, text: string): Promise<void> {
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

/** Fire a `drop` carrying plain text, the way a drag out of a web page does. */
async function dropText(page: Page, text: string): Promise<void> {
  const transfer = await page.evaluateHandle((contents) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", contents);
    return dt;
  }, text);
  await page.dispatchEvent("body", "drop", { dataTransfer: transfer });
}

// ---------------------------------------------------------------------------
// Autosave and restore
// ---------------------------------------------------------------------------

test("a sketch survives a reload, restored from IndexedDB", async ({ page }) => {
  await page.goto("/editor");
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");

  await chargeUpEverything(page);
  await expect(page.locator(CHARGE)).toContainText("+6");
  const id = await currentDocId(page);
  await waitForSaved(page);

  // A QUERY PARAMETER, not a path segment: `generateStaticParams` cannot
  // enumerate ids that only exist in this browser's IndexedDB, and the static
  // export has to keep building.
  await page.goto(`/editor?doc=${id}`);
  await expect(page.locator(CHARGE)).toContainText("+6");
  await expect(page.locator('[data-shell="top-bar"]')).toHaveAttribute("data-doc-id", id);
});

test("a restored sketch is not an undo step", async ({ page }) => {
  // Restoring through the undoable `openDocument` would make the first Ctrl+Z
  // after a reload wipe the canvas — and autosave would then persist the empty
  // document over the good one.
  await page.goto("/editor");
  await chargeUpEverything(page);
  const id = await currentDocId(page);
  await waitForSaved(page);

  await page.goto(`/editor?doc=${id}`);
  await expect(page.locator(CHARGE)).toContainText("+6");
  const restored = await page.locator(FORMULA).textContent();

  await page.keyboard.press("ControlOrMeta+z");
  // Nothing to undo: the restore cleared the history rather than pushing an
  // entry whose base is the empty startup document.
  await expect(page.locator(CHARGE)).toContainText("+6");
  await expect(page.locator(FORMULA)).toHaveText(restored ?? "");
});

test("an untouched visit to /editor does not litter the recents grid", async ({ page }) => {
  // The fixture is BASELINED rather than saved, so opening the editor and
  // leaving again leaves nothing behind. The first real edit is the first
  // write.
  await page.goto("/editor");
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");
  await page.goto("/");
  await expect(page.locator('[data-recents="empty"]')).toBeVisible();
});

test("the recents grid lists what was saved, and opens it", async ({ page }) => {
  await page.goto("/editor");
  await chargeUpEverything(page);
  const id = await currentDocId(page);
  await waitForSaved(page);

  await page.goto("/");
  const card = page.locator(`[data-recents="card"][data-doc-id="${id}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator('[data-recents="title"]')).toHaveText("Benzene");

  await card.locator('[data-recents="open"]').click();
  await expect(page.locator(CHARGE)).toContainText("+6");
});

test("a sketch can be renamed, duplicated and deleted from the grid", async ({ page }) => {
  await page.goto("/editor");
  await chargeUpEverything(page);
  await waitForSaved(page);

  await page.goto("/");
  await expect(page.locator('[data-recents="card"]')).toHaveCount(1);

  page.once("dialog", (dialog) => void dialog.accept("Cyclohexatriene"));
  await page.locator('[data-recents="rename"]').click();
  await expect(page.locator('[data-recents="title"]').first()).toHaveText("Cyclohexatriene");

  await page.locator('[data-recents="duplicate"]').first().click();
  await expect(page.locator('[data-recents="card"]')).toHaveCount(2);
  // A NEW id, or the copy would overwrite its own source: all three object
  // stores and the canvas's zoom-to-fit key on `doc.id`.
  const ids = await page.locator('[data-recents="card"]').evaluateAll((cards) =>
    cards.map((card) => card.getAttribute("data-doc-id")),
  );
  expect(new Set(ids).size).toBe(2);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator('[data-recents="delete"]').first().click();
  await expect(page.locator('[data-recents="card"]')).toHaveCount(1);
});

// ---------------------------------------------------------------------------
// The failure path
// ---------------------------------------------------------------------------

test("a rejected write is visible, not silent", async ({ page }) => {
  // `?storage=full` swaps in a store that refuses every write with a quota
  // error — the same family of affordance as `?fixture=stress`. Genuinely
  // exhausting a browser's storage takes minutes and is flaky; asserting it
  // only in a unit test proves the save path and not the wiring from that path
  // to the indicator a person actually reads.
  await page.goto("/editor?storage=full");
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");

  await chargeUpEverything(page);

  const indicator = page.locator(`${SAVE_STATE}[data-save-status="error"]`);
  await expect(indicator).toBeVisible({ timeout: 10_000 });
  await expect(indicator).toContainText(/no room left/i);
});

// ---------------------------------------------------------------------------
// The canvas error boundary
// ---------------------------------------------------------------------------

test("a throw inside the canvas flushes the sketch and the drawing survives a reload", async ({
  page,
}) => {
  await page.goto("/editor?crash=canvas");
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");
  const id = await currentDocId(page);

  // One edit, then arm, then a second edit — so the throw happens with a
  // change in the store that the autosave debounce has not written yet.
  await chargeUpEverything(page);
  await page.evaluate(() => {
    (window as unknown as Record<string, () => void>)["__chemistrySketcherArmCanvasCrash"]!();
  });
  await page.keyboard.press("+");

  await expect(page.locator('[data-shell="canvas-error"]')).toBeVisible();
  // The chrome stays mounted: the title, the status bar and the save indicator
  // are all still readable behind the fallback.
  await expect(page.locator('[data-shell="top-bar"]')).toBeVisible();

  await page.goto(`/editor?doc=${id}`);
  // BOTH edits are there. The second one only reached storage through the
  // boundary's flush.
  await expect(page.locator(CHARGE)).toContainText("+12");
});

// ---------------------------------------------------------------------------
// Import, and what it costs
// ---------------------------------------------------------------------------

test("a dropped molfile with a LYING extension still imports, by content", async ({
  page,
}) => {
  await page.goto("/editor");
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");

  // `.txt`, which is how PubChem serves one. Nothing in the import path looks
  // at the extension.
  await dropFile(page, "structure.txt", ETHANOL_MOLBLOCK);
  await expect(page.locator(FORMULA)).toHaveText("C₂H₆O");
});

test("dropping a molfile fetches NOTHING from RDKit; dropping a SMILES does", async ({
  page,
}) => {
  const rdkitRequests: string[] = [];
  page.on("request", (request) => {
    if (RDKIT_ASSET.test(request.url())) rdkitRequests.push(request.url());
  });

  await page.goto("/editor");
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");

  await dropFile(page, "ethanol.mol", ETHANOL_MOLBLOCK);
  await expect(page.locator(FORMULA)).toHaveText("C₂H₆O");
  await page.waitForLoadState("networkidle");
  // 6.9 MB is roughly forty times the rest of the client put together, and a
  // format the editor reads itself must never pay for it.
  expect(rdkitRequests, "a molfile drop reached for the wasm").toEqual([]);

  await dropText(page, "CC(=O)O");
  await expect(page.locator(FORMULA)).toHaveText("C₂H₄O₂", { timeout: 60_000 });
  expect(rdkitRequests.length, "a SMILES drop did not reach the wasm").toBeGreaterThan(0);
});

test("a multi-record SDF becomes N documents, not N fragments (decision 7)", async ({
  page,
}) => {
  await page.goto("/editor");
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");

  await dropFile(page, "catalogue.sdf", THREE_RECORD_SDF);
  // The first record is opened; the rest are written straight to storage,
  // because one editor holds one document and a grid can list forty.
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");
  await expect(page.locator('[data-status="message"]')).toContainText("2 more");

  await page.goto("/");
  await expect(page.locator('[data-recents="card"]')).toHaveCount(3);
  const titles = await page
    .locator('[data-recents="title"]')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent));
  expect([...titles].sort()).toEqual(["Benzene", "Ethanol", "Methanol-ish"]);
});

test("dropping something that is not a structure says so and changes nothing", async ({
  page,
}) => {
  await page.goto("/editor");
  await dropText(page, "Dear editor, please find attached");
  await expect(page.locator('[data-status="message"]')).toContainText(/does not look like/i);
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");
});

test("a dropped structure is one undo away from being taken back (decision 7)", async ({
  page,
}) => {
  await page.goto("/editor");
  await dropFile(page, "ethanol.mol", ETHANOL_MOLBLOCK);
  await expect(page.locator(FORMULA)).toHaveText("C₂H₆O");

  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");
});

// ---------------------------------------------------------------------------
// The file commands
// ---------------------------------------------------------------------------

test("the palette lists the file commands", async ({ page }) => {
  await page.goto("/editor");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator("[data-palette-command]").first()).toBeVisible();

  // The palette renders from the one registry, so this is a claim about a new
  // namespace reaching every surface rather than about the palette's markup.
  const listed = await page.evaluate(() =>
    [...document.querySelectorAll("[data-palette-command]")].map((node) =>
      node.getAttribute("data-palette-command"),
    ),
  );
  for (const id of ["file.new", "file.open", "file.save", "file.export-mol"]) {
    expect(listed).toContain(id);
  }
});

test("Mod+S saves and says so", async ({ page }) => {
  await page.goto("/editor");
  await chargeUpEverything(page);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator('[data-status="message"]')).toContainText(/Saved/);
  await waitForSaved(page);
});
