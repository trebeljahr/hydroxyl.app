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

test("exports ONE self-contained SVG: labelled panels, one bond length, unique ids, physical size", async ({
  page,
  browser,
}, testInfo) => {
  await openEditor(page);
  await composeThreeViews(page);
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

  // Physical units for the single-column preset.
  expect(attr(svg, "width")).toBe("8.25cm");
  const [, , vbW, vbH] = attr(svg, "viewBox").split(" ").map(Number);
  expect(Number.parseFloat(attr(svg, "height"))).toBeCloseTo((8.25 * vbH!) / vbW!, 2);

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
  // skeletal bond is the style's 24 px in viewBox units.
  const transforms = [...svg.matchAll(/transform="([^"]*)"/g)].map((m) => m[1]);
  expect(transforms).toHaveLength(3);
  for (const t of transforms) expect(t).toMatch(/^translate\(-?[\d.]+ -?[\d.]+\)$/);
  const bond = /<line id="p-panel-skeletal\.bond:[^"]+:line"[^>]*x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/.exec(
    svg,
  );
  expect(bond).not.toBeNull();
  const [x1, y1, x2, y2] = bond!.slice(1).map(Number);
  expect(Math.sqrt((x2! - x1!) ** 2 + (y2! - y1!) ** 2)).toBeCloseTo(24, 1);

  // The viewBox does not move with the editor's pan and zoom.
  await page.keyboard.press("Escape");
  await expect(page.locator(DIALOG)).toBeHidden();
  const box = (await page.locator(CANVAS).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -600);
  await page.keyboard.press("ControlOrMeta+0");
  await page.mouse.wheel(0, 400);
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

test("PNG at 300 dpi single column is 974 px wide, rasterised with its resolution stamped", async ({
  page,
}, testInfo) => {
  await openEditor(page);
  await composeThreeViews(page);
  await openExportDialog(page);
  await page.locator(`${DIALOG} input[name="figure-dpi"][value="300"]`).check();
  await page.locator(`${DIALOG} input[name="figure-width"][value="single"]`).check();
  const readout = await page.locator('[data-shell="figure-size"]').textContent();
  const expected = /PNG (\d+) × (\d+) px/.exec(readout ?? "");
  expect(expected?.[1]).toBe("974");

  const png = await downloadFrom(page, "figure.export-png");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(testInfo.outputPath("figure.png"), png);

  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(width).toBe(Math.round((8.25 / 2.54) * 300));
  expect(width).toBe(974);
  expect(String(height)).toBe(expected?.[2]);

  // pHYs: 300 dpi is 11811 pixels per metre, so the file claims 8.25 cm.
  const phys = png.indexOf("pHYs");
  expect(phys).toBeGreaterThan(0);
  expect(png.readUInt32BE(phys + 4)).toBe(11811);

  // Rasterised from the vectors at this size, not a small image scaled up:
  // the PNG decodes in the page at exactly its own pixel size and carries
  // hard black stroke pixels, which an interpolated upscale smears to grey.
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
      if (data[i]! < 16 && data[i + 3]! > 240) black += 1;
      if (data[i]! < 128) dark += 1;
    }
    return { w: img.naturalWidth, h: img.naturalHeight, black, dark, total: data.length / 4 };
  }, png.toString("base64"));
  expect(stats.w).toBe(974);
  expect(stats.dark).toBeGreaterThan(stats.total * 0.005);
  expect(stats.black).toBeGreaterThan(stats.dark * 0.3);
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
  expect(writes[0]!.svg).toContain('width="8.25cm"');
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
