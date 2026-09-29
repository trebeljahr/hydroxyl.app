"use client";

/**
 * The insert box: type a name, a sum formula or a SMILES, or paste a molfile,
 * and the structure is added beside the drawing.
 *
 * All the reading lives in `@/lib/io/insert` and all the placing in
 * `@/editor/commands/insert`; this file is the text field, the list of
 * readings under it, and the keyboard between them.
 *
 * ── THE LIST IS THE ANSWER, NOT A GUESS ────────────────────────────────────
 *
 * Every reading of the text is shown before anything is inserted — the entry
 * a name resolves to by its full name ("glucose" shows β-D-glucopyranose), every
 * listed compound a formula matches, and "read as SMILES" — and Enter takes the
 * highlighted one. A bare sugar name therefore never inserts an anomer the user
 * did not see named, and a formula never inserts one of seven hexoses silently.
 *
 * ── THE DICTIONARY LOADS WHEN THE BOX OPENS ────────────────────────────────
 *
 * It is ~80 kB of molblock text behind its own entry point, so the editor
 * route does not carry it until someone asks for it. RDKit loads later still:
 * only when a SMILES is actually inserted, exactly as for a pasted SMILES.
 */

import { molecularFormulaUnicode } from "@starter/chem-core";
import type { DictionaryCategory } from "@starter/chem-core/dictionary";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { insertStructure } from "@/editor/commands/insert";
import {
  interpretInsertText,
  loadDictionary,
  resolveInsertCandidate,
  type DictionaryModule,
  type InsertCandidate,
  type InsertInterpretation,
} from "@/lib/io/insert";
import { cn } from "@/lib/utils";
import { editorStore, useEditorStore } from "@/state";

const button =
  "hover:bg-accent focus-visible:ring-ring flex h-8 items-center justify-center rounded-md border px-3 text-xs focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40";

const NOTHING: InsertInterpretation = { candidates: [], notice: null, refusal: null };

const CATEGORY_TITLES: Readonly<Record<DictionaryCategory, string>> = {
  solvent: "solvent",
  aromatic: "arene",
  sugar: "sugar",
  "amino-acid": "amino acid",
  nucleobase: "nucleobase",
  biomolecule: "biomolecule",
  drug: "drug",
};

function candidateKey(candidate: InsertCandidate): string {
  return candidate.kind === "entry" ? `entry-${candidate.entry.id}` : candidate.kind;
}

function CandidateRow({
  candidate,
  text,
  dictionary,
}: {
  readonly candidate: InsertCandidate;
  readonly text: string;
  readonly dictionary: DictionaryModule;
}): ReactElement {
  if (candidate.kind === "smiles") {
    return (
      <>
        <span className="font-medium">Read as SMILES</span>
        <span className="text-muted-foreground truncate font-mono">{text.trim()}</span>
      </>
    );
  }
  if (candidate.kind === "molblock") {
    return <span className="font-medium">Read as a molfile</span>;
  }
  const { entry, via } = candidate;
  return (
    <>
      <span className="font-medium">{entry.name}</span>
      <span className="text-muted-foreground">
        {molecularFormulaUnicode(dictionary.dictionaryMolecule(entry))}
      </span>
      <span className="text-muted-foreground ml-auto text-[10px] uppercase opacity-80">
        {via === "formula" ? "formula match" : CATEGORY_TITLES[entry.category]}
      </span>
    </>
  );
}

