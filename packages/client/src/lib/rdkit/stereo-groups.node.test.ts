import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";

import {
  bonds,
  readMolblock,
  setBondStereo,
  stereoGroupCoverage,
  stereoGroupsOf,
  stereocenterAtoms,
  wedgelessStereoGroupAtoms,
  withStereoGroups,
} from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";

import type { JSMolLike, RDKitModuleLike } from "./ops";
import {
  moleculeToMolblock,
  molblockVersionFor,
  molblockVersionNotice,
  wedgelessStereoGroupNotice,
} from "./translate";

/**
 * Enhanced stereo groups across the real wasm, both directions.
 *
 * chem-core's V3000 codec is pure TypeScript and its own tests pin the bytes as
 * literals. This file is what keeps those literals honest, the same way
 * `stereo-centres.node.test.ts` keeps the CIP letters honest: the oracle is
 * RDKit MinimalLib 2025.03.4, loaded directly, with the worker treated as the
 * transport shell it is.
 *
 * `C[C@H](O)[C@@H](C)Cl` with the SMILES extension `|&1:1,3|` is the case
 * decision 25 was verified on, so it is the case re-proved here every run.
 *
 * THE ORACLE IS `get_json`, NOT A MOLBLOCK STRING AND NEVER A SMILES. Two
 * reasons, one per rejected option. A canonical SMILES is useless: RDKit's
 * default writer drops the collections entirely — `get_smiles()` on the
 * molecule above returns `C[C@H](O)[C@@H](C)Cl`, which is the SINGLE
 * ENANTIOMER, so the racemate and the pure compound canonicalise to the same
 * string and an assertion on it would pass for the wrong answer. Comparing
 * molblock text instead would assert on RDKit's formatting rather than on what
 * RDKit understood. `get_json` is RDKit's own commonchem dump and it carries
 * `stereoGroups` as structured data: `{"type":"and","id":0,"atoms":[1,3]}`.
 *
 * ITS INDICES ARE ZERO-BASED. Its `id` CARRIES NO INFORMATION: measured on
 * RDKit's own output for `C[C@H](O)[C@@H](C)[C@H](O)C |&1:1,&2:3,o1:5|`, which it
 * writes as `STERAC1`, `STERAC2` and `STEREL1`, every entry comes back `id: 0` —
 * so it distinguishes neither the group number nor one group from another, and no
 * assertion may be built on it (`rdkitGroups` drops it for that reason). An `abs`
 * entry carries no `id` at all. The group NUMBER survives only in the molblock
 * text, which is why the `MDLV30/...` lines are asserted separately below.
 * Measured, not assumed, as everything in this file is.
 *
 * WHAT IS DELIBERATELY NOT HERE: the SMILES-level round trip, because of the
 * canonicalisation above, and any assertion on CIP letters, which is
 * `stereo-centres.node.test.ts`'s subject. Decision 23 puts absolute R/S out of
 * scope for AND/OR centres in any case.
 */

const require = createRequire(import.meta.url);

let RDKit: RDKitModuleLike;

beforeAll(async () => {
  const initRDKitModule = require("@rdkit/rdkit") as () => Promise<RDKitModuleLike>;
  RDKit = await initRDKitModule();
}, 60_000);

/** RDKit's commonchem dump names the field; the shared interface omits it. */
type JsonMol = JSMolLike & { get_json(): string };

interface RdkitGroup {
  readonly type: string;
  readonly id?: number;
  readonly atoms: readonly number[];
}

/** What RDKit UNDERSTOOD from `text`, as `{kind, rows}` with ONE-based rows so
 *  the expectations read like the `ATOMS=(...)` list in the file. */
function rdkitGroups(text: string): { kind: string; rows: number[] }[] {
  const mol = RDKit.get_mol(text, JSON.stringify({ removeHs: false })) as JsonMol | null;
  if (mol === null) throw new Error("RDKit refused the text");
  try {
    const json = JSON.parse(mol.get_json()) as {
      molecules: { stereoGroups?: RdkitGroup[] }[];
    };
    const groups = json.molecules[0]?.stereoGroups ?? [];
    return groups.map((group) => ({
      kind: group.type,
      rows: group.atoms.map((index) => index + 1).sort((a, b) => a - b),
    }));
  } finally {
    mol.delete();
  }
}

/** RDKit's own molfile for a SMILES, with coordinates so the wedges are real. */
function rdkitMolblock(smiles: string): string {
  const mol = RDKit.get_mol(smiles) as JsonMol | null;
  if (mol === null) throw new Error(`RDKit refused ${smiles}`);
  try {
    mol.set_new_coords();
    return mol.get_molblock();
  } finally {
    mol.delete();
  }
}

/** The client's own export path, so decision 49's choice is what is measured. */
function exported(mol: Molecule): string {
  const written = moleculeToMolblock(mol, "stereo groups");
  if (!written.ok) throw new Error(`moleculeToMolblock refused: ${written.error.message}`);
  return written.value;
}

