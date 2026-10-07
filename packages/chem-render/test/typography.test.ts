/**
 * The glyphs a scheme is made of, against the vendored Arimo subset
 * (decisions 191, 192 and 206).
 *
 * The scope asked for a re-subset that adds delta, Delta, alpha, beta and the
 * double dagger. Decision 192 defers the download that would supply them, so
 * this file holds the other half of the bargain: every LATIN string a
 * conditions line, a coefficient or a bracket charge prints is measured with
 * no `.notdef` at all, and the Greek ones are PINNED as the known limit — the
 * assertions that fail, and get updated, the day Greek is vendored. The arrows
 * and the double dagger are drawn geometry (191, 204), so the font never needs
 * them; that too is pinned, so nobody "fixes" a drawn dagger into a glyph the
 * subset does not have.
 *
 * `node:fs` only for the fixtures, as everywhere in this package's tests.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { cipDescriptor, project, readMolblock, stereoConfig, suggestSteroidSkeleton } from "@starter/chem-core";
import type { Molecule, PlanarView } from "@starter/chem-core";

import { composeFigure } from "../src/figure/compose.js";
import type { Figure } from "../src/figure/compose.js";
import { representation } from "../src/representation.js";
import { buildScene } from "../src/scene/build.js";
import type { TextRunPrimitive } from "../src/scene/types.js";
import { PUBLICATION_STYLE, SCREEN_STYLE } from "../src/style.js";
import { serializeFigure } from "../src/svg/figure.js";
import { ARIMO_GREEK_UNICODE_RANGE, ARIMO_GREEK_WOFF_BASE64 } from "../src/text/generated/arimo-woff.js";
import { BUNDLED_MEASURER } from "../src/text/measurer.js";
import {
  GREEK_LETTERS,
  VENDORED_FACES,
  greek,
  italic,
  unmeasuredCodePoints,
  unmeasuredTextRuns,
} from "../src/text/typography.js";
import { ethanol } from "../src/fixtures.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, "..", "..", "chem-core", "test", "fixtures");

function load(dir: "steroid" | "projection", file: string): Molecule {
  return readMolblock(readFileSync(join(CORE, dir, file), "utf8")).molecule;
}

const FAMILY = PUBLICATION_STYLE.fontFamily;

function notdefs(text: string): number {
  return BUNDLED_MEASURER.measureText(text, { family: FAMILY, sizePx: 10 }).notdefCount;
}

/**
 * Conditions as a figure prints them (decision 202): a real minus and a
 * degree sign, en dashes in ranges, the middle dot of a solvate, a prime,
 * the micro sign, and the reagents of real procedures — the aldol of List,
 * Lerner and Barbas (L-proline, DMSO), a Birch-free LDA/MeI alkylation, an
 * Oppenauer oxidation, a Suzuki coupling.
 */
const LATIN_CORPUS = [
  "100 °C",
  "microwave, 30 min",
  "1. LDA, THF, −78 °C; 2. MeI",
  "(i) LDA, THF, −78 °C",
  "(ii) MeI",
  "L-proline (30 mol%), DMSO, rt",
  "Al(OiPr)3, acetone, toluene, reflux",
  "Pd(PPh3)4, K2CO3, dioxane–H2O, 80 °C, 12 h",
  "NaBH4, MeOH, 0 °C",
  "H3O+",
  "CuSO4·5H2O",
  "3′-OH",
  "5–10 min",
  "298 K",
  "10 µL",
  "2+",
  "−",
  "(R)",
  "(S)",
] as const;

describe("the Latin corpus is measured, glyph for glyph (decision 206)", () => {
  it("has no .notdef in any conditions line, coefficient or bracket charge", () => {
    for (const text of LATIN_CORPUS) {
      expect(notdefs(text), text).toBe(0);
      expect(unmeasuredCodePoints(text, BUNDLED_MEASURER, FAMILY), text).toEqual([]);
    }
  });

  it("measures a hyphen-minus narrower than the real minus a temperature prints with", () => {
    // Why a temperature is a number with a unit: a typed "-78 C" is the wrong
    // glyph, and the two do not even measure alike.
    const size = { family: FAMILY, sizePx: 10 };
    const hyphen = BUNDLED_MEASURER.measureText("-", size).advanceWidthPx;
    const minus = BUNDLED_MEASURER.measureText("−", size).advanceWidthPx;
    expect(minus).toBeGreaterThan(hyphen);
  });
});

