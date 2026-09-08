import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { benzene } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import {
  createMemoryDocumentStore,
  type MemoryDocumentStore,
} from "@/persistence/memory-store";
import { setDocumentStore } from "@/persistence/documents";
import { recordFor } from "@/persistence/record";
import { documentThumbnail } from "@/persistence/thumbnail";

import RecentsPage, { copyOf } from "./page";

/**
 * The landing page used to be a synchronous server component printing
 * benzene's formula, and both this file and `e2e/smoke.spec.ts` pinned that
 * placeholder. It is now the recents grid, so both had to be rewritten — the
 * placeholder was the thing this task replaces.
 */

let store: MemoryDocumentStore;

function seed(id: string, title: string, modifiedAt: string) {
  const doc = createDocument({ id, title, molecule: benzene(), now: modifiedAt });
  return recordFor(doc, documentThumbnail(doc));
}

beforeEach(() => {
  store = createMemoryDocumentStore();
  setDocumentStore(store);
});

afterEach(() => {
  setDocumentStore(null);
  vi.restoreAllMocks();
});

describe("the recents grid", () => {
  it("says so when there is nothing saved yet", async () => {
    render(<RecentsPage />);
    expect(await screen.findByText("No sketches yet.")).toBeInTheDocument();
  });

  it("LISTS WITHOUT DESERIALIZING A SINGLE MOLECULE", async () => {
    // The acceptance criterion. `get` is the call that decodes; the grid must
    // never make it.
    await store.put(seed("doc_1", "Benzene", "2024-01-01T00:00:00.000Z"));
    await store.put(seed("doc_2", "Toluene", "2024-02-01T00:00:00.000Z"));

    render(<RecentsPage />);
    await screen.findByText("Toluene");

    expect(store.counts.listMeta).toBeGreaterThan(0);
    expect(store.counts.get).toBe(0);
  });

  it("renders the formula and the counts from the meta row", async () => {
    await store.put(seed("doc_1", "Benzene", "2024-01-01T00:00:00.000Z"));
    render(<RecentsPage />);
    await screen.findByText("Benzene");
    expect(screen.getByText("C₆H₆")).toBeInTheDocument();
    expect(screen.getByText("6 atoms · 6 bonds")).toBeInTheDocument();
  });

  it("links each card at /editor?doc=<id>, a query parameter and not a path segment", async () => {
    // A dynamic route segment cannot be statically exported: nothing can
    // enumerate ids that live in a visitor's IndexedDB.
    await store.put(seed("doc_1", "Benzene", "2024-01-01T00:00:00.000Z"));
    render(<RecentsPage />);
    await screen.findByText("Benzene");
    expect(screen.getByText("Benzene").closest("a")).toHaveAttribute(
      "href",
      "/editor?doc=doc_1",
    );
  });

  it("shows the newest first", async () => {
    await store.put(seed("old", "Older", "2024-01-01T00:00:00.000Z"));
    await store.put(seed("new", "Newer", "2024-06-01T00:00:00.000Z"));
    render(<RecentsPage />);
    await screen.findByText("Newer");
    const cards = screen.getAllByRole("listitem");
    expect(cards[0]).toHaveAttribute("data-doc-id", "new");
  });

  it("renames a sketch", async () => {
    await store.put(seed("doc_1", "Benzene", "2024-01-01T00:00:00.000Z"));
    vi.spyOn(window, "prompt").mockReturnValue("Cyclohexatriene");
    render(<RecentsPage />);
    await screen.findByText("Benzene");

    fireEvent.click(screen.getByLabelText("Rename"));
    expect(await screen.findByText("Cyclohexatriene")).toBeInTheDocument();
  });

  it("deletes a sketch, after asking", async () => {
    await store.put(seed("doc_1", "Benzene", "2024-01-01T00:00:00.000Z"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<RecentsPage />);
    await screen.findByText("Benzene");

    fireEvent.click(screen.getByLabelText("Delete"));
    expect(await screen.findByText("No sketches yet.")).toBeInTheDocument();
  });

  it("keeps the sketch when the confirmation is declined", async () => {
    await store.put(seed("doc_1", "Benzene", "2024-01-01T00:00:00.000Z"));
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<RecentsPage />);
    await screen.findByText("Benzene");

    fireEvent.click(screen.getByLabelText("Delete"));
    await waitFor(() => {
      expect(screen.getByText("Benzene")).toBeInTheDocument();
    });
  });

  it("duplicates under a NEW id, so the copy cannot overwrite its source", async () => {
    await store.put(seed("doc_1", "Benzene", "2024-01-01T00:00:00.000Z"));
    render(<RecentsPage />);
    await screen.findByText("Benzene");

    fireEvent.click(screen.getByLabelText("Duplicate"));
    await screen.findByText("Benzene copy");

    const listed = await store.listMeta();
    expect(listed.ok && listed.value).toHaveLength(2);
    const ids = listed.ok ? listed.value.map((meta) => meta.id) : [];
    expect(new Set(ids).size).toBe(2);
  });

  it("surfaces a refused write rather than pretending the rename worked", async () => {
    // A rename that failed and one that succeeded look identical from a grid
    // that re-reads and shrugs.
    await store.put(seed("doc_1", "Benzene", "2024-01-01T00:00:00.000Z"));
    store.failWith("quota", "There is no room left in this browser's storage.");
    vi.spyOn(window, "prompt").mockReturnValue("Renamed");

    render(<RecentsPage />);
    await screen.findByText("Benzene");
    fireEvent.click(screen.getByLabelText("Rename"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no room left/i);
    // And the card still says what it actually says in storage.
    expect(screen.getByText("Benzene")).toBeInTheDocument();
  });
});

describe("copyOf", () => {
  it("mints a new id and keeps the chemistry", () => {
    const doc = createDocument({ id: "doc_1", title: "Benzene", molecule: benzene() });
    const copy = copyOf(doc);
    expect(copy.id).not.toBe(doc.id);
    expect(copy.metadata.title).toBe("Benzene copy");
    expect(copy.molecule).toBe(doc.molecule);
    expect(copy.panels).toBe(doc.panels);
  });
});
