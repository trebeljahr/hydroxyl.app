import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Panel figures and publication export, in a real browser.
 *
 * The unit tests prove what the serialiser writes and how the layout is
 * computed. These prove the parts only a browser has: the Radix panel list,
 * the save path (a real `download`), the rasteriser (an SVG drawn into a
 * canvas backing store), the async clipboard, IndexedDB across a reload — and
 * the one failure this feature is most likely to ship: a file that looks
 * right in the app and opens invisible on its own.
 *
 * `showSaveFilePicker` EXISTS in Playwright's Chromium, and a test that lets
 * it open hangs on a native dialog, so every spec here deletes it and takes
 * the download fallback instead.
 */

const CANVAS = "[data-canvas-root]";
const PANELS = '[data-shell="figure-panels"]';
const DIALOG = '[data-shell="export-dialog"]';
const SAVE_STATE = '[data-status="save-state"]';

async function openEditor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/editor");
  await page.locator(`${CANVAS} [data-layer="scene"]`).waitFor();
  await expect(page.locator(PANELS)).toBeVisible();
}

async function panelKinds(page: Page): Promise<string[]> {
  return page
    .locator(`${PANELS} [data-panel-id]`)
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-panel-kind") ?? ""));
}

async function addPanel(page: Page, title: string): Promise<void> {
  await page.locator(`${PANELS} [aria-label="View for the new panel"]`).click();
  await page.getByRole("option", { name: title, exact: true }).click();
  await page.locator('[data-shell="add-panel"]').click();
}

/** Skeletal, Lewis, sum formula — the acceptance figure — built through the UI. */
async function composeThreeViews(page: Page): Promise<void> {
  await expect.poll(() => panelKinds(page)).toEqual(["skeletal", "sumFormula"]);
  await addPanel(page, "Lewis");
  await expect.poll(() => panelKinds(page)).toEqual(["skeletal", "sumFormula", "lewis"]);
  // Reorder with the keyboard: focus the row, Alt+ArrowUp.
  const lewisRow = page.locator(`${PANELS} [data-panel-kind="lewis"]`);
  await lewisRow.focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => panelKinds(page)).toEqual(["skeletal", "lewis", "sumFormula"]);
}

async function openExportDialog(page: Page): Promise<void> {
  await page.locator('[data-command="figure.export-dialog"]').click();
  await expect(page.locator(DIALOG)).toBeVisible();
}

async function downloadFrom(page: Page, command: string): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(`${DIALOG} [data-command="${command}"]`).click(),
  ]);
  const path = await download.path();
  return readFileSync(path);
}

/** Fire a real `drop` carrying a molfile: opens it as a new document (decision 7). */
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

/**
 * A V2000 molfile of isolated methanes at the given positions, in BOND
 * LENGTHS (the reader divides by 1.5 Å). The cheapest drawing that is as wide
 * or as tall as a test needs at the fixed printed bond length.
 */
function methanesMolfile(title: string, positions: readonly (readonly [number, number])[]): string {
  const f = (v: number) => (v * 1.5).toFixed(4).padStart(10);
  const atoms = positions
    .map(([x, y]) => `${f(x)}${f(y)}${f(0)} C   0  0  0  0  0  0  0  0  0  0  0  0`)
    .join("\n");
  const count = String(positions.length).padStart(3);
  return `${title}\n  e2e               2D\n\n${count}  0  0  0  0  0  0  0  0  0999 V2000\n${atoms}\nM  END\n`;
}

/** The skeletal panel's first bond, measured in viewBox units. */
function firstSkeletalBondLength(svg: string): number {
  const bond = /<line id="p-panel-skeletal\.bond:[^"]+:line"[^>]*x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/.exec(
    svg,
  );
  expect(bond).not.toBeNull();
  const [x1, y1, x2, y2] = bond!.slice(1).map(Number);
  return Math.sqrt((x2! - x1!) ** 2 + (y2! - y1!) ** 2);
}

/** cm per viewBox unit times px per bond: the bond as a renderer of the file prints it. */
function printedBondCm(svg: string, bondLengthPx: number): number {
  const widthCm = Number.parseFloat(attr(svg, "width"));
  const [, , vbW] = attr(svg, "viewBox").split(" ").map(Number);
  return (widthCm / vbW!) * bondLengthPx;
}