describe("Greek is vendored, italic still waits (decisions 192 and 252)", () => {
  it("vendors the Greek face and not the italic one", () => {
    // When italic is vendored this fails first, and every pinned limit below
    // is to be re-derived rather than edited to pass.
    expect(VENDORED_FACES).toEqual({ greek: true, italic: false });
  });

  it("measures each Greek string of the done-when exactly, none of it at .notdef", () => {
    const pinned: readonly string[] = [
      `${greek("Delta")}, 100 °C`,
      `${greek("delta")}+`,
      `${greek("delta")}−`,
      `3${greek("beta")}-OH`,
      `5${greek("alpha")}-H`,
      `17${greek("alpha")}, 17${greek("beta")}-OH`,
      `10 ${greek("mu")}L`,
    ];
    for (const text of pinned) {
      expect(unmeasuredCodePoints(text, BUNDLED_MEASURER, FAMILY), text).toEqual([]);
      expect(notdefs(text), text).toBe(0);
    }
  });

  it("keeps the double dagger and every arrow out of the font: they are drawn (decisions 191, 204)", () => {
    for (const glyph of ["‡", "→", "⇌", "⇒", "↔"]) {
      expect(notdefs(glyph), glyph).toBe(1);
    }
  });

  it("names each Greek letter by its code point, and sets italic upright", () => {
    expect(GREEK_LETTERS).toEqual({ alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", mu: "μ" });
    expect(italic("R")).toBe("R");
    expect(italic("cat.")).toBe("cat.");
  });
});

describe("an unmeasured code point is reported, never thrown (decision 206)", () => {
  it("has nothing to report for a steroid panel's alpha/beta runs now Greek is vendored", () => {
    const mol = load("steroid", "cholesterol.mol");
    const suggestion = suggestSteroidSkeleton(mol);
    if (suggestion.kind !== "match") throw new Error("cholesterol is a steroid");
    const view: PlanarView = {
      kind: "planar",
      template: "steroid",
      frame: {},
      params: { rotationDeg: 0, mirror: false, skeletons: suggestion.skeletons },
    };
    const result = project(mol, stereoConfig(mol), view);
    if (result.kind !== "available") throw new Error(JSON.stringify(result));
    // Non-vacuous: the side chain's C-20 is a real letter before any face is.
    expect(cipDescriptor(mol, "a2")).toEqual({ kind: "R" });
    const scene = buildScene(mol, SCREEN_STYLE, representation("skeletal", { showStereoDescriptors: true }), {
      layout: result.layout,
    });
    // Non-vacuous: the panel does draw its Greek face labels.
    const faceRuns = scene.primitives.filter(
      (p): p is TextRunPrimitive => p.type === "textRun" && p.id.endsWith(":alphaBeta"),
    );
    expect(faceRuns.length).toBeGreaterThan(0);
    expect(faceRuns.find((p) => p.id === "atom:a24:alphaBeta")?.spans.map((s) => s.text).join("")).toBe("3β-OH");
    expect(unmeasuredTextRuns(scene)).toEqual([]);
  });

  it("finds nothing to report in a plain skeletal panel", () => {
    const mol = load("projection", "d-glucose-open.mol");
    // Four real letters first, or "nothing to report" proves nothing.
    const letters = mol.atomIds.map((id) => cipDescriptor(mol, id)?.kind).filter((k) => k === "R" || k === "S");
    expect(letters).toHaveLength(4);
    const scene = buildScene(mol, SCREEN_STYLE, representation("skeletal", { showStereoDescriptors: true }));
    expect(scene.primitives.filter((p) => p.id.endsWith(":descriptor"))).toHaveLength(4);
    expect(unmeasuredTextRuns(scene)).toEqual([]);
  });
});

describe("the exported SVG does not grow (decision 206)", () => {
  it("embeds the same 20,041 bytes of font it did before this task", () => {
    // Measured, not assumed: no re-subset, so the size delta of this task is
    // zero and the embedding costs what it did. A Greek or italic subset
    // must re-measure this and record the new figure in THIRD-PARTY-NOTICES.
    const figure = composeFigure(ethanol(), PUBLICATION_STYLE, [
      { id: "p1", representation: representation("skeletal") },
    ]);
    const embedded = Buffer.byteLength(serializeFigure(figure, { embedFont: true }), "utf8");
    const bare = Buffer.byteLength(serializeFigure(figure, { embedFont: false }), "utf8");
    expect(embedded - bare).toBe(20041);
  });

  it("adds the Greek face only to a figure that sets a Greek letter (decision 252)", () => {
    const base = composeFigure(ethanol(), PUBLICATION_STYLE, [
      { id: "p1", representation: representation("skeletal") },
    ]);
    const cell = base.cells[0]!;
    const delta: TextRunPrimitive = {
      id: "test:delta",
      source: { kind: "decoration" },
      type: "textRun",
      origin: { x: 0, y: 0 },
      spans: [{ text: "δ+" }],
      fontFamily: PUBLICATION_STYLE.fontFamily,
      fontSizePx: 10,
      fill: { color: "#000000" },
      anchor: "start",
    };
    const figure: Figure = { ...base, cells: [{ ...cell, decorations: [...cell.decorations, delta] }] };
    const svg = serializeFigure(figure, { embedFont: true });
    const greekFace =
      `@font-face{font-family:"Arimo";src:url(data:font/woff;base64,${ARIMO_GREEK_WOFF_BASE64}) format("woff");` +
      `font-weight:400;font-style:normal;unicode-range:${ARIMO_GREEK_UNICODE_RANGE}}`;
    expect(svg).toContain(greekFace);
    expect(serializeFigure(base, { embedFont: true })).not.toContain(ARIMO_GREEK_UNICODE_RANGE);
    const bare = Buffer.byteLength(serializeFigure(figure, { embedFont: false }), "utf8");
    expect(Buffer.byteLength(svg, "utf8") - bare).toBe(20041 + greekFace.length);
  });
});
