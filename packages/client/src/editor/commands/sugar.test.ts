/**
 * Decision 169's ring-chain commands, driven through the real store.
 *
 * Through the store for the reason `stereo-groups.test.ts` gives: "one undo
 * entry" (decision 104) is a claim about the seam, and only an `undo()` after
 * the command proves it. The molecules are real — the structure dictionary's
 * RDKit-laid-out D-glucose, D-fructose and beta-D-glucopyranose, and
 * chem-core's checked-in methyl alpha-D-glucopyranoside — so a regression
 * reads as a chemistry error. Each product is checked by chem-core's own
 * readings (anomer, series, CIP letter at C1), never by the status line
 * alone, since the line is built from those same readings.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  anomericConfiguration,
  benzene,
  bondBetween,
  carbohydrates,
  carbohydrateSeries,
  cipDescriptor,
  cycliseSugar,
  readMolblock,
  setBondStereo,
  species,
} from "@starter/chem-core";
import type { Anomer, AtomId, Carbohydrate, Molecule, SugarRingForm } from "@starter/chem-core";
import { dictionaryEntryById } from "@starter/chem-core/dictionary";
import { createDocument } from "@starter/shared";

import { guardedOps } from "@/state/chem-guard";
import { createEditorStore } from "@/state";
import type { EditorStore } from "@/state";

import { commandById } from "./registry";
import {
  NO_OPEN_SUGAR_REASON,
  NO_SUGAR_RING_REASON,
  OPEN_RING_ID,
  canCyclise,
  canOpenRing,
  cycliseCommandId,
  cycliseDisabledReason,
  cycliseSelectedSugar,
  cycliseTitle,
  openRingDisabledReason,
  openSelectedSugarRing,
} from "./sugar";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "chem-core",
  "test",
  "fixtures",
);

function fixture(dir: "projection" | "sugar", file: string): Molecule {
  return readMolblock(readFileSync(path.join(FIXTURES, dir, file), "utf8")).molecule;
}

function dictionary(id: string): Molecule {
  const entry = dictionaryEntryById(id);
  if (entry === undefined) throw new Error(`no dictionary entry ${id}`);
  return readMolblock(entry.molblock).molecule;
}

const glucose = (): Molecule => dictionary("aldehydo-d-glucose");
const fructose = (): Molecule => dictionary("keto-d-fructose");

function storeWith(molecule: Molecule): EditorStore {
  return createEditorStore({
    document: createDocument({ molecule, now: "2024-01-01T00:00:00.000Z" }),
    viewportSize: { width: 800, height: 600 },
    now: () => "2024-01-01T00:00:00.000Z",
  });
}

/** The store with ONE atom of the molecule selected: the ordinary click. */
function clickedStore(molecule: Molecule): EditorStore {
  const store = storeWith(molecule);
  store.getState().selectAtoms([molecule.atomIds[3]!]);
  return store;
}

function only(mol: Molecule): Carbohydrate {
  const units = carbohydrates(mol);
  expect(units).toHaveLength(1);
  return units[0]!;
}