function InsertForm(): ReactElement {
  const [text, setText] = useState("");
  const [dictionary, setDictionary] = useState<DictionaryModule | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards the await: a result arriving after the box closed must not insert.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    loadDictionary().then(
      (module) => {
        if (mounted.current) setDictionary(module);
      },
      (reason: unknown) => {
        if (mounted.current) {
          setLoadError(
            `The built-in list could not be loaded: ${reason instanceof Error ? reason.message : String(reason)}`,
          );
        }
      },
    );
    return () => {
      mounted.current = false;
    };
  }, []);

  const reading = useMemo(
    () => (dictionary === null ? NOTHING : interpretInsertText(text, dictionary)),
    [text, dictionary],
  );
  const { candidates } = reading;
  const activeIndex = Math.min(active, Math.max(0, candidates.length - 1));
  const chosen = candidates[activeIndex];

  async function insert(candidate: InsertCandidate | undefined): Promise<void> {
    if (candidate === undefined || dictionary === null || busy) return;
    setBusy(true);
    setError(null);
    const result = await resolveInsertCandidate(text, candidate, dictionary);
    if (!mounted.current) return;
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    insertStructure(editorStore, result.value.molecule, result.value.title);
    editorStore.getState().setInsertDialogOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Arrows move the highlight only while the text is one line; in a pasted
    // molfile they have to move the caret.
    const singleLine = !text.includes("\n");
    if (singleLine && event.key === "ArrowDown" && candidates.length > 0) {
      event.preventDefault();
      setActive((activeIndex + 1) % candidates.length);
      return;
    }
    if (singleLine && event.key === "ArrowUp" && candidates.length > 0) {
      event.preventDefault();
      setActive((activeIndex - 1 + candidates.length) % candidates.length);
      return;
    }
    // Enter inserts; Shift+Enter is a newline for whoever types a molfile.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void insert(chosen);
    }
  }

  const listId = "insert-candidates";
  const optionId = (index: number): string => `insert-candidate-${String(index)}`;

  return (
    <div className="flex flex-col gap-2">
      <textarea
        // The box is the one thing the user came here to use.
        autoFocus
        rows={text.includes("\n") ? 8 : 2}
        value={text}
        spellCheck={false}
        aria-label="Structure to insert"
        aria-controls={listId}
        aria-activedescendant={chosen === undefined ? undefined : optionId(activeIndex)}
        data-shell="insert-input"
        placeholder="caffeine, C6H12O6, CC(=O)Oc1ccccc1C(=O)O, or paste a molfile"
        onChange={(event) => {
          setText(event.target.value);
          setActive(0);
          setError(null);
        }}
        onKeyDown={onKeyDown}
        className="bg-background focus-visible:ring-ring w-full resize-y rounded-md border px-2 py-1.5 font-mono text-sm focus-visible:outline-none focus-visible:ring-2"
      />

      {dictionary === null && loadError === null ? (
        <p className="text-muted-foreground text-xs">Loading the built-in list…</p>
      ) : null}
      {loadError === null ? null : (
        <p role="alert" className="text-destructive text-xs">
          {loadError}
        </p>
      )}

      <ul
        id={listId}
        role="listbox"
        aria-label="Readings"
        data-shell="insert-candidates"
        className={cn("flex max-h-64 flex-col overflow-y-auto", candidates.length === 0 && "hidden")}
      >
        {candidates.map((candidate, index) => (
          <li
            key={candidateKey(candidate)}
            id={optionId(index)}
            role="option"
            aria-selected={index === activeIndex}
            data-candidate={candidateKey(candidate)}
            onMouseEnter={() => setActive(index)}
            onMouseDown={(event) => {
              // Keep focus in the text field, so the keyboard keeps working.
              event.preventDefault();
            }}
            onClick={() => {
              void insert(candidate);
            }}
            className={cn(
              "flex cursor-pointer items-baseline gap-2 rounded px-2 py-1 text-xs",
              index === activeIndex
                ? "bg-accent text-accent-foreground"
                : "text-popover-foreground",
            )}
          >
            {dictionary === null ? null : (
              <CandidateRow candidate={candidate} text={text} dictionary={dictionary} />
            )}
          </li>
        ))}
      </ul>

      {reading.notice === null ? null : (
        <p data-shell="insert-notice" role="status" className="text-muted-foreground text-xs">
          {reading.notice}
        </p>
      )}
      {reading.refusal === null ? null : (
        <p data-shell="insert-refusal" role="status" className="text-muted-foreground text-xs">
          {reading.refusal}
        </p>
      )}
      {error === null ? null : (
        <p data-shell="insert-error" role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}

      <div className="mt-1 flex items-center gap-2">
        <p className="text-muted-foreground mr-auto text-[11px]">
          {dictionary === null
            ? "Names come from a built-in list."
            : `Names come from a built-in list of ${String(dictionary.STRUCTURE_DICTIONARY.length)} compounds.`}{" "}
          Nothing you type leaves this browser.
        </p>
        <button
          type="button"
          className={button}
          onClick={() => editorStore.getState().setInsertDialogOpen(false)}
        >
          Cancel
        </button>
        <button
          type="button"
          data-shell="insert-submit"
          className={cn(button, "bg-primary text-primary-foreground hover:bg-primary/90")}
          disabled={chosen === undefined || busy}
          onClick={() => {
            void insert(chosen);
          }}
        >
          {busy ? "Reading…" : "Insert"}
        </button>
      </div>
    </div>
  );
}

export function InsertDialog(): ReactElement {
  const open = useEditorStore((state) => state.ui.insertDialogOpen);
  return (
    <Dialog open={open} onOpenChange={(next) => editorStore.getState().setInsertDialogOpen(next)}>
      <DialogContent className="top-[10%] max-w-lg p-4" data-shell="insert-dialog">
        <DialogTitle className="text-sm font-semibold">Insert a structure</DialogTitle>
        <DialogDescription className="text-muted-foreground mb-2 text-xs">
          Type a name, a sum formula or a SMILES, or paste a molfile. The structure is added
          beside your drawing.
        </DialogDescription>
        {/* Mounted only while open, so the box starts empty every time. */}
        {open ? <InsertForm /> : null}
      </DialogContent>
    </Dialog>
  );
}
