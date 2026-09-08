/**
 * Keyboard traversal, against real molecules.
 *
 * The criterion is "arrow keys move focus atom-to-atom along bonds" AND
 * "keyboard traversal reaches every atom". The second is the one a naive
 * implementation fails: a disconnected fragment has no bond to walk in on.
 */

import { describe, expect, it } from "vitest";

import { benzene, buildMolecule, linearChain } from "@starter/chem-core";

import { describeAtom, neighbourInDirection, nextFocusAtom } from "./traversal";

describe("neighbourInDirection", () => {
  it("follows the bond that points that way", () => {
    // A cross: one neighbour in each cardinal direction.
    const mol = buildMolecule((b) => {
      const centre = b.atom("C", { x: 0, y: 0 });
      const north = b.atom("N", { x: 0, y: 1 });
      const south = b.atom("O", { x: 0, y: -1 });
      const east = b.atom("S", { x: 1, y: 0 });
      const west = b.atom("P", { x: -1, y: 0 });
      b.bond(centre, north);
      b.bond(centre, south);
      b.bond(centre, east);
      b.bond(centre, west);
    });
    // MODEL COORDINATES ARE Y-UP: "up" is +y. The renderer flips; this does
    // not, and a traversal that used screen y would go the wrong way.
    expect(neighbourInDirection(mol, "a1", "up")).toBe("a2");
    expect(neighbourInDirection(mol, "a1", "down")).toBe("a3");
    expect(neighbourInDirection(mol, "a1", "right")).toBe("a4");
    expect(neighbourInDirection(mol, "a1", "left")).toBe("a5");
  });

  it("answers nothing when no bond points that way", () => {
    const mol = linearChain(2, "C", 1, 0);
    expect(neighbourInDirection(mol, "a1", "left")).toBeUndefined();
  });

  it("accepts a hexagon's 60-degree bonds as 'up'", () => {
    // A strict quadrant would make "up" ambiguous at every ring vertex, where
    // the two bonds sit at +/-60 from vertical.
    const mol = benzene();
    expect(neighbourInDirection(mol, "a1", "up")).toBeDefined();
  });
});

