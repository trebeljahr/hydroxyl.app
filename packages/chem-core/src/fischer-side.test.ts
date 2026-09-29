/**
 * The scoped Fischer read (decision 144): one centre on a synthetic cross,
 * every other unit out of scope.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildMolecule } from "./builders.js";
import { fischerCrossParity, fischerSide } from "./fischer-side.js";
import { bondsAt, otherEnd } from "./molecule.js";
import { readMolblock } from "./molblock-read.js";
import { readConfig, stereoConfig } from "./stereo-config.js";
import { carbohydrates } from "./sugar.js";
import type { AtomId, Molecule } from "./types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "projection");

function fixture(file: string): Molecule {
  return readMolblock(readFileSync(join(FIXTURES, file), "utf8")).molecule;
}

function oxygenOn(mol: Molecule, atomId: AtomId): AtomId {
  return bondsAt(mol, atomId)
    .map((bond) => otherEnd(bond, atomId))
    .find((id) => mol.atoms[id]!.element === "O")!;
}

/** D-glyceraldehyde as a bare Fischer cross: CHO up, CH2OH down, OH right. */
function glyceraldehydeFischer(): { mol: Molecule; c1: AtomId; c2: AtomId; c3: AtomId; o2: AtomId } {
  let ids: { c1: AtomId; c2: AtomId; c3: AtomId; o2: AtomId } | undefined;
  const mol = buildMolecule((b) => {
    const c2 = b.atom("C", { x: 0, y: 0 });
    const c1 = b.atom("C", { x: 0, y: 1 });
    const c3 = b.atom("C", { x: 0, y: -1 });
    const o2 = b.atom("O", { x: 1, y: 0 });
    b.bond(c2, c1);
    b.bond(c2, c3);
    b.bond(c2, o2);
    b.bond(c1, b.atom("O", { x: 0.87, y: 1.5 }), 2);
    b.bond(c3, b.atom("O", { x: 0, y: -2 }));
    ids = { c1, c2, c3, o2 };
  });
  return { mol, ...ids! };
}

describe("readConfig with a scope", () => {
  it("reads one centre and reports every other unit as not covered", () => {
    const mol = fixture("d-glucose-open.mol");
    // The drawing as it stands is no Fischer projection: the convention
    // refuses it whole.
    expect(readConfig({ mol }, { kind: "fischer" }).kind).toBe("unavailable");
    const [unit] = carbohydrates(mol);
    const [c1, c2, c3] = unit!.backbone;
    const o2 = oxygenOn(mol, c2!);
    const origin = mol.atoms[c2!]!.pos;
    const read = readConfig(
      {
        mol,
        positions: {
          [c1!]: { x: origin.x, y: origin.y + 1 },
          [c3!]: { x: origin.x, y: origin.y - 1 },
          [o2]: { x: origin.x + 1, y: origin.y },
        },
      },
      { kind: "fischer" },
      { centres: [c2!] },
    );
    if (read.kind !== "read") throw new Error("the scoped read refused");
    for (const centre of read.config.centres) {
      if (centre.atomId === c2) expect(centre.reading.kind).toBe("specified");
      else expect(centre.reading).toEqual({ kind: "undetermined", reason: "not-covered" });
    }
    expect(read.config.centres).toHaveLength(4);
  });

  it("does not share the unscoped read's cache", () => {
    const mol = fixture("r-glyceraldehyde.mol");
    const full = readConfig({ mol }, { kind: "wedgeHash" });
    const scoped = readConfig({ mol }, { kind: "wedgeHash" }, { centres: [] });
    expect(scoped).not.toBe(full);
    if (scoped.kind !== "read") throw new Error("refused");
    expect(scoped.config.centres.every((c) => c.reading.kind === "undetermined")).toBe(true);
    expect(readConfig({ mol }, { kind: "wedgeHash" })).toBe(full);
  });
});

describe("fischerSide", () => {
  it("puts (R)-glyceraldehyde's OH on the right and (S)-glyceraldehyde's on the left", () => {
    for (const [file, side] of [
      ["r-glyceraldehyde.mol", "right"],
      ["s-glyceraldehyde.mol", "left"],
    ] as const) {
      const mol = fixture(file);
      const [unit] = carbohydrates(mol);
      const [c1, c2, c3] = unit!.backbone;
      expect(fischerSide(mol, c2!, { up: c1!, down: c3!, side: oxygenOn(mol, c2!) }).kind, file).toBe(side);
      // Swapping up and down is a half turn of the cross: the other side.
      expect(fischerSide(mol, c2!, { up: c3!, down: c1!, side: oxygenOn(mol, c2!) }).kind).toBe(
        side === "right" ? "left" : "right",
      );
    }
  });

  it("asks whichever configuration it is given: a drawn Fischer, read as one", () => {
    const { mol, c1, c2, c3, o2 } = glyceraldehydeFischer();
    const arms = { up: c1, down: c3, side: o2 };
    // Read with the wedge convention, a bare cross states nothing.
    expect(fischerSide(mol, c2, arms)).toEqual({ kind: "undetermined", reason: "no-stereo-bond" });
    const read = readConfig({ mol }, { kind: "fischer" });
    if (read.kind !== "read") throw new Error("refused");
    expect(fischerSide(mol, c2, arms, read.config).kind).toBe("right");
  });

  it("gives the right-hand parity from fischerCrossParity, and the left is its opposite", () => {
    const { mol, c1, c2, c3, o2 } = glyceraldehydeFischer();
    const read = readConfig({ mol }, { kind: "fischer" });
    if (read.kind !== "read") throw new Error("refused");
    const drawn = read.config.centres.find((c) => c.atomId === c2)!;
    expect(drawn.reading).toEqual({ kind: "specified", parity: fischerCrossParity(mol, c2, { up: c1, down: c3, side: o2 }) });
  });

  it("refuses arms that are not the centre's ligands, and a config from another molecule", () => {
    const mol = fixture("r-glyceraldehyde.mol");
    const [unit] = carbohydrates(mol);
    const [c1, c2, c3] = unit!.backbone;
    expect(fischerSide(mol, c2!, { up: c1!, down: c1!, side: c3! })).toEqual({
      kind: "undetermined",
      reason: "not-its-ligands",
    });
    expect(fischerSide(mol, c1!, { up: c2!, down: c3!, side: c1! })).toEqual({
      kind: "undetermined",
      reason: "not-a-stereocentre",
    });
    // A config whose centre lists other ligands (as one from another
    // molecule would) is a caller error, not an answer.
    const own = stereoConfig(mol);
    const foreign = {
      ...own,
      centres: own.centres.map((c) => ({ ...c, order: [...c.order].reverse() })),
    };
    expect(() => fischerSide(mol, c2!, { up: c1!, down: c3!, side: oxygenOn(mol, c2!) }, foreign)).toThrow(
      /does not match/,
    );
  });
});
