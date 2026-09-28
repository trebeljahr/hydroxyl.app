"use client";

/**
 * `/` — the sketches you have. Create, open, rename, duplicate, delete, and
 * move the whole library in and out as one file.
 *
 * ── A CLIENT COMPONENT BEHIND A SERVER PAGE ────────────────────────────────
 *
 * `page.tsx` is a server component that renders this with the landing page
 * as a prop. The landing page composes its example figure at build time, and
 * a prop is how a client component can show server-rendered markup without
 * importing — and so shipping — the code that made it. With no sketches in
 * this browser the grid shows that page (decision 109); with any, the header
 * links to it instead.
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
 * `copyOf` does. All three object stores key on `doc.id`, and the canvas
 * frames its view on `doc.id` too, so a copy that kept the original's id
 * would overwrite its own source the first time either was saved.
 *
 * ── THE CARDS ARE PLAIN ANCHORS, NOT `next/link`, AND THAT IS A FIX ────────
 *
 * Measured in the static export: a client-side router navigation to
 * `/editor?doc=…` pushed `/editor/?doc=…` — with a trailing slash, and without
 * loading a document — after which the page's own relative `./_next/…` prefix
 * resolved into a directory that has no assets, every later chunk 404'd, and
 * reloading the URL the router had left in the address bar rendered nothing
 * at all. Before this page existed nothing in the app linked to another route,
 * so the export was only ever entered by direct URL and the failure had
 * nowhere to appear. `@/lib/deployment` computes an href that is correct in
 * both builds — from the BUILD FLAG, so the prerendered HTML is already right
 * and there is no window in which the link points at a file that does not
 * exist — and a full-page navigation loads a real document at the depth its
 * asset prefix was written for.
 *
 * ── AND THE GRID LISTENS FOR THE OTHER TABS ────────────────────────────────
 *
 * One origin has one IndexedDB. Deleting a sketch in this tab used to leave
 * another tab's grid still offering the card. See persistence/broadcast.ts.
 */

