import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildMolecule, emptyMolecule, vec } from "@starter/chem-core";
import { ethanol } from "@starter/chem-render";
import { createDocument } from "@starter/shared";

import { createEditorStore, type EditorStore } from "@/state";

const saved = vi.hoisted(() => ({ calls: [] as { blob: Blob; filename: string; mimeType: string }[] }));
vi.mock("@/lib/io/file-system", () => ({
  writeBlobFile: vi.fn(async (blob: Blob, filename: string, mimeType: string) => {
    saved.calls.push({ blob, filename, mimeType });
    return { ok: true };
  }),
}));

import { exportCdxml } from "./figure";

function editor(molecule = ethanol(), title = "Ethanol"): EditorStore {
  const document = createDocument({ molecule, now: "2024-01-01T00:00:00.000Z" });
  return createEditorStore({
    document: { ...document, metadata: { ...document.metadata, title } },
    viewportSize: { width: 800, height: 600 },
  });
}

beforeEach(() => {
  saved.calls = [];
});

describe("exportCdxml", () => {
  it("saves the structure as a .cdxml named after the sketch", async () => {
    const store = editor();
    await exportCdxml(store);
    expect(saved.calls).toHaveLength(1);
    const [call] = saved.calls;
    expect(call!.filename).toMatch(/\.cdxml$/);
    expect(call!.mimeType).toBe("chemical/x-cdxml");
    const text = await call!.blob.text();
    expect(text).toContain("<CDXML");
    expect(text).toContain(`Element="8"`);
    expect(store.getState().ui.statusMessage).toBe("Downloaded the structure as CDXML.");
  });

  it("says what CDXML could not hold", async () => {
    const butene = buildMolecule((b) => {
      const c1 = b.atom("C", vec(0, 0));
      const c2 = b.atom("C", vec(0.87, 0.5));
      const c3 = b.atom("C", vec(1.73, 0));
      const c4 = b.atom("C", vec(2.6, 0.5));
      b.bond(c1, c2, 1);
      b.bond(c2, c3, 2, "either");
      b.bond(c3, c4, 1);
    });
    const store = editor(butene, "Butene");
    await exportCdxml(store);
    expect(store.getState().ui.statusMessage).toMatch(/^Downloaded the structure as CDXML\. .*crossed double bond/);
  });

  it("refuses an empty drawing without saving anything", async () => {
    const store = editor(emptyMolecule(), "Empty");
    await exportCdxml(store);
    expect(saved.calls).toHaveLength(0);
    expect(store.getState().ui.statusMessage).toMatch(/no CDXML/);
  });
});
