/**
 * Proof that the client can actually consume @starter/chem-render.
 *
 * The package's own suite runs against `src/`, so it would stay green even if
 * the built artefact were unusable from here — a missing `exports` entry, a
 * `.js` extension left off a relative import under NodeNext, a type that only
 * resolves inside the package. Those all surface as a Next build failure much
 * later and much less legibly. This test imports the package the way the app
 * does, from its built `dist/`, and asserts on the output.
 *
 * It runs in jsdom, which matters too: the renderer is supposed to be
 * DOM-free, but "does not need a DOM" and "breaks when one is present" are
 * different claims, and only this side of the workspace can check the second.
 */

import { describe, expect, it } from "vitest";

import { benzene, molecularFormula } from "@starter/chem-core";
import {
  buildScene,
  PUBLICATION_STYLE,
  representation,
  SCREEN_STYLE,
  serializeScene,
} from "@starter/chem-render";
import type { RenderStyle } from "@starter/chem-render";

describe("@starter/chem-render from the client", () => {
  it("renders benzene to SVG", () => {
    const scene = buildScene(
      benzene(),
      PUBLICATION_STYLE,
      representation("skeletal"),
    );

    expect(molecularFormula(benzene())).toBe("C6H6");
    // Six lines for six ring bonds: skeletal defaults to the inscribed
    // circle, which replaces the Kekulé alternation's second lines rather
    // than being drawn over them.
    expect(scene.primitives.filter((p) => p.type === "line")).toHaveLength(6);

    const svg = serializeScene(scene, { standalone: false });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('data-bond="b7"');
    expect(svg.match(/<line /g)).toHaveLength(6);
    // The publication style is transparent by design, so nothing dropped into
    // a page brings its own white block with it.
    expect(svg).not.toContain("<rect");
  });

  it("scales with the style rather than with anything the client does", () => {
    // The editor viewport will do pan and zoom on top of this. It must never
    // re-derive the bond length — the style already did, once.
    const mol = benzene();
    const kind = representation("skeletal");
    const small = buildScene(mol, PUBLICATION_STYLE, kind);
    const large = buildScene(mol, SCREEN_STYLE, kind);

    // The margin and the placeholder dot radius are absolute px and do not
    // scale with the bond length, so they come off before the comparison.
    // What is left is pure molecular geometry, and it must scale by exactly
    // the bondLengthPx ratio.
    const span = (
      bounds: { width: number },
      style: RenderStyle,
    ): number => bounds.width - 2 * style.marginPx - 2 * style.atomDotRadiusPx;

    expect(span(large.bounds, SCREEN_STYLE)).toBeCloseTo(
      span(small.bounds, PUBLICATION_STYLE) *
        (SCREEN_STYLE.bondLengthPx / PUBLICATION_STYLE.bondLengthPx),
      9,
    );
  });
});
