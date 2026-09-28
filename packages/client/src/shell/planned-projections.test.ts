/**
 * The planned-projection list is copy, not a view kind — and must stop being
 * listed the day its projection ships.
 */

import { describe, expect, it } from "vitest";

import { VIEW_KIND_TITLES } from "@starter/chem-render";
import { VIEW_KINDS } from "@starter/shared";

import { PLANNED_PROJECTIONS, PLANNED_PROJECTION_REASON } from "./planned-projections";

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

  it("offers nothing that is already a real view", () => {
    // When a projection lands as a view kind, its planned entry must go, or
    // the chooser offers it twice: once live and once as "not built yet".
    const kinds: readonly string[] = VIEW_KINDS;
    const titles = Object.values(VIEW_KIND_TITLES).map((t) => t.toLowerCase());
    for (const planned of PLANNED_PROJECTIONS) {
      expect(kinds, planned.id).not.toContain(planned.id);
      expect(titles, planned.title).not.toContain(planned.title.toLowerCase());
    }
  });

  it("says what each one draws, in one sentence", () => {
    for (const planned of PLANNED_PROJECTIONS) {
      expect(planned.shows, planned.id).toMatch(/^[A-Z].+\.$/);
      expect(planned.shows.split(/\.\s/), planned.id).toHaveLength(1);
    }
    expect(PLANNED_PROJECTION_REASON).toMatch(/not built yet/i);
  });
});
