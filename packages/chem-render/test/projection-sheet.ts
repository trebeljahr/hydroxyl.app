/**
 * THE PROJECTION CONTACT SHEET (decision 190): every BUILT projection of every
 * fixture of the projection harness, with its descriptors, on one page.
 *
 * Drawn FROM THE MATRIX. chem-core's harness commits
 * `test/harness/__golden__/matrix.json`, one row per fixture and listed
 * template, and this page draws exactly the rows it calls `built`, from the
 * view it records, projecting the checked-in molblock again through
 * chem-core. A template that lands turns its rows to `built` there and
 * they appear here with no edit. Rows that are owed or refused are listed
 * under their fixture with the reason, so the page shows what is missing
 * as well as what is drawn.
 *
 * A wrong Fischer is obvious to a chemist and invisible in a diff, so this
 * page is for Rico to review (a human task); the SVGs are committed as
 * goldens meanwhile, so any change to a picture fails at once and points
 * here. The chemistry is asserted in chem-core's harness, never here.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { project, readMolblock, stereoConfig } from "@starter/chem-core";
import type { Molecule, ProjectedLayout, ProjectionView } from "@starter/chem-core";

import { representation } from "../src/representation.js";
import { buildScene } from "../src/scene/build.js";
import { RENDER_STYLES } from "../src/style.js";
import { serializeScene } from "../src/svg/serialize.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHEM_CORE_TEST = join(HERE, "..", "..", "chem-core", "test");
const MATRIX = join(CHEM_CORE_TEST, "harness", "__golden__", "matrix.json");
const OUTPUT_FILE = join(HERE, "output", "projection-sheet.html");

export interface MatrixRow {
  readonly fixture: string;
  readonly template: string;
  readonly status: "built" | "pending" | "refused" | "not-applicable";
  readonly view?: ProjectionView;
  readonly letters?: Readonly<Record<string, string>>;
  readonly doubleBonds?: Readonly<Record<string, string>>;
  readonly coverage?: { readonly centres: readonly string[]; readonly doubleBonds: readonly string[] };
  readonly reason?: string;
  readonly why?: string;
}

interface Matrix {
  readonly fixtures: readonly { readonly fixture: string; readonly family: string }[];
  readonly rows: readonly MatrixRow[];
}

export function readMatrix(): Matrix {
  return JSON.parse(readFileSync(MATRIX, "utf8")) as Matrix;
}

const MOLECULES = new Map<string, { readonly molecule: Molecule; readonly title: string }>();

export function fixtureMolecule(fixture: string): { readonly molecule: Molecule; readonly title: string } {
  let found = MOLECULES.get(fixture);
  if (found === undefined) {
    const read = readMolblock(readFileSync(join(CHEM_CORE_TEST, "fixtures", fixture), "utf8"));
    // "(R)-glyceraldehyde (generated 2026-09-17, RDKit 2025.03.4)" -> the name.
    found = { molecule: read.molecule, title: read.title.replace(/\s*\(generated [^)]*\)\s*$/, "") };
    MOLECULES.set(fixture, found);
  }
  return found;
}

/** The layout of a built row, projected again from the row's recorded view. */
export function layoutOf(row: MatrixRow): ProjectedLayout {
  const { molecule } = fixtureMolecule(row.fixture);
  const result = project(molecule, stereoConfig(molecule), row.view!);
  if (result.kind !== "available") {
    throw new Error(`${row.fixture} as ${row.template} is built in the matrix but projects ${result.kind} here`);
  }
  return result.layout;
}

/** Descriptors, labels and locants on: the page is for reading configuration. */
const REPRESENTATION = representation("skeletal", { showStereoDescriptors: true, showLocants: true });

/** One golden SVG per built row, at the publication preset. */
export function projectionSvg(row: MatrixRow, standalone = true): string {
  const { molecule } = fixtureMolecule(row.fixture);
  const scene = buildScene(molecule, RENDER_STYLES.publication, REPRESENTATION, { layout: layoutOf(row) });
  return serializeScene(scene, { standalone });
}

