import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  expectGroundMatchesScheme,
  freezeColourTransitions,
  paintedText,
  paintsOwnGround,
  parkPointerOn,
} from "./support/colours";

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

/** The inscribed circle of a perceived aromatic ring. It carries the ring's
 *  ATOM SET rather than a bond id, because a ring has no id of its own in
 *  chem-core, so it is invisible to `lineCount` and to `bondCount` alike. */
async function ringCircleCount(page: Page): Promise<number> {
  return page.locator("circle[data-ring-atom-ids]").count();
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
  // discriminator on screen is what the ring draws: a saturated ring is six
  // plain lines, and an arene is six lines plus ONE INSCRIBED CIRCLE — the
  // editor's skeletal panel defaults to the aromatic circle, which suppresses
  // the alternation's inner lines rather than being drawn over them.
  const baseBonds = await bondCount(page);
  const baseLines = await lineCount(page);
  const baseCircles = await ringCircleCount(page);

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
  // Six more lines and one more circle: the arene really is one, and it says
  // so with the delocalisation circle rather than with three inner lines.
  expect(await lineCount(page)).toBe(baseLines + 6 + 6);
  expect(await ringCircleCount(page)).toBe(baseCircles + 1);

  // And neither ring is over-valent, which a wrongly kekulised one would be.
  await expect(page.locator('[data-status="issues"]')).toContainText(
    "0 chemistry errors",
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

test("the status bar reports the formula, the masses and the chemistry errors", async ({
  page,
}) => {
  await openEditor(page);

  await expect(page.locator('[data-status="formula"]')).toHaveText("C₆H₆");
  await expect(page.locator('[data-status="weight"]')).toContainText("MW 78");
  await expect(page.locator('[data-status="exact-mass"]')).toContainText("Exact 78");
  await expect(page.locator('[data-status="issues"]')).toContainText(
    "0 chemistry errors",
  );

  // Draw a fifth and sixth bond onto one ring carbon and the bar says so.
  await page.click('[data-tool="bond"]');
  const atom = await atomCentre(page, "a1");
  await page.mouse.click(atom.x, atom.y);
  await page.mouse.click(atom.x, atom.y);
  await page.mouse.click(atom.x, atom.y);

  await expect(page.locator('[data-status="issues"]')).toContainText(
    "1 chemistry error",
  );
});

/**
 * EVERY READOUT ON ONE LINE, AND THE ZOOM CONTROLS ON SCREEN, down to a
 * portrait tablet.
 *
 * The bar is `h-8` and does not wrap as a row. Before the bar went
 * `whitespace-nowrap`, a readout squeezed below its text width wrapped
 * INTERNALLY — "MW" over "78.1140", two 16px lines in 32px — at 768 for
 * benzene and at 900 with two errors in the counter. Nowrap alone turned that
 * into horizontal overflow that pushed + and Donate off a 768px tablet, so
 * decision 139 hides Donate below 1024 and the exact mass below 900, with the
 * exact mass kept in the MW readout's title. The Feedback link hides with
 * Donate (decision 167); at 1024 with two errors, the message and the save
 * state still have 62px between them.
 *
 * Numbers rather than a screenshot: the claim is about the flex algorithm,
 * and heights and overflow are what it is made of. Benzene has the plain
 * "0 chemistry errors" span; the nitro-ammonium fixture has the wider
 * two-button issue counter.
 */
test("the status bar keeps every readout on one line from 768 to 1280", async ({
  page,
}) => {
  await openEditor(page);

  const measure = async (sketch: string): Promise<void> => {
    for (const width of [768, 900, 1024, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const bar = await page.evaluate(() => {
        const footer = document.querySelector('[data-shell="status-bar"]');
        if (!(footer instanceof HTMLElement)) throw new Error("no status bar");
        const shown = (selector: string): boolean => {
          const node = footer.querySelector(selector);
          if (node === null) return false;
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.left >= 0 && box.right <= window.innerWidth;
        };
        return {
          overflow: footer.scrollWidth - footer.clientWidth,
          tall: [...footer.children]
            .filter((child) => child.getBoundingClientRect().height > 20)
            .map((child) => child.getAttribute("data-status") ?? child.tagName),
          controls: ["view.fit", "view.reset", "view.zoom-out", "view.zoom-in"]
            .map((id) => `[data-command="${id}"]`)
            .concat('[data-status="zoom"]')
            .every(shown),
          exactMass: shown('[data-status="exact-mass"]'),
          donate: shown('[data-status="donate"]'),
          feedback: shown('[data-status="feedback"]'),
        };
      });

      expect({ sketch, width, ...bar }).toEqual({
        sketch,
        width,
        overflow: 0,
        tall: [],
        controls: true,
        // Decision 139's order: Donate gives way first, then the exact mass.
        // Feedback goes with Donate (decision 167).
        exactMass: width >= 900,
        donate: width >= 1024,
        feedback: width >= 1024,
      });
    }
  };

  await expect(page.locator('[data-status="issues"]')).toHaveText("0 chemistry errors");
  await measure("benzene");
  // Where the exact mass goes when its readout is hidden.
  await expect(page.locator('[data-status="weight"]')).toHaveAttribute(
    "title",
    /Exact mass 78\.0470/,
  );

  const molfile = readFileSync(
    join(process.cwd(), "e2e", "fixtures", "nitro-ammonium-uncharged.mol"),
    "utf8",
  );
  const transfer = await page.evaluateHandle((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], "nitro-ammonium-uncharged.mol", { type: "text/plain" }));
    return dt;
  }, molfile);
  await page.dispatchEvent("body", "drop", { dataTransfer: transfer });
  await expect(page.locator('[data-status="issues"]')).toHaveText("2 chemistry errors");
  await measure("nitro-ammonium, two errors");
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

/**
 * THE SERVED HTML MUST NOT CARRY A MINTED DOCUMENT ID.
 *
 * `/editor` is prerendered, so `TopBar`'s `data-doc-id` is written once by
 * `next build` and read by every visitor's browser. While the startup document
 * minted its id from `Date.now()` and `Math.random()` the two could not agree,
 * and React reported the attribute hydration mismatch recorded in manual
 * notes 3 — an error it explicitly does not patch up.
 *
 * Asserted against the RESPONSE BODY rather than against the live DOM: by the
 * time the page has mounted, the editor has opened a real document and the
 * attribute is legitimately a minted id. What is under test is the byte
 * sequence the build emitted.
 */
test("the prerendered editor names the fixed startup document", async ({ page }) => {
  const response = await page.request.get("/editor");
  expect(response.ok()).toBe(true);
  const html = await response.text();

  const match = /data-shell="top-bar"[^>]*data-doc-id="([^"]*)"/.exec(html);
  expect(match?.[1]).toBe("doc_startup");
});