function attr(svg: string, name: string): string {
  const match = new RegExp(`<svg[^>]*\\s${name}="([^"]*)"`).exec(svg);
  if (match === null) throw new Error(`no ${name} on the svg root`);
  return match[1]!;
}

test("panels compose, reorder by keyboard, carry captions and columns, and survive a reload", async ({
  page,
}) => {
  await openEditor(page);
  await composeThreeViews(page);

  // The row keeps focus as it moves, so a second press keeps moving it.
  expect(
    await page.evaluate(() => document.activeElement?.getAttribute("data-panel-kind")),
  ).toBe("lewis");

  const caption = page.locator(`${PANELS} [data-panel-kind="lewis"] [data-panel-caption]`);
  await caption.fill("Lewis structure");
  await caption.press("Enter");
  const columns = page.locator(`${PANELS} [data-figure-columns]`);
  await columns.fill("2");
  await columns.press("Enter");

  // Labels follow the order, not the order panels were added in.
  await expect(page.locator(`${PANELS} [data-panel-kind="lewis"]`)).toHaveAttribute(
    "data-panel-label",
    "(b)",
  );

  // The switcher over the canvas lists the same panels; choosing Lewis draws
  // the canvas through it, choosing the formula keeps the structure and says why.
  const lewisId = await page
    .locator(`${PANELS} [data-panel-kind="lewis"]`)
    .getAttribute("data-panel-id");
  await page.locator(`[data-switcher-panel="${lewisId}"]`).click();
  await expect(page.locator(`[data-switcher-panel="${lewisId}"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator('[data-switcher-panel="panel-sum-formula"]').click();
  await expect(page.locator('[data-shell="switcher-notice"]')).toContainText("text view");

  await expect(page.locator(`${SAVE_STATE}[data-save-status="saved"]`)).toBeVisible({
    timeout: 10_000,
  });
  // Reopened by id, the way the recents grid does: a bare /editor starts a
  // fresh sketch by design.
  const id = await page.locator('[data-shell="top-bar"]').getAttribute("data-doc-id");
  expect(id).toBeTruthy();
  await page.goto(`/editor?doc=${id}`);
  await expect(page.locator('[data-shell="top-bar"]')).toHaveAttribute("data-doc-id", id!);
  await page.locator(`${CANVAS} [data-layer="scene"]`).waitFor();

  await expect.poll(() => panelKinds(page)).toEqual(["skeletal", "lewis", "sumFormula"]);
  await expect(
    page.locator(`${PANELS} [data-panel-kind="lewis"] [data-panel-caption]`),
  ).toHaveValue("Lewis structure");
  await expect(page.locator(`${PANELS} [data-figure-columns]`)).toHaveValue("2");
});

test("exports ONE self-contained SVG: labelled panels, one bond length, unique ids, printed bond size", async ({
  page,
  browser,
}, testInfo) => {
  await openEditor(page);
  await composeThreeViews(page);

  // WITH THE ROTATE HANDLE ON THE CANVAS. Every other overlay mark is drawn
  // only during a gesture; the handle is drawn whenever two atoms or more are
  // selected (decision 105), so it is the one most likely to be on screen when
  // someone exports. The blanket `data-overlay` check below binds it only if
  // it is actually there.
  await page.locator(CANVAS).click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator('[data-overlay="rotate-handle"]')).toHaveCount(1);

  await openExportDialog(page);
  await expect(page.locator('[data-shell="figure-preview"]')).toBeVisible();

  const svg = (await downloadFrom(page, "figure.export-svg")).toString("utf8");
  await expect(page.locator('[data-shell="export-status"]')).toContainText("Exported the figure as SVG");

  // One root, three panels in order.
  expect(svg.match(/<svg[\s>]/g)).toHaveLength(1);
  expect([...svg.matchAll(/data-panel-label="([^"]+)"/g)].map((m) => m[1])).toEqual([
    "(a)",
    "(b)",
    "(c)",
  ]);
  expect([...svg.matchAll(/data-view="([^"]+)"/g)].map((m) => m[1])).toEqual([
    "skeletal",
    "lewis",
    "sumFormula",
  ]);
  for (const letter of ["a", "b", "c"]) expect(svg).toContain(`<tspan>(${letter})</tspan>`);

  // Physical units at the fixed printed bond length (decision 20): a
  // three-panel benzene is narrower than the single column it may fill, so
  // it prints at its natural size and the column is not stretched to.
  expect(attr(svg, "width")).toMatch(/^[\d.]+cm$/);
  const widthCm = Number.parseFloat(attr(svg, "width"));
  expect(widthCm).toBeLessThan(8.25);
  const [, , vbW, vbH] = attr(svg, "viewBox").split(" ").map(Number);
  expect(Number.parseFloat(attr(svg, "height"))).toBeCloseTo((widthCm * vbH!) / vbW!, 3);
  // Publication's 24 px bond: new documents open in Publication (decision
  // 135), and the export defaults to it whatever the canvas shows (decision
  // 50).
  expect(printedBondCm(svg, 24)).toBeCloseTo(0.508, 3);
  await expect(page.locator('[data-shell="figure-scaled"]')).toHaveCount(0);

  // Nothing that only resolves inside the app.
  expect(svg).not.toContain("var(--");
  expect(svg).not.toMatch(/\sclass=/);
  expect(svg).not.toContain("data-overlay");
  expect(svg).not.toContain("data-atom-id");

  // No two elements share an id, although panels (a) and (b) share every atom id.
  const ids = [...svg.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
  expect(ids.length).toBeGreaterThan(30);
  expect(new Set(ids).size).toBe(ids.length);

  // One bond length: every panel transform is a bare translate, and a
  // skeletal bond is the publication style's 24 px in viewBox units.
  const transforms = [...svg.matchAll(/transform="([^"]*)"/g)].map((m) => m[1]);
  expect(transforms).toHaveLength(3);
  for (const t of transforms) expect(t).toMatch(/^translate\(-?[\d.]+ -?[\d.]+\)$/);
  expect(firstSkeletalBondLength(svg)).toBeCloseTo(24, 1);

  // The viewBox does not move with the editor's pan and zoom. BOTH are
  // driven, and they are different gestures (decision 106): a bare wheel pans
  // and Ctrl + wheel zooms, so a spec that only scrolled would prove half of
  // what it claims.
  await page.keyboard.press("Escape");
  await expect(page.locator(DIALOG)).toBeHidden();
  const box = (await page.locator(CANVAS).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const zoom = page.locator('[data-status="zoom"]');
  const zoomBefore = await zoom.textContent();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -600);
  await page.keyboard.up("Control");
  await expect(zoom).not.toHaveText(zoomBefore ?? "");
  await page.mouse.wheel(0, 400);
  await page.keyboard.press("ControlOrMeta+0");
  await page.mouse.wheel(120, 400);
  await openExportDialog(page);
  const again = (await downloadFrom(page, "figure.export-svg")).toString("utf8");
  expect(attr(again, "viewBox")).toBe(attr(svg, "viewBox"));
  expect(again).toBe(svg);

  // OPENED ON ITS OWN, from the filesystem, outside the app.
  const file = testInfo.outputPath("figure.svg");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(file, svg);
  const standalone = await browser.newPage();
  try {
    await standalone.goto(`file://${file}`);
    const rendered = await standalone.evaluate(async () => {
      const root = document.documentElement;
      const panels = [...document.querySelectorAll("[data-panel]")].map((g) => {
        const b = (g as SVGGraphicsElement).getBBox();
        return { width: b.width, height: b.height };
      });
      const texts = [...document.querySelectorAll("text")].length;
      // Rasterise the document as it stands and count inked pixels.
      const markup = new XMLSerializer().serializeToString(root);
      const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas") as HTMLCanvasElement;
      canvas.width = 800;
      canvas.height = Math.round((800 * img.naturalHeight) / img.naturalWidth);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let inked = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 128) inked += 1;
      return { tag: root.tagName, panels, texts, inked, total: data.length / 4 };
    });
    expect(rendered.tag).toBe("svg");
    expect(rendered.panels).toHaveLength(3);
    for (const p of rendered.panels) {
      expect(p.width).toBeGreaterThan(10);
      expect(p.height).toBeGreaterThan(5);
    }
    expect(rendered.texts).toBeGreaterThan(10);
    // Ink, but not a solid block: a figure, not a blank file or a black box.
    expect(rendered.inked).toBeGreaterThan(rendered.total * 0.005);
    expect(rendered.inked).toBeLessThan(rendered.total * 0.5);
    await standalone.screenshot({ path: testInfo.outputPath("figure-standalone.png") });
  } finally {
    await standalone.close();
  }
});

