import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * THE HALF OF THE RETENTION CONTRACT A COUNT CANNOT CHECK.
 *
 * `keysRetained` sums over the caches built by `weakCache`, so it sees a
 * `WeakMap` there turning into a `Map`. It cannot see a cache that was never
 * built there: write `const formulaCache = new Map<Molecule, string>()` at
 * module scope and every retention count in the suite still reports zero while
 * the cache holds every molecule of the session. That gap is a source-level
 * property, so this is a source-level test.
 *
 * THE RULE. A module-scope container in the client that mentions `Molecule` or
 * `SketchDocument` anywhere in its declaration must come from `weakCache`.
 * Both are immutable and both are replaced by the store on every edit, so any
 * strong container naming one accumulates a dead object per edit. Note that
 * the rule is about MENTIONING, not about the key position: a
 * `Map<string, Molecule>` keyed by document id retains molecules just as
 * surely as a `Map<Molecule, …>` does, and the crash report is indifferent to
 * which way round the leak is written.
 *
 * WHAT THIS DOES NOT CATCH, stated so nobody reads it as more than it is. It
 * is a line scanner: it sees declarations at column zero whose head fits on
 * one line, and it reasons about type NAMES rather than types. A container
 * built inside a function and stashed on a module-scope object, a cache typed
 * through an alias that hides the word `Molecule`, or a retainer that is not a
 * container at all are all invisible to it. It closes the one gap it names —
 * a new cache of the known shape, silently outside the count — and claims
 * nothing further.
 */

const clientSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The values the editor store replaces on every edit, by name. */
const REPLACED_PER_EDIT = /\b(Molecule|SketchDocument)\b/;

/** A module-scope `const`/`let` whose head fits on one line. Column zero is
 *  what makes it module scope: everything nested is indented by the
 *  formatter. */
const DECLARATION = /^(?:const|let)\s+\w+[^=]*=\s*(.*)$/;

/** Building somewhere to put things: a keyed container, a set, or a literal
 *  array or object that a later `push`/assignment can grow. */
const BUILDS_A_CONTAINER = /new\s+(?:Weak)?(?:Map|Set)\s*[<(]|new\s+Array\b|=\s*\[\s*\]|=\s*\{\s*\}/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    // Tests may hold whatever they like: a fixture that keeps 500 molecules
    // on purpose is the point of some of them.
    if (entry.name.includes(".test.")) continue;
    out.push(full);
  }
  return out;
}

describe("caches keyed on a value the store replaces per edit", () => {
  it("are all built by weakCache, so the retention count can see them", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(clientSrc)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        const declaration = DECLARATION.exec(line);
        if (declaration === null) return;
        if (!REPLACED_PER_EDIT.test(line)) return;
        if (!BUILDS_A_CONTAINER.test(line)) return;
        // The sanctioned form, and the only one that enrols in the count.
        if (/\bweakCache\s*[<(]/.test(declaration[1] ?? "")) return;
        offenders.push(`${path.relative(clientSrc, file)}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("scans a body of source large enough for the rule to mean something", () => {
    // A scanner pointed at an empty directory passes. This is what stops the
    // test above from going quietly vacuous after a move or a rename.
    const files = sourceFiles(clientSrc);
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith(path.join("editor", "derived.ts")))).toBe(true);
    expect(files.some((f) => f.endsWith(path.join("canvas", "scene-bridge.ts")))).toBe(true);
  });
});
