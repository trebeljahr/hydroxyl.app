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
const RECENTS_LINK = '[data-shell="recents-link"]';

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

test("an edit followed IMMEDIATELY by a navigation still reaches storage", async ({
  page,
}) => {
  // The autosave debounce is a window in which the drawing exists only in
  // memory, and the last-resort flush has to close it. An IndexedDB flush
  // cannot: measured in Chrome with the connection warm and the whole path to
  // `IDBObjectStore.put` synchronous, the requests are queued and the
  // transaction still never commits, because the document is destroyed first.
  // The teardown handlers therefore write the document to `localStorage`
  // first, which returns with the value already committed, and the next load
  // puts it back into IndexedDB. See `persistence/journal.ts`.
  await page.goto("/editor");
  await chargeUpEverything(page);
  const id = await currentDocId(page);
  await waitForSaved(page);

  // A second edit, then straight away — nothing awaited in between that would
  // give the debounce time to fire on its own, so the write that saves this
  // edit is the `pagehide` flush.
  await page.keyboard.press("+");
  await page.goto(`/editor?doc=${id}`);

  await expect(page.locator(CHARGE)).toContainText("+12");
});

test("a tab CLOSED inside the debounce still gives the sketch back", async ({
  page,
  context,
}) => {
  // The case the journal exists for, and the one no flush can cover: there is
  // no next task in which an IndexedDB transaction could commit, because the
  // document is gone. `localStorage.setItem` has already returned by then.
  await page.goto("/editor");
  await chargeUpEverything(page);
  const id = await currentDocId(page);
  await waitForSaved(page);

  await page.keyboard.press("+");
  await page.close({ runBeforeUnload: true });

  const reopened = await context.newPage();
  await reopened.goto(`/editor?doc=${id}`);
  await expect(reopened.locator(CHARGE)).toContainText("+12");
  // And the rescue copy is gone once it has been honoured, so a later load
  // cannot restore it over newer work.
  await expect
    .poll(() =>
      reopened.evaluate(
        (docId) => localStorage.getItem(`chemistry-sketcher/unsaved/${docId}`),
        id,
      ),
    )
    .toBeNull();
});

test("a document deleted in another tab does not go on looking saved", async ({ page }) => {
  // One origin has one IndexedDB and the recents cards are ordinary links, so
  // two tabs on one library is a single gesture away. Without a signal the
  // editor's next autosave RESURRECTS the deleted document and nobody is told.
  await page.goto("/editor");
  await chargeUpEverything(page);
  const id = await currentDocId(page);
  await waitForSaved(page);

  const other = await page.context().newPage();
  await other.goto("/");
  const card = other.locator(`[data-recents="card"][data-doc-id="${id}"]`);
  await expect(card).toBeVisible();
  other.once("dialog", (dialog) => void dialog.accept());
  await card.locator('[data-recents="delete"]').click();
  await expect(other.locator('[data-recents="card"]')).toHaveCount(0);

  const indicator = page.locator(`${SAVE_STATE}[data-save-status="error"]`);
  await expect(indicator).toBeVisible({ timeout: 10_000 });
  await expect(indicator).toContainText(/deleted in another tab/i);

  // And the next edit here must NOT quietly write it back. Well past the
  // autosave debounce, the other tab's grid is still empty and the warning
  // still stands.
  await page.keyboard.press("+");
  await page.waitForTimeout(1_000);
  await expect(indicator).toContainText(/deleted in another tab/i);
  await other.reload();
  await expect(other.locator('[data-recents="empty"]')).toBeVisible();
  await other.close();
});

