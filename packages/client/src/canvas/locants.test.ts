/**
 * The document's locants on the canvas and in the exported file (decision
 * 168): one numbering, `atomNumbering(doc.molecule, doc.locants)`, read by
 * both, so a number cannot be on screen and missing from the figure, or the
 * reverse (decision 21).
 *
 * Real molecules, so a regression reads as a chemistry error: open-chain
 * D-glucose (C1 the aldehyde, to C6), beta-D-glucopyranose (the ring carbons
 * C1 to C5 and C6), adenosine (a nucleoside's sugar is primed, 1′ to 5′, and
 * the purine is not numbered at all) and L-cysteine (C1 the carboxyl, C2 the
 * alpha carbon, C3 the CH2SH).
 *
 * "The same locants" is asserted at the SAME style. The export defaults to
 * Publication (decision 50), where the 10 pt atom labels leave some locants
 * no slot that keeps clear of their ink, and those are dropped (decision 58)
 * on the canvas and in the file alike: the Publication cases below check the
 * file draws exactly what a Publication canvas draws, and never a number the
 * canvas does not give that atom.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  addAtom,
  alphaAminoAcids,
  benzene,
  carbohydrates,
  readMolblock,
  setAtomPositions,
  sugarPerceptionComputationCount,
} from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";
import { dictionaryEntryById } from "@starter/chem-core/dictionary";
import { createDocument, defaultPanelsFor } from "@starter/shared";
import type { Panel, SketchDocument, StylePresetId } from "@starter/shared";
import { describe, expect, it } from "vitest";

import { figureSvgForFile, prepareFigure } from "@/lib/export/figure";
import type { FigureExportSettings } from "@/state/types";

import {
  buildDocumentScene,
  canvasAnnotatedScene,
  documentNumbering,
  documentNumbersAtoms,
} from "./scene-bridge";

const NOW = "2024-01-01T00:00:00.000Z";

function dictionaryMolecule(id: string): Molecule {
  return readMolblock(dictionaryEntryById(id)!.molblock).molecule;
}

/** chem-core's own checked-in fixture, which RDKit made from PubChem's SMILES. */
function adenosine(): Molecule {
  const path = join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "chem-core",
    "test",
    "fixtures",
    "projection",
    "adenosine.mol",
  );
  return readMolblock(readFileSync(path, "utf8")).molecule;
}

function withLocantsShown(panel: Panel, show = true): Panel {
  return {
    ...panel,
    representation: {
      ...panel.representation,
      display: { ...panel.representation.display, showLocants: show },
    },
  };
}

/** The default panels (skeletal, sum formula), skeletal with locants on. */
function numberedDoc(
  molecule: Molecule,
  options: {
    readonly stylePreset?: StylePresetId;
    readonly locants?: Readonly<Record<AtomId, string>>;
    readonly show?: boolean;
  } = {},
): SketchDocument {
  const stylePreset = options.stylePreset ?? "screen";
  const [skeletal, sum] = defaultPanelsFor(stylePreset);
  return createDocument({
    molecule,
    stylePreset,
    panels: [withLocantsShown(skeletal!, options.show ?? true), sum!],
    locants: options.locants,
    now: NOW,
  });
}

/** Each locant the canvas draws, by atom. */
function canvasLocants(doc: SketchDocument): Record<AtomId, string> {
  const drawn: Record<AtomId, string> = {};
  for (const primitive of canvasAnnotatedScene(doc, null).scene.primitives) {
    if (primitive.type !== "textRun" || primitive.source.kind !== "atom") continue;
    if (!primitive.id.endsWith(":locant")) continue;
    drawn[primitive.source.atomId] = primitive.spans.map((span) => span.text).join("");
  }
  return drawn;
}

