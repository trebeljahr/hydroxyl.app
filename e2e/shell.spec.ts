import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The editor shell in a real browser: the rail, the palette, the status bar
 * and the canvas's keyboard focus.
 *
 * WHY THESE AND NOT MORE UNIT TESTS. Almost everything the shell does IS unit
 * tested — the registries, the element buffer, the traversal, the key layer
 * are all pure and provable in node. What jsdom cannot answer is whether the
 * three surfaces are wired to each other in the running app: whether a real
 * keydown at the window reaches the layer past the canvas's own listener,
 * whether the palette's Radix dialog actually traps and releases focus,
 * whether typing into the title field is genuinely inert. Those are the
 * assertions below, and every one of them is about a seam rather than about
 * a computation.
 */

const CANVAS = "[data-canvas-root]";
const RAIL = '[data-shell="tool-rail"]';
const TITLE = '[data-shell="document-title"]';

async function openEditor(page: Page): Promise<void> {
  await page.goto("/editor");
  await page.locator(`${CANVAS} [data-layer="scene"]`).waitFor();
  await expect(page.locator(RAIL)).toBeVisible();
}

/** Distinct bonds, not the lines that depict them: a double bond draws two. */
async function bondCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const ids = new Set<string>();
    document
      .querySelectorAll("[data-bond-id]")
      .forEach((node) => ids.add(node.getAttribute("data-bond-id") ?? ""));
    return ids.size;
  });
}

async function atomCount(page: Page): Promise<number> {
  return page.locator("[data-atom-id]").count();
}

/** Drawn lines, which is bonds plus one extra per double bond. */
async function lineCount(page: Page): Promise<number> {
  return page.locator("line[data-bond-id]").count();
}

async function atomCentre(
  page: Page,
  atomId: string,
): Promise<{ readonly x: number; readonly y: number }> {
  const point = await page.evaluate((id) => {
    const node = document.querySelector(`[data-atom-id="${id}"]`);
    const box = node?.getBoundingClientRect();
    return box === undefined
      ? null
      : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, atomId);
  if (point === null) throw new Error(`no atom ${atomId} on screen`);
  return point;
}

async function activeTool(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const pressed = document.querySelector('[data-tool][aria-pressed="true"]');
    return pressed?.getAttribute("data-tool") ?? null;
  });
}

test("every tool in the rail is reachable by click and by hotkey, and shows which is active", async ({
  page,
}) => {
  await openEditor(page);

  const tools = await page.evaluate(() =>
    [...document.querySelectorAll("[data-tool]")].map((node) => ({
      id: node.getAttribute("data-tool") ?? "",
      hotkey: node.getAttribute("aria-keyshortcuts") ?? "",
    })),
  );
  expect(tools.length).toBeGreaterThanOrEqual(8);

  for (const tool of tools) {
    // By click.
    await page.click(`[data-tool="${tool.id}"]`);
    expect(await activeTool(page), `${tool.id} by click`).toBe(tool.id);

    // And by hotkey, from a fresh tool so the assertion cannot pass by
    // accident. The rail button still has focus here, which is the state a
    // user is in immediately after clicking — the shortcut layer must not be
    // inert in it.
    await page.click('[data-tool="select"]');
    await page.keyboard.press(tool.hotkey);
    expect(await activeTool(page), `${tool.id} by hotkey`).toBe(tool.id);
  }
});

test("the tool stays held after it is used — tools are sticky", async ({ page }) => {
  await openEditor(page);
  await page.click('[data-tool="ring"]');

  const box = (await page.locator(CANVAS).boundingBox())!;
  // Empty canvas, well away from the fixture in the middle.
  await page.mouse.click(box.x + 60, box.y + 60);

  expect(await activeTool(page)).toBe("ring");
});