test("PDF is one vector page the printed size, with Arimo embedded (decision 236)", async ({
  page,
}, testInfo) => {
  await openEditor(page);
  await composeThreeViews(page);
  await openExportDialog(page);
  await page.locator(`${DIALOG} input[name="figure-width"][value="single"]`).check();
  const readout = await page.locator('[data-shell="figure-size"]').textContent();
  const printed = /Prints ([\d.]+) × ([\d.]+) cm/.exec(readout ?? "");
  expect(printed).not.toBeNull();

  const pdf = await downloadFrom(page, "figure.export-pdf");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(testInfo.outputPath("figure.pdf"), pdf);
  const text = pdf.toString("latin1");
  expect(text.startsWith("%PDF-1.7\n")).toBe(true);
  expect(text.endsWith("%%EOF\n")).toBe(true);

  // The page is the size the dialog read out, in points.
  const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text);
  expect(Number(box?.[1])).toBeCloseTo((Number(printed?.[1]) / 2.54) * 72, 0);
  expect(Number(box?.[2])).toBeCloseTo((Number(printed?.[2]) / 2.54) * 72, 0);
  // Text set in the embedded face, not left to the reader's fonts.
  expect(text).toContain("/FontFile2");
  expect(text).toContain("/Encoding /Identity-H");
  expect(text).not.toContain("/BaseFont /Symbol");
  await expect(page.locator('[data-shell="export-status"]')).toContainText("Exported the figure as PDF");
});