function message(store: EditorStore): string | null {
  return store.getState().ui.statusMessage;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cyclising the selected open-chain sugar", () => {
  const CASES: readonly (readonly [
    string,
    () => Molecule,
    SugarRingForm,
    Exclude<Anomer, "mixture">,
    string,
    "R" | "S",
  ])[] = [
    // The CIP letter at the new anomeric carbon is PubChem's for each product,
    // so the anomer is checked by a reading that does not share code with
    // `anomericConfiguration`.
    ["D-glucose", glucose, "pyranose", "alpha", "Closed C1 onto the C5 hydroxyl: α-D-pyranose", "S"],
    ["D-glucose", glucose, "pyranose", "beta", "Closed C1 onto the C5 hydroxyl: β-D-pyranose", "R"],
    ["D-glucose", glucose, "furanose", "alpha", "Closed C1 onto the C4 hydroxyl: α-D-furanose", "S"],
    ["D-fructose", fructose, "pyranose", "beta", "Closed C2 onto the C6 hydroxyl: β-D-pyranose", "R"],
    ["D-fructose", fructose, "furanose", "beta", "Closed C2 onto the C5 hydroxyl: β-D-furanose", "R"],
  ];

  for (const [name, load, form, anomer, line, letter] of CASES) {
    it(`closes ${name} to the ${anomer}-${form} as one undo entry`, () => {
      const store = clickedStore(load());
      const before = store.getState().document;
      const chain = only(before.molecule);
      const entries = store.getState().history.past.length;
      expect(canCyclise(store.getState(), form)).toBe(true);

      commandById(cycliseCommandId(form, anomer)).run(store);

      const mol = store.getState().document.molecule;
      const unit = only(mol);
      expect(unit.form).toBe(form);
      expect(unit.anchor).toBe(chain.anchor);
      expect(anomericConfiguration(mol, unit).kind).toBe(anomer);
      expect(carbohydrateSeries(mol, unit).kind).toBe("D");
      expect(cipDescriptor(mol, unit.anchor)?.kind).toBe(letter);
      expect(message(store)).toBe(line);

      expect(store.getState().history.past.length).toBe(entries + 1);
      expect(store.getState().history.past.at(-1)?.label).toBe(cycliseTitle(form, anomer));
      expect(store.getState().undo()).toBe(true);
      expect(store.getState().document).toBe(before);
    });
  }

  it("draws a mixture as a wavy bond and says so", () => {
    const store = clickedStore(glucose());
    cycliseSelectedSugar(store, "pyranose", "mixture");
    const mol = store.getState().document.molecule;
    const unit = only(mol);
    expect(anomericConfiguration(mol, unit)).toEqual({ kind: "mixture", anomericCarbon: unit.anchor });
    expect(bondBetween(mol, unit.anchor, unit.ring!.anomericSubstituent)?.stereo).toBe("wavy");
    expect(message(store)).toBe("Closed C1 onto the C5 hydroxyl: D-pyranose, α/β mixture");
  });

  it("refuses alpha on a chain whose reference centre is not drawn, and allows the mixture", () => {
    // Every wedge gone: C5's configuration is not stated, so alpha has
    // nothing to be cis to. chem-core refuses and names C5.
    let flat = glucose();
    for (const id of flat.bondIds) flat = setBondStereo(flat, id, "none");
    const c5 = only(flat).backbone[4]!;
    const store = clickedStore(flat);
    const before = store.getState().document;
    const entries = store.getState().history.past.length;

    cycliseSelectedSugar(store, "pyranose", "alpha");

    expect(store.getState().document).toBe(before);
    expect(store.getState().history.past.length).toBe(entries);
    expect(message(store)).toBe(
      "Cyclise refused: α and β are stated against the reference centre, and its configuration " +
        "is not drawn. Draw its wedge or hash, or close the ring as an α/β mixture.",
    );
    expect(store.getState().ui.refusal).toMatchObject({ source: "Cyclise", atomIds: [c5] });
    expect(store.getState().selection.atomIds).toEqual([c5]);

    // The refusal selected C5, which is still in the same structure, so the
    // way out the sentence offers is one row away.
    cycliseSelectedSugar(store, "pyranose", "mixture");
    const mol = store.getState().document.molecule;
    expect(only(mol).form).toBe("pyranose");
    expect(message(store)).toBe("Closed C1 onto the C5 hydroxyl: pyranose, α/β mixture");
    // An edit clears the refusal: its ids described the molecule refused.
    expect(store.getState().ui.refusal).toBeNull();
  });

  it("names and selects what the layout could not clear, rather than hiding it", () => {
    // Real sugars clear every clash (decision 157), so the report is driven
    // through a result that carries some: the real product, with a centre and
    // a clash chem-core could have returned.
    vi.spyOn(guardedOps, "cycliseSugar").mockImplementation((mol, options) => {
      const real = cycliseSugar(mol, options);
      if (real.kind !== "cyclised") return real;
      const [c2, c3] = real.ring.ringAtomIds.slice(2) as [AtomId, AtomId];
      const [b1, b2] = real.molecule.bondIds as [string, string];
      return { ...real, unmarked: [c2], collisions: { atoms: [[c3, real.ring.anomericSubstituent]], bonds: [[b1, b2]] } };
    });
    const store = clickedStore(glucose());
    cycliseSelectedSugar(store, "pyranose", "beta");

    const state = store.getState();
    const unit = only(state.document.molecule);
    const [c2, c3] = unit.ring!.ringAtomIds.slice(2);
    const o1 = unit.ring!.anomericSubstituent;
    const [b1, b2] = state.document.molecule.bondIds;
    expect(message(store)).toBe(
      `Closed C1 onto the C5 hydroxyl: β-D-pyranose. Could not draw the configuration at ${c2}. ` +
        `The new layout could not clear everything: 1 atom pair lies on top of each other (${c3}/${o1}) ` +
        `and 1 pair of bonds crosses (${b1}/${b2}) (selected)`,
    );
    expect(state.selection.atomIds).toEqual([c2, c3, o1]);
    expect(state.selection.bondIds).toEqual([b1, b2]);
    // Still one entry: the report is about the edit, not a second step.
    expect(state.history.past.at(-1)?.label).toBe(cycliseTitle("pyranose", "beta"));
  });

  it("says why a row is off", () => {
    const store = storeWith(glucose());
    expect(cycliseDisabledReason(store.getState(), "pyranose")).toBe(NO_OPEN_SUGAR_REASON);

    const ring = clickedStore(dictionary("beta-d-glucopyranose"));
    expect(cycliseDisabledReason(ring.getState(), "pyranose")).toBe(NO_OPEN_SUGAR_REASON);

    const aromatic = clickedStore(benzene());
    expect(canCyclise(aromatic.getState(), "furanose")).toBe(false);

    // A triose is a sugar, and neither ring fits on its three carbons.
    const triose = clickedStore(fixture("projection", "r-glyceraldehyde.mol"));
    expect(cycliseDisabledReason(triose.getState(), "pyranose")).toBe(
      "No hydroxyl on this sugar's numbered chain closes a six-membered ring (a pyranose).",
    );
    expect(cycliseDisabledReason(triose.getState(), "furanose")).toBe(
      "No hydroxyl on this sugar's numbered chain closes a five-membered ring (a furanose).",
    );
  });

  it("asks for one sugar when the selection spans two, and takes the one clicked", () => {
    const store = storeWith(glucose());
    store.getState().selectAll();
    commandById("edit.duplicate").run(store);
    const copy = store.getState().selection.atomIds;
    store.getState().selectAll();
    expect(cycliseDisabledReason(store.getState(), "pyranose")).toBe(
      "The selection touches 2 open-chain sugars. Select atoms of one of them.",
    );
    store.getState().selectAtoms([copy[0]!]);
    cycliseSelectedSugar(store, "pyranose", "alpha");
    const forms = carbohydrates(store.getState().document.molecule).map((unit) => unit.form);
    expect(forms.sort()).toEqual(["open", "pyranose"]);
  });
});

