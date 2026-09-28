import { benzene, type Molecule } from "@starter/chem-core";
import { produce } from "immer";
import { describe, expect, it } from "vitest";

import { assertNotDraft, guardedOps } from "./chem-guard";
import type { GuardedOps } from "./chem-guard";

/** `process.env.NODE_ENV` is typed as a literal union by the Next types, and
 *  the tests need to write an arbitrary value to it (and to restore whatever
 *  was there, including nothing). */
const env = process.env as Record<string, string | undefined>;

function withNodeEnv(value: string | undefined, fn: () => void): void {
  const original = env["NODE_ENV"];
  env["NODE_ENV"] = value;
  try {
    fn();
  } finally {
    env["NODE_ENV"] = original;
  }
}

describe("assertNotDraft", () => {
  it("passes a plain molecule through", () => {
    expect(() => assertNotDraft(benzene(), "removeAtoms")).not.toThrow();
  });

  it("throws on a draft, naming the operation", () => {
    produce(benzene(), (draft) => {
      expect(() => assertNotDraft(draft, "removeAtoms")).toThrow(/removeAtoms/);
    });
  });

  it("throws in development, not merely under the test runner", () => {
    // The guard's condition is `!== "production"`, and vitest sets NODE_ENV to
    // "test". Pinning "development" as well is what makes the assertion match
    // the promise — the tripwire has to be live in `next dev`, which is the
    // only place a developer will ever trip it.
    withNodeEnv("development", () => {
      produce(benzene(), (draft) => {
        expect(() => assertNotDraft(draft, "removeAtoms")).toThrow(
          /removeAtoms received an immer draft/,
        );
      });
    });
  });

  it("is a no-op in production", () => {
    withNodeEnv("production", () => {
      produce(benzene(), (draft) => {
        expect(() => assertNotDraft(draft, "removeAtoms")).not.toThrow();
      });
    });
    // And the check is read per call, not captured at module init: the guard
    // is live again as soon as NODE_ENV goes back.
    produce(benzene(), (draft) => {
      expect(() => assertNotDraft(draft, "removeAtoms")).toThrow();
    });
  });
});

