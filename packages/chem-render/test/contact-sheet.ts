/**
 * The contact sheet: every fixture, in every representation, in both presets,
 * as one self-contained HTML page.
 *
 * The goldens in `__golden__/` are the assertion; this is the thing a human
 * actually looks at. A golden string nobody opens will happily preserve a
 * wrong double-bond side, a mirrored structure or a label sitting on top of a
 * bond forever — the bytes match, so the test is green, and the picture has
 * been wrong since whoever accepted the snapshot last. Regenerating the sheet
 * on every run means the moment you are asked to bless a diff, the rendered
 * result is already on disk one click away.
 *
 * Self-contained is a hard requirement: the SVG is inlined, not linked, and
 * there is no CSS or font fetched from anywhere. The page has to be legible
 * opened straight off the filesystem with `file://`, on a machine with no
 * network and no dev server running.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { representationAvailability } from "../src/availability.js";
import { MECHANISM_FIXTURES, steroidSkeletonWithLocants, FIXTURES } from "../src/fixtures.js";
import {
  isStructuralViewKind,
  representation,
  VIEW_KINDS,
} from "../src/representation.js";
import { buildScene } from "../src/scene/build.js";
import type { SceneBuildOptions } from "../src/scene/build.js";
import type { RenderScene } from "../src/scene/types.js";
import { RENDER_STYLES } from "../src/style.js";
import type { RenderStyle, RenderStyleName } from "../src/style.js";
import { serializeScene } from "../src/svg/serialize.js";
import type { Representation, ViewKind } from "../src/representation.js";
import type { Molecule } from "@starter/chem-core";

const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "output");
const OUTPUT_FILE = join(OUTPUT_DIR, "contact-sheet.html");

const PRESET_NAMES: readonly RenderStyleName[] = Object.freeze([
  "publication",
  "screen",
]);

/** Where the sheet lands, whether or not it has been written yet. */
export function contactSheetPath(): string {
  return OUTPUT_FILE;
}

/** The same path as a `file://` URL, which terminals turn into a link. */
export function contactSheetUrl(): string {
  return pathToFileURL(OUTPUT_FILE).href;
}

/**
 * Builds the sheet and writes it, returning the absolute path.
 *
 * The write is atomic — a temporary file in the same directory, then a
 * rename. Two vitest workers can reach this at once (the golden test also
 * refreshes the sheet so the path in its failure message is never stale), and
 * a half-written HTML file that happens to be open in a browser tab is a
 * confusing thing to debug. The temporary name carries the pid so the two
 * writers cannot collide on it either; the content is deterministic, so
 * whichever rename lands last is the same file.
 */
