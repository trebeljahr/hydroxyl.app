# Third-party notices

Components redistributed with chemistry-sketcher, and — because this tool's
whole output is a file someone else opens — the terms that apply when that
output travels.

## RDKit MinimalLib (the chemistry oracle)

- **Files:** `packages/client/public/rdkit/RDKit_minimal.wasm` (6.9 MB) and
  `RDKit_minimal.js` (128 kB), staged out of `node_modules/@rdkit/rdkit` by
  `packages/client/scripts/copy-rdkit.mjs` on every dev, build and test run.
  They are gitignored, not committed: the same script writes
  `packages/client/public/rdkit/THIRD-PARTY-NOTICES.txt` beside them, carrying
  the RDKit `LICENSE` file verbatim, so the notice travels with the binary
  into `out/` and into the Docker image rather than living only here.
- **Version:** `@rdkit/rdkit` 2025.3.4-1.0.0, wrapping RDKit 2025.03.4.
- **Copyright:** Copyright (c) 2006-2024, Rational Discovery LLC, Google Inc.,
  and others. See the shipped `LICENSE`.
- **Licence:** BSD 3-Clause.

### Why RDKit, and why only at the edges

RDKit is this project's stated import/export ORACLE, and `chem-core`'s valence
table is calibrated against its default table on purpose — divergence shows up
as a hydrogen appearing or vanishing across a SMILES round trip. But chem-core
must never depend on it, directly or in a type: the editor has to draw, edit
and export a structure with the wasm never having loaded, on a laptop with no
network. So RDKit lives entirely behind `packages/client/src/lib/rdkit/`, in a
worker, loaded on the first import or export and never before.

### What is actually inside the wasm

The 6.9 MB file statically links more than RDKit, and two of those components
are not BSD. All four are named in the shipped `THIRD-PARTY-NOTICES.txt`:

- **RDKit** — BSD 3-Clause.
- **IUPAC InChI Software, version 1.07.3** — the IUPAC/InChI-Trust Licence,
  which is NOT BSD. Linked because `RDK_BUILD_INCHI_SUPPORT` is on, which is
  what makes `toInchi` possible.
- **Boost** — Boost Software License 1.0.
- **coordgenlibs** (Schrödinger, Inc.) — BSD 3-Clause. What
  `generate2DCoords` actually runs.

A notice carrying only the RDKit text would be incomplete, which is why the
generated file reproduces the Boost licence in full and points at the InChI
Trust's terms by name and version.

### Obligations that reach an exported figure

None. BSD 3-Clause governs redistribution of the software, and a molfile or an
SVG this tool produces is neither the software nor a derivative work of it.

## OpenChemLib JS (the 3D view's force field)

- **Files:** `packages/client/public/conformer/conformer.worker.js` (1.3 MB),
  an esbuild bundle of `src/lib/conformer/worker.ts` with `openchemlib` and
  the MMFF94 tables from its `resources.json`, staged by
  `packages/client/scripts/copy-conformer.mjs` on every dev, build and test
  run. Gitignored; the script writes `public/conformer/THIRD-PARTY-NOTICES.txt`
  beside it with the `LICENSE` file verbatim.
- **Version:** `openchemlib` 9.25.1.
- **Copyright:** Copyright (c) 2015-2017, cheminfo. See the shipped `LICENSE`.
- **Licence:** BSD 3-Clause.
- **Why:** the bundled RDKit MinimalLib has no conformer embedding (decision
  232); OpenChemLib's MMFF94s+ minimiser builds the 3D view's geometry in the
  browser, so nothing drawn leaves the machine (decision 108).

## three.js (the 3D view's renderer)

- **Files:** bundled by Next into the editor's client chunks, loaded only when
  the 3D view opens.
- **Version:** `three` 0.186.1.
- **Copyright:** Copyright © 2010-2026 three.js authors.
- **Licence:** MIT.

## Arimo (the figure font)

- **Files:** `packages/chem-render/assets/arimo-latin-400-normal.woff`,
  regular weight, latin subset, 14.4 kB; and
  `packages/chem-render/assets/arimo-greek-400-normal.woff`, regular weight,
  greek subset, 11.2 kB (decision 252).
- **Version:** 1.341, both files. Extracted from `@fontsource/arimo@5.3.0`
  (the Greek file fetched 2026-10-07 from
  `cdn.jsdelivr.net/npm/@fontsource/arimo@5.3.0/files/`, where the Latin file
  is byte-identical to the one vendored here); the licence text
  in `packages/chem-render/assets/OFL.txt` is the copy published alongside the
  font in `google/fonts`.