test("PNG at 300 dpi follows the printed size, not the column, rasterised with its resolution stamped", async ({
  page,
}, testInfo) => {
  await openEditor(page);
  await composeThreeViews(page);
  await openExportDialog(page);
  await page.locator(`${DIALOG} input[name="figure-dpi"][value="300"]`).check();
  await page.locator(`${DIALOG} input[name="figure-width"][value="single"]`).check();
  const readout = await page.locator('[data-shell="figure-size"]').textContent();
  const expected = /Prints ([\d.]+) × ([\d.]+) cm · PNG (\d+) × (\d+) px · bond ([\d.]+) mm/.exec(
    readout ?? "",
  );
  expect(expected).not.toBeNull();
  // One bond at 0.508 cm, so this figure is narrower than the 8.25 cm column.
  expect(expected?.[5]).toBe("5.08");
  const printedCm = Number(expected?.[1]);
  expect(printedCm).toBeLessThan(8.25);
  const expectedWidthPx = Number(expected?.[3]);
  expect(expectedWidthPx).toBeLessThan(974);
  expect(Math.abs(expectedWidthPx - (printedCm / 2.54) * 300)).toBeLessThan(1);

  const png = await downloadFrom(page, "figure.export-png");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(testInfo.outputPath("figure.png"), png);

  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(width).toBe(expectedWidthPx);
  expect(String(height)).toBe(expected?.[4]);

  // pHYs: 300 dpi is 11811 pixels per metre, so the file claims the printed width.
  const phys = png.indexOf("pHYs");
  expect(phys).toBeGreaterThan(0);
  expect(png.readUInt32BE(phys + 4)).toBe(11811);

  // Rasterised from the vectors at this size, not a small image scaled up:
  // the PNG decodes in the page at exactly its own pixel size and carries
  // hard ink-coloured stroke pixels, which an interpolated upscale smears to grey.
  const stats = await page.evaluate(async (base64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let black = 0;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Within 48 of the publication style's black ink (the export's default
      // style, decision 50), fully opaque.
      if (data[i]! < 48 && data[i + 3]! > 240) black += 1;
      if (data[i]! < 128) dark += 1;
    }
    return { w: img.naturalWidth, h: img.naturalHeight, black, dark, total: data.length / 4 };
  }, png.toString("base64"));
  expect(stats.w).toBe(expectedWidthPx);
  expect(stats.dark).toBeGreaterThan(stats.total * 0.005);
  expect(stats.black).toBeGreaterThan(stats.dark * 0.3);
});

