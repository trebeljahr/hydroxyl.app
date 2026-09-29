import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The Publication canvas is a print preview at the zoom you were working at
 * (decision 107), measured in a real browser.
 *
 * Before this, switching to Publication redrew the scene at its 24 px bond
 * under the viewport fitted for Screen's 44 px one. The molecule shrank to
 * 55% and slid towards the scene origin, the halos and handles stayed at
 * their Screen size around it, and the zoom readout did not move. That read as
 * "the sizes are all messed up", and the one mode that shows the figure did
 * not look like the surface you drew it on.
 *
 * What a real browser proves and a unit test cannot: the transform the page
 * actually paints, the overlay's measured size on screen, and the exported
 * file against the canvas it came from. Three claims:
 *
 *   1. A switch moves nothing. Every atom stays on its pixel, the chrome keeps
 *      its size on screen, and the readout keeps its number. Only the ink
 *      changes, to the ACS proportions (decision 26).
 *   2. The Publication canvas IS the exported figure. Every coordinate the
 *      canvas draws is written into the SVG with the same bytes.
 *   3. The view never reaches the file. Switching and zooming leave the
 *      export byte-identical.
 *
 * Glucose because it has everything the switch changes: labels (the glyph
 * grows against the bond), a bare vertex (only its dot shrinks), wedges and
 * hashes, and selection halos around both kinds of atom.
 */

const CANVAS = "[data-canvas-root]";
const SCENE = `${CANVAS} [data-layer="scene"]`;
const DIALOG = '[data-shell="export-dialog"]';

// From the repo root, which is where Playwright runs. The chem-core fixture
// rather than a copy, so the two cannot drift.
const GLUCOSE = readFileSync(
  join(process.cwd(), "packages", "chem-core", "test", "fixtures", "projection", "beta-d-glucopyranose.mol"),
  "utf8",
);

/**
 * Glucose, imported, and left in `preset`. An import opens in Publication
 * (decision 135); asking for Screen switches it there, for the specs that
 * test the switch a user makes from Screen.
 */
async function openGlucose(page: Page, preset: "screen" | "publication"): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/editor");
  // A fresh browser opens an empty sketch, whose scene group has no size, so
  // wait for it to exist rather than to be visible.
  await page.locator(SCENE).waitFor({ state: "attached" });
  await expect(page.locator('[data-shell="status-bar"]')).toBeVisible();
  const transfer = await page.evaluateHandle((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], "glucose.mol", { type: "text/plain" }));
    return dt;
  }, GLUCOSE);
  // The drop listener is attached by an effect, so a drop that lands before
  // hydration is ignored. Repeat it until the document arrives; a second
  // drop of the same file would only open the same molecule again.
  await expect(async () => {
    await page.dispatchEvent("body", "drop", { dataTransfer: transfer });
    await expect(page.locator('[data-status="formula"]')).toHaveText("C₆H₁₂O₆", {
      timeout: 1_000,
    });
  }).toPass();
  await expect(page.locator('[data-shell="style-preset"]')).toHaveAttribute(
    "data-style-preset",
    "publication",
  );
  if (preset === "screen") await switchTo(page, "screen");
}

async function switchTo(page: Page, preset: "screen" | "publication"): Promise<void> {
  await page.locator(`[data-shell="style-preset"] [data-command="view.style-${preset}"]`).click();
  await expect(page.locator('[data-shell="style-preset"]')).toHaveAttribute(
    "data-style-preset",
    preset,
  );
}

interface Seen {
  /** Every selection halo: its atom, its centre and radius in client px. */
  readonly halos: readonly { id: string; x: number; y: number; r: number }[];
  /** Label font size in client px, per labelled atom. */
  readonly fontPx: Readonly<Record<string, number>>;
  /** Scene px -> client px: the painted zoom. */
  readonly scale: number;
  readonly readout: string;
}

/**
 * What is on screen, in client px, through `getScreenCTM` — the transform the
 * browser really painted — rather than a bounding box, which grows with the
 * stroke and with the glyphs.
 */