- **Copyright:** Copyright The Arimo Project Authors
  (https://github.com/googlefonts/arimo).
- **Licence:** SIL Open Font License, Version 1.1. Full text in
  `packages/chem-render/assets/OFL.txt`.

### Why this font

Three constraints, and only a short list of faces satisfies all of them.

**The licence has to permit embedding in a file the user then gives away.**
Exported figures go to journals, co-authors and preprint servers, and an SVG
that references a font by name renders in whatever the recipient happens to
have — which is how a carefully spaced `OCH₃` arrives at a typesetter
overlapping the bond it sits on. So the font gets embedded, and the licence has
to allow that unconditionally. OFL 1.1 does, explicitly and in the strongest
terms available: section 2 permits redistribution of the font software with or
without modification, and the licence's own preamble and FAQ are clear that a
document created with the font — including one with the font embedded in it —
carries no licence obligation whatsoever. Nothing propagates to the user's
manuscript. A Microsoft core font (Arial, Helvetica) would have been the
obvious typographic choice and is flatly not redistributable; a GPL-with-
font-exception face (Nimbus Sans) is redistributable but drags a discussion
about the exception's scope into a chemist's figure, which is not a
conversation this tool should start.

**It has to be metric-compatible with Arial and Helvetica.** Chemical figures
are set in Arial or Helvetica by long convention, and several journals specify
one of them outright. Arimo is Steve Matteson's metrically-compatible design —
identical advance widths, glyph for glyph — so a figure laid out against the
bundled table is laid out correctly whether the viewer resolves Arimo, Arial,
Helvetica or Liberation Sans. That is what makes `font-family` a real fallback
chain here rather than a hope: the measurements this renderer trims bonds
against stay true under substitution. Liberation Sans is the same design under
a different name and would have done equally well; Arimo was taken because it
ships as a clean, small, subsettable OFL package.

**It has to cover what a label contains.** The latin subset carries the element
symbols, digits, `+`, the real minus sign U+2212, parentheses and brackets, and
the middle dot. Radical electrons are drawn as circle primitives rather than
glyphs, so no label depends on a bullet character being present.

### The subset and scheme text (decisions 191, 192, 206 and 252)

*Decision 252 (2026-10-07) vendored the Greek subset; the "Not covered"
bullet below is now history, and the Greek section after this one says what
changed.*

Reaction conditions, coefficients and a bracket's charge are set in this same
subset, and **the subset was deliberately not changed** for them. The plan
asked for a re-subset adding lowercase and capital delta, alpha, beta, mu and
the double dagger; decision 192 defers that until Rico approves downloading
Arimo's Greek range and Arimo Italic. So the licence reasoning above is the
reasoning for the subset that ships, re-read for this change rather than
assumed: the WOFF, its sha256 and the generated metrics table are byte for
byte what they were, and the regeneration test still reproduces the table
from the WOFF.

- **Covered and pinned.** Every Latin string a conditions line prints — the
  real minus, the degree sign, the en dash of a range, the middle dot of a
  hydrate, the prime, the micro sign U+00B5, and reagent formulas such as
  `Pd(PPh3)4` and `H3O+` — measures with no `.notdef`
  (`packages/chem-render/test/typography.test.ts`).
- **Drawn, never set.** Every arrow, the scheme `+` and the transition state's
  double dagger are geometry (decisions 191 and 204), so the font never needs
  U+2192, U+21CC or U+2021.
- **Not covered, reported.** α, β, γ, δ, μ (U+03B1-U+03BC) and Δ (U+0394) are measured
  at `.notdef`'s advance and drawn from the next face in the stack; resvg, the
  social-card rasteriser, draws a box for each. Each is a row in
  `unmeasuredTextRuns(scene)` and a finding on the annotation that carries it.
  Every Greek letter and every italic run goes through
  `packages/chem-render/src/text/typography.ts`, so vendoring is an asset
  change.
- **Size.** Measured, not assumed: this change adds 0 bytes to an exported
  SVG. Embedding the font costs 20,041 bytes per SVG (a test pins the number).

### The Greek subset (decision 252)

Rico approved the download on 2026-10-07. The checks the paragraph below
asks for, as run on that file:

- **Same licence and copyright.** Its `name` table carries the same copyright
  line (ID 0, "Copyright 2020 The Arimo Project Authors") and licence URL
  (ID 14, openfontlicense.org) as the Latin file, so `OFL.txt` covers it.
- **No Reserved Font Name** appears in any `name` record.
- **Verbatim.** The file is committed exactly as published (SHA-256
  `5b632348…79474ad`), so OFL section 3 stays unengaged; the PDF writer
  embeds it unmodified, unwrapped from WOFF to its TrueType tables.
- **Still Arial's metrics.** Every one of the 127 Greek code points Arial
  has (macOS Arial, 2048 units) has the same advance in this file; 8 archaic
  letters Arial lacks are Arimo's own. Version, em and every vertical metric
  match the Latin file, which `mergeMetrics` refuses to merge otherwise.
- **Regenerated.** `arimo-metrics.ts` now holds both faces (Latin wins on the
  two spaces they share, with identical widths), and `font-metrics.test.ts`
  re-derives it from both files.
- **Size.** An exported SVG without Greek is unchanged: 20,041 bytes of font.
  One that sets a Greek letter embeds a second `@font-face` with a
  `unicode-range`, 15,529 bytes more (a test pins both numbers). A PDF embeds
  the Greek face only when it sets a Greek letter.

**What a Greek or italic subset must re-check before it ships.** That the new
files carry the same OFL 1.1 text and copyright line as `OFL.txt` (Arimo
Italic is a separate font file from the same project, and a Greek range from
a different packaging is a different file); that no Reserved Font Name
appears in either; that the files are taken verbatim as published, so OFL
section 3 stays unengaged; that the Greek advances are still Arial's, glyph by
glyph, since metric compatibility is the guarantee most likely to break
quietly there; then the regenerated table, the new sha256, the re-measured SVG
size and this section.

### Obligations this project meets

- The OFL text ships next to the font, unmodified.
- The copyright notice is reproduced above and in `OFL.txt`.
- The font is not renamed, and no Reserved Font Name is used — the file is a
  verbatim subset as published, so OFL section 3 is not engaged.
- The font is not sold on its own.

### Obligations that reach an exported figure

None. A figure exported from this tool — including one with the font embedded —
is a document created with the font, not a derivative of the font software, and
the user may do anything at all with it. That is the reason for choosing an OFL
face, and it is worth stating plainly here so nobody has to re-derive it before
sending a paper out.