/** `projection/d-glucose-open.mol` as `chain/fischer` -> `projection-d-glucose-open--chain-fischer.svg`. */
export function goldenName(row: MatrixRow): string {
  return `${row.fixture.replace(/\.mol$/, "").replace("/", "-")}--${row.template.replace("/", "-")}.svg`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** "a3 R · a5 S", then E/Z: what the layout states, as the harness read it back. */
export function descriptorCaption(row: MatrixRow): string {
  const centres = Object.entries(row.letters ?? {}).map(([id, letter]) => `${id} ${letter}`);
  const bonds = Object.entries(row.doubleBonds ?? {}).map(([id, letter]) => `${id} ${letter}`);
  const all = [...centres, ...bonds];
  return all.length === 0 ? "states no stereo unit" : all.join(" · ");
}

export function renderProjectionSheet(): string {
  const matrix = readMatrix();
  const sections = matrix.fixtures.map(({ fixture, family }) => {
    const rows = matrix.rows.filter((row) => row.fixture === fixture);
    const built = rows.filter((row) => row.status === "built");
    const cells = built
      .map((row) =>
        [
          `        <figure class="cell">`,
          `          <div class="stage">${projectionSvg(row, false)}</div>`,
          `          <figcaption>`,
          `            <span class="template">${escapeHtml(row.template)}</span>`,
          `            <span class="descriptors">${escapeHtml(descriptorCaption(row))}</span>`,
          `          </figcaption>`,
          `        </figure>`,
        ].join("\n"),
      )
      .join("\n");
    const owed = rows
      .filter((row) => row.status === "pending" || row.status === "refused")
      .map(
        (row) =>
          `        <li><code>${escapeHtml(row.template)}</code> ${
            row.status === "pending" ? "owed: template not built yet" : `refused: ${escapeHtml(row.reason ?? "")}`
          }</li>`,
      );
    return [
      `    <section>`,
      `      <h2>${escapeHtml(fixtureMolecule(fixture).title)} <small>${escapeHtml(fixture)} &middot; ${escapeHtml(family)}</small></h2>`,
      `      <div class="grid">`,
      cells,
      `      </div>`,
      ...(owed.length === 0 ? [] : [`      <ul class="owed">`, ...owed, `      </ul>`]),
      `    </section>`,
    ].join("\n");
  });
  const builtCount = matrix.rows.filter((row) => row.status === "built").length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Projection contact sheet</title>
<style>
  :root { color-scheme: light dark; --ink: #111827; --dim: #6b7280; --rule: #d1d5db; --page: #f8fafc; }
  @media (prefers-color-scheme: dark) { :root { --ink: #e5e7eb; --dim: #9ca3af; --rule: #374151; --page: #0b1220; } }
  body { margin: 0; padding: 32px; background: var(--page); color: var(--ink);
         font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Arial, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .lede { color: var(--dim); margin: 0 0 28px; max-width: 72ch; }
  section { margin: 0 0 32px; }
  h2 { font-size: 16px; margin: 0 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--rule); }
  h2 small { font-weight: 400; color: var(--dim); font-size: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
  .cell { margin: 0; display: flex; flex-direction: column; }
  /* A light ground whatever the theme: publication ink is #000000. */
  .stage { display: flex; align-items: center; justify-content: center; height: 240px; padding: 8px;
           box-sizing: border-box; border: 1px solid var(--rule); border-radius: 6px; background: #ffffff; }
  .stage svg { max-width: 100%; max-height: 100%; height: auto; }
  figcaption { display: flex; flex-direction: column; margin-top: 6px; font-size: 12px; color: var(--dim); }
  .template { font-weight: 600; color: var(--ink); }
  .owed { margin: 10px 0 0; padding-left: 18px; color: var(--dim); font-size: 12px; }
</style>
</head>
<body>
  <h1>Projection contact sheet</h1>
  <p class="lede">Every built projection of every fixture in the projection harness (${builtCount} panels), drawn from
  chem-core's <code>test/harness/__golden__/matrix.json</code>, with the descriptors the harness read back from each layout.
  Publication style, descriptors and locants on. Regenerated by <code>pnpm test</code>; never commit it. The SVGs are the goldens in
  <code>test/__golden__/projection/</code>: look here before accepting a diff to one.</p>
${sections.join("\n")}
</body>
</html>
`;
}

export function projectionSheetPath(): string {
  return OUTPUT_FILE;
}

export function projectionSheetUrl(): string {
  return pathToFileURL(OUTPUT_FILE).href;
}

/** Written atomically, as the contact sheet is: two workers may both write it. */
export function writeProjectionSheet(): string {
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  const temporary = `${OUTPUT_FILE}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, renderProjectionSheet(), "utf8");
  renameSync(temporary, OUTPUT_FILE);
  return OUTPUT_FILE;
}