describe("opening the selected sugar ring", () => {
  it("opens beta-D-glucopyranose to the open chain as one undo entry", () => {
    const store = clickedStore(dictionary("beta-d-glucopyranose"));
    const before = store.getState().document;
    expect(canOpenRing(store.getState())).toBe(true);

    commandById(OPEN_RING_ID).run(store);

    const mol = store.getState().document.molecule;
    const chain = only(mol);
    expect(chain).toMatchObject({ form: "open", parent: "aldose" });
    expect(carbohydrateSeries(mol, chain).kind).toBe("D");
    expect(message(store)).toBe("Opened the pyranose at C1; the C5 hydroxyl is free again");
    expect(store.getState().history.past.at(-1)?.label).toBe("Open sugar ring");
    expect(store.getState().undo()).toBe(true);
    expect(store.getState().document).toBe(before);
  });

  it("refuses a methyl glucoside, says why, and points at the methoxy oxygen", () => {
    const glycoside = fixture("sugar", "methyl-alpha-d-glucopyranoside.mol");
    const methoxy = only(glycoside).ring!.anomericSubstituent;
    const store = clickedStore(glycoside);
    const before = store.getState().document;
    const entries = store.getState().history.past.length;
    expect(canOpenRing(store.getState())).toBe(true);

    openSelectedSugarRing(store);

    expect(store.getState().document).toBe(before);
    expect(store.getState().history.past.length).toBe(entries);
    expect(message(store)).toBe(
      "Open ring refused: this is a glycoside, not a hemiacetal. Its anomeric carbon carries an OR, " +
        "NR or SR group instead of an OH, and opening it would mean deleting the aglycone.",
    );
    expect(store.getState().ui.refusal).toMatchObject({ source: "Open ring", atomIds: [methoxy] });
    expect(store.getState().selection.atomIds).toEqual([methoxy]);
  });

  it("is off with nothing selected and on an open chain", () => {
    expect(openRingDisabledReason(storeWith(glucose()).getState())).toBe(NO_SUGAR_RING_REASON);
    expect(openRingDisabledReason(clickedStore(glucose()).getState())).toBe(NO_SUGAR_RING_REASON);
  });
});

describe("the mutarotation figure (decision 104)", () => {
  it("is the chain duplicated twice, one copy closed alpha and one beta: three species", () => {
    const store = storeWith(glucose());
    store.getState().selectAll();
    commandById("edit.duplicate").run(store);
    const first = store.getState().selection.atomIds;
    commandById("edit.duplicate").run(store);

    // The second copy is selected after the duplicate; close it beta.
    commandById(cycliseCommandId("pyranose", "beta")).run(store);
    // One click on the first copy is enough to close it alpha.
    store.getState().selectAtoms([first[0]!]);
    commandById(cycliseCommandId("pyranose", "alpha")).run(store);

    const mol = store.getState().document.molecule;
    expect(species(mol)).toHaveLength(3);
    const readings = carbohydrates(mol)
      .map((unit) => `${unit.form}:${anomericConfiguration(mol, unit).kind}`)
      .sort();
    expect(readings).toEqual(["open:notApplicable", "pyranose:alpha", "pyranose:beta"]);
    for (const unit of carbohydrates(mol)) expect(carbohydrateSeries(mol, unit).kind).toBe("D");

    // Selecting the whole figure still means the one open chain: the rings
    // are not open-chain sugars, so the row stays on.
    store.getState().selectAll();
    expect(canCyclise(store.getState(), "furanose")).toBe(true);
    // Each closure was its own step.
    expect(store.getState().undo()).toBe(true);
    expect(store.getState().undo()).toBe(true);
    expect(carbohydrates(store.getState().document.molecule).map((unit) => unit.form)).toEqual([
      "open",
      "open",
      "open",
    ]);
  });
});