test("the ring tool can place benzene, not only cyclohexane", async ({ page }) => {
  await openEditor(page);

  // BOTH ARE SIZE 6 and differ only in `kekule`, which is exactly why the old
  // numeric ring option could reach one of them and never the other. The
  // discriminator on screen is the number of LINES per bond: a saturated ring
  // draws six lines for six bonds, an arene draws nine for six because each
  // of its three double bonds is two lines.
  const baseBonds = await bondCount(page);
  const baseLines = await lineCount(page);

  await page.click('[data-tool="ring"]');
  const box = (await page.locator(CANVAS).boundingBox())!;

  await page.click('[aria-label="Ring template options"]');
  await page.click('[data-option="ring-cyclohexane"]');
  await page.mouse.click(box.x + 80, box.y + box.height - 80);

  expect(await bondCount(page)).toBe(baseBonds + 6);
  expect(await lineCount(page)).toBe(baseLines + 6);

  await page.click('[aria-label="Ring template options"]');
  await page.click('[data-option="ring-benzene"]');
  await page.mouse.click(box.x + box.width - 100, box.y + 80);

  expect(await bondCount(page)).toBe(baseBonds + 12);
  // Nine, not six: the arene really is one.
  expect(await lineCount(page)).toBe(baseLines + 6 + 9);

  // And neither ring is over-valent, which a wrongly kekulised one would be.
  await expect(page.locator('[data-status="issues"]')).toContainText(
    "0 valence issues",
  );
});

test("the command palette lists the same commands the toolbar exposes", async ({
  page,
}) => {
  await openEditor(page);

  const railTools = await page.evaluate(() =>
    [...document.querySelectorAll("[data-tool]")].map(
      (node) => `tool.${node.getAttribute("data-tool") ?? ""}`,
    ),
  );

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator("[data-palette-command]").first()).toBeVisible();

  const listed = await page.evaluate(() =>
    [...document.querySelectorAll("[data-palette-command]")].map((node) =>
      node.getAttribute("data-palette-command"),
    ),
  );
  for (const id of railTools) expect(listed).toContain(id);
  // And "Clean up structure" is there, which is the command with no button of
  // its own on the rail.
  expect(listed).toContain("structure.clean-up");

  // It runs what it lists.
  await page.click('[data-palette-command="tool.eraser"]');
  expect(await activeTool(page)).toBe("eraser");
});

test("element hotkeys distinguish C, Cl and Ca through the buffer", async ({
  page,
}) => {
  await openEditor(page);

  // Selecting an atom first makes the answer visible: the element hotkey
  // retypes the selection, and the properties panel shows what it became.
  const atom = await atomCentre(page, "a1");
  await page.mouse.click(atom.x, atom.y);
  const element = page.locator('[data-shell="properties-panel"] input').first();
  await expect(element).toHaveValue("C");

  // "C" alone is carbon, immediately — the common case must not wait.
  await page.keyboard.press("n");
  await expect(element).toHaveValue("N");
  await page.keyboard.press("c");
  await expect(element).toHaveValue("C");

  // A second character inside the window REPLACES it.
  await page.keyboard.press("c");
  await page.keyboard.press("l");
  await expect(element).toHaveValue("Cl");

  await page.keyboard.press("c");
  await page.keyboard.press("a");
  await expect(element).toHaveValue("Ca");

  // And the same first keystroke twice is carbon twice, not "Cc".
  await page.keyboard.press("c");
  await page.keyboard.press("c");
  await expect(element).toHaveValue("C");
});

test("shortcuts are inert while a text input has focus", async ({ page }) => {
  await openEditor(page);
  await page.click('[data-tool="select"]');

  await page.click(TITLE);
  // Explicitly to the end: a click puts the caret where it lands, and the
  // assertion below is about what the field ENDS with.
  await page.keyboard.press("End");
  // "d" is the bond tool's letter and "x" is the eraser's. Typed into the
  // title they must be characters, not tool changes.
  await page.keyboard.type("dx ring");

  expect(await activeTool(page)).toBe("select");
  await expect(page.locator(TITLE)).toHaveValue(/dx ring$/);

  // And Delete in the field edits the text rather than the molecule.
  const before = await atomCount(page);
  await page.keyboard.press("Backspace");
  expect(await atomCount(page)).toBe(before);
});

test("shortcuts are inert while the command palette has focus", async ({ page }) => {
  await openEditor(page);
  await page.click('[data-tool="select"]');
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator("[data-palette-command]").first()).toBeVisible();

  // Typed into the palette's filter, a tool letter is a search term.
  await page.keyboard.type("dx");
  expect(await activeTool(page)).toBe("select");

  await page.keyboard.press("Escape");
  await expect(page.locator("[data-palette-command]").first()).toBeHidden();
});

