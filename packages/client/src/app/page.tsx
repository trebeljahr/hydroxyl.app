"use client";

/**
 * `/` — the sketches you have. Create, open, rename, duplicate, delete.
 *
 * ── IT READS THE META STORE AND NOTHING ELSE ───────────────────────────────
 *
 * Every card here is rendered from a `DocumentMeta` row: the title, the
 * timestamps, the formula and the atom and bond counts, all denormalised at
 * save time. Not one molecule is decoded to draw this page, and that is a
 * structural property rather than a good intention — `DocumentStore.listMeta`
 * opens a transaction over the `meta` object store alone, so a future edit
 * that reached for a document there would throw rather than quietly turn the
 * landing page into a full library deserialization.
 *
 * The thumbnails are the one extra read, and they are SVG text written at save
 * time by a pure function (see persistence/thumbnail.ts) — still no molecule.
 *
 * ── WHAT IT DELIBERATELY DOES NOT IMPORT ───────────────────────────────────
 *
 * `@/state`, because importing the editor store instantiates it and flips
 * immer's global auto-freeze setting on a route that has no editor. And
 * `@/lib/rdkit`, because `e2e/rdkit.spec.ts` asserts that loading `/` fetches
 * nothing from RDKit and a static import would make that promise rest on the
 * bridge's laziness rather than on the module graph.
 *
 * ── AND A DUPLICATE MUST MINT A NEW ID ─────────────────────────────────────
 *
 * `createDocument` does. All three object stores key on `doc.id`, and the
 * canvas frames its view on `doc.id` too, so a copy that kept the original's
 * id would overwrite its own source the first time either was saved.
 */

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { FilePlus2Icon, PencilIcon, CopyIcon, Trash2Icon } from "lucide-react";

import { createDocument } from "@starter/shared";
import type { SketchDocument } from "@starter/shared";

import { documentStore, duplicateDocument } from "@/persistence/documents";
import type { DocumentMeta } from "@/persistence/types";
import { cn } from "@/lib/utils";

interface Row {
  readonly meta: DocumentMeta;
  readonly thumbnail: string | null;
}

function formatWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A copy of `doc` under a fresh id, named the way every file manager names
 *  one. `createDocument` mints the id; see the header for why that matters. */
export function copyOf(doc: SketchDocument, now?: string): SketchDocument {
  return createDocument({
    molecule: doc.molecule,
    title: `${doc.metadata.title} copy`,
    stylePreset: doc.stylePreset,
    panels: doc.panels,
    now,
  });
}