test("a rename from the grid survives the open editor's next autosave", async ({ page }) => {
  // The editor used to write the whole document back, stale title included,
  // so renaming a card while its sketch was open in another tab lasted only
  // until that tab's next edit.
  await page.goto("/editor");
  await chargeUpEverything(page);
  await expect(page.locator(CHARGE)).toContainText("+6");
  const id = await currentDocId(page);
  await waitForSaved(page);

  const other = await page.context().newPage();
  await other.goto("/");
  const card = other.locator(`[data-recents="card"][data-doc-id="${id}"]`);
  await expect(card).toBeVisible();
  other.once("dialog", (dialog) => void dialog.accept("Cyclohexatriene"));
  await card.locator('[data-recents="rename"]').click();
  await expect(card.locator('[data-recents="title"]')).toHaveText("Cyclohexatriene");

  // The open editor takes the name on as soon as the rename is announced.
  const title = page.locator('[data-shell="document-title"]');
  await expect(title).toHaveValue("Cyclohexatriene");

  // An edit that has nothing to do with the title, then its autosave.
  await page.keyboard.press("+");
  await expect(page.locator(CHARGE)).toContainText("+12");
  await waitForSaved(page);

  // Undoing that edit must not undo the rename with it: the rename was never
  // an undo step, and the older snapshot no longer carries the old title.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(CHARGE)).toContainText("+6");
  await expect(title).toHaveValue("Cyclohexatriene");
  await waitForSaved(page);

  await page.goto(`/editor?doc=${id}`);
  await expect(page.locator(CHARGE)).toContainText("+6");
  await expect(title).toHaveValue("Cyclohexatriene");
  await other.reload();
  await expect(card.locator('[data-recents="title"]')).toHaveText("Cyclohexatriene");
  await other.close();
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

test("the top bar goes home with a stroke drawn a moment ago, and the card brings it back", async ({
  page,
}) => {
  // Clicked straight after the stroke, with nothing awaited that would give
  // the autosave debounce time to fire: the write that puts this card on the
  // grid is the one the link waits for before it navigates.
  const atoms = page.locator(`${CANVAS} [data-layer="scene"] circle[data-atom-id]`);
  await page.goto("/editor");
  await expect(atoms).toHaveCount(6);
  const id = await currentDocId(page);

  const box = (await page.locator(CANVAS).boundingBox())!;
  await page.click('[data-tool="ring"]');
  await page.mouse.click(box.x + 90, box.y + 90);
  await expect.poll(() => atoms.count()).toBeGreaterThan(6);
  const drawn = await atoms.count();

  await page.locator(RECENTS_LINK).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");

  const card = page.locator(`[data-recents="card"][data-doc-id="${id}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator('[data-recents="thumbnail"]')).toBeVisible();
  await card.locator('[data-recents="open"]').click();
  await expect(atoms).toHaveCount(drawn);
});

test("leaving a sketch the store refused asks first, and stays when told to", async ({
  page,
}) => {
  await page.goto("/editor?storage=full");
  await chargeUpEverything(page);
  await expect(page.locator(`${SAVE_STATE}[data-save-status="error"]`)).toBeVisible({
    timeout: 10_000,
  });

  const asked: string[] = [];
  page.once("dialog", (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });
  await page.locator(RECENTS_LINK).click();
  await expect(page.locator('[data-status="message"]')).toContainText("Stayed in the editor");
  expect(new URL(page.url()).pathname).toMatch(/^\/editor/);
  expect(asked[0]).toMatch(/no room left/i);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator(RECENTS_LINK).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
});

test("?doc= opens THAT document, not whichever one the tab saw last", async ({ page }) => {
  // The blocking regression this pins. `editorStore` is a module singleton, so
  // the load used to be skipped whenever the molecule was already non-empty —
  // the URL named one document, the canvas showed another, and the first edit
  // forked a new record while the indicator said "Saved". The decision is made
  // on the document's ID now, so a second visit loads rather than adopting.
  await page.goto("/editor");
  await chargeUpEverything(page);
  const first = await currentDocId(page);
  await waitForSaved(page);

  // A second, visibly different document: ethanol rather than a charged benzene.
  await page.goto("/editor");
  await dropFile(page, "ethanol.mol", ETHANOL_MOLBLOCK);
  await expect(page.locator(FORMULA)).toHaveText("C₂H₆O");
  const second = await currentDocId(page);
  await waitForSaved(page);
  expect(second).not.toBe(first);

  // Each id opens its own sketch, and the top bar agrees with the URL.
  await page.goto(`/editor?doc=${first}`);
  await expect(page.locator('[data-shell="top-bar"]')).toHaveAttribute("data-doc-id", first);
  await expect(page.locator(CHARGE)).toContainText("+6");

  await page.goto(`/editor?doc=${second}`);
  await expect(page.locator('[data-shell="top-bar"]')).toHaveAttribute("data-doc-id", second);
  await expect(page.locator(FORMULA)).toHaveText("C₂H₆O");
});

test("the grid links at a file the export actually has, with no trailing slash", async ({
  page,
}) => {
  // The other blocking regression. `next/link href="/editor?doc=…"` made the
  // static export's client router push `/editor/?doc=…` — no document loaded,
  // and every later `./_next/…` chunk resolved into a directory with none, so
  // the RDKit import died with "Failed to load chunk" and reloading that URL
  // rendered nothing. Plain anchors at a build-appropriate href, and a real
  // navigation, are the fix. Here (standalone) the correct href is `/editor`.
  await page.goto("/editor");
  await chargeUpEverything(page);
  const id = await currentDocId(page);
  await waitForSaved(page);

  await page.goto("/");
  const open = page.locator(`[data-recents="card"][data-doc-id="${id}"] [data-recents="open"]`);
  await expect(open).toHaveAttribute("href", `/editor?doc=${id}`);

  // A marker that only a REAL document load can clear. `next/link` would push
  // the URL and keep this window object — and in the export that push is the
  // whole failure, because the pushed path is a directory with no assets under
  // it and no HTML document at it.
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>)["__navigationWitness"] = true;
  });
  await open.click();
  await expect(page.locator(CHARGE)).toContainText("+6");
  const survived = await page.evaluate(
    () => (window as unknown as Record<string, unknown>)["__navigationWitness"],
  );
  expect(survived, "the card must navigate, not push a route").toBeUndefined();
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

test("there is no debug switch that quietly stops saving", async ({ page }) => {
  // `?storage=memory` used to swap in a store that kept nothing while the
  // indicator went on reporting "Saved" — the exact silent loss this whole
  // feature exists to remove, reachable by anyone who pasted a URL out of a
  // bug report. `full` and `crash` stay because both put a visible error on
  // the screen; a debug affordance may break the app, it may not lie about it.
  await page.goto("/editor?storage=memory");
  await chargeUpEverything(page);
  const id = await currentDocId(page);
  await waitForSaved(page);

  await page.goto(`/editor?doc=${id}`);
  await expect(page.locator(CHARGE)).toContainText("+6");
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

test("the crash fallback offers an exit that is NOT the document that crashed", async ({
  page,
}) => {
  // React retries a failed concurrent render and swallows a one-shot throw, so
  // a throw that reaches `componentDidCatch` is deterministic over this
  // document. Reload is the same URL and the recents card links at the same
  // id, which left a sketch that reliably breaks the canvas permanently
  // unopenable — the boundary's own flush cementing the trap.
  await page.goto("/editor?crash=canvas");
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");
  await chargeUpEverything(page);
  await page.evaluate(() => {
    (window as unknown as Record<string, () => void>)["__chemistrySketcherArmCanvasCrash"]!();
  });
  await page.keyboard.press("+");

  const fallback = page.locator('[data-shell="canvas-error"]');
  await expect(fallback).toBeVisible();
  // And it says what the rescue write actually did, rather than asserting a
  // save it never checked.
  await expect(page.locator('[data-shell="canvas-error-rescue"]')).toHaveAttribute(
    "data-rescue",
    "saved",
  );

  await page.locator('[data-shell="canvas-error-new"]').click();
  // A blank editor, with no `?doc=` and no crash armed.
  await expect(page.locator(CANVAS)).toBeVisible();
  await expect(page.locator('[data-shell="canvas-error"]')).toHaveCount(0);
});

test("the fallback does NOT claim a save that was refused", async ({ page }) => {
  // `saveDocument` RESOLVES `{ok:false}` on a quota refusal — it never rejects
  // — so a boundary that handled only a rejection printed "Your sketch has
  // been saved" over a write that had not happened, beside a status bar
  // showing the quota error.
  await page.goto("/editor?crash=canvas&storage=full");
  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");
  await chargeUpEverything(page);
  await page.evaluate(() => {
    (window as unknown as Record<string, () => void>)["__chemistrySketcherArmCanvasCrash"]!();
  });
  await page.keyboard.press("+");

  const rescue = page.locator('[data-shell="canvas-error-rescue"]');
  await expect(rescue).toHaveAttribute("data-rescue", "failed", { timeout: 10_000 });
  await expect(rescue).toContainText(/could NOT be saved/);
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
  for (const id of ["file.new", "file.open", "file.save", "file.export-mol", "file.recents"]) {
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

// ---------------------------------------------------------------------------
// The startup placeholder
// ---------------------------------------------------------------------------

/**
 * THE ID THE PRERENDER RENDERS MUST NOT BECOME A DOCUMENT IDENTITY.
 *
 * `/editor` is prerendered, so the store's startup document carries a FIXED id
 * (`doc_startup`) for the server and the browser to agree on — see
 * `state/startup-document.ts`. That string is the same in every visitor's
 * browser, so a record stored under it belongs to nobody.
 *
 * The placeholder is REACHABLE, which is what made this a data-loss bug rather
 * than a curiosity: opening the benzene fixture is an undoable entry, so one
 * Ctrl+Z puts the placeholder back on the canvas. Measured before the fix:
 * twelve atoms drawn that way were stored under `doc_startup`, and reopening
 * the recents card they made showed an empty canvas — the sketch gone, with no
 * error anywhere.
 *
 * Decision 85: ephemeral until the first edit. The placeholder stays on the
 * canvas after the undo and is written nowhere; the first stroke mints an id
 * of this tab's own, and THAT is what the recents card carries.
 */
test("work drawn after undoing the fixture keeps an id of its own", async ({ page }) => {
  const atoms = page.locator(`${CANVAS} [data-layer="scene"] circle[data-atom-id]`);

  await page.goto("/editor");
  await expect(atoms).toHaveCount(6);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(atoms).toHaveCount(0);
  // Still the placeholder, and that is the point: an editor nobody has drawn
  // in owns nothing and writes nothing.
  expect(await currentDocId(page)).toBe("doc_startup");

  const box = (await page.locator(CANVAS).boundingBox())!;
  await page.click('[data-tool="ring"]');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2 + 60, box.y + box.height / 2);
  const drawn = await atoms.count();
  expect(drawn).toBeGreaterThan(0);

  // The stroke is what gives the document an identity.
  const minted = await currentDocId(page);
  expect(minted).not.toBe("doc_startup");
  await waitForSaved(page);

  await page.goto("/");
  await expect(page.locator(`[data-recents="card"][data-doc-id="doc_startup"]`)).toHaveCount(0);
  const card = page.locator(`[data-recents="card"][data-doc-id="${minted}"]`);
  await expect(card).toHaveCount(1);
  await card.locator('[data-recents="open"]').click();

  // The whole point: the card leads back to the atoms, not to a blank canvas.
  await expect(atoms).toHaveCount(drawn);
});

/**
 * An untouched editor leaves the library exactly as it found it.
 *
 * Opening `/editor`, undoing back to the placeholder and leaving again used to
 * be enough to litter the recents grid — first with a `doc_startup` record,
 * and then, after the id was minted at mount instead, with an empty `Untitled`
 * card for a session in which nothing was drawn.
 */
test("opening and leaving the editor stores nothing", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-recents="empty"]')).toBeVisible();

  await page.goto("/editor");
  await expect(page.locator(`${CANVAS} [data-layer="scene"] circle[data-atom-id]`)).toHaveCount(6);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(FORMULA)).toHaveText("Empty sketch");

  await page.goto("/");
  await expect(page.locator('[data-recents="empty"]')).toBeVisible();
});

/**
 * The other half of the same bug. `?doc=doc_startup` matched the id every
 * fresh store already holds, so the effect took its "already the one the URL
 * names" branch: no read, no error, an empty canvas, and the first stroke
 * written back over whatever was stored. The reserved string names no document
 * now — `documentIdFromSearch` answers null for it — so the route is an
 * ordinary `/editor`, and nothing stored under that key is read, replaced or
 * deleted.
 */
test("?doc=doc_startup is an ordinary /editor, and touches nothing", async ({ page }) => {
  await page.goto("/editor?doc=doc_startup");

  await expect(page.locator(FORMULA)).toHaveText("C₆H₆");
  expect(await currentDocId(page)).not.toBe("doc_startup");

  await chargeUpEverything(page);
  await waitForSaved(page);

  await page.goto("/");
  await expect(page.locator(`[data-recents="card"][data-doc-id="doc_startup"]`)).toHaveCount(0);
});