import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import {
  CopyIcon,
  DownloadIcon,
  FilePlus2Icon,
  PencilIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";

import { onDocumentChange } from "@/persistence/broadcast";
import {
  copyOf,
  documentStore,
  duplicateDocument,
  removeDocument,
  renameDocument,
} from "@/persistence/documents";
import { recoverJournaledDocuments } from "@/persistence/session";
import {
  formatBytes,
  readStorageStatus,
  requestPersistentStorage,
  type StorageStatus,
} from "@/persistence/storage-status";
import type { DocumentMeta } from "@/persistence/types";
import { aboutHref, editorHref } from "@/lib/deployment";
import { exportLibrary, importIntoLibrary, type ActionReport } from "@/lib/io/library-actions";
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

/** Re-exported so the grid's own test can reach it and so this file still
 *  reads as owning the rule in its header. The function lives beside the
 *  store, because the import path forks a document for the same reason. */
export { copyOf };

export interface RecentsPageProps {
  /** Shown instead of the grid while this browser holds no sketches. Absent
   *  in the unit tests, which then see the one-line empty state. */
  readonly landing?: ReactNode;
}

export default function RecentsPage({ landing }: RecentsPageProps = {}): ReactElement {
  const [rows, setRows] = useState<readonly Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Success lines ("Imported 12 sketches.") — kept apart from `error`, which
  // is an alert and is announced as one.
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    // RECOVERED BEFORE THE FIRST LISTING. The journal holds a sketch whose
    // write the last teardown interrupted, and navigating away from the editor
    // is the commonest way to strand one — so this page is very often the
    // first thing loaded after it happened. Listing first would show the
    // superseded row, or no row at all for a sketch that had never reached
    // storage. Recovery only writes; the listing below then sees it.
    void recoverJournaledDocuments()
      .then(() => read())
      .then((next) => {
        if (cancelled) return;
        setRows(next.rows);
        setError(next.error);
      });
    return () => {
      cancelled = true;
    };
  }, [read]);

  // Another tab saved, renamed or deleted something. Without this the grid
  // keeps offering a card whose document is gone, and opening it lands on
  // "No saved document with the id …".
  useEffect(() => onDocumentChange(() => void refresh()), [refresh]);

  const onRename = useCallback(
    async (meta: DocumentMeta) => {
      const next = window.prompt("Rename this sketch", meta.title);
      if (next === null || next.trim() === "" || next === meta.title) return;
      setError(null);
      const result = await renameDocument(meta.id, next.trim());
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
      const result = await removeDocument(meta.id);
      if (!result.ok) setError(result.error.message);
      await refresh();
    },
    [refresh],
  );

  /** Run an import or export and put its sentence where the user will see
   *  it. A cancelled picker says nothing. */
  const runAction = useCallback(
    async (action: () => Promise<ActionReport>) => {
      setError(null);
      setNotice(null);
      setBusy(true);
      try {
        const report = await action();
        if (report.outcome === "failed") setError(report.message);
        else if (report.outcome === "done") setNotice(report.message);
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [refresh],
  );

  const empty = rows !== null && rows.length === 0;
  const showLanding = empty && landing !== undefined;

  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-6">
        {/* The page's h1 is the landing headline when the landing shows. */}
        {showLanding ? (
          <p className="text-lg font-semibold tracking-tight">Chemistry Sketcher</p>
        ) : (
          <h1 className="text-xl font-semibold tracking-tight">Chemistry Sketcher</h1>
        )}
        <nav className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          {showLanding ? null : (
            <a
              href={aboutHref()}
              data-recents="about"
              className="text-muted-foreground hover:text-foreground rounded-md px-2 py-1.5"
            >
              About
            </a>
          )}
          <button
            type="button"
            data-recents="import"
            disabled={busy}
            onClick={() => void runAction(() => importIntoLibrary())}
            className="hover:bg-accent flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-medium disabled:opacity-50"
          >
            <UploadIcon className="size-4" />
            Import
          </button>
          {rows !== null && rows.length > 0 ? (
            <button
              type="button"
              data-recents="export-all"
              disabled={busy}
              onClick={() => void runAction(() => exportLibrary())}
              className="hover:bg-accent flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-medium disabled:opacity-50"
            >
              <DownloadIcon className="size-4" />
              Export all sketches
            </button>
          ) : null}
          <a
            href={editorHref()}
            data-recents="new"
            className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium"
          >
            <FilePlus2Icon className="size-4" />
            New sketch
          </a>
        </nav>
      </header>

      <main className={showLanding ? "" : "p-4 sm:p-6"}>
        {notice === null ? null : (
          <p
            data-recents="notice"
            role="status"
            className={cn("text-sm font-medium", showLanding ? "mx-auto max-w-5xl px-4 pt-4 sm:px-6" : "mb-4")}
          >
            {notice}
          </p>
        )}
        {error === null ? null : (
          <p
            data-recents="error"
            role="alert"
            className={cn(
              "text-destructive text-sm font-medium",
              showLanding ? "mx-auto max-w-5xl px-4 pt-4 sm:px-6" : "mb-4",
            )}
          >
            {error}
          </p>
        )}

        {rows === null ? (
          <p data-recents="loading" className="text-muted-foreground text-sm">
            Looking for your sketches…
          </p>
        ) : rows.length === 0 ? (
          showLanding ? (
            <div data-recents="empty">{landing}</div>
          ) : (
            <div data-recents="empty" className="text-muted-foreground max-w-prose text-sm">
              <p className="mb-2">No sketches yet.</p>
              <p>
                Start a new one, or drop a <code className="font-mono">.mol</code>,{" "}
                <code className="font-mono">.sdf</code> or SMILES onto the editor.
              </p>
            </div>
          )
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
                <a
                  href={editorHref(meta.id)}
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
                </a>
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
        {rows !== null && rows.length > 0 ? <StorageLine rows={rows} /> : null}
      </main>
    </div>
  );
}

/**
 * Where the library lives, how big it is, and whether the browser has
 * promised to keep it (decision 108). See persistence/storage-status.ts for
 * why `persist()` waits for a click.
 *
 * Re-read whenever the listing changes, so the size follows an import or a
 * delete. `rows` is the trigger, not an input.
 */
function StorageLine({ rows }: { readonly rows: readonly Row[] }): ReactElement {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readStorageStatus().then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const onKeep = useCallback(async () => {
    const granted = await requestPersistentStorage();
    setDeclined(granted === false);
    setStatus(await readStorageStatus());
  }, []);

  return (
    <footer
      data-recents="storage"
      className="text-muted-foreground mt-8 max-w-prose space-y-1 border-t pt-4 text-sm"
    >
      <p>
        Your sketches are stored in this browser only
        {status?.usageBytes === null || status === null
          ? "."
          : `, using ${formatBytes(status.usageBytes)}.`}{" "}
        Use Export all sketches to keep a copy elsewhere.
      </p>
      {status?.persisted === true ? (
        <p data-recents="persisted">This browser has agreed not to clear them on its own.</p>
      ) : status?.persisted === false ? (
        <p>
          {declined
            ? "This browser declined to promise it will keep them. Export all sketches now and then."
            : "This browser may clear them if it runs short of space."}{" "}
          {declined ? null : (
            <button
              type="button"
              data-recents="persist"
              onClick={() => void onKeep()}
              className="text-foreground underline underline-offset-2"
            >
              Ask the browser to keep them
            </button>
          )}
        </p>
      ) : null}
    </footer>
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
