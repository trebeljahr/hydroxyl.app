/**
 * "Clean up structure": re-lay-out the drawing with RDKit's CoordGen.
 *
 * This is the sanctioned fix for the overlaps chem-render's collision pass
 * only REPORTS. Nothing nudges coordinates behind the author's back — an
 * export that diverged from what they drew is worse than a visible collision —
 * so the repair is a command they ask for, and one undo puts it back.
 *
 * ── THREE THINGS THE OBVIOUS IMPLEMENTATION GETS WRONG ─────────────────────
 *
 * 1. IT CANNOT BE A TRANSACTION, because `generate2DCoords` is ASYNC and
 *    `transact(label, fn)` takes a synchronous function. Opening a transaction
 *    and awaiting inside it would leave one open across every pointer event
 *    the user fires while the wasm loads — the single failure this codebase
 *    cannot survive. It does not need one either: ONE `applyMoleculeEdit` is
 *    already one history entry.
 *
 * 2. THE ATOM IDS DO NOT SURVIVE. `generate2DCoords` writes a molblock and
 *    reads it back, and `readMolblock` mints ids from a1 with a fresh
 *    `nextId`. So the returned molecule is ISOMORPHIC to the one that went in,
 *    not identical to it: the graph, the elements, the charges and the bond
 *    orders are the same, the identities are not. `pruneSelection` is purely
 *    subtractive and therefore empties the selection, which is the honest
 *    outcome — there is no id to carry it onto.
 *
 * 3. THE MOLECULE CAN CHANGE DURING THE AWAIT. Loading the wasm takes long
 *    enough to draw another bond in. Writing the result unconditionally would
 *    silently discard that bond, so the molecule is re-checked by REFERENCE
 *    before the write and the command declines rather than clobbers.
 *
 * ── AND WHY THE IMPORT IS DYNAMIC ──────────────────────────────────────────
 *
 * `e2e/rdkit.spec.ts` asserts that loading /editor fetches nothing matching
 * the RDKit assets. A static import would be safe today — `ensureWorker()` is
 * lazy — but it would put the bridge in the /editor chunk and make that
 * guarantee depend on a laziness nothing enforces. Importing inside `run`
 * keeps the 6.9 MB wasm and its glue out of the route entirely until someone
 * asks for a layout.
 */

import type { Molecule } from "@starter/chem-core";
import type { EditorStore } from "@/state";

export const CLEAN_UP_LABEL = "Clean up structure";

/** So a test can drive the whole command without the wasm. */
export type Generate2DCoords = (
  mol: Molecule,
) => Promise<{ readonly ok: true; readonly value: Molecule } | {
  readonly ok: false;
  readonly error: { readonly message: string };
}>;

export async function cleanUpStructure(
  store: EditorStore,
  generate?: Generate2DCoords,
): Promise<void> {
  const before = store.getState().document.molecule;
  if (before.atomIds.length === 0) {
    store.getState().setStatusMessage("There is nothing to clean up yet");
    return;
  }

  store.getState().setStatusMessage("Cleaning up the structure…");

  const layout =
    generate ?? ((mol: Molecule) => import("@/lib/rdkit").then((m) => m.generate2DCoords(mol)));

  let result: Awaited<ReturnType<Generate2DCoords>>;
  try {
    result = await layout(before);
  } catch (error) {
    store
      .getState()
      .setStatusMessage(
        error instanceof Error && error.message.length > 0
          ? error.message
          : "The structure could not be cleaned up",
      );
    return;
  }

  if (!result.ok) {
    // Surfaced VERBATIM rather than flattened to "failed". The two failures
    // reachable from a real drawing both name what is wrong and what to do:
    // `MolblockLabelError` lists the atoms carrying a cosmetic label (decision
    // 8 — a `Ph` is never silently written as a methyl), and the unkekulizable
    // case names the aromatic-flagged atoms no Kekule structure resolves.
    store.getState().setStatusMessage(result.error.message);
    return;
  }

  // Read out of the union before the closure below captures it: `result` is a
  // `let`, and TypeScript does not carry a narrowing into a callback over a
  // mutable binding.
  const cleaned = result.value;
  const state = store.getState();
  if (state.document.molecule !== before) {
    state.setStatusMessage(
      "The drawing changed while it was being cleaned up, so nothing was moved",
    );
    return;
  }

  // ONE entry. `applyMoleculeEdit` records the whole change against the
  // snapshot it took before running the edit, so a single undo restores both
  // the coordinates and the selection that was live when the command ran.
  state.applyMoleculeEdit(CLEAN_UP_LABEL, () => cleaned);
  state.setStatusMessage(
    "Structure cleaned up — the layout is new, so the selection was cleared",
  );
}