/** `C[C@H](O)[C@@H](C)Cl |&1:1,3|` as chem-core reads RDKit's own molfile. */
const RACEMATE_SMILES = "C[C@H](O)[C@@H](C)Cl |&1:1,3|";

/** A chain of `n` carbinol centres, all in one AND group. Long enough that the
 *  COLLECTION entry passes 80 characters and the writer has to continue it. */
function polyolSmiles(n: number): string {
  const centres = Array.from({ length: n }, (_, i) => 1 + i * 2).join(",");
  return `C${"[C@H](O)".repeat(n)}C |&1:${centres}|`;
}

describe("RDKit reads this app's V3000 stereo groups", () => {
  it("re-proves decision 25: RDKit itself writes enhanced stereo only as V3000", () => {
    // The premise of the whole feature, measured rather than cited. RDKit is
    // not asked for V3000 here: `get_molblock()` with no options switches to it
    // ON ITS OWN because the molecule has a collection to state, and there is
    // nothing in the V2000 rendering standing in for one.
    const molblock = rdkitMolblock(RACEMATE_SMILES);
    expect(molblock).toContain("V3000");
    expect(molblock).toContain("M  V30 BEGIN COLLECTION");
    expect(molblock).toContain("MDLV30/STERAC1");
    expect(molblock).not.toContain("V2000");
  });

  it("reads RDKit's racemate, re-exports it, and gets the same collection back", () => {
    const read = readMolblock(rdkitMolblock(RACEMATE_SMILES));
    // Decision 90's reader takes RDKit's V3000 whole: no skipped rows, so no
    // warnings — a warning here would mean a feature silently dropped.
    expect(read.warnings).toEqual([]);
    const mol = read.molecule;

    expect(stereocenterAtoms(mol)).toEqual(["a2", "a4"]);
    expect(stereoGroupsOf(mol)).toEqual([{ kind: "and", index: 1, atomIds: ["a2", "a4"] }]);
    // Both centres in one AND group: the molecule reads `rac-` (decision 40).
    expect(stereoGroupCoverage(mol)).toMatchObject({ kind: "whole", prefix: "rac-" });

    // Decision 49: the app picked the generation from the molecule.
    expect(molblockVersionFor(mol)).toBe("V3000");
    const ours = exported(mol);
    expect(ours).toContain("MDLV30/STERAC1 ATOMS=(2 2 4)");

    expect(rdkitGroups(ours)).toEqual([{ kind: "and", rows: [2, 4] }]);
  });

  it("keeps AND, OR and ABS apart in one file", () => {
    // One collection of each, so a writer that reused a name — or a reader that
    // coalesced them — fails here rather than in a figure six months on.
    const base = readMolblock(rdkitMolblock(polyolSmiles(3))).molecule;
    const centres = stereocenterAtoms(base);
    expect(centres).toHaveLength(3);
    const mixed = withStereoGroups(base, [
      { kind: "and", index: 1, atomIds: [centres[0]!] },
      { kind: "or", index: 1, atomIds: [centres[1]!] },
      { kind: "abs", index: 1, atomIds: [centres[2]!] },
    ]);

    const ours = exported(mixed);
    expect(ours).toContain("MDLV30/STERAC1");
    expect(ours).toContain("MDLV30/STEREL1");
    expect(ours).toContain("MDLV30/STEABS");

    // Canonical order, kind then index: abs, and, or.
    expect(rdkitGroups(ours)).toEqual([
      { kind: "abs", rows: [6] },
      { kind: "and", rows: [2] },
      { kind: "or", rows: [4] },
    ]);
  });

  it("keeps the whole group across a CONTINUED COLLECTION line (T7)", () => {
    // The likeliest defect in the feature, and the one that fails silently: a
    // reader that never rejoins loses the tail of a group and the molecule
    // still looks fine. Eighteen centres put the entry past 80 characters, and
    // the writer's break lands MID-NUMBER (`... 32 3-` / `4 36)`), which is the
    // hardest place for a reader to rejoin correctly.
    const mol = readMolblock(rdkitMolblock(polyolSmiles(18))).molecule;
    const centres = stereocenterAtoms(mol);
    expect(centres).toHaveLength(18);
    expect(stereoGroupsOf(mol)[0]?.atomIds).toEqual([...centres]);

    const ours = exported(mol);
    const collection = ours
      .split("\n")
      .slice(
        ours.split("\n").findIndex((line) => line.includes("BEGIN COLLECTION")) + 1,
        ours.split("\n").findIndex((line) => line.includes("END COLLECTION")),
      );
    // More than one physical line, and every line but the last ends in a dash.
    expect(collection.length).toBeGreaterThan(1);
    for (const line of collection.slice(0, -1)) expect(line.endsWith("-")).toBe(true);
    for (const line of collection) expect(line.startsWith("M  V30 ")).toBe(true);

    // And RDKit gets all eighteen back, not the head of the list.
    const [group] = rdkitGroups(ours);
    expect(group?.kind).toBe("and");
    expect(group?.rows).toHaveLength(18);
    expect(group?.rows).toEqual(Array.from({ length: 18 }, (_, i) => 2 + i * 2));
  });

  it("re-proves decision 125: RDKit drops a grouped atom that carries no mark", () => {
    // THE KNOWN LIMIT, measured every run rather than trusted — the
    // `RDKIT_MOLFILE_STEREO_BLIND` precedent. Every other fixture in this file
    // comes from an RDKit SMILES carrying `@`/`@@`, so every grouped atom always
    // has a chiral tag and none of them can see this; the wedgeless case has to
    // be built deliberately.
    //
    // A flat skeleton marked racemic is an ordinary scheme drawing, so refusing
    // the mark was rejected (decision 125). This app states it correctly at every
    // layer and RDKit still will not read it back.
    const drawn = readMolblock(rdkitMolblock(RACEMATE_SMILES)).molecule;
    const flat = bonds(drawn).reduce((mol, bond) => setBondStereo(mol, bond.id, "none"), drawn);
    expect(bonds(flat).filter((bond) => bond.stereo !== "none")).toEqual([]);
    // Still two stereocentres: `stereocenterAtoms` includes a centre whose
    // descriptor is undetermined, which is what lets a flat racemate be marked.
    expect(stereocenterAtoms(flat)).toEqual(["a2", "a4"]);
    const racemate = withStereoGroups(flat, [{ kind: "and", index: 1, atomIds: ["a2", "a4"] }]);
    expect(stereoGroupCoverage(racemate)).toMatchObject({ kind: "whole", prefix: "rac-" });

    const ours = exported(racemate);
    // The file is RIGHT: the collection is there, and chem-core reads it back
    // whole. Nothing here is a defect in this app.
    expect(ours).toContain("MDLV30/STERAC1 ATOMS=(2 2 4)");
    expect(stereoGroupsOf(readMolblock(ours).molecule)).toEqual([
      { kind: "and", index: 1, atomIds: ["a2", "a4"] },
    ]);
    // And RDKit reports NO collection at all. When a future RDKit reads the
    // collection block this fails, and the limit — and its warning — come out.
    expect(rdkitGroups(ours)).toEqual([]);

    // The dialog's sentence names exactly the atoms that will be lost.
    expect(wedgelessStereoGroupAtoms(racemate)).toEqual(["a2", "a4"]);
    const notice = wedgelessStereoGroupNotice(racemate);
    expect(notice).toContain("a2, a4");
    expect(notice).toContain("RDKit");
    // The same molecule with its wedges intact earns no warning, and RDKit keeps
    // the collection — so the sentence tracks the drawing and not the feature.
    expect(wedgelessStereoGroupNotice(withStereoGroups(drawn, [
      { kind: "and", index: 1, atomIds: ["a2", "a4"] },
    ]))).toBeNull();
  });

  it("drops only the grouped atoms that carry no mark, not the whole collection", () => {
    // PER ATOM, which is why the warning names atoms rather than saying the
    // collection is unreliable: with one of the two centres still wedged RDKit
    // keeps that one and silently shrinks the group.
    const drawn = readMolblock(rdkitMolblock(RACEMATE_SMILES)).molecule;
    const keep = bonds(drawn).find((bond) => bond.stereo !== "none" && bond.from === "a2");
    expect(keep).toBeDefined();
    const half = bonds(drawn).reduce(
      (mol, bond) => (bond.id === keep?.id ? mol : setBondStereo(mol, bond.id, "none")),
      drawn,
    );
    const racemate = withStereoGroups(half, [{ kind: "and", index: 1, atomIds: ["a2", "a4"] }]);
    expect(wedgelessStereoGroupAtoms(racemate)).toEqual(["a4"]);
    expect(wedgelessStereoGroupNotice(racemate)).toContain("a4");
    expect(rdkitGroups(exported(racemate))).toEqual([{ kind: "and", rows: [2] }]);
  });

  it("writes V2000 with no collection when the molecule states no group, and says so", () => {
    // The other half of decision 49: V2000 stays the default, because it is
    // what every other reader takes without argument. The notice is `null` for
    // exactly that case, which is what keeps the dialog quiet.
    const plain = withStereoGroups(readMolblock(rdkitMolblock("C[C@H](O)CC")).molecule, []);
    expect(stereoGroupsOf(plain)).toEqual([]);
    expect(molblockVersionFor(plain)).toBe("V2000");
    expect(molblockVersionNotice(plain)).toBeNull();

    const ours = exported(plain);
    expect(ours).toContain("V2000");
    expect(ours).not.toContain("V3000");
    expect(ours).not.toContain("COLLECTION");
    // RDKit still reads it — and reports no collection, rather than inventing
    // an absolute one. That distinction is decision 91.
    expect(rdkitGroups(ours)).toEqual([]);
  });
});