/** Each locant the exported SVG file's skeletal panel draws, by atom. */
function exportedLocants(doc: SketchDocument, style: FigureExportSettings["style"]): Record<AtomId, string> {
  const prepared = prepareFigure(doc, { width: "double", customWidthCm: 12, dpi: 300, style, pngBackground: "white" });
  if (!prepared.ok) throw new Error(prepared.message);
  const svg = figureSvgForFile(prepared.value);
  const drawn: Record<AtomId, string> = {};
  const pattern = /<text id="p-panel-skeletal\.atom:[^"]+:locant" data-atom="([^"]+)"[^>]*><tspan>([^<]*)<\/tspan>/g;
  for (const [, atomId, text] of svg.matchAll(pattern)) drawn[atomId!] = text!;
  return drawn;
}

/** A locant map keyed by the atoms of `backbone`, in order from `first`. */
function numberedFrom(backbone: readonly AtomId[], labels: readonly string[]): Record<AtomId, string> {
  return Object.fromEntries(backbone.map((atomId, i) => [atomId, labels[i]!]));
}

describe("the document's locants on the canvas and in the file (decision 168)", () => {
  it("numbers open-chain D-glucose C1 to C6 from the aldehyde, on screen and in the file", () => {
    const molecule = dictionaryMolecule("aldehydo-d-glucose");
    const [unit] = carbohydrates(molecule);
    const expected = numberedFrom(unit!.backbone, ["1", "2", "3", "4", "5", "6"]);
    // C1 is the aldehyde carbon: the one double-bonded to an oxygen.
    const c1 = unit!.backbone[0]!;
    expect(
      molecule.bondIds.some((id) => {
        const bond = molecule.bonds[id]!;
        const other = bond.from === c1 ? bond.to : bond.to === c1 ? bond.from : undefined;
        return other !== undefined && bond.order === 2 && molecule.atoms[other]!.element === "O";
      }),
    ).toBe(true);

    const doc = numberedDoc(molecule);
    expect(canvasLocants(doc)).toEqual(expected);
    expect(exportedLocants(doc, "canvas")).toEqual(expected);
  });

  it("numbers beta-D-glucopyranose's ring carbons and C6", () => {
    const molecule = dictionaryMolecule("beta-d-glucopyranose");
    const [unit] = carbohydrates(molecule);
    expect(unit!.form).not.toBe("open");
    const expected = numberedFrom(unit!.backbone, ["1", "2", "3", "4", "5", "6"]);
    // C1 is the anomeric carbon, the one bonded to the ring oxygen.
    expect(unit!.backbone[0]).toBe(unit!.ring!.anomericCarbon);

    const doc = numberedDoc(molecule);
    expect(canvasLocants(doc)).toEqual(expected);
    expect(exportedLocants(doc, "canvas")).toEqual(expected);
  });

  it("primes adenosine's ribose 1′ to 5′ and leaves the purine unnumbered", () => {
    const molecule = adenosine();
    const [unit] = carbohydrates(molecule);
    expect(unit!.primed).toBe(true);
    const expected = numberedFrom(unit!.backbone, ["1′", "2′", "3′", "4′", "5′"]);
    // C1′ carries the base: its anomeric substituent is the purine's N9.
    expect(unit!.backbone[0]).toBe(unit!.ring!.anomericCarbon);
    expect(molecule.atoms[unit!.ring!.anomericSubstituent]!.element).toBe("N");

    const doc = numberedDoc(molecule);
    expect(canvasLocants(doc)).toEqual(expected);
    expect(exportedLocants(doc, "canvas")).toEqual(expected);
  });

  it("numbers L-cysteine from its carboxyl carbon", () => {
    const molecule = dictionaryMolecule("l-cysteine");
    const [unit] = alphaAminoAcids(molecule);
    expect(unit!.backbone[0]).toBe(unit!.carboxylCarbon);
    expect(unit!.backbone[1]).toBe(unit!.alphaCarbon);
    const expected = numberedFrom(unit!.backbone, ["1", "2", "3"]);

    const doc = numberedDoc(molecule);
    expect(canvasLocants(doc)).toEqual(expected);
    expect(exportedLocants(doc, "canvas")).toEqual(expected);
  });

  it("puts in the Publication file exactly the locants a Publication canvas draws", () => {
    // The file's default style (decision 50). Some locants are dropped there,
    // and the file drops the same ones: it never prints a number the canvas
    // does not give that atom, and never loses one the canvas draws.
    for (const molecule of [
      dictionaryMolecule("aldehydo-d-glucose"),
      dictionaryMolecule("beta-d-glucopyranose"),
      adenosine(),
      dictionaryMolecule("l-cysteine"),
    ]) {
      const onPublication = canvasLocants(numberedDoc(molecule, { stylePreset: "publication" }));
      expect(Object.keys(onPublication).length).toBeGreaterThan(0);
      const numbering = documentNumbering(numberedDoc(molecule)).locants;
      for (const [atomId, text] of Object.entries(onPublication)) expect(numbering[atomId]).toBe(text);
      // A Screen document exported at Publication, and a Publication one
      // exported as shown: the same drawing.
      expect(exportedLocants(numberedDoc(molecule), "publication")).toEqual(onPublication);
      expect(exportedLocants(numberedDoc(molecule, { stylePreset: "publication" }), "canvas")).toEqual(
        onPublication,
      );
    }
  });

  it("draws an explicit locant in place of the derived one, and hides one set to empty", () => {
    const molecule = dictionaryMolecule("aldehydo-d-glucose");
    const [c1, c2, ...rest] = carbohydrates(molecule)[0]!.backbone;
    const doc = numberedDoc(molecule, { locants: { [c1!]: "1*", [c2!]: "" } });
    const expected = {
      [c1!]: "1*",
      ...numberedFrom(rest, ["3", "4", "5", "6"]),
    };
    expect(canvasLocants(doc)).toEqual(expected);
    expect(exportedLocants(doc, "canvas")).toEqual(expected);
  });

  it("draws nothing while the panel's flag is off, in either place", () => {
    const doc = numberedDoc(dictionaryMolecule("aldehydo-d-glucose"), { show: false });
    expect(documentNumbersAtoms(doc)).toBe(true);
    expect(canvasLocants(doc)).toEqual({});
    expect(exportedLocants(doc, "canvas")).toEqual({});
  });

  it("gives the library thumbnail the same locants as the canvas", () => {
    const doc = numberedDoc(dictionaryMolecule("l-cysteine"));
    const thumbnail = buildDocumentScene(doc).primitives.filter((p) => p.id.endsWith(":locant"));
    const canvas = canvasAnnotatedScene(doc, null).scene.primitives.filter((p) => p.id.endsWith(":locant"));
    expect(thumbnail).toEqual(canvas);
    expect(thumbnail).toHaveLength(3);
  });
});

describe("documentNumbering", () => {
  it("is one object per document, so the scene, the export and the toggle share it", () => {
    const doc = numberedDoc(dictionaryMolecule("aldehydo-d-glucose"));
    expect(documentNumbering(doc)).toBe(documentNumbering(doc));
  });

  it("reads the whole document: a numbered sugar beside benzene still numbers atoms", () => {
    expect(documentNumbersAtoms(numberedDoc(benzene()))).toBe(false);
    expect(documentNumbersAtoms(numberedDoc(dictionaryMolecule("l-cysteine")))).toBe(true);
    // An explicit empty string hides the only locants there are.
    const cysteine = dictionaryMolecule("l-cysteine");
    const hidden = Object.fromEntries(alphaAminoAcids(cysteine)[0]!.backbone.map((id) => [id, ""]));
    expect(documentNumbersAtoms(numberedDoc(cysteine, { locants: hidden }))).toBe(false);
  });

  it("does not re-run sugar perception on a drag frame", () => {
    // Every pointer move commits a new document with a new molecule, so the
    // per-document memo misses by design; the chain rules underneath are
    // memoised on the topology, which a drag keeps.
    const doc = numberedDoc(dictionaryMolecule("aldehydo-d-glucose"));
    const before = canvasLocants(doc);
    const runs = sugarPerceptionComputationCount();
    const atomId = doc.molecule.atomIds[0]!;
    let frame = doc;
    for (let i = 1; i <= 5; i += 1) {
      const { x, y } = frame.molecule.atoms[atomId]!.pos;
      frame = { ...frame, molecule: setAtomPositions(frame.molecule, [[atomId, { x: x + 0.05, y: y + 0.05 }]]) };
      expect(canvasLocants(frame)).toEqual(before);
    }
    expect(sugarPerceptionComputationCount()).toBe(runs);
  });

  it("is not computed for a scene whose panel does not draw locants", () => {
    // A topology no other test has seen, so a perception run would show.
    const glucose = dictionaryMolecule("aldehydo-d-glucose");
    const { molecule } = addAtom(glucose, { element: "C", pos: { x: 40, y: 40 } });
    const runs = sugarPerceptionComputationCount();
    canvasAnnotatedScene(numberedDoc(molecule, { show: false }), null);
    expect(sugarPerceptionComputationCount()).toBe(runs);
    canvasAnnotatedScene(numberedDoc(molecule), null);
    expect(sugarPerceptionComputationCount()).toBe(runs + 1);
  });
});