async function look(page: Page): Promise<Seen> {
  return page.evaluate(() => {
    const scene = document.querySelector<SVGGElement>('[data-canvas-root] [data-layer="scene"]')!;
    const ctm = scene.getScreenCTM()!;
    const client = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(ctm);
    const halos = [
      ...document.querySelectorAll<SVGCircleElement>('[data-overlay="selected-atom"]'),
    ].map((circle) => {
      const centre = client(circle.cx.baseVal.value, circle.cy.baseVal.value);
      return {
        id: circle.getAttribute("data-overlay-target") ?? "",
        x: centre.x,
        y: centre.y,
        r: circle.r.baseVal.value * ctm.a,
      };
    });
    const fontPx: Record<string, number> = {};
    for (const text of scene.querySelectorAll<SVGTextElement>("text[data-atom-id]")) {
      fontPx[text.getAttribute("data-atom-id") ?? ""] =
        Number.parseFloat(text.getAttribute("font-size") ?? "NaN") * ctm.a;
    }
    return {
      halos,
      fontPx,
      scale: ctm.a,
      readout: document.querySelector('[data-status="zoom"]')?.textContent ?? "",
    };
  });
}

async function exportSvg(page: Page): Promise<string> {
  await page.locator('[data-command="figure.export-dialog"]').click();
  await expect(page.locator(DIALOG)).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(`${DIALOG} [data-command="figure.export-svg"]`).click(),
  ]);
  const svg = readFileSync(await download.path()).toString("utf8");
  await page.keyboard.press("Escape");
  await expect(page.locator(DIALOG)).toBeHidden();
  return svg;
}

test("switching to Publication moves nothing: only the ink changes", async ({ page }) => {
  await openGlucose(page, "screen");
  await page.locator(CANVAS).focus();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator('[data-overlay="selected-atom"]')).toHaveCount(12);

  const screen = await look(page);
  await switchTo(page, "publication");
  const publication = await look(page);

  // Every atom on the pixel it had, and every ring the same size on screen.
  expect(publication.halos.map((h) => h.id)).toEqual(screen.halos.map((h) => h.id));
  screen.halos.forEach((halo, at) => {
    const other = publication.halos[at]!;
    expect(Math.abs(other.x - halo.x), `${halo.id} x`).toBeLessThan(0.5);
    expect(Math.abs(other.y - halo.y), `${halo.id} y`).toBeLessThan(0.5);
  });
  // The bare vertex's ring is sized by the chrome alone, so it is exact. A
  // labelled atom's ring hugs its glyph, which is meant to grow.
  const bare = (seen: Seen) => seen.halos.find((h) => h.id === "a2")!;
  expect(Math.abs(bare(publication).r - bare(screen).r)).toBeLessThan(0.5);

  // The readout says what the eye sees: nothing zoomed.
  expect(publication.readout).toBe(screen.readout);
  // The painted scale did change, by exactly the ratio of the bond lengths.
  expect(publication.scale / screen.scale).toBeCloseTo(44 / 24, 6);

  // The ink is what changed: labels against the same on-screen bond, from
  // Screen's 16 px on 44 to the ACS 1996 setting's 10 pt on 14.4 pt.
  const bondOnScreen = 44 * screen.scale;
  // Six oxygens and the five ring stereocentres are labelled.
  expect(Object.keys(screen.fontPx)).toHaveLength(11);
  for (const [atom, px] of Object.entries(screen.fontPx)) {
    expect(px / bondOnScreen, `${atom} at Screen`).toBeCloseTo(16 / 44, 3);
    expect(publication.fontPx[atom]! / bondOnScreen, `${atom} at Publication`).toBeCloseTo(
      10 / 14.4,
      3,
    );
  }

  // And back: the same pixels again.
  await switchTo(page, "screen");
  const again = await look(page);
  screen.halos.forEach((halo, at) => {
    expect(Math.abs(again.halos[at]!.x - halo.x)).toBeLessThan(0.5);
    expect(Math.abs(again.halos[at]!.y - halo.y)).toBeLessThan(0.5);
  });
  expect(again.readout).toBe(screen.readout);
});

test("the Publication canvas draws the exported figure, coordinate for coordinate", async ({
  page,
}) => {
  // Not switched: an import opens in Publication (decision 135), so this is
  // the canvas a new sketch shows from its first stroke.
  await openGlucose(page, "publication");

  // Every id'd primitive the canvas draws, with the attributes that place and
  // size it, exactly as the DOM carries them.
  const GEOMETRY = ["x1", "y1", "x2", "y2", "x", "y", "cx", "cy", "r", "points", "d", "font-size", "stroke-width"];
  const canvas = await page.evaluate((names) => {
    const out: Record<string, Record<string, string>> = {};
    for (const el of document.querySelectorAll('[data-canvas-root] [data-layer="scene"] [id]')) {
      const attrs: Record<string, string> = {};
      for (const name of names) {
        const value = el.getAttribute(name);
        if (value !== null) attrs[name] = value;
      }
      out[el.id] = attrs;
    }
    return out;
  }, GEOMETRY);
  const ids = Object.keys(canvas);
  expect(ids.length).toBeGreaterThan(20);

  const svg = await exportSvg(page);
  // The export writes the skeletal panel's primitives under a panel prefix
  // and moves the panel with a translate on its group — never by rewriting a
  // coordinate (chem-render's figure tests pin that). So each canvas element
  // appears in the file with the SAME attribute bytes.
  for (const id of ids) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`<[a-z]+ id="p-panel-skeletal\\.${escaped}"([^>]*)>`).exec(svg);
    expect(match, id).not.toBeNull();
    for (const [name, value] of Object.entries(canvas[id]!)) {
      expect(match![1], `${id} ${name}`).toContain(` ${name}="${value}"`);
    }
  }
});

