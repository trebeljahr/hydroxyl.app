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
  // carries the completeness guarantee for any graph. See traversal.ts.
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

  // The modifier is ADVERTISED. An undiscoverable shortcut is not an
  // accessibility feature, and Shift+Arrow appeared in no tooltip, no palette
  // row and no label until this attribute existed.
  await expect(page.locator(CANVAS)).toHaveAttribute(
    "aria-keyshortcuts",
    /Shift\+ArrowRight/,
  );
});

test("the BARE arrows reach every atom of the ring too, and say so each time", async ({
  page,
}) => {
  await openEditor(page);
  await page.locator(CANVAS).focus();
  await expect(page.locator('[data-overlay="focus-atom"]')).toHaveCount(1);

  // The bonded walk used to trade focus back and forth across one bond: four
  // of six atoms pressing Right, two of six pressing Down. It now refuses to
  // step straight back to the atom it came from, which breaks the cycle.
  const visited = new Set<string>();
  const heard = new Set<string>();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("ArrowRight");
    const id = await page
      .locator('[data-overlay="focus-atom"]')
      .getAttribute("data-overlay-target");
    if (id !== null) visited.add(id);
    heard.add((await page.locator("#canvas-focus-status").textContent()) ?? "");
  }
  expect([...visited].sort()).toEqual(["a1", "a2", "a3", "a4", "a5", "a6"]);

  // Every carbon in benzene is "C, 2 bonds", so the live region used to be
  // handed a byte-identical string on every press, never mutate, and never
  // announce. A screen-reader user heard the first move and then silence.
  expect(heard.size).toBeGreaterThan(1);
});

test("a letter typed at the properties panel's Select does not edit the molecule", async ({
  page,
}) => {
  await openEditor(page);

  // Pick one ring bond, then put focus on the Order control — a Radix Select,
  // which renders a `<button role="combobox">` and is NOT a `<select>`. The
  // key layer's text-entry guard missed it, so `d` switched to the bond tool
  // AND retyped the bond as a double, and `t` made it a triple with two
  // valence errors, from a single keystroke with no menu ever opened.
  const first = await atomCentre(page, "a1");
  const second = await atomCentre(page, "a2");
  await page.mouse.click((first.x + second.x) / 2, (first.y + second.y) / 2);

  const combobox = page
    .locator('[data-shell="properties-panel"] [role="combobox"]')
    .first();
  await expect(combobox).toBeVisible();
  await combobox.focus();

  // WHAT THE WIDGET DOES IS NOT WHAT THE EDITOR DOES. Radix's type-ahead is
  // entitled to act on `d` — "Double" begins with it, and that is the whole
  // reason the guard has to exist. What must NOT also happen is the editor
  // reading the same keystroke: the bug was `d` retyping the bond AND
  // switching to the bond tool, from one press with no menu open.
  const atoms = await atomCount(page);
  const bonds = await bondCount(page);

  // `x` and `3` and Delete match no option, so the widget ignores them
  // entirely and anything that happens is the editor reaching through.
  for (const key of ["x", "3", "Delete", "Backspace"]) {
    await page.keyboard.press(key);
  }
  expect(await activeTool(page), "the eraser letter reached the editor").toBe(
    "select",
  );
  expect(await atomCount(page)).toBe(atoms);
  expect(await bondCount(page)).toBe(bonds);

  // And a letter the widget DOES claim still must not move the tool.
  await page.keyboard.press("d");
  expect(await activeTool(page)).toBe("select");
});

test("a two-letter symbol whose first letter is no element is still typeable", async ({
  page,
}) => {
  await openEditor(page);
  const atom = await atomCentre(page, "a1");
  await page.mouse.click(atom.x, atom.y);
  const element = page.locator('[data-shell="properties-panel"] input').first();
  await expect(element).toHaveValue("C");

  // "Li" used to arm IODINE: `l` resolved to nothing and was discarded, so
  // `i` was read as a fresh start.
  await page.keyboard.press("l");
  await page.keyboard.press("i");
  await expect(element).toHaveValue("Li");

  // `g` is the pan tool's letter, but one keystroke into a pending symbol the
  // only sane reading is magnesium.
  await page.keyboard.press("m");
  await page.keyboard.press("g");
  await expect(element).toHaveValue("Mg");
  expect(await activeTool(page)).not.toBe("pan");

  // And the organic set stays whole: `r` is the ring tool, `e` the element
  // tool, and bromine and selenium beat both.
  await page.keyboard.press("b");
  await page.keyboard.press("r");
  await expect(element).toHaveValue("Br");
  await page.keyboard.press("s");
  await page.keyboard.press("e");
  await expect(element).toHaveValue("Se");
});

test("a run of arrow TAPS is one undo, not one per tap", async ({ page }) => {
  await openEditor(page);
  const atom = await atomCentre(page, "a1");
  await page.mouse.click(atom.x, atom.y);

  const startX = (await atomCentre(page, "a1")).x;
  // Discrete taps, which is how the key is actually used. Each one released
  // its own key, and a `keyup` listener committed the transaction on every
  // release — so the 400 ms coalescing window never once got to run.
  for (let i = 0; i < 6; i++) await page.keyboard.press("ControlOrMeta+ArrowRight");
  const movedX = (await atomCentre(page, "a1")).x;
  expect(movedX).toBeGreaterThan(startX);

  // Let the idle timer close the run, then take it back in ONE undo.
  await page.waitForTimeout(700);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await atomCentre(page, "a1")).x).toBeCloseTo(startX, 0);
});

test("Fit is a command, reachable from the palette and not only from the status bar", async ({
  page,
}) => {
  await openEditor(page);
  // It had no registry entry at all: no shortcut, no palette row, reachable
  // from the status bar and nowhere else.
  await expect(page.locator('[data-command="view.fit"]')).toBeVisible();

  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    page.locator('[data-palette-command="view.fit"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-palette-command="view.theme"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('[data-palette-command="chain.length.6"]'),
  ).toHaveCount(1);
  await page.keyboard.press("Escape");

  // The canvas fits itself on mount, so reset the view first — otherwise Fit
  // is a no-op and the assertion proves nothing.
  await page.locator(CANVAS).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+0");
  const reset = await page.locator('[data-status="zoom"]').textContent();
  await page.keyboard.press("ControlOrMeta+Shift+f");
  await expect(page.locator('[data-status="zoom"]')).not.toHaveText(
    reset ?? "",
  );
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
