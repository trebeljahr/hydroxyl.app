/**
 * A panel's projection view (decisions 128, 162): stored canonical, decoded
 * strictly, and allowed to go stale without breaking the document.
 *
 * Every molecule here is a real one read from chem-core's structure
 * dictionary — aldehydo-D-glucose, beta-D-glucopyranose, cholesterol — so a
 * failure reads as "the Fischer of glucose changed", not as a graph error.
 * Where a test asserts that two views draw the same picture, it first asserts
 * that the picture states something: the centres resolve to R or S and
 * nothing is unplaced, or a layout that stated nothing would pass.
 */

import {
  FRAME_KINDS,
  PROJECTION_TEMPLATES,
  carbohydrates,
  descriptorFromConfig,
  project,
  readMolblock,
  readProjection,
  removeAtoms,
  resolveProjectionFrame,
  rings,
  stereoConfig,
  stereoDisagreements,
  suggestSteroidSkeleton,
  sugarRings,
  type AtomId,
  type ChainView,
  type Molecule,
  type ProjectedLayout,
  type ProjectionView,
  type RingView,
  type SightedBondView,
} from "@starter/chem-core";
import { dictionaryEntryById } from "@starter/chem-core/dictionary";
import { projectedViewAvailability } from "@starter/chem-render";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CHAIN_TOP_VALUES,
  DOCUMENT_UPGRADES,
  RING_CONFORMER_FORMS,
  RING_FACE_VALUES,
  SCHEMA_VERSION,
  assembleProjectionView,
  createDocument,
  decodeDocument,
  defaultRepresentation,
  encodeDocument,
  isFromNewerBuild,
  panelWithView,
  projectionViewSchema,
  projectionViewsEqual,
  prunePanelViews,
  safeDecodeDocument,
  type Panel,
  type RepresentationKind,
  type SketchDocument,
} from "./document.js";

const NOW = "2024-03-01T12:00:00.000Z";

function dictionaryMolecule(id: string): Molecule {
  const entry = dictionaryEntryById(id);
  if (entry === undefined) throw new Error(`no dictionary entry ${id}`);
  return readMolblock(entry.molblock).molecule;
}

/** aldehydo-D-glucose: C1 a6 (the CHO), C2 a5, C3 a4, C4 a3, C5 a2, C6 a1. */
const glucose = (): Molecule => dictionaryMolecule("aldehydo-d-glucose");
const glucopyranose = (): Molecule => dictionaryMolecule("beta-d-glucopyranose");
const cholesterol = (): Molecule => dictionaryMolecule("cholesterol");

/** The glucose backbone as sugar perception numbers it: C1 first. */
function glucoseBackbone(mol: Molecule): readonly AtomId[] {
  const unit = carbohydrates(mol)[0];
  if (unit === undefined || unit.firstLocant !== 1) throw new Error("glucose did not number");
  return unit.backbone;
}

function fischerOf(mol: Molecule): ChainView {
  return {
    kind: "chain",
    template: "fischer",
    frame: { backbone: glucoseBackbone(mol) },
    params: { top: "first" },
  };
}

/** Newman down glucose's C2–C3 bond, each end's reference its hydroxyl O. */
function newmanOfC2C3(torsionDeg: number, rollDeg = 0): SightedBondView {
  return {
    kind: "sightedBond",
    template: "newman",
    frame: { front: "a5", back: "a4", frontReference: "a8", backReference: "a9" },
    params: { torsionDeg, rollDeg },
  };
}

function pyranoseRing(mol: Molecule): readonly AtomId[] {
  const perceived = sugarRings(mol)[0];
  if (perceived?.kind !== "sugarRing") throw new Error("glucopyranose ring not perceived");
  return perceived.ring.ringAtomIds;
}

function chairOf(mol: Molecule, frontAtomId: AtomId): RingView {
  const ring = pyranoseRing(mol);
  return {
    kind: "ring",
    template: "chair",
    frame: { ringAtomIds: ring, referenceAtomId: ring[1]! },
    params: { face: "back", conformer: { form: "chair", frontAtomId } },
  };
}

function panel(id: string, kind: RepresentationKind, view?: ProjectionView): Panel {
  const plain: Panel = { id, representation: defaultRepresentation(kind) };
  return view === undefined ? plain : panelWithView(plain, view);
}