test("the status bar reports the formula, the masses and the valence issues", async ({
  page,
}) => {
  await openEditor(page);

  await expect(page.locator('[data-status="formula"]')).toHaveText("C₆H₆");
  await expect(page.locator('[data-status="weight"]')).toContainText("MW 78");
  await expect(page.locator('[data-status="exact-mass"]')).toContainText("Exact 78");
  await expect(page.locator('[data-status="issues"]')).toContainText(
    "0 valence issues",
  );

  // Draw a fifth and sixth bond onto one ring carbon and the bar says so.
  await page.click('[data-tool="bond"]');
  const atom = await atomCentre(page, "a1");
  await page.mouse.click(atom.x, atom.y);
  await page.mouse.click(atom.x, atom.y);
  await page.mouse.click(atom.x, atom.y);

  await expect(page.locator('[data-status="issues"]')).toContainText(
    "1 valence issue",
  );
});

test("the canvas is focusable and the arrow keys walk it atom to atom", async ({
  page,
}) => {
  await openEditor(page);

  // Reachable by keyboard alone. Tabbing from the title field must eventually
  // land ON the canvas rather than skipping past the drawing into the
  // properties panel — the canvas is one tab stop, and it has to be a stop.
  await page.click(TITLE);
  let reached = false;
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(
      () => document.activeElement?.getAttribute("data-canvas-root") === "true",
    );
  }
  expect(reached, "Tab never reached the canvas").toBe(true);

  // Focus lands somewhere as soon as the canvas has it.
  await expect(page.locator('[data-overlay="focus-atom"]')).toHaveCount(1);
  const first = await page
    .locator('[data-overlay="focus-atom"]')
    .getAttribute("data-overlay-target");

  // A bare arrow follows a BOND, so the focus lands on a neighbour of the
  // atom it started on rather than anywhere in the document.
  await page.keyboard.press("ArrowRight");
  const neighbour = await page
    .locator('[data-overlay="focus-atom"]')
    .getAttribute("data-overlay-target");
  expect(neighbour).not.toBe(first);

  // Shift walks the document's atom order instead, and THAT is the mode that
  // reaches every atom — a bonded walk on a ring cannot, whatever the rule.
  // See the header of editor/traversal.ts.
  const visited = new Set<string>();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Shift+ArrowRight");
    const id = await page
      .locator('[data-overlay="focus-atom"]')
      .getAttribute("data-overlay-target");
    if (id !== null) visited.add(id);
  }
  expect(visited.size).toBe(6);

  // And it announces where it is.
  await expect(page.locator("#canvas-focus-status")).toContainText("bond");
});

test("the canvas stays a white publication ground when the UI goes dark", async ({
  page,
}) => {
  await openEditor(page);
  await page.click('[data-shell="theme-toggle"]');

  const dark = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
  expect(dark).toBe(true);

  // The chrome followed the theme...
  const railBackground = await page.evaluate(() => {
    const rail = document.querySelector('[data-shell="tool-rail"]')!;
    return getComputedStyle(rail).backgroundColor;
  });
  expect(railBackground).not.toBe("rgb(255, 255, 255)");

  // ...and the drawing surface did not. A figure's ground is white because
  // that is what a journal prints on; a dark canvas would show the chemist
  // something they cannot export.
  const ground = await page.evaluate(() => {
    const canvas = document.querySelector("[data-canvas-root]")!;
    return getComputedStyle(canvas.parentElement!).backgroundColor;
  });
  expect(ground).toBe("rgb(255, 255, 255)");
});

test("undo and redo run from the top bar and from the keyboard, as one entry each", async ({
  page,
}) => {
  await openEditor(page);
  const before = await atomCount(page);

  await page.click('[data-tool="chain"]');
  const atom = await atomCentre(page, "a1");
  await page.mouse.click(atom.x, atom.y);
  const grown = await atomCount(page);
  expect(grown).toBeGreaterThan(before);

  // ONE entry for the whole chain, not one per atom.
  await page.keyboard.press("ControlOrMeta+z");
  expect(await atomCount(page)).toBe(before);

  await page.click('[data-command="edit.redo"]');
  expect(await atomCount(page)).toBe(grown);
});
