import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { benzene, buildMolecule, vec } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { createMemoryDocumentStore, type MemoryDocumentStore } from "@/persistence/memory-store";
import { setDocumentStore } from "@/persistence/documents";
import { recordFor } from "@/persistence/record";
import { flushEditorDocument, resetEditorPersistence } from "@/persistence/session";
import { editorStore, guardedOps } from "@/state";

// The shell is the canvas, the rails and the panels — none of which decide
// which document is open. What is under test is the page's mount effect.
vi.mock("@/shell", () => ({ EditorShell: () => null }));

// The page installs the real IndexedDB store on mount (`setDocumentStore(null)`
// clears any `?storage=` override), and jsdom has no IndexedDB. Only the
// page's own call is neutralised; the store this file installs through
// `@/persistence/documents` is the one every read and write goes to.
vi.mock("@/persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/persistence")>()),
  setDocumentStore: () => undefined,
}));

import EditorPage from "./page";

function ethanol() {
  return buildMolecule((b) => {
    const c1 = b.atom("C", vec(0, 0));
    const c2 = b.atom("C", vec(1.5, 0));
    const o = b.atom("O", vec(2.25, 1.3));
    b.bond(c1, c2);
    b.bond(c2, o);
  });
}

const FIRST = createDocument({ id: "doc_first", title: "Ethanol", molecule: ethanol() });
const SECOND = createDocument({ id: "doc_second", title: "Benzene", molecule: benzene() });

let store: MemoryDocumentStore;

beforeEach(async () => {
  store = createMemoryDocumentStore();
  setDocumentStore(store);
  await store.put(recordFor(FIRST));
  await store.put(recordFor(SECOND));
});

afterEach(() => {
  resetEditorPersistence();
  setDocumentStore(null);
  window.history.replaceState(null, "", "/");
});

function visit(search: string) {
  window.history.replaceState(null, "", `/editor${search}`);
  return render(<EditorPage />);
}

describe("/editor?doc=<id>", () => {
  it("opens THAT document on a second visit in the same tab, not the leftover", async () => {
    // `editorStore` is a module singleton and survives a client-side
    // navigation. The load used to run only into an EMPTY molecule, so any
    // earlier visit left the canvas non-empty, the read was skipped, and the
    // leftover was baselined under the old id: the URL named one sketch, the
    // canvas showed another, and the first edit forked a new record.
    const first = visit(`?doc=${FIRST.id}`);
    await waitFor(() => {
      expect(editorStore.getState().document.id).toBe(FIRST.id);
    });
    first.unmount();

    visit(`?doc=${SECOND.id}`);
    await waitFor(() => {
      expect(editorStore.getState().document.id).toBe(SECOND.id);
    });
    expect(editorStore.getState().document.molecule.atomIds).toHaveLength(6);

    // And the first edit lands on the document the URL names, not a fork.
    editorStore
      .getState()
      .applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, m.atomIds[0]!, "N"));
    const result = await flushEditorDocument();
    expect(result?.ok).toBe(true);

    const listed = await store.listMeta();
    expect(listed.ok && listed.value.map((meta) => meta.id).sort()).toEqual(
      [FIRST.id, SECOND.id].sort(),
    );
    const reread = await store.get(SECOND.id);
    expect(reread.ok && reread.value.molecule.atoms[reread.value.molecule.atomIds[0]!]?.element).toBe(
      "N",
    );
  });
});