function documentWith(molecule: Molecule, panels: readonly Panel[]): SketchDocument {
  return createDocument({ id: "doc-views", title: "views", molecule, panels, now: NOW });
}

/** Aldehydo-D-glucose with one panel of every frame kind but the ring. */
function glucoseDocument(): SketchDocument {
  const mol = glucose();
  return documentWith(mol, [
    panel("panel-plain", "skeletal"),
    panel("panel-fischer", "skeletal", fischerOf(mol)),
    panel("panel-fischer-h", "explicitH", { ...fischerOf(mol), params: { top: "last" } }),
    panel("panel-newman", "skeletal", newmanOfC2C3(60, 15)),
    panel("panel-planar", "kekule", {
      kind: "planar",
      template: "wedgeDash",
      frame: {},
      params: { rotationDeg: 90, mirror: true },
    }),
    panel("panel-torsions", "skeletal", {
      kind: "annotationOverlay",
      template: "torsion",
      frame: { bondIds: ["b17", "b16", "b15", "b14", "b13"] },
      params: {},
    }),
  ]);
}

/** beta-D-glucopyranose with a Haworth and a pinned chair. */
function pyranoseDocument(): SketchDocument {
  const mol = glucopyranose();
  const ring = pyranoseRing(mol);
  return documentWith(mol, [
    panel("panel-haworth", "skeletal", {
      kind: "ring",
      template: "haworth",
      frame: { ringAtomIds: ring },
      params: { face: "front" },
    }),
    panel("panel-chair", "explicitH", chairOf(mol, ring[1]!)),
  ]);
}

function roundTrip(doc: SketchDocument): SketchDocument {
  return decodeDocument(JSON.parse(JSON.stringify(encodeDocument(doc))));
}

function encoded(doc: SketchDocument): Record<string, any> {
  return JSON.parse(JSON.stringify(encodeDocument(doc))) as Record<string, any>;
}