export function writeContactSheet(): string {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const temporary = `${OUTPUT_FILE}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, renderContactSheet(), "utf8");
  renameSync(temporary, OUTPUT_FILE);
  return OUTPUT_FILE;
}

interface Cell {
  /** The rendered SVG, or the reason there is none. Never both, never blank. */
  readonly svg: string;
  readonly unavailable: string | undefined;
  readonly primitiveCount: number;
  readonly width: number;
  readonly height: number;
}

function representationFor(kind: ViewKind): Representation {
  // The negative arm of the guard narrows to `TextViewKind`, which is what
  // picks the no-flags overload of `representation`.
  return isStructuralViewKind(kind) ? representation(kind) : representation(kind);
}

interface Row {
  readonly label: string;
  readonly note: string | undefined;
  readonly representation: Representation;
}

/**
 * The rows of one fixture's section.
 *
 * The six view kinds, plus one row per display FLAG that changes the picture.
 * A flag is not a kind, so it would otherwise be invisible on the sheet — and
 * the sheet is the only artefact that can catch a delocalisation circle drawn
 * at the wrong radius, a wedge whose apex ended up at the wrong end, or a hash
 * ladder whose bars all came out the same width.
 *
 * The descriptor row is skeletal rather than kekule so the letters are read
 * against the emptiest drawing there is: if `(R)` clears the bonds and labels
 * of a bare skeleton it is at least placed, and if it does not, nothing else
 * on the cell is in the way of seeing that.
 */
const ROWS: readonly Row[] = Object.freeze([
  ...VIEW_KINDS.map((kind) => ({
    label: kind,
    note: isStructuralViewKind(kind) ? undefined : "text view",
    representation: representationFor(kind),
  })),
  Object.freeze({
    label: "skeletal",
    // Skeletal DEFAULTS to the circle now, so the extra row is the picture the
    // default replaced: a delocalisation drawn as alternating lines. Losing
    // that row would leave the alternation visible only under `kekule`, whose
    // bare carbons change a second thing at the same time.
    note: "kekule alternation",
    representation: representation("skeletal", { aromaticCircles: false }),
  }),
  Object.freeze({
    label: "skeletal",
    note: "stereo descriptors",
    representation: representation("skeletal", { showStereoDescriptors: true }),
  }),
]);

/** Counts primitives the way a reader would: groups count as their contents. */
function countPrimitives(scene: RenderScene): number {
  const walk = (primitives: RenderScene["primitives"]): number =>
    primitives.reduce(
      (total, p) => total + (p.type === "group" ? walk(p.children) : 1),
      0,
    );
  return walk(scene.primitives);
}

function buildCell(
  fixture: { readonly molecule: Molecule },
  rep: Representation,
  style: RenderStyle,
  options?: SceneBuildOptions,
): Cell {
  // A VIEW THAT CANNOT BE PRODUCED PRINTS ITS REASON, and this is the whole
  // point of the availability function existing: a blank cell on a contact
  // sheet is indistinguishable from a rendering bug, and a blank cell in an
  // exported figure is worse.
  const availability = representationAvailability(fixture.molecule, rep.kind);
  if (!availability.available) {
    return {
      svg: "",
      unavailable: availability.message,
      primitiveCount: 0,
      width: 0,
      height: 0,
    };
  }

  const scene = buildScene(fixture.molecule, style, rep, options);
  return {
    // `standalone: false` drops the XML declaration, which is invalid inside
    // an HTML document and makes browsers refuse the whole page.
    svg: serializeScene(scene, { standalone: false }),
    unavailable: undefined,
    primitiveCount: countPrimitives(scene),
    width: scene.bounds.width,
    height: scene.bounds.height,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** One decimal is plenty for a caption; the goldens carry the exact numbers. */
function round(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/**
 * The fused-ring ANNOTATION section: a steroid with every ring atom numbered
 * and its four provable stereocentres labelled.
 *
 * Its own section rather than a `FIXTURES` entry, because the locants are an
 * INJECTED input (`SceneBuildOptions.locants`) that no other fixture has, and
 * because this is where a locant sitting on a wedge, or a descriptor pushed
 * into a ring, gets seen. The numbering is the steroid's real one and the
 * atom ids are deliberately not in that order, so a sheet showing 1..17
 * running round the rings in id order would be showing ids.
 */
const ANNOTATED = steroidSkeletonWithLocants();
export const ANNOTATED_SECTION_NAME = "steroid skeleton (locants injected)";
const ANNOTATED_ROWS: readonly Row[] = Object.freeze([
  Object.freeze({
    label: "skeletal",
    note: "no annotations",
    representation: representation("skeletal"),
  }),
  Object.freeze({
    label: "skeletal",
    note: "stereo descriptors + locants",
    representation: representation("skeletal", {
      showStereoDescriptors: true,
      showLocants: true,
    }),
  }),
]);

/**
 * The MECHANISM sections: molecules with the curly arrows a textbook draws on
 * them, passed as the document field they are (`schemeAnnotations`). Skeletal
 * is the figure; Lewis is where a lone-pair arrow must leave from the drawn
 * pair rather than from the label, and where the y-flip would show first — an
 * arrow bowing the wrong way runs through the dots it should start beside.
 */
export const MECHANISM_SECTION_PREFIX = "mechanism: ";
const MECHANISM_ROWS: readonly Row[] = Object.freeze([
  Object.freeze({
    label: "skeletal",
    note: "curly arrows",
    representation: representation("skeletal"),
  }),
  Object.freeze({
    label: "lewis",
    note: "curly arrows from the drawn lone pairs",
    representation: representation("lewis"),
  }),
]);

function renderRow(
  row: Row,
  fixture: { readonly molecule: Molecule },
  options?: SceneBuildOptions,
): string {
  const cells = PRESET_NAMES.map((presetName) => {
    const cell = buildCell(fixture, row.representation, RENDER_STYLES[presetName], options);
    const body =
      cell.unavailable === undefined
        ? `          <div class="stage stage--${presetName}">${cell.svg}</div>`
        : `          <div class="stage stage--${presetName}"><p class="why">${escapeHtml(cell.unavailable)}</p></div>`;
    const meta =
      cell.unavailable === undefined
        ? [
            `            <span class="meta">${cell.primitiveCount} primitives</span>`,
            `            <span class="meta">${round(cell.width)} &times; ${round(cell.height)} px</span>`,
          ]
        : [`            <span class="meta">unavailable</span>`];
    return [
      `        <figure class="cell">`,
      body,
      `          <figcaption>`,
      `            <span class="preset">${escapeHtml(presetName)}</span>`,
      ...meta,
      `          </figcaption>`,
      `        </figure>`,
    ].join("\n");
  }).join("\n");

  return [
    `      <div class="row">`,
    `        <h3 class="kind">${escapeHtml(row.label)}${
      row.note === undefined ? "" : ` <em>${escapeHtml(row.note)}</em>`
    }</h3>`,
    cells,
    `      </div>`,
  ].join("\n");
}

function renderSection(name: string, rows: readonly string[]): string {
  return [
    `    <section>`,
    `      <h2>${escapeHtml(name)}</h2>`,
    rows.join("\n"),
    `    </section>`,
  ].join("\n");
}

export function renderContactSheet(): string {
  const sections = [
    ...FIXTURES.map((fixture) =>
      renderSection(
        fixture.name,
        ROWS.map((row) => renderRow(row, fixture)),
      ),
    ),
    renderSection(
      ANNOTATED_SECTION_NAME,
      ANNOTATED_ROWS.map((row) =>
        renderRow(row, ANNOTATED, { locants: ANNOTATED.locants }),
      ),
    ),
    ...MECHANISM_FIXTURES.map((fixture) =>
      renderSection(
        MECHANISM_SECTION_PREFIX + fixture.name,
        MECHANISM_ROWS.map((row) =>
          renderRow(row, fixture, { schemeAnnotations: fixture.annotations }),
        ),
      ),
    ),
  ].join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>chem-render contact sheet</title>
<style>
  :root { color-scheme: light dark; --ink: #111827; --dim: #6b7280; --rule: #d1d5db; --page: #f8fafc; --card: #ffffff; }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #e5e7eb; --dim: #9ca3af; --rule: #374151; --page: #0b1220; --card: #111827; }
  }
  body { margin: 0; padding: 32px; background: var(--page); color: var(--ink);
         font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Arial, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .lede { color: var(--dim); margin: 0 0 28px; max-width: 60ch; }
  section { margin: 0 0 36px; }
  h2 { font-size: 16px; margin: 0 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--rule); }
  .row { display: grid; grid-template-columns: 140px 1fr 1fr; gap: 16px; align-items: start;
         padding: 12px 0; border-bottom: 1px dashed var(--rule); }
  .kind { font-size: 13px; font-weight: 600; margin: 0; padding-top: 6px; }
  .kind em { display: block; font-weight: 400; font-style: normal; color: var(--dim); font-size: 12px; }
  .cell { margin: 0; display: flex; flex-direction: column; }
  .why { margin: 0; padding: 8px 10px; color: var(--dim); font-size: 12px; font-style: italic; }
  /* Both stages keep a light ground whatever the page theme is. Publication
     ink is literally #000000 and screen ink is nearly so — previewing either
     on a dark card would hide the very thing the sheet exists to show. */
  .stage { display: flex; align-items: center; justify-content: center;
           height: 168px; padding: 8px; box-sizing: border-box;
           border: 1px solid var(--rule); border-radius: 6px; overflow: auto;
           background-color: #ffffff; }
  /* The publication style carries no background of its own, on purpose. The
     checkerboard is the page saying so, rather than a white cell quietly
     making a transparent figure look opaque. */
  .stage--publication {
    background-image:
      linear-gradient(45deg, rgba(0,0,0,.10) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.10) 75%),
      linear-gradient(45deg, rgba(0,0,0,.10) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.10) 75%);
    background-size: 12px 12px; background-position: 0 0, 6px 6px;
  }
  .stage svg { max-width: 100%; max-height: 100%; height: auto; }
  figcaption { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; font-size: 12px; color: var(--dim); }
  .preset { font-weight: 600; color: var(--ink); }
</style>
</head>
<body>
  <h1>chem-render contact sheet</h1>
  <p class="lede">Every fixture &times; every representation &times; both style presets.
  Regenerated by <code>pnpm test</code>; never commit it. Look here before accepting a golden diff &mdash;
  the SVG bytes can match a wrong picture forever.</p>
${sections}
</body>
</html>
`;
}