describe("nextFocusAtom", () => {
  it("starts somewhere when nothing is focused yet", () => {
    const mol = benzene();
    expect(nextFocusAtom(mol, undefined, "right")).toBe(mol.atomIds[0]);
  });

  it("walks the ring bond by bond", () => {
    const mol = benzene();
    const first = nextFocusAtom(mol, "a1", "up");
    expect(first).toBeDefined();
    expect(mol.atoms["a1"]!.pos).not.toEqual(mol.atoms[first!]!.pos);
  });

  it("gets STUCK on a ring when it is given no memory of where it came from", () => {
    // The old behaviour, pinned as the reason `previous` exists at all. With
    // no memory the walk trades focus across one bond forever: four of
    // benzene's six atoms pressing Right, two of six pressing Down.
    const mol = benzene();
    for (const direction of ["right", "down"] as const) {
      const visited = new Set<string>();
      let current: string | undefined = undefined;
      for (let i = 0; i < 30; i++) {
        current = nextFocusAtom(mol, current, direction);
        if (current !== undefined) visited.add(current);
      }
      expect(visited.size).toBeLessThan(mol.atomIds.length);
    }
  });

  it("reaches every atom of a ring in bonded mode once it remembers the last one", () => {
    // The bonded walk is not complete for EVERY graph — a preference for a
    // bonded neighbour can always skip an atom — but the shape that actually
    // bit was the 2-cycle, and rejecting the atom just left kills it. Benzene
    // is the molecule /editor loads, so it is the one that has to work.
    const mol = benzene();
    for (const direction of ["right", "left", "up", "down"] as const) {
      const visited = new Set<string>();
      let previous: string | undefined = undefined;
      let current: string | undefined = undefined;
      for (let i = 0; i < mol.atomIds.length * 2; i++) {
        const next = nextFocusAtom(mol, current, direction, "bonded", previous);
        previous = current;
        current = next;
        if (current !== undefined) visited.add(current);
      }
      expect(
        [...visited].sort(),
        `bonded ${direction} missed an atom`,
      ).toEqual([...mol.atomIds].sort());
    }
  });

  it("never answers with the atom the focus just came from", () => {
    const mol = benzene();
    // a2 is bonded to a1 and a3; coming FROM a1, Right must not go back to it
    // even when a1 is the best-aligned neighbour.
    expect(nextFocusAtom(mol, "a2", "left", "bonded", "a1")).not.toBe("a1");
  });

  it("still hands back the only other atom of a two-atom molecule", () => {
    // The exclusion is a preference, not a prohibition: with nowhere else to
    // go, going back is the only honest answer.
    const mol = buildMolecule((b) => {
      const a = b.atom("C", { x: 0, y: 0 });
      const c = b.atom("O", { x: 1, y: 0 });
      b.bond(a, c);
    });
    expect(nextFocusAtom(mol, "a2", "left", "bonded", "a1")).toBe("a1");
  });

  it("reaches every atom in sequential mode, ring or not", () => {
    for (const mol of [
      benzene(),
      // Two disconnected fragments: no bond joins them, so no graph walk can
      // ever cross.
      buildMolecule((b) => {
        const a = b.atom("C", { x: 0, y: 0 });
        const c = b.atom("C", { x: 1, y: 0 });
        b.bond(a, c);
        const d = b.atom("O", { x: 10, y: 10 });
        const e = b.atom("O", { x: 11, y: 10 });
        b.bond(d, e);
      }),
    ]) {
      const visited = new Set<string>();
      let current: string | undefined = undefined;
      for (let i = 0; i < mol.atomIds.length + 2; i++) {
        current = nextFocusAtom(mol, current, "right", "sequential");
        if (current !== undefined) visited.add(current);
      }
      expect([...visited].sort()).toEqual([...mol.atomIds].sort());
    }
  });

  it("walks the sequential mode backwards on the opposite arrow", () => {
    const mol = benzene();
    const forward = nextFocusAtom(mol, "a1", "right", "sequential");
    expect(nextFocusAtom(mol, forward, "left", "sequential")).toBe("a1");
  });

  it("returns nothing for an empty molecule", () => {
    const mol = buildMolecule(() => undefined);
    expect(nextFocusAtom(mol, undefined, "up")).toBeUndefined();
  });

  it("recovers from a focus id the molecule no longer has", () => {
    // An undo or an erase can leave the roving focus pointing at nothing.
    const mol = benzene();
    expect(nextFocusAtom(mol, "a99", "up")).toBe(mol.atomIds[0]);
  });
});

describe("describeAtom", () => {
  it("names the element and the bond count a screen reader needs", () => {
    const mol = benzene();
    expect(describeAtom(mol, "a1")).toBe("C, 2 bonds, atom 1 of 6");
  });

  it("mentions a charge and a display label", () => {
    const mol = buildMolecule((b) => {
      b.atom("N", { x: 0, y: 0 }, { charge: 1, label: "NR3" });
    });
    expect(describeAtom(mol, "a1")).toBe(
      "N, charge +1, labelled NR3, 0 bonds, atom 1 of 1",
    );
  });

  it("describes no two atoms of benzene identically", () => {
    // THE LIVE REGION ONLY SPEAKS WHEN ITS TEXT CHANGES. Every carbon in
    // benzene is "C, 2 bonds", so before the ordinal was added React wrote
    // the same string on every arrow press, the DOM never mutated, and a
    // screen-reader user heard the first move and then nothing at all for the
    // rest of the ring. This is that bug, pinned.
    const mol = benzene();
    const said = mol.atomIds.map((id) => describeAtom(mol, id));
    expect(new Set(said).size).toBe(mol.atomIds.length);
  });
});
