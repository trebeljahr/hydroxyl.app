/**
 * The serialiser's contract: deterministic bytes, correct escaping, no DOM.
 *
 * Every one of these is a property the goldens depend on. If the output is not
 * byte-stable, a golden diff is noise and gets rubber-stamped; if a number can
 * print as "-0" on one machine and "0" on another, the same file fails in CI
 * and passes locally, which is the fastest way to teach a team to ignore a
 * failing snapshot.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { benzene } from "@starter/chem-core";

import { acetate, ethanol } from "../src/fixtures.js";
import {
  isStructuralViewKind,
  representation,
  VIEW_KINDS,
} from "../src/representation.js";
import { buildScene } from "../src/scene/build.js";
import type { RenderScene } from "../src/scene/types.js";
import {
  PUBLICATION_STYLE,
  SCREEN_STYLE,
  withStyle,
} from "../src/style.js";
import {
  escapeAttr,
  escapeText,
  formatNumber,
  serializeScene,
  serializeToDataUri,
} from "../src/svg/serialize.js";

const SKELETAL = representation("skeletal");
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function svgOf(scene: RenderScene): string {
  return serializeScene(scene);
}

describe("byte-determinism", () => {
  it("serialises the same scene twice to identical bytes", () => {
    const scene = buildScene(benzene(), PUBLICATION_STYLE, SKELETAL);
    expect(svgOf(scene)).toBe(svgOf(scene));
  });

  it("serialises two independently built scenes of one molecule identically", () => {
    // The stronger claim: nothing in the pipeline is seeded by iteration
    // order, a counter, a Map insertion sequence or the clock. Exported
    // figures get committed and diffed, and that is worthless otherwise.
    const a = svgOf(buildScene(benzene(), SCREEN_STYLE, SKELETAL));
    const b = svgOf(buildScene(benzene(), SCREEN_STYLE, SKELETAL));
    expect(a).toBe(b);
  });

  it("never prints a negative zero", () => {
    // The y-flip is a negation, so a model y of 0 becomes -0 in the scene.
    // Whether that reaches the output depends on nothing a reader can
    // predict, which is exactly the kind of diff that erodes trust in the
    // goldens.
    const scene = buildScene(ethanol(), SCREEN_STYLE, SKELETAL);
    // Sanity first: the flip really does produce a -0 upstream, so the
    // assertion below is testing normalisation and not an absent case.
    const originDot = scene.primitives.find(
      (p) => p.type === "circle" && p.centre.x === 0,
    );
    if (originDot === undefined || originDot.type !== "circle") {
      throw new Error("ethanol should place its methyl carbon on the origin");
    }
    expect(Object.is(originDot.centre.y, -0)).toBe(true);

    const svg = svgOf(scene);
    expect(svg).toContain('cy="0"');
    // `-0` as a whole token: "-0.5" is a perfectly good number and must not
    // trip this.
    expect(svg).not.toMatch(/-0(?![.\d])/);
  });

  it("stays deterministic and negative-zero-free across the whole matrix", () => {
    // One fixture proves the rule is implemented; the sweep proves no
    // combination of style precision and representation escapes it. It is
    // cheap, and the case it catches — one preset rounding a coordinate to a
    // signed nothing — is invisible until CI disagrees with a laptop.
    for (const fixture of [benzene(), ethanol(), acetate()]) {
      for (const style of [PUBLICATION_STYLE, SCREEN_STYLE]) {
        for (const kind of VIEW_KINDS) {
          const view = isStructuralViewKind(kind)
            ? representation(kind)
            : representation(kind);
          const label = `${style.name}/${kind}`;
          const first = svgOf(buildScene(fixture, style, view));
          const second = svgOf(buildScene(fixture, style, view));
          expect(first, label).toBe(second);
          expect(first, label).not.toMatch(/-0(?![.\d])/);
        }
      }
    }
  });

  it("normalises a value that merely rounds to nothing", () => {
    expect(formatNumber(-0.0001, 2)).toBe("0");
    expect(formatNumber(-0, 3)).toBe("0");
    expect(formatNumber(24, 3)).toBe("24");
    expect(formatNumber(10.5, 2)).toBe("10.5");
    expect(formatNumber(-0.5, 2)).toBe("-0.5");
  });

  it("names the offending primitive when a coordinate is not finite", () => {
    expect(() => formatNumber(Number.NaN, 2, "bond:b7:line")).toThrow(
      /bond:b7:line/,
    );
  });
});

describe("the style owns the scale", () => {
  it("changes the drawn bond length by exactly the bondLengthPx ratio", () => {
    // Measured off the emitted strings, with no geometry code in the loop: a
    // preset swap must move the picture and nothing else. Benzene's ring edges
    // are one model unit each, so a line's length in px IS bondLengthPx.
    const lengthOfFirstLine = (svg: string): number => {
      const match = /<line[^>]*x1="([^"]*)" y1="([^"]*)" x2="([^"]*)" y2="([^"]*)"/.exec(
        svg,
      );
      if (match === null) throw new Error("no <line> in the output");
      const [, x1, y1, x2, y2] = match.map(Number) as (number | undefined)[];
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
        throw new Error("malformed line attributes");
      }
      return Math.hypot(x2 - x1, y2 - y1);
    };

    const publication = lengthOfFirstLine(
      svgOf(buildScene(benzene(), PUBLICATION_STYLE, SKELETAL)),
    );
    const screen = lengthOfFirstLine(
      svgOf(buildScene(benzene(), SCREEN_STYLE, SKELETAL)),
    );

    expect(publication).toBeCloseTo(PUBLICATION_STYLE.bondLengthPx, 2);
    expect(screen).toBeCloseTo(SCREEN_STYLE.bondLengthPx, 2);
    expect(screen / publication).toBeCloseTo(
      SCREEN_STYLE.bondLengthPx / PUBLICATION_STYLE.bondLengthPx,
      2,
    );
  });

  it("emits a background rect only when the style has one", () => {
    // A publication figure has to take the colour of the page it lands on.
    // A baked-in white rect is why exported SVGs show up as bright blocks on
    // dark slides.
    expect(svgOf(buildScene(benzene(), PUBLICATION_STYLE, SKELETAL))).not.toContain(
      "<rect",
    );
    expect(svgOf(buildScene(benzene(), SCREEN_STYLE, SKELETAL))).toContain(
      '<rect data-decoration="background"',
    );
  });

  it("cuts the viewBox from the scene bounds", () => {
    const scene = buildScene(acetate(), SCREEN_STYLE, SKELETAL);
    const { bounds } = scene;
    const expected = [bounds.minX, bounds.minY, bounds.width, bounds.height]
      .map((n) => formatNumber(n, scene.style.coordinatePrecision))
      .join(" ");
    expect(svgOf(scene)).toContain(`viewBox="${expected}"`);
  });
});

describe("escaping", () => {
  it("escapes text content and attribute values", () => {
    expect(escapeText('< & " >')).toBe('&lt; &amp; " &gt;');
    expect(escapeAttr('< & " >')).toBe("&lt; &amp; &quot; &gt;");
  });

  it("escapes the ampersand first, so an entity is not double-decoded", () => {
    // Replacing `<` before `&` would turn "&lt;" into "&amp;lt;" the long way
    // round and produce "&lt;" again on the next pass. Order matters.
    expect(escapeText("&lt;")).toBe("&amp;lt;");
    expect(escapeAttr('a & b < c > d "e"')).toBe(
      "a &amp; b &lt; c &gt; d &quot;e&quot;",
    );
  });

  it("escapes a hostile value on the way into real output", () => {
    // A font stack is the attribute a user can most plausibly get their own
    // string into, and an unescaped quote there ends the attribute early and
    // corrupts the whole document.
    const style = withStyle(PUBLICATION_STYLE, {
      fontFamily: 'My "Weird" & <Font>',
    });
    const svg = svgOf(
      buildScene(ethanol(), style, representation("sumFormula")),
    );
    expect(svg).toContain(
      'font-family="My &quot;Weird&quot; &amp; &lt;Font&gt;"',
    );
    expect(svg).not.toContain('My "Weird"');
  });
});

describe("back-references", () => {
  it("puts a data attribute naming the source on every primitive", () => {
    const scene = buildScene(benzene(), SCREEN_STYLE, SKELETAL);
    const svg = svgOf(scene);

    for (const primitive of scene.primitives) {
      if (primitive.source.kind === "atom") {
        expect(svg).toContain(
          `id="${primitive.id}" data-atom="${primitive.source.atomId}"`,
        );
      } else if (primitive.source.kind === "bond") {
        expect(svg).toContain(
          `id="${primitive.id}" data-bond="${primitive.source.bondId}"`,
        );
      }
    }

    // Every drawn element except the style's own background belongs to the
    // model: a hit-test reads the attribute off the element under the cursor
    // rather than re-deriving geometry.
    const elements = svg.match(/<(line|circle|polygon|polyline|path|text|g)\b/g) ?? [];
    const referenced = svg.match(/ data-(atom|bond)="/g) ?? [];
    expect(referenced).toHaveLength(elements.length);
  });

  it("flags a text view's glyph run as a decoration, not as an atom", () => {
    const svg = svgOf(
      buildScene(acetate(), SCREEN_STYLE, representation("sumFormula")),
    );
    expect(svg).toContain('data-decoration="true"');
    expect(svg).not.toContain("data-atom=");
    expect(svg).not.toContain("data-bond=");
  });
});

describe("output shape", () => {
  it("prepends the XML declaration only for a standalone file", () => {
    const scene = buildScene(ethanol(), PUBLICATION_STYLE, SKELETAL);
    expect(serializeScene(scene)).toMatch(/^<\?xml version="1\.0"/);
    expect(serializeScene(scene, { standalone: false })).toMatch(/^<svg /);
  });

  it("collapses to a single line when indentation is off", () => {
    const scene = buildScene(ethanol(), PUBLICATION_STYLE, SKELETAL);
    const inline = serializeScene(scene, { standalone: false, indent: false });
    expect(inline).not.toContain("\n");
  });

  it("keeps the tspans of a formula whitespace-free", () => {
    // SVG collapses whitespace between tspans to a space, which would set
    // "C6H6" as "C 6 H 6". Indented output must not reintroduce it.
    const svg = svgOf(
      buildScene(benzene(), PUBLICATION_STYLE, representation("sumFormula")),
    );
    expect(svg).toContain("</tspan><tspan");
    expect(svg).not.toMatch(/<\/tspan>\s+<tspan/);
  });

  it("round-trips through a data URI", () => {
    const scene = buildScene(benzene(), SCREEN_STYLE, SKELETAL);
    const uri = serializeToDataUri(scene);
    expect(uri.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(uri.slice("data:image/svg+xml;charset=utf-8,".length))).toBe(
      serializeScene(scene, { standalone: false, indent: false }),
    );
  });
});

describe("the DOM-free claim", () => {
  it("serialises where there is no DOM at all", () => {
    // The whole package has to work in a build script and a unit test, not
    // only in a browser. This runs in vitest's node environment, so the
    // globals genuinely are absent — asserting it makes the guarantee a test
    // failure rather than a comment.
    expect("document" in globalThis).toBe(false);
    expect("window" in globalThis).toBe(false);
    expect(() =>
      svgOf(buildScene(benzene(), SCREEN_STYLE, SKELETAL)),
    ).not.toThrow();
  });

  it("does not reach for a DOM global anywhere in the source", () => {
    // The runtime check above only covers the paths these tests walk. This
    // one covers the file. Comments are stripped first, since the serialiser
    // says "no `document`, no `XMLSerializer`" in its own header — a naive
    // grep would fail on the promise rather than on a breach of it.
    const sources = [
      "svg/serialize.ts",
      "scene/build.ts",
      "scene/bounds.ts",
      "style.ts",
      "representation.ts",
      "fixtures.ts",
    ];
    for (const relative of sources) {
      const code = stripComments(readFileSync(join(SRC_DIR, relative), "utf8"));
      expect(code, relative).not.toMatch(/\b(document|window)\s*\./);
      expect(code, relative).not.toMatch(/\b(XMLSerializer|createElementNS)\b/);
    }
  });
});

/**
 * Crude comment stripping for the source scan above: block comments, then
 * line comments whose `//` is not part of a URL scheme. It only has to be
 * good enough to stop a prose mention of `document` from failing the test.
 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