test("a figure wider than the column scales down to exactly the column, and the dialog says so", async ({
  page,
}) => {
  await openEditor(page);
  // Two methanes 24 bonds apart: about 12 cm at the house bond length.
  await dropMolfile(page, "wide.mol", methanesMolfile("Wide", [[0, 0], [24, 0]]));
  await expect(page.locator('[data-status="formula"]')).toHaveText("C₂H₈");

  await openExportDialog(page);
  await page.locator(`${DIALOG} input[name="figure-width"][value="single"]`).check();
  await page.locator(`${DIALOG} input[name="figure-dpi"][value="300"]`).check();
  const notice = page.locator('[data-shell="figure-scaled"]');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText(/^Scaled to \d+% to fit a single column\.$/);
  const percent = Number(/(\d+)%/.exec((await notice.textContent()) ?? "")![1]);
  expect(percent).toBeLessThan(100);
  const readout = (await page.locator('[data-shell="figure-size"]').textContent()) ?? "";
  expect(readout).toMatch(/^Prints 8\.25 × [\d.]+ cm · PNG 974 × \d+ px/);
  // The read-out's bond is the house bond times the reported scale.
  const bondMm = Number(/bond ([\d.]+) mm/.exec(readout)![1]);
  expect(bondMm).toBeLessThan(5.08);
  // (Both are rounded for display, so they agree to within a percent.)
  expect(Math.abs(bondMm / 0.0508 - percent)).toBeLessThan(1.2);

  const svg = (await downloadFrom(page, "figure.export-svg")).toString("utf8");
  expect(attr(svg, "width")).toBe("8.25cm");
  expect(printedBondCm(svg, 24)).toBeLessThan(0.508);
  await expect(page.locator('[data-shell="export-status"]')).toContainText(
    "to fit a single column.",
  );

  // The same figure fits a double column and prints at its natural size there.
  await page.locator(`${DIALOG} input[name="figure-width"][value="double"]`).check();
  await expect(notice).toHaveCount(0);
  await expect(page.locator('[data-shell="figure-fit"]')).toBeVisible();
  await expect(page.locator('[data-shell="figure-size"]')).toContainText("bond 5.08 mm");
});

test("labels scaled under 8 pt: the read-out states the printed pt, the dialog warns, and the export still works", async ({
  page,
}) => {
  await openEditor(page);
  // Two methanes 24 bonds apart: about 12 cm at the house bond length.
  await dropMolfile(page, "wide.mol", methanesMolfile("Wide", [[0, 0], [24, 0]]));
  await expect(page.locator('[data-status="formula"]')).toHaveText("C₂H₈");

  await openExportDialog(page);
  // Publication, the export's default style (decision 50), prints 10 pt labels
  // at the house bond (decision 26), so only the fit scaling can take them
  // under 8 pt here.
  await expect(page.locator('[data-shell="figure-style"]')).toHaveAttribute(
    "data-style-preset",
    "publication",
  );
  await page.locator(`${DIALOG} input[name="figure-width"][value="single"]`).check();

  const scaled = page.locator('[data-shell="figure-scaled"]');
  await expect(scaled).toBeVisible();
  const percent = Number(/(\d+)%/.exec((await scaled.textContent()) ?? "")![1]);
  expect(percent).toBeLessThan(80);

  // The read-out's label size is the one AFTER scaling: 10 pt times the scale.
  const readout = (await page.locator('[data-shell="figure-size"]').textContent()) ?? "";
  const labelPt = Number(/labels ([\d.]+) pt/.exec(readout)![1]);
  expect(labelPt).toBeLessThan(8);
  expect(Math.abs(labelPt - percent / 10)).toBeLessThanOrEqual(0.11);

  const warning = page.locator('[data-shell="figure-label-size"]');
  await expect(warning).toBeVisible();
  await expect(warning).toHaveAttribute("data-label-pt", labelPt.toFixed(1));
  await expect(warning).toContainText(
    `Labels print at ${labelPt.toFixed(1)} pt, below the 8 pt minimum ACS asks for in figures.`,
  );
  // A 12 cm figure with the default two panels (skeletal, sum formula) side
  // by side: a double column fits it at 8 pt, and so would a different layout.
  const needed = Number(/maximum width of ([\d.]+) cm/.exec((await warning.textContent()) ?? "")![1]);
  expect(needed).toBeGreaterThan(8.25);
  expect(needed).toBeLessThan(17.8);
  await expect(warning).toContainText("Try a double column, fewer panels per row, or fewer panels.");

  // A warning, not a refusal (decision 51).
  for (const command of ["figure.export-svg", "figure.export-pdf", "figure.export-png", "figure.copy"]) {
    await expect(page.locator(`${DIALOG} [data-command="${command}"]`)).toBeEnabled();
  }
  const svg = (await downloadFrom(page, "figure.export-svg")).toString("utf8");
  expect(attr(svg, "width")).toBe("8.25cm");
  await expect(page.locator('[data-shell="export-status"]')).toContainText(
    `Labels print at ${labelPt.toFixed(1)} pt`,
  );

  // A custom width at the named minimum brings the labels back to 8 pt.
  await page.locator(`${DIALOG} [data-shell="custom-width"]`).fill(String(needed));
  await expect(warning).toHaveCount(0);
  await expect(page.locator('[data-shell="figure-size"]')).toContainText("labels 8.0 pt");

  // In the double column it prints at its natural size, 10 pt, with no warning.
  await page.locator(`${DIALOG} input[name="figure-width"][value="double"]`).check();
  await expect(warning).toHaveCount(0);
  await expect(page.locator('[data-shell="figure-size"]')).toContainText("labels 10.0 pt");
});