function undefinedValuedPaths(value: unknown, path = "$"): string[] {
  const found: string[] = [];
  const visit = (node: unknown, at: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${at}[${index}]`));
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const key of Object.keys(node)) {
      const child = (node as Record<string, unknown>)[key];
      if (child === undefined) found.push(`${at}.${key}`);
      else visit(child, `${at}.${key}`);
    }
  };
  visit(value, path);
  return found;
}

function viewOf(doc: SketchDocument, id: string): ProjectionView {
  const found = doc.panels.find((p) => p.id === id)?.view;
  if (found === undefined) throw new Error(`panel ${id} has no view`);
  return found;
}

function layoutOf(mol: Molecule, view: ProjectionView): ProjectedLayout {
  const result = project(mol, stereoConfig(mol), view);
  if (result.kind !== "available") throw new Error(`not available: ${JSON.stringify(result)}`);
  return result.layout;
}

/** R/S per centre the layout states, read back from the layout's own geometry. */
function lettersReadBack(mol: Molecule, layout: ProjectedLayout): Record<AtomId, string> {
  const read = readProjection(mol, layout);
  if (read.kind !== "read") throw new Error(`read refused: ${read.reason}`);
  const out: Record<AtomId, string> = {};
  for (const centre of read.config.centres) {
    out[centre.atomId] = descriptorFromConfig(mol, centre, read.config)?.kind ?? "none";
  }
  return out;
}

describe("a panel's projection view round-trips (decision 162)", () => {
  it("keeps every frame kind with every optional key, and a decoded document equals itself", () => {
    for (const original of [glucoseDocument(), pyranoseDocument()]) {
      const decoded = roundTrip(original);
      expect(decoded).toEqual(original);
      expect(roundTrip(decoded)).toEqual(decoded);
      expect(JSON.stringify(encodeDocument(decoded))).toBe(JSON.stringify(encodeDocument(original)));
      expect(undefinedValuedPaths(decoded)).toEqual([]);
      expect(undefinedValuedPaths(encodeDocument(decoded))).toEqual([]);
    }
    const doc = roundTrip(glucoseDocument());
    // The plain panel has no key at all, not one holding undefined.
    expect(Object.hasOwn(doc.panels[0]!, "view")).toBe(false);
    // The optional references survived: a stored reference is the whole point
    // of storing it, since CIP-derived ones spin when a bromine is added.
    expect(viewOf(doc, "panel-newman")).toEqual(newmanOfC2C3(60, 15));
    const chair = viewOf(roundTrip(pyranoseDocument()), "panel-chair");
    expect(chair.kind === "ring" && chair.params.conformer).toEqual({ form: "chair", frontAtomId: "a6" });
    expect(chair.kind === "ring" && chair.frame.referenceAtomId).toBe("a6");
  });

  it("draws the same Fischer of D-glucose after the round trip, stating all four centres", () => {
    const original = glucoseDocument();
    const decoded = roundTrip(original);
    const mol = decoded.molecule;
    const before = layoutOf(original.molecule, viewOf(original, "panel-fischer"));
    const after = layoutOf(mol, viewOf(decoded, "panel-fischer"));
    // Non-vacuous first: every centre of the backbone is placed and reads a
    // letter, (2R,3S,4R,5R) — D-glucose — off the layout's own geometry.
    expect(after.unplaced).toEqual([]);
    expect(after.coverage.centres).toEqual(["a2", "a3", "a4", "a5"]);
    expect(lettersReadBack(mol, after)).toEqual({ a2: "R", a3: "R", a4: "S", a5: "R" });
    const read = readProjection(mol, after);
    if (read.kind !== "read") throw new Error(`read refused: ${read.reason}`);
    expect(stereoDisagreements(stereoConfig(mol), read.config, after.coverage)).toEqual([]);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});

describe("an accepted steroid skeleton round-trips (decision 163)", () => {
  function acceptedSteroidView(mol: Molecule): ProjectionView {
    const suggestion = suggestSteroidSkeleton(mol);
    if (suggestion.kind !== "match") throw new Error(`cholesterol was not suggested: ${suggestion.kind}`);
    return {
      kind: "planar",
      template: "steroid",
      frame: {},
      params: { rotationDeg: 0, mirror: false, skeleton: suggestion.skeleton },
    };
  }

  it("keeps the core in locant order and draws the same alpha/beta labels after the round trip", () => {
    const mol = cholesterol();
    const view = acceptedSteroidView(mol);
    const core = view.kind === "planar" ? view.params.skeleton!.core : [];
    // Non-vacuous: the core is 17 atoms in LOCANT order, which is not the
    // sorted order a set would be stored in, so a codec that sorted it fails.
    expect(core).toHaveLength(17);
    expect([...core].sort()).not.toEqual([...core]);
    const original = documentWith(mol, [panel("panel-steroid", "skeletal", view)]);
    const decoded = roundTrip(original);
    expect(decoded).toEqual(original);
    expect(undefinedValuedPaths(encodeDocument(decoded))).toEqual([]);
    const stored = viewOf(decoded, "panel-steroid");
    expect(stored.kind === "planar" && stored.params.skeleton).toEqual({ name: "steroid", core });
    const before = layoutOf(original.molecule, viewOf(original, "panel-steroid"));
    const after = layoutOf(decoded.molecule, stored);
    // Cholesterol states 3beta-OH, 10beta- and 13beta-methyl at least.
    expect(after.faceLabels.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it("refuses a skeleton this build does not name and a number where a core atom goes", () => {
    const mol = cholesterol();
    const doc = documentWith(mol, [panel("panel-steroid", "skeletal", acceptedSteroidView(mol))]);
    const cases: ((skeleton: Record<string, any>) => void)[] = [
      (skeleton) => (skeleton.name = "hopane"),
      (skeleton) => (skeleton.core = [0, ...skeleton.core.slice(1)]),
      (skeleton) => (skeleton.extra = true),
    ];
    for (const breakIt of cases) {
      const raw = encoded(doc);
      breakIt(raw.panels[0].view.params.skeleton);
      expect(safeDecodeDocument(raw).ok, String(breakIt)).toBe(false);
    }
  });
});

describe("angles are canonical", () => {
  it("stores 370 as 10 and -60 as 300, on assemble and on decode", () => {
    const at = (torsionDeg: number, rollDeg: number): Panel =>
      panel("panel-newman", "skeletal", newmanOfC2C3(torsionDeg, rollDeg));
    expect(at(370, -60)).toEqual(at(10, 300));
    expect(at(-300, 720)).toEqual(at(60, 0));
    expect(at(-0, 360).view).toEqual(newmanOfC2C3(0, 0));
    expect(Object.is((at(-0, 0).view as SightedBondView).params.torsionDeg, 0)).toBe(true);

    // A hand-written file: the angles open canonical.
    const file = encoded(glucoseDocument());
    const newman = file.panels.find((p: { id: string }) => p.id === "panel-newman");
    newman.view.params = { torsionDeg: 420, rollDeg: -345 };
    const planar = file.panels.find((p: { id: string }) => p.id === "panel-planar");
    planar.view.params.rotationDeg = -270;
    const decoded = decodeDocument(file);
    expect(viewOf(decoded, "panel-newman")).toEqual(newmanOfC2C3(60, 15));
    expect(viewOf(decoded, "panel-planar")).toEqual(viewOf(glucoseDocument(), "panel-planar"));
    expect(decoded).toEqual(glucoseDocument());
  });

  it("draws cholesterol rotated by 370 exactly as by 10, every centre still lettered", () => {
    const turned = (rotationDeg: number): ProjectionView => ({
      kind: "planar",
      template: "wedgeDash",
      frame: {},
      params: { rotationDeg, mirror: false },
    });
    // The RAW angles, each on its own reading of cholesterol: the engine's
    // result cache is per molecule instance, so neither layout is the other
    // one fetched back, and only the engine's own canonical angle makes them
    // byte-identical. Turned by 370° and by 10° as floating-point rotations,
    // they would differ in the last bits.
    const mol = cholesterol();
    const a = layoutOf(mol, turned(370));
    const b = layoutOf(cholesterol(), turned(10));
    expect(a.unplaced).toEqual([]);
    const letters = lettersReadBack(mol, a);
    expect(Object.keys(letters)).toHaveLength(8);
    expect(Object.values(letters).every((l) => l === "R" || l === "S")).toBe(true);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Turned 11°, the picture does move: the comparison can fail.
    expect(JSON.stringify(layoutOf(cholesterol(), turned(11)))).not.toBe(JSON.stringify(b));
    expect(projectionViewsEqual(turned(370), turned(10))).toBe(true);
    expect(projectionViewsEqual(turned(370), turned(11))).toBe(false);
  });

  it("stores a caller's panels canonical in createDocument, and keeps canonical ones by reference", () => {
    // A fixture writing its panel by hand, not through panelWithView: the
    // Newman at 370 and a caption key holding undefined.
    const handWritten = {
      id: "panel-newman",
      representation: defaultRepresentation("skeletal"),
      caption: undefined,
      view: newmanOfC2C3(370, -60),
    } as unknown as Panel;
    const doc = documentWith(glucose(), [handWritten]);
    expect(doc.panels[0]!.view).toEqual(newmanOfC2C3(10, 300));
    expect(Object.hasOwn(doc.panels[0]!, "caption")).toBe(false);
    expect(undefinedValuedPaths(doc)).toEqual([]);
    expect(roundTrip(doc)).toEqual(doc);
    expect(JSON.stringify(roundTrip(doc))).toBe(JSON.stringify(doc));

    // Already canonical: the same list and the same panel objects, so a copy
    // of a document shares its panels.
    const copy = createDocument({ molecule: doc.molecule, panels: doc.panels, now: NOW });
    expect(copy.panels).toBe(doc.panels);
    const mixed = [doc.panels[0]!, handWritten];
    const assembled = createDocument({ molecule: doc.molecule, panels: mixed, now: NOW }).panels;
    expect(assembled).not.toBe(mixed);
    expect(assembled[0]).toBe(doc.panels[0]);
    expect(assembled[1]).toEqual(doc.panels[0]);
  });

  it("refuses to assemble an angle that is not a finite number", () => {
    expect(() => assembleProjectionView(newmanOfC2C3(Number.NaN))).toThrow(/finite/);
    expect(() => panel("p", "skeletal", newmanOfC2C3(0, Number.POSITIVE_INFINITY))).toThrow(/finite/);
  });
});

describe("a ring is an atom-id SET", () => {
  it("decodes any order to one view, which resolves to the same ring", () => {
    const doc = pyranoseDocument();
    const file = encoded(doc);
    const haworth = file.panels.find((p: { id: string }) => p.id === "panel-haworth");
    haworth.view.frame.ringAtomIds = [...haworth.view.frame.ringAtomIds].reverse();
    expect(decodeDocument(file)).toEqual(doc);

    const mol = doc.molecule;
    const ring = pyranoseRing(mol);
    const shuffled: RingView = {
      kind: "ring",
      template: "haworth",
      frame: { ringAtomIds: [ring[3]!, ring[0]!, ring[5]!, ring[1]!, ring[4]!, ring[2]!] },
      params: { face: "front" },
    };
    expect(projectionViewsEqual(shuffled, viewOf(doc, "panel-haworth"))).toBe(true);
    const a = resolveProjectionFrame(mol, shuffled);
    const b = resolveProjectionFrame(mol, viewOf(doc, "panel-haworth"));
    expect(a.kind).toBe("available");
    expect(a).toEqual(b);
  });

  it("asks which ring when a set names a fusion atom of cholesterol, and resolves a whole ring in any order", () => {
    const mol = cholesterol();
    const [ringD, ringC] = rings(mol);
    const fusion = ringD!.atomIds.filter((id) => ringC!.atomIds.includes(id));
    expect(fusion).toHaveLength(2);
    const partial: RingView = {
      kind: "ring",
      template: "haworth",
      frame: { ringAtomIds: [fusion[0]!] },
      params: { face: "front" },
    };
    const choice = resolveProjectionFrame(mol, partial);
    expect(choice.kind).toBe("needsChoice");
    const whole = (ids: readonly AtomId[]): RingView => ({ ...partial, frame: { ringAtomIds: ids } });
    const forward = resolveProjectionFrame(mol, whole(ringC!.atomIds));
    const backward = resolveProjectionFrame(mol, whole([...ringC!.atomIds].reverse()));
    expect(forward.kind).toBe("available");
    expect(backward).toEqual(forward);
  });
});

describe("the codec refuses what is malformed and decodes what is merely stale", () => {
  function withView(mutate: (view: Record<string, any>) => void, id = "panel-haworth"): unknown {
    const file = encoded(pyranoseDocument());
    const target = file.panels.find((p: { id: string }) => p.id === id);
    mutate(target.view);
    return file;
  }

  it("refuses an index-shaped ring reference rather than accepting a number", () => {
    const cases: ((view: Record<string, any>) => void)[] = [
      (view) => (view.frame.ringAtomIds = [0, 1, 2, 3, 4, 5]),
      (view) => (view.frame.ringAtomIds = 0),
      (view) => (view.frame.referenceAtomId = 1),
      (view) => (view.frame = { ringIndex: 0 }),
    ];
    for (const breakIt of cases) {
      expect(safeDecodeDocument(withView(breakIt)).ok, String(breakIt)).toBe(false);
    }
  });

  it("refuses an id named twice in a set, a template of another frame kind and an unknown form", () => {
    const cases: [string, (view: Record<string, any>) => void][] = [
      ["panel-haworth", (view) => view.frame.ringAtomIds.push(view.frame.ringAtomIds[0])],
      ["panel-haworth", (view) => (view.template = "fischer")],
      ["panel-haworth", (view) => (view.kind = "helix")],
      ["panel-haworth", (view) => (view.params.face = "up")],
      ["panel-haworth", (view) => (view.params.face = undefined)],
      ["panel-chair", (view) => (view.params.conformer.form = "boat")],
      ["panel-chair", (view) => (view.params.conformer = { form: "chair" })],
    ];
    for (const [id, breakIt] of cases) {
      expect(safeDecodeDocument(withView(breakIt, id)).ok, String(breakIt)).toBe(false);
    }
    const overlay = encoded(glucoseDocument());
    overlay.panels.find((p: { id: string }) => p.id === "panel-torsions").view.frame.bondIds.push("b13");
    expect(safeDecodeDocument(overlay).ok).toBe(false);
    // An EMPTY ring set is not malformed: it is the frame's "whichever ring
    // there is", which the engine resolves or answers with a choice.
    expect(safeDecodeDocument(withView((view) => (view.frame.ringAtomIds = []))).ok).toBe(true);
  });

  it("refuses a key this build does not know, at any depth of a view, as a newer build's", () => {
    const newer: [string, (view: Record<string, any>) => void][] = [
      // The planned ring arm's fields that decision 162 did not build.
      ["panel-haworth", (view) => (view.params.showHydrogensAt = ["a6"])],
      ["panel-haworth", (view) => (view.params.camera = { azimuth: 0 })],
      ["panel-haworth", (view) => (view.frame.assignments = [])],
      ["panel-chair", (view) => (view.params.conformer.upAtomId = "a6")],
      ["panel-chair", (view) => (view.named = "rotamer A")],
    ];
    for (const [id, add] of newer) {
      const result = safeDecodeDocument(withView(add, id));
      expect(result.ok, String(add)).toBe(false);
      if (!result.ok) expect(isFromNewerBuild(result.error), String(add)).toBe(true);
    }
  });

  it("calls a chair panel's unknown conformer form a newer build's, and nothing else a view gets wrong", () => {
    // Decision 154: a boat arrives as a new arm of the conformer union, which
    // zod refuses on its discriminator with no unknown key in sight. It is
    // THIS build, meeting a file from the chair task's, that has to say
    // "newer version".
    const boat = safeDecodeDocument(
      withView(
        (view) => (view.params.conformer = { form: "boat", frontAtomId: "a6", backAtomId: "a3" }),
        "panel-chair",
      ),
    );
    expect(boat.ok).toBe(false);
    if (!boat.ok) expect(isFromNewerBuild(boat.error)).toBe(true);

    // Everything else is damage, not a newer build: a frame kind or a
    // template no build lists, a face that is neither, a chair missing its
    // pinned atom, an index for a ring.
    const corrupt: [string, (view: Record<string, any>) => void][] = [
      ["panel-haworth", (view) => (view.kind = "helix")],
      ["panel-haworth", (view) => (view.template = "fischer")],
      ["panel-haworth", (view) => (view.params.face = "up")],
      ["panel-chair", (view) => (view.params.conformer = { form: "chair" })],
      ["panel-haworth", (view) => (view.frame.ringAtomIds = [0, 1, 2, 3, 4, 5])],
    ];
    for (const [id, breakIt] of corrupt) {
      const result = safeDecodeDocument(withView(breakIt, id));
      expect(result.ok, String(breakIt)).toBe(false);
      if (!result.ok) expect(isFromNewerBuild(result.error), String(breakIt)).toBe(false);
    }
  });

  it("decodes a view naming atoms the molecule does not hold, and the panel says so instead of throwing", () => {
    const file = encoded(glucoseDocument());
    const fischer = file.panels.find((p: { id: string }) => p.id === "panel-fischer");
    fischer.view.frame.backbone = ["a6", "a5", "a99", "constructor"];
    const newman = file.panels.find((p: { id: string }) => p.id === "panel-newman");
    newman.view.frame.frontReference = "toString";
    const decoded = decodeDocument(file);
    const mol = decoded.molecule;

    const verdict = projectedViewAvailability(mol, "skeletal", viewOf(decoded, "panel-fischer"));
    expect(verdict.status).toBe("unavailable");
    if (verdict.status !== "unavailable") throw new Error("unreachable");
    expect(verdict.reason).toBe("missing-atom");
    expect(verdict.atomIds).toEqual(["a99", "constructor"]);
    expect(verdict.message).toMatch(/deleted; choose again/);

    // A stale REFERENCE is softer: the frame resolves and reports the fallback.
    const sighted = resolveProjectionFrame(mol, viewOf(decoded, "panel-newman"));
    expect(sighted.kind).toBe("available");
    if (sighted.kind !== "available" || sighted.frame.kind !== "sightedBond") throw new Error("unreachable");
    expect(sighted.frame.referenceFallbacks).toEqual([{ end: "front", reason: "missing-atom" }]);
    expect(sighted.frame.backReference).toBe("a9");
  });
});

describe("an edit that deletes atoms", () => {
  it("degrades a panel naming them to unavailable, and prunes only the overlay's bond set", () => {
    const doc = glucoseDocument();
    const c3 = "a4";
    const molecule = removeAtoms(doc.molecule, [c3]);
    const panels = prunePanelViews(doc.panels, molecule);

    // The Fischer, the Newman and the planar view are the same objects: a
    // backbone short of C3 is not a shorter backbone, it is a question to ask
    // again, and undo restores it with the atom.
    for (const id of ["panel-plain", "panel-fischer", "panel-fischer-h", "panel-newman", "panel-planar"]) {
      expect(panels.find((p) => p.id === id), id).toBe(doc.panels.find((p) => p.id === id));
    }
    for (const id of ["panel-fischer", "panel-fischer-h", "panel-newman"]) {
      const verdict = projectedViewAvailability(molecule, "skeletal", viewOf({ ...doc, panels }, id));
      expect(verdict.status, id).toBe("unavailable");
      if (verdict.status === "unavailable") {
        expect(verdict.reason, id).toBe("missing-atom");
        expect(verdict.atomIds, id).toEqual([c3]);
      }
    }
    // The overlay keeps the torsions of the bonds that are left: C3's two
    // backbone bonds (b15 C4–C3, b16 C3–C2) went with it.
    expect(viewOf({ ...doc, panels }, "panel-torsions")).toEqual({
      kind: "annotationOverlay",
      template: "torsion",
      frame: { bondIds: ["b13", "b14", "b17"] },
      params: {},
    });
    // And the pruned document still saves and opens.
    const edited = { ...doc, molecule, panels };
    expect(roundTrip(edited)).toEqual(edited);
  });

  it("returns the same panel list when the deleted atoms are named by no view", () => {
    const doc = glucoseDocument();
    // O6, the C6 hydroxyl: on the drawing, in no frame and on no overlay bond.
    const molecule = removeAtoms(doc.molecule, ["a7"]);
    expect(prunePanelViews(doc.panels, molecule)).toBe(doc.panels);
  });
});

describe("panelWithView", () => {
  it("returns the panel itself when the view draws the same picture", () => {
    const doc = pyranoseDocument();
    const haworth = doc.panels[0]!;
    const view = viewOf(doc, "panel-haworth") as RingView;
    const again: RingView = {
      ...view,
      frame: { ringAtomIds: [...view.frame.ringAtomIds].reverse() },
    };
    expect(panelWithView(haworth, again)).toBe(haworth);
    expect(panelWithView(haworth, JSON.parse(JSON.stringify(view)) as RingView)).toBe(haworth);
    const plain = panel("panel-plain", "skeletal");
    expect(panelWithView(plain, null)).toBe(plain);
  });

  it("writes a new panel when the picture changes, and removes the key with null", () => {
    const doc = pyranoseDocument();
    const chair = doc.panels[1]!;
    const ring = pyranoseRing(doc.molecule);
    // A ring flip names a neighbour of the pinned atom instead.
    const flipped = panelWithView(chair, chairOf(doc.molecule, ring[2]!));
    expect(flipped).not.toBe(chair);
    expect(flipped.representation).toBe(chair.representation);
    const cleared = panelWithView(flipped, null);
    expect(Object.hasOwn(cleared, "view")).toBe(false);
    expect(cleared).toEqual({ id: chair.id, representation: chair.representation });
  });
});

describe("schema v2 carries the view with no second bump", () => {
  it("is still version 2, a v1 document still opens, and a newer version is refused", () => {
    expect(SCHEMA_VERSION).toBe(2);
    const doc = glucoseDocument();
    const file = encoded(doc);
    expect(file.schemaVersion).toBe(2);

    const v1 = encoded(documentWith(glucose(), [panel("panel-plain", "skeletal")]));
    delete v1.annotations;
    delete v1.nextAnnotationId;
    v1.schemaVersion = 1;
    expect(safeDecodeDocument(v1).ok).toBe(false);
    const upgraded = decodeDocument(DOCUMENT_UPGRADES[1]!(v1));
    expect(upgraded.panels.every((p) => !Object.hasOwn(p, "view"))).toBe(true);
    expect(upgraded.schemaVersion).toBe(2);

    const future = { ...file, schemaVersion: 3 };
    expect(safeDecodeDocument(future).ok).toBe(false);
  });
});

/**
 * Every value the schema's SHAPE admits, one per arm of every union at every
 * depth, with every optional key PRESENT: the fixture for "the assembler
 * keeps what the schema reads". Built from the schema rather than written
 * out, so a key the schema starts reading is in it with no fixture to add.
 * A zod type this does not know throws, so a schema grown a new kind of
 * field makes the test ask for it rather than skip it.
 */
function everyKeySamples(schema: z.ZodType, path = "view"): unknown[] {
  if (schema instanceof z.ZodOptional) return everyKeySamples(schema.unwrap() as z.ZodType, path);
  if (schema instanceof z.ZodDiscriminatedUnion || schema instanceof z.ZodUnion) {
    return (schema.options as z.ZodType[]).flatMap((option) => everyKeySamples(option, path));
  }
  if (schema instanceof z.ZodObject) {
    let samples: Record<string, unknown>[] = [{}];
    for (const [key, child] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
      const values = everyKeySamples(child, `${path}.${key}`);
      samples = samples.flatMap((sample) => values.map((value) => ({ ...sample, [key]: value })));
    }
    return samples;
  }
  if (schema instanceof z.ZodArray) return everyKeySamples(schema.element as z.ZodType, `${path}[]`).map((v) => [v]);
  if (schema instanceof z.ZodTuple) {
    let samples: unknown[][] = [[]];
    (schema.def.items as z.ZodType[]).forEach((item, index) => {
      const values = everyKeySamples(item, `${path}[${index}]`);
      samples = samples.flatMap((sample) => values.map((value) => [...sample, value]));
    });
    return samples;
  }
  if (schema instanceof z.ZodLiteral) return [...schema.values];
  if (schema instanceof z.ZodEnum) return [schema.options[0]];
  if (schema instanceof z.ZodString) return ["a1"];
  if (schema instanceof z.ZodNumber) return [10];
  if (schema instanceof z.ZodBoolean) return [true];
  throw new Error(`everyKeySamples: no sample for ${schema.def.type} at ${path}`);
}

/** Every key path in a JSON value, array elements folded to `[]`. */
function keyPaths(value: unknown, at = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => keyPaths(item, `${at}[]`));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [`${at}.${key}`, ...keyPaths(child, `${at}.${key}`)]);
}

describe("the projection value lists and chem-core stay in step", () => {
  it("keeps, through the assembler, every key the schema reads, optional keys included", () => {
    // `projectionViewSchema` is the shape piped into the canonicalising
    // transform; the shape is what a file may hold.
    const shape = projectionViewSchema.in as z.ZodType;
    const samples = everyKeySamples(shape) as ProjectionView[];
    // Non-vacuous: every frame kind, and today's optional keys, are in it.
    expect(new Set(samples.map((s) => s.kind))).toEqual(new Set(FRAME_KINDS));
    const covered = new Set(samples.flatMap((s) => keyPaths(s).map((p) => `${s.kind}${p}`)));
    for (const optional of [
      "ring.frame.referenceAtomId",
      "ring.params.conformer.frontAtomId",
      "sightedBond.frame.frontReference",
      "sightedBond.frame.backReference",
    ]) {
      expect(covered, optional).toContain(optional);
    }
    for (const sample of samples) {
      const label = `${sample.kind}/${sample.template}`;
      // The shape's own verdict first, so a sample is a value a file may hold.
      expect(shape.safeParse(sample).success, label).toBe(true);
      expect(keyPaths(assembleProjectionView(sample)).sort(), label).toEqual(keyPaths(sample).sort());
      const stored = panel("p", "skeletal", sample).view;
      expect(keyPaths(stored).sort(), label).toEqual(keyPaths(sample).sort());
    }
  });

  it("decodes every listed template of every frame kind, and no template under another kind", () => {
    expect([...CHAIN_TOP_VALUES]).toEqual(["first", "last"]);
    expect([...RING_FACE_VALUES]).toEqual(["front", "back"]);
    expect([...RING_CONFORMER_FORMS]).toEqual(["chair"]);
    const doc = glucoseDocument();
    const samples: Record<(typeof FRAME_KINDS)[number], ProjectionView> = {
      planar: viewOf(doc, "panel-planar"),
      chain: viewOf(doc, "panel-fischer"),
      ring: chairOf(glucopyranose(), "a6"),
      sightedBond: viewOf(doc, "panel-newman"),
      annotationOverlay: viewOf(doc, "panel-torsions"),
    };
    for (const kind of FRAME_KINDS) {
      for (const other of FRAME_KINDS) {
        for (const template of PROJECTION_TEMPLATES[other]) {
          const file = encoded(documentWith(doc.molecule, [panel("p", "skeletal", samples[kind])]));
          file.panels[0].view.template = template;
          const ok = safeDecodeDocument(file).ok;
          expect(ok, `${kind}/${template}`).toBe(kind === other);
        }
      }
    }
  });
});