describe("guardedOps", () => {
  it("throws when a draft molecule reaches an op", () => {
    expect(() =>
      produce(benzene(), (draft) => {
        guardedOps.removeAtoms(draft as unknown as Molecule, []);
      }),
    ).toThrow(/removeAtoms/);
  });

  it("throws for every mutating op, not just the first one wired up", () => {
    const mol = benzene();
    const firstAtom = mol.atomIds[0]!;
    const firstBond = mol.bondIds[0]!;

    // KEYED ON `guardedOps` RATHER THAN LISTED FREELY, and the exhaustiveness
    // assertion below is the point of the test. A hand-written array is
    // silently incomplete the moment the facade grows an entry — which is
    // exactly what happened when the drawing ops arrived: seven new ops, none
    // of them attempted here, so an op wired as a bare re-export would have
    // slipped through with the suite green. `Record<keyof GuardedOps, ...>`
    // makes that a type error, and the runtime check catches the reverse.
    const attempts: Record<keyof GuardedOps, (draft: Molecule) => void> = {
      removeAtoms: (d) => void guardedOps.removeAtoms(d, [firstAtom]),
      removeBonds: (d) => void guardedOps.removeBonds(d, [firstBond]),
      updateAtom: (d) => void guardedOps.updateAtom(d, firstAtom, { charge: 1 }),
      updateBond: (d) => void guardedOps.updateBond(d, firstBond, { order: 2 }),
      setAtomPosition: (d) =>
        void guardedOps.setAtomPosition(d, firstAtom, { x: 0, y: 0 }),
      setAtomPositions: (d) =>
        void guardedOps.setAtomPositions(d, [[firstAtom, { x: 0, y: 0 }]]),
      mergeAtoms: (d) => void guardedOps.mergeAtoms(d, mol.atomIds[0]!, mol.atomIds[2]!),
      translateAtoms: (d) => void guardedOps.translateAtoms(d, [firstAtom], { x: 1, y: 1 }),
      rotateAtoms: (d) => void guardedOps.rotateAtoms(d, [firstAtom], { x: 0, y: 0 }, 1),
      flipAtoms: (d) =>
        void guardedOps.flipAtoms(d, [firstAtom], {
          point: { x: 0, y: 0 },
          direction: { x: 0, y: 1 },
        }),
      addAtom: (d) => void guardedOps.addAtom(d, { element: "C" }),
      applyIssueFix: (d) =>
        void guardedOps.applyIssueFix(d, {
          kind: "set-charge",
          title: "Make it C⁺",
          atomId: firstAtom,
          charge: 1,
        }),
      addBond: (d) =>
        void guardedOps.addBond(d, { from: mol.atomIds[0]!, to: mol.atomIds[3]! }),
      extractFragment: (d) => void guardedOps.extractFragment(d, [firstAtom]),
      duplicateFragment: (d) => void guardedOps.duplicateFragment(d, [firstAtom]),
      insertFragment: (d) => void guardedOps.insertFragment(d, benzene()),
      setElement: (d) => void guardedOps.setElement(d, firstAtom, "N"),
      setCharge: (d) => void guardedOps.setCharge(d, firstAtom, 1),
      setIsotope: (d) => void guardedOps.setIsotope(d, firstAtom, 13),
      setLabel: (d) => void guardedOps.setLabel(d, firstAtom, "Ph"),
      setExplicitHydrogenCount: (d) =>
        void guardedOps.setExplicitHydrogenCount(d, firstAtom, 1),
      setBondOrder: (d) => void guardedOps.setBondOrder(d, firstBond, 2),
      cycleBondOrder: (d) => void guardedOps.cycleBondOrder(d, firstBond),
      setBondStereo: (d) => void guardedOps.setBondStereo(d, firstBond, "wedge"),
      setDoubleBondSide: (d) => void guardedOps.setDoubleBondSide(d, firstBond, "left"),
      flipBond: (d) => void guardedOps.flipBond(d, firstBond),
      setLonePairs: (d) => void guardedOps.setLonePairs(d, firstAtom, 1),
      invertStereocentre: (d) => void guardedOps.invertStereocentre(d, firstAtom),
      alignFragments: (d) =>
        void guardedOps.alignFragments(d, [firstAtom], "top"),
      // Benzene has no stereocentre, and deliberately none is needed: the group
      // record layer validates ids against the molecule and never asks whether
      // an atom is stereogenic, so the draft has to be refused before
      // `requireAtom` reads a proxy and the molecule is reassembled around it.
      withStereoGroups: (d) =>
        void guardedOps.withStereoGroups(d, [
          { kind: "and", index: 1, atomIds: [firstAtom] },
        ]),
      sprout: (d) => void guardedOps.sprout(d, firstAtom),
      sproutTo: (d) =>
        void guardedOps.sproutTo(d, firstAtom, {
          kind: "new-atom",
          pos: { x: 5, y: 5 },
          angle: 0,
        }),
      fuseRingOnBond: (d) => void guardedOps.fuseRingOnBond(d, firstBond, "benzene"),
      attachRingToAtom: (d) => void guardedOps.attachRingToAtom(d, firstAtom, "benzene"),
      spiroRingAtAtom: (d) => void guardedOps.spiroRingAtAtom(d, firstAtom, "benzene"),
      appendChain: (d) => void guardedOps.appendChain(d, firstAtom, 3),
      attachGroupToAtom: (d) => void guardedOps.attachGroupToAtom(d, firstAtom, "COOH"),
    };

    // The facade and the attempts cover each other. Without this the object
    // above could go stale the other way — an op removed from the facade would
    // leave a dead attempt that still passed.
    expect(Object.keys(attempts).sort()).toEqual(Object.keys(guardedOps).sort());

    for (const [name, attempt] of Object.entries(attempts)) {
      expect(() =>
        produce(mol, (draft) => {
          attempt(draft as unknown as Molecule);
        }),
        `${name} should have refused a draft`,
      ).toThrow(new RegExp(name));
    }
  });

  it("guards the fragment argument of insertFragment too", () => {
    const target = benzene();
    expect(() =>
      produce(benzene(), (draft) => {
        guardedOps.insertFragment(target, draft as unknown as Molecule);
      }),
    ).toThrow(/insertFragment\(fragment\)/);
  });

  it("delegates normally when handed a real molecule", () => {
    const mol = benzene();
    const stripped = guardedOps.removeAtoms(mol, [mol.atomIds[0]!]);
    expect(stripped.atomIds).toHaveLength(5);

    // A no-op still comes back by reference, so the store's identity check
    // ("did anything change?") keeps working through the facade.
    expect(guardedOps.removeAtoms(mol, [])).toBe(mol);

    const moved = guardedOps.translateAtoms(mol, mol.atomIds, { x: 10, y: 0 });
    expect(moved.atoms[mol.atomIds[0]!]?.pos.x).toBeCloseTo(
      (mol.atoms[mol.atomIds[0]!]?.pos.x ?? 0) + 10,
      9,
    );
  });

  it("lets a draft through in production, where the guard is compiled out", () => {
    withNodeEnv("production", () => {
      expect(() =>
        produce(benzene(), (draft) => {
          guardedOps.removeAtoms(draft as unknown as Molecule, []);
        }),
      ).not.toThrow();
    });
  });
});