test("a molfile drawn at another tool's bond length prints at the house bond, and the dialog's read-out is true", async ({
  page,
}) => {
  await openEditor(page);
  // Ethane at a 0.825-unit bond, as ChemDraw writes it. Read at the shared
  // 1.5 scale that is a 0.55-unit bond; the import normalises it to one.
  await dropMolfile(
    page,
    "ethane.mol",
    [
      "Ethane",
      "  ChemDraw          2D",
      "",
      "  2  1  0  0  0  0  0  0  0  0999 V2000",
      "   -0.4125    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    0.4125    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  1  0  0  0  0",
      "M  END",
      "",
    ].join("\n"),
  );
  await expect(page.locator('[data-status="formula"]')).toHaveText("C₂H₆");

  await openExportDialog(page);
  await page.locator(`${DIALOG} input[name="figure-width"][value="single"]`).check();
  await expect(page.locator('[data-shell="figure-fit"]')).toBeVisible();
  await expect(page.locator('[data-shell="figure-size"]')).toContainText("bond 5.08 mm");
  await expect(page.locator('[data-shell="figure-bond-length"]')).toHaveCount(0);

  // The file agrees with the read-out: its drawn bond prints at 0.508 cm.
  const svg = (await downloadFrom(page, "figure.export-svg")).toString("utf8");
  const drawn = firstSkeletalBondLength(svg);
  expect(drawn).toBeCloseTo(24, 1);
  expect(printedBondCm(svg, drawn)).toBeCloseTo(0.508, 3);
});

test("double column at 600 dpi exports a PNG past Safari's canvas area where the browser can draw it", async ({
  page,
}) => {
  await openEditor(page);
  // At a fixed printed bond only a big drawing fills a double column at 600
  // dpi and is taller than 0.95 of its width: four methanes on a 40-bond
  // square, 20 cm a side, with the panels stacked in one column.
  await dropMolfile(
    page,
    "square.mol",
    methanesMolfile("Square", [[0, 0], [40, 0], [0, 40], [40, 40]]),
  );
  await expect(page.locator('[data-status="formula"]')).toHaveText("C₄H₁₆");
  const columns = page.locator(`${PANELS} [data-figure-columns]`);
  await columns.fill("1");
  await columns.press("Enter");

  await openExportDialog(page);
  await page.locator(`${DIALOG} input[name="figure-width"][value="double"]`).check();
  await page.locator(`${DIALOG} input[name="figure-dpi"][value="600"]`).check();
  await expect(page.locator('[data-shell="figure-scaled"]')).toContainText("to fit a double column.");
  const readout = await page.locator('[data-shell="figure-size"]').textContent();
  const size = /PNG (\d+) × (\d+) px/.exec(readout ?? "");
  const widthPx = Number(size?.[1]);
  const heightPx = Number(size?.[2]);
  expect(widthPx).toBe(Math.round((17.8 / 2.54) * 600));
  expect(widthPx * heightPx).toBeGreaterThan(16_777_216);
  expect(heightPx).toBeLessThan(32_767);

  await expect(page.locator(`${DIALOG} [role="alert"]`)).toHaveCount(0);
  await expect(page.locator(`${DIALOG} [data-command="figure.export-png"]`)).toBeEnabled();
  const png = await downloadFrom(page, "figure.export-png");
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(png.readUInt32BE(16)).toBe(widthPx);
  expect(png.readUInt32BE(20)).toBe(heightPx);
  // 600 dpi is 23622 pixels per metre.
  expect(png.readUInt32BE(png.indexOf("pHYs") + 4)).toBe(23622);
});