/**
 * AND THE BROWSER MUST AGREE WITH IT.
 *
 * The test above reads the emitted bytes; this one watches what React says
 * about them. A hydration mismatch is reported through `console.error` and
 * nowhere else — the page still renders, the attribute is silently left at the
 * server's value, and nothing fails — so the only way to notice it is to
 * listen.
 *
 * The filter is deliberately narrow. Asserting an EMPTY console would make
 * this test fail for any unrelated warning the app or a dependency emits,
 * which is how console assertions become a test everyone deletes.
 */
test("/editor hydrates without React reporting a mismatch", async ({ page }) => {
  const hydration: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/hydrat/i.test(text) || /server rendered HTML didn't match/i.test(text)) {
      hydration.push(text);
    }
  });
  page.on("pageerror", (error) => {
    if (/hydrat/i.test(error.message)) hydration.push(error.message);
  });

  await page.goto("/editor");
  // Waited for, so the assertion is about a page that has actually hydrated:
  // the canvas only draws once the mount effect has opened the fixture.
  await expect(page.locator(`${CANVAS} [data-layer="scene"] circle[data-atom-id]`)).toHaveCount(6);

  expect(hydration).toEqual([]);
});

/**
 * THE PICKERS' COLOURS, AS CHROMIUM ACTUALLY COMPUTES THEM.
 *
 * The component tests pin which classes each state declares; jsdom runs no
 * cascade, so only a real browser can say what those classes resolve to. Both
 * halves of the reported defect are measurable here and nowhere else:
 *
 *  1. AN IDLE ENTRY MUST PAINT ITSELF. Every entry — not only the selected one
 *     — has to come out with an opaque background and text that contrasts with
 *     it, which is what makes "the pickers are weirdly transparent except the
 *     selected entry, and the chain numbers do not show" a state the markup can
 *     no longer produce on its own.
 *  2. "UNAVAILABLE" MUST NOT LOOK LIKE "USABLE". The "(b) Sum formula" button
 *     used to paint the same rgb(115,115,115) as the genuinely disabled locants
 *     label, so a working control wore the disabled colour.
 *
 * The threshold is WCAG AA for normal text, 4.5:1, computed from the resolved
 * rgb of the element and of the ground it is painted on. The readings live in
 * `support/colours.ts`, shared with the panel chooser's spec.
 *
 * BOTH SCHEMES, because the report was about both and a light-only check would
 * leave the darker half of the claim resting on one person's screenshot. With no
 * stored preference, `shell/theme.ts` falls back to `prefers-color-scheme`, so
 * Playwright's `colorScheme` is what drives the app here — and the run asserts
 * the class actually landed, or a "dark" run would be a second light run
 * quietly pinning nothing.
 */