export default function RecentsPage(): ReactElement {
  const [rows, setRows] = useState<readonly Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Read the library. NO setState in here, deliberately.
   *
   * An effect body that calls a function which sets state synchronously
   * triggers a cascading render, and the lint rule that says so is right: the
   * effect's job is to talk to the external system (storage), and React finds
   * out from the callback. Splitting the read from the write is what keeps
   * that true whatever this function is called from.
   */
  const read = useCallback(async (): Promise<
    { readonly rows: readonly Row[]; readonly error: string | null }
  > => {
    const store = documentStore();
    const listed = await store.listMeta();
    if (!listed.ok) return { rows: [], error: listed.error.message };
    // Thumbnails only, never `get` — see the header.
    const withThumbnails = await Promise.all(
      listed.value.map(async (meta) => {
        const thumbnail = await store.getThumbnail(meta.id);
        return { meta, thumbnail: thumbnail.ok ? thumbnail.value : null };
      }),
    );
    return { rows: withThumbnails, error: null };
  }, []);

  const refresh = useCallback(async () => {
    const next = await read();
    setRows(next.rows);
    // NOT `setError(null)` on success. Every action below re-lists when it
    // finishes, including the ones that FAILED, so clearing on a successful
    // listing would wipe a rename's quota message the moment the grid redrew —
    // the silent failure this whole task is about, reintroduced one level up.
    // The actions clear it themselves, before they run.
    if (next.error !== null) setError(next.error);
  }, [read]);

  useEffect(() => {
    let cancelled = false;
    void read().then((next) => {
      if (cancelled) return;
      setRows(next.rows);
      setError(next.error);
    });
    return () => {
      cancelled = true;
    };
  }, [read]);

  const onRename = useCallback(
    async (meta: DocumentMeta) => {
      const next = window.prompt("Rename this sketch", meta.title);
      if (next === null || next.trim() === "" || next === meta.title) return;
      setError(null);
      const result = await documentStore().rename(meta.id, next.trim());
      if (!result.ok) setError(result.error.message);
      await refresh();
    },
    [refresh],
  );

  const onDuplicate = useCallback(
    async (meta: DocumentMeta) => {
      setError(null);
      const result = await duplicateDocument(meta.id, (doc) => copyOf(doc));
      if (!result.ok) setError(result.error.message);
      await refresh();
    },
    [refresh],
  );

  const onDelete = useCallback(
    async (meta: DocumentMeta) => {
      if (!window.confirm(`Delete “${meta.title}”? This cannot be undone.`)) return;
      setError(null);
      const result = await documentStore().remove(meta.id);
      if (!result.ok) setError(result.error.message);
      await refresh();
    },
    [refresh],
  );

  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="flex items-center gap-4 border-b px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight">Chemistry Sketcher</h1>
        <Link
          href="/editor"
          data-recents="new"
          className="bg-primary text-primary-foreground ml-auto flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium"
        >
          <FilePlus2Icon className="size-4" />
          New sketch
        </Link>
      </header>

      <main className="p-6">
        {error === null ? null : (
          <p
            data-recents="error"
            role="alert"
            className="text-destructive mb-4 text-sm font-medium"
          >
            {error}
          </p>
        )}

        {rows === null ? (
          <p data-recents="loading" className="text-muted-foreground text-sm">
            Looking for your sketches…
          </p>
        ) : rows.length === 0 ? (
          <div data-recents="empty" className="text-muted-foreground max-w-prose text-sm">
            <p className="mb-2">No sketches yet.</p>
            <p>
              Start a new one, or drop a <code className="font-mono">.mol</code>,{" "}
              <code className="font-mono">.sdf</code> or SMILES onto the editor.
            </p>
          </div>
        ) : (
          <ul
            data-recents="grid"
            className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4"
          >
            {rows.map(({ meta, thumbnail }) => (
              <li
                key={meta.id}
                data-recents="card"
                data-doc-id={meta.id}
                className="bg-card flex flex-col overflow-hidden rounded-lg border"
              >
                <Link
                  href={`/editor?doc=${encodeURIComponent(meta.id)}`}
                  data-recents="open"
                  className="focus-visible:ring-ring flex flex-1 flex-col focus-visible:outline-none focus-visible:ring-2"
                >
                  <div
                    className={cn(
                      "flex h-32 items-center justify-center overflow-hidden border-b bg-white p-2",
                    )}
                  >
                    {thumbnail === null ? (
                      <span className="font-mono text-lg text-neutral-500">
                        {meta.formulaUnicode === "" ? "Empty" : meta.formulaUnicode}
                      </span>
                    ) : (
                      // The stored fragment is SVG this app generated from its
                      // own scene graph — never a file's contents — so there is
                      // no untrusted markup here.
                      <div
                        data-recents="thumbnail"
                        className="[&>svg]:max-h-full [&>svg]:max-w-full"
                        dangerouslySetInnerHTML={{ __html: thumbnail }}
                      />
                    )}
                  </div>
                  <div className="flex-1 px-3 py-2">
                    <p data-recents="title" className="truncate text-sm font-medium">
                      {meta.title}
                    </p>
                    <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">
                      {meta.formulaUnicode === "" ? "Empty sketch" : meta.formulaUnicode}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {meta.atomCount} atoms · {meta.bondCount} bonds
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {formatWhen(meta.modifiedAt)}
                    </p>
                  </div>
                </Link>
                <div className="flex items-center gap-1 border-t px-2 py-1.5">
                  <CardButton
                    label="Rename"
                    action="rename"
                    onClick={() => void onRename(meta)}
                  >
                    <PencilIcon className="size-3.5" />
                  </CardButton>
                  <CardButton
                    label="Duplicate"
                    action="duplicate"
                    onClick={() => void onDuplicate(meta)}
                  >
                    <CopyIcon className="size-3.5" />
                  </CardButton>
                  <CardButton
                    label="Delete"
                    action="delete"
                    onClick={() => void onDelete(meta)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </CardButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function CardButton({
  label,
  action,
  onClick,
  children,
}: {
  readonly label: string;
  readonly action: string;
  readonly onClick: () => void;
  readonly children: ReactElement;
}): ReactElement {
  return (
    <button
      type="button"
      data-recents={action}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="hover:bg-accent focus-visible:ring-ring flex size-7 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2"
    >
      {children}
    </button>
  );
}
