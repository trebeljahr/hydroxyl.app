import { benzene, type Molecule } from "@starter/chem-core";
import { produce } from "immer";
import { describe, expect, it } from "vitest";

import { assertNotDraft, guardedOps } from "./chem-guard";

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

    const attempts: ReadonlyArray<readonly [string, (draft: Molecule) => void]> = [
      ["removeAtoms", (d) => void guardedOps.removeAtoms(d, [firstAtom])],
      ["removeBonds", (d) => void guardedOps.removeBonds(d, [firstBond])],
      ["updateAtom", (d) => void guardedOps.updateAtom(d, firstAtom, { charge: 1 })],
      ["updateBond", (d) => void guardedOps.updateBond(d, firstBond, { order: 2 })],
      [
        "setAtomPosition",
        (d) => void guardedOps.setAtomPosition(d, firstAtom, { x: 0, y: 0 }),
      ],
      [
        "setAtomPositions",
        (d) => void guardedOps.setAtomPositions(d, [[firstAtom, { x: 0, y: 0 }]]),
      ],
      [
        "mergeAtoms",
        (d) => void guardedOps.mergeAtoms(d, mol.atomIds[0]!, mol.atomIds[2]!),
      ],
      [
        "translateAtoms",
        (d) => void guardedOps.translateAtoms(d, [firstAtom], { x: 1, y: 1 }),
      ],
      [
        "rotateAtoms",
        (d) => void guardedOps.rotateAtoms(d, [firstAtom], { x: 0, y: 0 }, 1),
      ],
      [
        "flipAtoms",
        (d) =>
          void guardedOps.flipAtoms(d, [firstAtom], {
            point: { x: 0, y: 0 },
            direction: { x: 0, y: 1 },
          }),
      ],
      ["addAtom", (d) => void guardedOps.addAtom(d, { element: "C" })],
      [
        "addBond",
        (d) => void guardedOps.addBond(d, { from: mol.atomIds[0]!, to: mol.atomIds[3]! }),
      ],
      ["extractFragment", (d) => void guardedOps.extractFragment(d, [firstAtom])],
      ["insertFragment(target)", (d) => void guardedOps.insertFragment(d, benzene())],
    ];

    for (const [name, attempt] of attempts) {
      expect(() =>
        produce(mol, (draft) => {
          attempt(draft as unknown as Molecule);
        }),
        `${name} should have refused a draft`,
      ).toThrow(new RegExp(name.split("(")[0]!));
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