test("the export defaults to Publication whatever the canvas shows, and can follow the canvas instead", async ({
  page,
}) => {
  await openEditor(page);
  const topBar = page.locator('[data-shell="style-preset"]');
  // New documents open in Publication (decision 135), so the canvas and the
  // default file already agree, and both choices give one file.
  await expect(topBar).toHaveAttribute("data-style-preset", "publication");

  await openExportDialog(page);
  const style = page.locator('[data-shell="figure-style"]');
  const notice = page.locator('[data-shell="figure-style-notice"]');
  await expect(style).toHaveAttribute("data-style-preset", "publication");
  await expect(style).toHaveAttribute("data-document-preset", "publication");
  await expect(style.locator('input[value="publication"]')).toBeChecked();
  await expect(notice).toHaveCount(0);
  const newSvg = (await downloadFrom(page, "figure.export-svg")).toString("utf8");
  expect(firstSkeletalBondLength(newSvg)).toBeCloseTo(24, 1);
  await style.locator('input[value="canvas"]').check();
  await expect(notice).toHaveCount(0);
  expect((await downloadFrom(page, "figure.export-svg")).toString("utf8")).toBe(newSvg);
  await page.keyboard.press("Escape");
  await expect(page.locator(DIALOG)).toBeHidden();

  // A sketch switched to Screen, saved and reloaded, keeps Screen.
  await topBar.locator('[data-command="view.style-screen"]').click();
  await expect(topBar).toHaveAttribute("data-style-preset", "screen");
  await expect(topBar.locator('[data-command="view.style-screen"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(`${SAVE_STATE}[data-save-status="saved"]`)).toBeVisible({
    timeout: 10_000,
  });
  const id = await page.locator('[data-shell="top-bar"]').getAttribute("data-doc-id");
  expect(id).toBeTruthy();
  await page.goto(`/editor?doc=${id}`);
  await expect(page.locator('[data-shell="top-bar"]')).toHaveAttribute("data-doc-id", id!);
  await page.locator(`${CANVAS} [data-layer="scene"]`).waitFor();
  await expect(topBar).toHaveAttribute("data-style-preset", "screen");

  await openExportDialog(page);
  // Decision 50: the file is Publication by default; the canvas stays Screen.
  await expect(style).toHaveAttribute("data-style-preset", "publication");
  await expect(style).toHaveAttribute("data-document-preset", "screen");
  // Session-only: "canvas" was picked before the reload, which is back on
  // the default.
  await expect(style.locator('input[value="publication"]')).toBeChecked();
  await expect(notice).toHaveText("The canvas shows the Screen style. The export uses the Publication style.");
  await expect(page.locator('[data-shell="figure-label-size"]')).toHaveCount(0);
  const publicationSvg = (await downloadFrom(page, "figure.export-svg")).toString("utf8");
  expect(firstSkeletalBondLength(publicationSvg)).toBeCloseTo(24, 1);
  // The ACS 1996 setting at the house bond (decision 26): 0.6 pt lines, 10 pt labels.
  expect(publicationSvg).toContain('stroke-width="1"');
  await expect(page.locator('[data-shell="figure-size"]')).toContainText("bond 5.08 mm · labels 10.0 pt");

  // The other choice follows the canvas, and the label warning (decision 51)
  // says what Screen prints and points back to Publication.
  await style.locator('input[value="canvas"]').check();
  await expect(style).toHaveAttribute("data-style-preset", "screen");
  await expect(notice).toHaveCount(0);
  await expect(page.locator('[data-shell="figure-size"]')).toContainText("labels 5.2 pt");
  const labelWarning = page.locator('[data-shell="figure-label-size"]');
  await expect(labelWarning).toContainText("Labels print at 5.2 pt");
  await expect(labelWarning).toContainText("such as Publication");
  const screenSvg = (await downloadFrom(page, "figure.export-svg")).toString("utf8");
  expect(firstSkeletalBondLength(screenSvg)).toBeCloseTo(44, 1);
  expect(screenSvg).toContain('stroke-width="2"');
  // Same printed bond in both: the physical scale divides by the style used.
  expect(printedBondCm(screenSvg, 44)).toBeCloseTo(0.508, 3);
  expect(printedBondCm(publicationSvg, 24)).toBeCloseTo(0.508, 3);

  // The choice is an export setting, not an edit: the document keeps Screen.
  await page.keyboard.press("Escape");
  await expect(page.locator(DIALOG)).toBeHidden();
  await expect(topBar).toHaveAttribute("data-style-preset", "screen");
});

