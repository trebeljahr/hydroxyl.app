/**
 * The planned-projection list is copy, not a view kind — and must stop being
 * listed the day its projection ships.
 *
 * Decision 128 made a projection an axis orthogonal to the view kind, stored
 * in `Panel.view`, so "is it a view kind yet?" can no longer say when a
 * projection has shipped: it never becomes one. What these tests hold instead
 * is that each entry names a template chem-core really lists, that together
 * they account for every listed template, and (in `FigurePanelChooser.test.tsx`)
 * that no control of the chooser can store a view yet.
 */

import { describe, expect, it } from "vitest";

import { FRAME_KINDS, PROJECTION_TEMPLATES } from "@starter/chem-core";
import { VIEW_KIND_TITLES } from "@starter/chem-render";
import { VIEW_KINDS } from "@starter/shared";

import { PLANNED_PROJECTIONS, PLANNED_PROJECTION_REASON } from "./planned-projections";

/**
 * Templates chem-core lists that are deliberately NOT offered as a picture of
 * their own, with why. Every other listed template must be planned (or, once
 * it ships, offered by the chooser and removed from both lists).
 */
const NOT_A_PICTURE_OF_ITS_OWN: Readonly<Record<string, string>> = {
  "planar/wedgeDash": "the plain drawing every structural panel already is",
  "planar/steroid": "a marking convention on the planar frame, not a separate picture",
  "annotationOverlay/torsion": "labels laid on the drawing, not a redrawing of it",
};

describe("PLANNED_PROJECTIONS", () => {
  it("names the seven projections the epic plans, once each", () => {
    expect(PLANNED_PROJECTIONS.map((p) => p.title)).toEqual([
      "Fischer",
      "Haworth",
      "Chair",
      "Newman",
      "Sawhorse",
      "Natta",
      "Mills",
    ]);
    const ids = PLANNED_PROJECTIONS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names, for each, a template chem-core lists, and no two the same", () => {
    const stored = PLANNED_PROJECTIONS.map((p) => `${p.stored.kind}/${p.stored.template}`);
    expect(new Set(stored).size).toBe(stored.length);
    for (const planned of PLANNED_PROJECTIONS) {
      const listed: readonly string[] = PROJECTION_TEMPLATES[planned.stored.kind];
      expect(listed, planned.id).toContain(planned.stored.template);
      // The id is the template's own name, so a test hook and the document
      // value never drift apart.
      expect(planned.stored.template, planned.id).toBe(planned.id);
    }
  });

  it("accounts for every template chem-core lists: planned, or left out with a reason", () => {
    const planned = new Set(PLANNED_PROJECTIONS.map((p) => `${p.stored.kind}/${p.stored.template}`));
    const listed = FRAME_KINDS.flatMap((kind) =>
      PROJECTION_TEMPLATES[kind].map((template) => `${kind}/${template}`),
    );
    for (const key of listed) {
      const accounted = planned.has(key) || Object.hasOwn(NOT_A_PICTURE_OF_ITS_OWN, key);
      expect(accounted, `${key} is neither planned nor left out on purpose`).toBe(true);
      expect(planned.has(key) && Object.hasOwn(NOT_A_PICTURE_OF_ITS_OWN, key), key).toBe(false);
    }
    for (const key of Object.keys(NOT_A_PICTURE_OF_ITS_OWN)) {
      expect(listed, key).toContain(key);
    }
  });

  it("is never a view kind: a projection is an axis beside the kind (decision 128)", () => {
    const kinds: readonly string[] = VIEW_KINDS;
    const titles = Object.values(VIEW_KIND_TITLES).map((t) => t.toLowerCase());
    for (const planned of PLANNED_PROJECTIONS) {
      expect(kinds, planned.id).not.toContain(planned.id);
      expect(titles, planned.title).not.toContain(planned.title.toLowerCase());
    }
  });

  it("says what each one draws, in one sentence, and why none can be picked", () => {
    for (const planned of PLANNED_PROJECTIONS) {
      expect(planned.shows, planned.id).toMatch(/^[A-Z].+\.$/);
      expect(planned.shows.split(/\.\s/), planned.id).toHaveLength(1);
    }
    expect(PLANNED_PROJECTION_REASON).toMatch(/not built yet/i);
    // The engine exists now (it draws a Fischer); what is missing is the
    // editor's side, and the reason must not claim otherwise.
    expect(PLANNED_PROJECTION_REASON).not.toMatch(/engine/i);
  });
});