for (const scheme of ["light", "dark"] as const) {
  test.describe(`picker colours, ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("every picker entry paints its own colours, and 'usable' never looks disabled", async ({
      page,
    }) => {
      await openEditor(page);
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.classList.contains("dark")),
        )
        .toBe(scheme === "dark");
      await freezeColourTransitions(page);
      await runPickerColourChecks(page, scheme);
    });
  });
}


async function runPickerColourChecks(
  page: Page,
  scheme: "light" | "dark",
): Promise<void> {
  // ── 1. The chain picker: the numbers, and the entries carrying them ───────
  await page.click('[aria-label="Chain options"]');
  await expect(page.locator('[data-option="chain-6"]')).toBeVisible();

  const armed = await page.evaluate(
    () =>
      document
        .querySelector('[data-option][aria-pressed="true"]')
        ?.getAttribute("data-option") ?? "",
  );
  expect(armed).toMatch(/^chain-/);

  const idleChains = await page.evaluate(() =>
    [...document.querySelectorAll('[data-option^="chain-"]')]
      .filter((node) => node.getAttribute("aria-pressed") !== "true")
      .map((node) => node.getAttribute("data-option") ?? ""),
  );
  expect(idleChains.length).toBeGreaterThan(3);

  for (const option of idleChains) {
    const selector = `[data-option="${option}"]`;
    expect(await paintsOwnGround(page, selector), `${option} has no ground`).toBe(true);
    const painted = await paintedText(page, selector);
    // The number is on screen and legible against the entry's own ground.
    expect(painted.text.trim(), option).not.toBe("");
    expect(painted.contrast, `${option} at ${painted.colour} on ${painted.background}`)
      .toBeGreaterThanOrEqual(4.5);
    expectGroundMatchesScheme(painted, scheme, option);
  }

  // The selected entry is legible too — the bug made it the ONLY legible one,
  // and a fix that inverted that would be no better.
  const selected = await paintedText(page, `[data-option="${armed}"]`);
  expect(selected.contrast).toBeGreaterThanOrEqual(4.5);
  await page.keyboard.press("Escape");

  // ── 2. The element grid ──────────────────────────────────────────────────
  await page.click('[aria-label="Element options"]');
  await expect(page.locator('[data-element="C"]')).toBeVisible();
  const idleElements = await page.evaluate(() =>
    [...document.querySelectorAll("[data-element]")]
      .filter((node) => node.getAttribute("aria-pressed") !== "true")
      .map((node) => node.getAttribute("data-element") ?? ""),
  );
  expect(idleElements.length).toBeGreaterThan(8);
  for (const symbol of idleElements) {
    const selector = `[data-element="${symbol}"]`;
    expect(await paintsOwnGround(page, selector), `${symbol} has no ground`).toBe(true);
    const painted = await paintedText(page, selector);
    expect(painted.contrast, `${symbol} at ${painted.colour} on ${painted.background}`)
      .toBeGreaterThanOrEqual(4.5);
    expectGroundMatchesScheme(painted, scheme, symbol);
  }
  await page.keyboard.press("Escape");

  // ── 3. Usable is not the disabled grey ───────────────────────────────────
  //
  // The sum-formula panel button is a TEXT view: the canvas cannot draw through
  // it, but the click is accepted and the strip explains itself, so it is not
  // unavailable and must not wear the unavailable colour. The locants label in
  // the view options is genuinely disabled — the registry refuses it until
  // something numbers the atoms — and is the reference grey.
  const usable = await paintedText(page, '[data-switcher-panel="panel-sum-formula"]');
  expect(usable.contrast).toBeGreaterThanOrEqual(4.5);

  await page.click('[data-shell="view-options"]');
  await expect(page.locator('[data-view-flag="showLocants"]')).toBeVisible();
  const disabledLabel = await page.evaluate(() => {
    const box = document.querySelector('[data-view-flag="showLocants"]');
    if (box === null) throw new Error("no locants checkbox");
    if (!(box as HTMLInputElement).disabled) throw new Error("locants box is not disabled");
    const label = box.closest("label");
    if (label === null) throw new Error("locants box has no label");
    return getComputedStyle(label).color;
  });
  // The measured collision, now impossible: a working control and a refused one
  // cannot be the same colour.
  expect(usable.colour).not.toBe(disabledLabel);

  // ── 4. The view options' own labels, resting AND hovered ─────────────────
  //
  // These rows were the last place in the strip still legible only by
  // inheriting `PopoverContent`'s ground: both branches named an ink and
  // neither named a background, so `paintsOwnGround` was false for every one of
  // them and the ratio measured above was an ancestor's, not the row's.
  const rows = { live: "aromaticCircles", refused: "showLocants" } as const;
  const hoveredGrounds: Record<string, string> = {};
  for (const [what, flag] of Object.entries(rows)) {
    const selector = `[data-view-flag-row="${flag}"]`;
    expect(await paintsOwnGround(page, selector), `${what} label has no ground`).toBe(
      true,
    );
    const resting = await paintedText(page, selector);
    expect(
      resting.contrast,
      `${what} label resting at ${resting.colour} on ${resting.background}`,
    ).toBeGreaterThanOrEqual(4.5);
    expectGroundMatchesScheme(resting, scheme, `${what} label resting`);

    await parkPointerOn(page, selector, 0.25);
    const hovered = await paintedText(page, selector);
    expect(
      hovered.contrast,
      `${what} label hovered at ${hovered.colour} on ${hovered.background}`,
    ).toBeGreaterThanOrEqual(4.5);
    expectGroundMatchesScheme(hovered, scheme, `${what} label hovered`);
    hoveredGrounds[what] = hovered.background;
  }
  // The live row lights up under the pointer and the refused one does not, so
  // hovering the column says which switches are yours. That is the signal the
  // refused row keeps INSTEAD of going dim: the failing pairing was precisely
  // the muted ink on the accent ground, so it holds its own ground and its own
  // ink through the hover, and states both rather than leaving the non-reaction
  // to the absence of a class.
  expect(hoveredGrounds.refused).not.toBe(hoveredGrounds.live);
  await page.keyboard.press("Escape");

  // ── 5. A genuinely BLOCKED panel button, resting AND hovered ─────────────
  //
  // Reached the only way the app offers one. A fresh sketch is empty, where
  // "condensed" is unavailable merely FOR BEING EMPTY — which is not `blocked`,
  // and is why the panel can be added at all — and then a ring, because a ring
  // has no condensed formula. The button that comes out is the one control here
  // that is enabled, struck through, and carries a refusal in its `title`.
  await page.keyboard.press("ControlOrMeta+k");
  await page.click('[data-palette-command="file.new"]');
  const panelList = '[data-shell="figure-panels"]';
  await page.locator(`${panelList} [aria-label="View for the new panel"]`).click();
  await page.getByRole("option", { name: "Condensed formula", exact: true }).click();
  await page.locator('[data-shell="add-panel"]').click();
  await page.click('[data-tool="ring"]');
  const canvas = (await page.locator(CANVAS).boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);

  const third = page.locator("[data-switcher-panel]").nth(2);
  await expect(third).toBeVisible();
  // Enabled on purpose: the click is the way to read the refusal, which is what
  // takes the button out of 1.4.3's exemption for inactive controls.
  await expect(third).toBeEnabled();
  await expect(third).toHaveAttribute(
    "title",
    "A ring has no condensed formula; use the sum formula instead.",
  );
  const blockedId = await third.getAttribute("data-switcher-panel");
  const blockedSelector = `[data-switcher-panel="${blockedId ?? ""}"]`;
  // The line-through is what says "unavailable", and it is not a colour, so it
  // survives the ink going to full contrast below.
  expect(
    await page.evaluate(
      (sel) => getComputedStyle(document.querySelector(sel)!).textDecorationLine,
      blockedSelector,
    ),
  ).toContain("line-through");

  const blockedResting = await paintedText(page, blockedSelector);
  expect(
    blockedResting.contrast,
    `blocked resting at ${blockedResting.colour} on ${blockedResting.background}`,
  ).toBeGreaterThanOrEqual(4.5);
  expectGroundMatchesScheme(blockedResting, scheme, "blocked resting");

  await parkPointerOn(page, blockedSelector);
  const blockedHovered = await paintedText(page, blockedSelector);
  // The assertion the shipped class list failed: 4.349:1 in light mode, because
  // the hover moved the ground to `--accent` and kept `--muted-foreground`.
  expect(
    blockedHovered.contrast,
    `blocked hovered at ${blockedHovered.colour} on ${blockedHovered.background}`,
  ).toBeGreaterThanOrEqual(4.5);
  expectGroundMatchesScheme(blockedHovered, scheme, "blocked hovered");
  // And the hover really is a different painting, so the check above is not
  // quietly re-measuring the resting state.
  expect(blockedHovered.background).not.toBe(blockedResting.background);

  // ── 6. The full periodic table behind "Show all elements" ────────────────
  //
  // Its cells paint with the same shared picker states as the quick picker,
  // and this is where that sharing is measured rather than assumed: every
  // idle cell, the armed one, the group-3 markers, and the entry that opens
  // the table.
  await page.mouse.move(0, 0);
  await page.click('[aria-label="Element options"]');
  const showAll = '[data-option="element-show-all"]';
  await expect(page.locator(showAll)).toBeVisible();
  expect(await paintsOwnGround(page, showAll), "Show all has no ground").toBe(true);
  const showAllPainted = await paintedText(page, showAll);
  expect(showAllPainted.contrast, `Show all at ${showAllPainted.colour}`).toBeGreaterThanOrEqual(
    4.5,
  );
  expectGroundMatchesScheme(showAllPainted, scheme, "Show all");
  await page.click(showAll);
  const table = '[data-shell="periodic-table"]';
  await expect(page.locator(table)).toBeVisible();

  const armedCell = `${table} [data-periodic-element][aria-pressed="true"]`;
  await expect(page.locator(armedCell)).toHaveCount(1);
  const armedPainted = await paintedText(page, armedCell);
  expect(armedPainted.contrast, `armed cell at ${armedPainted.colour}`).toBeGreaterThanOrEqual(4.5);

  const idleCells = await page.evaluate(
    (sel) =>
      [...document.querySelectorAll(`${sel} [data-periodic-element]`)]
        .filter((node) => node.getAttribute("aria-pressed") !== "true")
        .map((node) => node.getAttribute("data-periodic-element") ?? ""),
    table,
  );
  expect(idleCells).toHaveLength(117);
  for (const symbol of idleCells) {
    const selector = `${table} [data-periodic-element="${symbol}"]`;
    expect(await paintsOwnGround(page, selector), `${symbol} cell has no ground`).toBe(true);
    const painted = await paintedText(page, selector);
    expect(painted.contrast, `${symbol} cell at ${painted.colour} on ${painted.background}`)
      .toBeGreaterThanOrEqual(4.5);
    expectGroundMatchesScheme(painted, scheme, `${symbol} cell`);
  }
  for (const marker of ["57–71", "89–103"]) {
    const painted = await paintedText(page, `${table} [data-periodic-marker="${marker}"]`);
    expect(painted.contrast, `marker ${marker} at ${painted.colour}`).toBeGreaterThanOrEqual(4.5);
  }
  await page.keyboard.press("Escape");
}