test("Copy figure writes svg, png and plain text in ONE ClipboardItem", async ({ page }) => {
  await page.addInitScript(() => {
    const record: { items: number; types: string[]; svg: string; pngSignature: number[] }[] = [];
    (window as unknown as { __clipboardWrites: typeof record }).__clipboardWrites = record;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async write(items: ClipboardItem[]) {
          const first = items[0]!;
          const svg = first.types.includes("image/svg+xml")
            ? await (await first.getType("image/svg+xml")).text()
            : "";
          const png = first.types.includes("image/png")
            ? [...new Uint8Array(await (await first.getType("image/png")).arrayBuffer()).slice(0, 8)]
            : [];
          record.push({ items: items.length, types: [...first.types], svg, pngSignature: png });
        },
        async writeText() {},
      },
    });
  });
  await openEditor(page);
  await composeThreeViews(page);
  await openExportDialog(page);
  await page.locator(`${DIALOG} [data-command="figure.copy"]`).click();
  await expect(page.locator('[data-shell="export-status"]')).toContainText("Copied the figure");

  const writes = await page.evaluate(
    () =>
      (window as unknown as {
        __clipboardWrites: { items: number; types: string[]; svg: string; pngSignature: number[] }[];
      }).__clipboardWrites,
  );
  expect(writes).toHaveLength(1);
  expect(writes[0]!.items).toBe(1);
  expect([...writes[0]!.types].sort()).toEqual(["image/png", "image/svg+xml", "text/plain"]);
  expect(writes[0]!.svg).toMatch(/<svg[^>]*\swidth="[\d.]+cm"/);
  expect(writes[0]!.pngSignature).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test("a labelled atom: the formula panel shows why, export refuses, copy-as-molfile names the atom", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __clipboardWrites: number }).__clipboardWrites = 0;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async write() {
          (window as unknown as { __clipboardWrites: number }).__clipboardWrites += 1;
        },
      },
    });
  });
  await openEditor(page);

  // Label a1 "Ph" through the properties panel.
  const point = await page.evaluate(() => {
    const box = document.querySelector('[data-atom-id="a1"]')?.getBoundingClientRect();
    return box === undefined ? null : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  expect(point).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
  const label = page
    .locator('[data-shell="properties-panel"] label')
    .filter({ hasText: "Display label" })
    .locator("input");
  await label.fill("Ph");
  await label.press("Tab");

  // The panel list states the reason on the sum-formula panel, in words.
  const formulaRow = page.locator(`${PANELS} [data-panel-kind="sumFormula"]`);
  await expect(formulaRow).toHaveAttribute("data-panel-unavailable", "true");
  await expect(formulaRow.locator("[data-panel-reason]")).toContainText(
    "Ph is drawn as an abbreviation",
  );

  // The export refuses rather than writing an empty cell, and says which panel.
  await openExportDialog(page);
  await expect(page.locator('[data-shell="figure-refusal"]')).toContainText("Panel (b)");
  await expect(page.locator(`${DIALOG} [data-command="figure.export-svg"]`)).toBeDisabled();
  await expect(page.locator(`${DIALOG} [data-command="figure.export-png"]`)).toBeDisabled();
  // The preview still shows the panel, marked with its reason.
  const preview = await page.locator('[data-shell="figure-preview"]').getAttribute("src");
  expect(decodeURIComponent(preview ?? "")).toContain("Sum formula view unavailable.");

  // Copy as molfile surfaces MolblockLabelError with the atom id and label.
  await page.locator(`${DIALOG} [data-command="figure.copy-molblock"]`).click();
  const status = page.locator('[data-shell="export-status"]');
  await expect(status).toContainText("a1");
  await expect(status).toContainText('"Ph"');
  expect(await page.evaluate(() => (window as unknown as { __clipboardWrites: number }).__clipboardWrites)).toBe(0);
});
