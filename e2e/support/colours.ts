import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Colour readings in a real browser, shared by the specs that hold picker
 * states to the 4.5:1 floor: `shell.spec.ts` (the strip, the tool rail) and
 * `panel-chooser.spec.ts` (the figure panel chooser).
 *
 * One copy, because two specs measuring contrast two ways would be free to
 * drift into disagreeing about the same pixel. Not a spec itself: the
 * Playwright config collects `*.spec.ts` only.
 */

export interface PaintedText {
  readonly colour: string;
  readonly background: string;
  readonly contrast: number;
  readonly text: string;
}

/**
 * The resolved ink, the first opaque ground behind it, and the ratio between
 * them. Walking up for the ground is what makes the measurement honest: an
 * entry that declares no background of its own reports its ancestor's, and the
 * ratio then says nothing about the entry.
 */
export async function paintedText(page: Page, selector: string): Promise<PaintedText> {
  return page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (node === null) throw new Error(`nothing matches ${sel}`);
    const parse = (value: string): readonly number[] => {
      const parts = /rgba?\(([^)]+)\)/.exec(value)?.[1]?.split(",") ?? [];
      return parts.map((p) => Number(p.trim()));
    };
    const opaque = (value: string): boolean => {
      const rgba = parse(value);
      return rgba.length >= 3 && (rgba[3] ?? 1) > 0.99;
    };
    let ground = "rgb(255, 255, 255)";
    for (let el: Element | null = node; el !== null; el = el.parentElement) {
      const value = getComputedStyle(el).backgroundColor;
      if (opaque(value)) {
        ground = value;
        break;
      }
    }
    const colour = getComputedStyle(node).color;
    const luminance = (value: string): number => {
      const [r = 0, g = 0, b = 0] = parse(value);
      const channel = (c: number): number => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const a = luminance(colour);
    const b = luminance(ground);
    const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return { colour, background: ground, contrast, text: node.textContent ?? "" };
  }, selector);
}

/** Whether the element paints an opaque background of its OWN, rather than
 *  borrowing the popover's. */
export async function paintsOwnGround(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (node === null) throw new Error(`nothing matches ${sel}`);
    const alpha = /rgba?\(([^)]+)\)/
      .exec(getComputedStyle(node).backgroundColor)?.[1]
      ?.split(",")[3];
    return alpha === undefined ? true : Number(alpha.trim()) > 0.99;
  }, selector);
}

/**
 * Freeze the colour transitions before measuring.
 *
 * Every control this test reads now carries `transition-colors`, so a reading
 * taken in the frame after the theme class lands returns an INTERPOLATED colour
 * — a light-mode grey part-way to its dark-mode value — and the contrast number
 * is then about an animation frame rather than about the state. Removing the
 * interpolation cannot hide a wrong resting colour: it only stops the browser
 * spending frames on the way there.
 */
export async function freezeColourTransitions(page: Page): Promise<void> {
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; }",
  });
}

/**
 * Park the pointer inside an element so `:hover` applies, then read it.
 *
 * WHY HOVER IS MEASURED AT ALL. Every other reading here is a RESTING one, and
 * the 4.5:1 floor binds a control in each state it can be in, not only the one
 * it sits in. The blocked panel button is the case that made that concrete: it
 * is deliberately not `disabled`, because its click is how the refusal is read,
 * so WCAG 1.4.3's exemption for inactive controls never applied to it — and it
 * used to carry `text-muted-foreground` through the hover, which is 4.349:1 on
 * `--accent` in light mode. The resting pair passes, so only a hovered reading
 * can see it.
 *
 * `page.mouse.move` RATHER THAN `page.hover`, because hover runs a hit-target
 * check and these labels wrap a disabled input and a wrapped reason line, so
 * the centre of the box can land on a child or in the gap between the two lines
 * and the check fails on markup that is perfectly hoverable. `dy` is a fraction
 * of the height, so 0.25 reaches the FIRST line of a two-line label.
 */
export async function parkPointerOn(page: Page, selector: string, dy = 0.5): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} has no box to hover`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * dy);
}

/**
 * The entry's own ground, on the right side of the theme.
 *
 * A 4.5:1 ratio says nothing about WHICH way round the entry is painted, so
 * without this the dark run could be a second light run in a dark shell —
 * popover entries still painting white on black text — and would pass. The
 * theme's two grounds are hsl 100% and hsl 3.9%, so the bar is generous.
 */
export function expectGroundMatchesScheme(
  painted: PaintedText,
  scheme: "light" | "dark",
  what: string,
): void {
  const [r = 0, g = 0, b = 0] = /rgba?\(([^)]+)\)/
    .exec(painted.background)?.[1]
    ?.split(",")
    .map((part) => Number(part.trim())) ?? [];
  const brightness = (r + g + b) / 3;
  if (scheme === "dark") {
    expect(brightness, `${what} ground ${painted.background} is not a dark ground`).toBeLessThan(
      96,
    );
  } else {
    expect(
      brightness,
      `${what} ground ${painted.background} is not a light ground`,
    ).toBeGreaterThan(160);
  }
}