test("the view never reaches the file: switching and zooming export the same bytes", async ({
  page,
}) => {
  await openGlucose(page, "screen");
  const first = await exportSvg(page);

  await switchTo(page, "publication");
  const box = (await page.locator(CANVAS).boundingBox())!;
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3);
  await page.mouse.wheel(0, -400);
  await switchTo(page, "screen");
  await switchTo(page, "publication");

  // The export defaults to Publication whichever style the canvas shows
  // (decision 50), so both are the same figure, byte for byte.
  expect(await exportSvg(page)).toBe(first);
});

/** The shortest distance between two drawn atom dots, in client px: one bond. */
async function bondOnScreen(page: Page): Promise<number> {
  return page.evaluate((scene) => {
    const dots = [...document.querySelectorAll<SVGCircleElement>(`${scene} circle[data-atom-id]`)].map(
      (circle) =>
        new DOMPoint(circle.cx.baseVal.value, circle.cy.baseVal.value).matrixTransform(
          circle.getScreenCTM()!,
        ),
    );
    let shortest = Infinity;
    dots.forEach((a, i) => {
      for (const b of dots.slice(i + 1)) shortest = Math.min(shortest, Math.hypot(a.x - b.x, a.y - b.y));
    });
    return shortest;
  }, SCENE);
}

test("a new document opens in Publication, framed no smaller than Screen frames it", async ({
  page,
}) => {
  await page.goto("/editor");
  const presets = page.locator('[data-shell="style-preset"]');
  const readout = page.locator('[data-status="zoom"]');
  await expect(page.locator(`${SCENE} circle[data-atom-id]`)).toHaveCount(6);
  // Decision 135: the benzene a bare /editor opens is in Publication.
  await expect(presets).toHaveAttribute("data-style-preset", "publication");
  const opened = await bondOnScreen(page);
  const openedReadout = await readout.textContent();

  // The same drawing fitted in Screen. Publication's margin is a smaller
  // share of its bond (8 of 24 px against 16 of 44), so its fit is if
  // anything larger: measured 222 px against 216 px at 1280 x 720.
  await switchTo(page, "screen");
  await page.getByRole("button", { name: "Fit" }).click();
  await expect(readout).not.toHaveText(openedReadout!);
  expect(opened).toBeGreaterThanOrEqual(await bondOnScreen(page));

  // And Reset agrees with the readout in both: 100% is a 44 px bond.
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(readout).toHaveText("100%");
  expect(await bondOnScreen(page)).toBeCloseTo(44, 1);
  await switchTo(page, "publication");
  await expect(readout).toHaveText("100%");
  expect(await bondOnScreen(page)).toBeCloseTo(44, 1);
});

test("a blank sketch opens at 100%, so its first atom is drawn at a working size (decision 174)", async ({
  page,
}) => {
  await page.goto("/editor");
  await expect(page.locator(`${SCENE} circle[data-atom-id]`)).toHaveCount(6);
  await page.keyboard.press("ControlOrMeta+k");
  await page.click('[data-palette-command="file.new"]');
  await expect(page.locator(`${SCENE} [data-atom-id]`)).toHaveCount(0);
  await expect(page.locator('[data-shell="style-preset"]')).toHaveAttribute(
    "data-style-preset",
    "publication",
  );
  // Not the empty scene's margin box fitted to the canvas, which read 2073%.
  await expect(page.locator('[data-status="zoom"]')).toHaveText("100%");

  // A carbon placed on it: fitted, its "CH4" measured 1168 x 828 px.
  await page.locator('[data-tool="element"]').click();
  const box = (await page.locator(CANVAS).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const label = page.locator(`${SCENE} text[data-atom-id]`);
  await expect(label).toHaveCount(1);
  const drawn = (await label.boundingBox())!;
  expect(drawn.height).toBeLessThan(60);
  expect(drawn.width).toBeLessThan(120);
});
