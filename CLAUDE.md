# chemistry-sketcher

Chemical structure editor for publication figures. Draw a molecule once,
view and export it in every representation a figure might need.

The product is called **Hydroxyl**: `SITE_NAME` in
`packages/client/src/lib/site.ts`, which every header, title and the social
card read. The repository and every browser-storage name keep
`chemistry-sketcher` — the IndexedDB database, the localStorage keys, the
BroadcastChannel. Do not rename those: a renamed store opens empty and every
saved sketch is orphaned. New exports are `.hydroxyl.json` and
`hydroxyl-library-<date>.json`; the library reader still accepts the old
`chemistry-sketcher-library` envelope (decision 229).

## Hatchkit Context

This starter is normally generated and maintained by `hatchkit`.
If `.hatchkit.json` exists at the project root, treat the repo as a
Hatchkit-managed project.

Useful Hatchkit commands from inside a generated project:

```bash
hatchkit overview --json                 # inspect manifest/project state
hatchkit update                          # add supported features additively
hatchkit add <project> [services]        # provision GlitchTip/Plausible/Listmonk+SES/S3/email/search
hatchkit keys push <project>             # push dotenvx private key to Coolify/GitHub Actions
hatchkit sync                            # sync/deploy existing project state
hatchkit rename-domain                   # update domain-related deploy config
hatchkit regen-infra                     # regenerate infra/deploy files
hatchkit provision s3                    # create project buckets + env entries
hatchkit assets pull                     # mirror remote object storage assets locally
```

Before giving Hatchkit setup advice, run `hatchkit status --json` and
read `providers[]`, `nextStep`, and `suggestions[]`. For provider failures,
run `hatchkit doctor --json` and surface the failing `checks[].hint[]`
lines. Never print dotenvx private keys unless the user specifically asks.

If a Hatchkit command breaks in this project, report the failing command,
cwd, Hatchkit version, output, suspected source area, and safe undo path.
When asking another agent to fix it, include a repair prompt with those details
and tell it to preserve existing user setups, use `--dry-run` where possible,
and ask before provider/DNS/Coolify/Terraform/keychain mutations.

Do not run commands that may alter existing infrastructure unless the user
explicitly asks. Prefer giving the command to the user, or using preview modes
such as `hatchkit destroy <project> --recipe`, `hatchkit gh-pages --undo
--dry-run`, and other command-specific `--dry-run` options.

## Tech Stack

- **Frontend:** Next.js 16 (App Router) + React 19 + Tailwind CSS v4 + shadcn/ui
- **Chemistry:** `@starter/chem-core`, a dependency-free TypeScript model
- **Tests:** Vitest (unit), Playwright (e2e)
- **Deploy:** Docker image built in CI → Coolify on Hetzner, managed by hatchkit

There is no server package. This is a static/client-only surface; the editor
runs entirely in the browser. If a server becomes necessary (IUPAC naming is
the likely trigger), add it with `hatchkit update` rather than by hand.

## Package Layout

```
packages/
  chem-core/   pure chemistry model — graph, valence, formula, geometry
  client/      Next.js app
  mcp/         local stdio MCP server (private, unpublished; decision 246)
  shared/      zod schemas
```

`packages/mcp` reuses the editor's export and import code from
`packages/client/src` through the `@/` alias and is bundled with esbuild, so
a change to `lib/export/figure.ts`, `lib/rdkit/ops.ts`, `lib/rdkit/translate.ts`
or `lib/io/fragment.ts` reaches the MCP tools too — run `pnpm test:mcp`. Those
modules must stay free of React and the DOM at module scope for that to work.
Do not publish the package: that waits on the licence and is Rico's step.

### chem-core is the important one

Framework-free by design: no React, no DOM, no dependencies. All chemistry
logic lives here so it can be tested without a browser and reused headlessly.
**Never put chemistry logic in a React component.**

Invariants to preserve when editing it:

- **Hydrogens are implicit.** Derived from valence at query time, never stored
  as atoms. An earlier version modelled them as real nodes and every traversal,
  layout pass and export had to filter them back out.
- **Elements have valence *lists*.** Not a single `maxBonds` number — sulfur is
  divalent in a thiol and hexavalent in a sulfone. The lists match RDKit's
  default valence table on purpose: RDKit is the import/export oracle, and
  diverging shows up as hydrogens appearing or vanishing across a SMILES
  round-trip. The charge handling mirrors RDKit's 2024.09
  `calculateImplicitValence`: a charged atom takes the valence list of its
  isoelectronic element (Z − charge, so Si+ reads as Al, Cl+ as S), with
  RDKit's two exceptions — P/S/As/Se keep their own list under a large
  negative charge, and a bare hydrogen with |charge| ≥ 2 is refused. There is
  no carbon special case any more. `valence-table.node.test.ts` probes the
  real wasm for every element at charges −4..+4.
- **The graph is flat and acyclic.** Atoms reference each other only via ids on
  bonds. Ids come from a monotonic counter and are never reused.
- **Everything is pure.** Molecules are immutable; edits return new ones.
- **Bulk construction goes through `MoleculeBuilder`.** `addAtom`/`addBond` are
  O(n) per call by design (structural sharing matters more than speed for
  single interactive edits). Calling them in a loop is quadratic — a 20k-atom
  chain took over four minutes that way.
- **Coordinates are y-up**, matching molfile and ordinary maths. Only the SVG
  renderer flips to y-down.
- **A reaction scheme is still one Molecule.** Species are its connected
  components, unioned across `Molecule.speciesJoins` (the salt, the solvate);
  `species(mol)` in species.ts is memoised. What is drawn between species —
  arrows, plus signs, brackets, text — is the document's `annotations`, typed
  in chem-render's `scheme/annotation.ts`. chem-core never learns what an
  arrow is.
- **Over-valence counts a pinned hydrogen count.** `statedValence` is bonds +
  radicals + `explicitHydrogenCount`, added BEFORE the aromatic snap as
  RDKit's `calcExplicitValence` does. Measured on drawn bonds alone, an
  uncharged N pinned to NH3 with a carbon on it read as clean while RDKit
  refused it.
- **A dative bond is a real bond; bold and hydrogen bonds are not chemistry**
  (decision 226). `Bond.dative` (donor `from` → acceptor `to`) adds 0 to the
  donor's valence and 1 to the acceptor's — RDKit's DATIVE rule, so a drawn
  N→B leaves BH2 exactly as RDKit reads `N->B` — and only V3000 (type 9) can
  write it. `Bond.bold` is display only. A hydrogen bond is chem-render's
  `hydrogenBond` annotation and never reaches chem-core.
- **An abbreviation is a label over real atoms.** `Molecule.abbreviations`
  (decision 225) groups atoms that stay in the graph, so formula, mass,
  valence and SMILES never read it. Only drawing (`contractedView`) and the
  molfile `SUP` S-group do. The attachment bond is derived, never stored; a
  group with two bonds out draws expanded (decision 240). A bare `Atom.label`
  with no atoms behind it is still refused at export (decision 8).
- **Issues and their fixes are chem-core's.** `chemistryIssues` returns every
  issue located (anchor `atomId`, all `atomIds`/`bondIds`, a canvas `label`);
  `issueFixes`/`applyIssueFix` decide which one-click repair is obvious. The
  client only routes a click into the store.
- **Query atoms are atoms with `query`, and their element is `"*"`**
  (decisions 228, 238). R-groups, element lists, "any atom" and generic labels
  ride every traversal as ordinary atoms; `QUERY_ELEMENT` has no valence list
  and no mass, so they take no hydrogens and a generic structure has no mass
  (`GenericStructureError`). A query bond keeps the lowest order it admits in
  `order`. Never give a placeholder a real element "for now".
- **`exactMass()` throws** rather than substituting an average atomic weight
  when an element has no verified monoisotopic value. Do not "fix" this by
  falling back — a plausible wrong mass is worse than an error.

### RDKit lives behind a worker, and only at the edges

RDKit-WASM is the import/export oracle (`@rdkit/rdkit`, BSD-3, 6.9 MB), and
the entire dependency is confined to `packages/client/src/lib/rdkit/`.

- **chem-core must never depend on it**, not even in a type. The editor has to
  draw, edit and export with the wasm never loaded.
- **`packages/client/scripts/copy-rdkit.mjs` stages it into
  `public/rdkit/`** — the wasm, the emscripten glue, an esbuild bundle of
  `worker.ts`, and a generated `THIRD-PARTY-NOTICES.txt`. All four are
  gitignored and regenerate on every `dev`, `build` and `test`. Do NOT route
  the wasm or the worker through Turbopack: `new Worker(new URL("./worker.ts",
  import.meta.url))` resolves the emitted chunk against `location.origin`,
  which drops any subpath the static export is served under, 404s, and reports
  it as an error event with an EMPTY message.
- **RDKit URLs carry `?v=<content hash>`.** The staged files keep fixed
  names, and the hosted build's service worker serves them cache-first
  (decision 239), so `rdkitAssetUrl()` appends `NEXT_PUBLIC_RDKIT_ASSET_VERSION`
  (hashed in `next.config.ts`) and the worker repeats its own query on the glue
  and the wasm. Build any new RDKit URL through it, or a cached worker will
  outlive the client code it talks to.
- **chem-core's molblock codec is the only translation layer.** RDKit never
  sees a chem-core type and chem-core never sees a JSMol; text is the whole
  interface, which is what lets the fidelity harness run with no worker.
- **Write molblocks for RDKit with `hydrogenAssertion: "valence"`.** The
  default `hhh` field is a QUERY field per the CTfile spec and RDKit treats it
  as one — benzene written with it arrives as C6, silently, with an empty log.
- **The structure dictionary is generated, not written.**
  `packages/chem-core/src/dictionary-entries.ts` holds RDKit-laid-out molblocks
  for the insert box's named compounds. Edit the source table in
  `packages/client/scripts/build-structure-dictionary.mjs` and run
  `pnpm --filter @starter/client build:dictionary`; the script refuses to write
  if a row's CIP descriptors or InChIKey disagree with RDKit. RDKit runs there
  at build time only — the editor reads the molblocks with chem-core. The
  dictionary is served from `@starter/chem-core/dictionary`, never from the
  root barrel, so its ~80 kB loads only when the insert box opens.
- **The fidelity harness never asserts on a SMILES string**, because RDKit
  canonicalises the right and the wrong answer to the same one. It asserts on
  chem-core's own queries, and on more than `elementCounts` and `netCharge`:
  those two are identical for a sulfone and its charge-separated form, for
  glycine's neutral and zwitterionic forms, and for 13-C methane and 12-C.

### The 3D view derives its geometry; nothing stores it

- **Conformers come from OpenChemLib's MMFF94s+, not RDKit** (decision 232):
  the bundled MinimalLib has no ETKDG or force field, which
  `lib/rdkit/conformer-capability.node.test.ts` pins. OpenChemLib is confined
  to `packages/client/src/lib/conformer/`, in its own worker that
  `scripts/copy-conformer.mjs` bundles into `public/conformer/` (gitignored,
  same no-Turbopack rule as RDKit's). A molblock goes in, plain atom/bond
  records come out; chem-core never sees either side's types.
- **The drawn stereo is checked, not hoped for.** `embed.ts` starts from the
  2D drawing lifted off the plane by its wedges, minimises, and reads every
  attempt's parities back from the 3D molfile. An attempt that inverts a
  drawn centre is discarded; after five the view refuses rather than show
  the enantiomer.
- **Each species is embedded on its own** and set side by side; minimised
  together the force field clumps them.
- three.js renders it (`lib/three-d/`), loaded by `import()` when the panel
  opens. The panel's state is session-only and never touches the document.

## How to Run

```bash
pnpm install
pnpm dev          # client at http://localhost:6337
pnpm build        # builds chem-core + shared, then the client
pnpm typecheck
```

Workspace packages are consumed from their built `dist/`, so `chem-core` and
`shared` must be built before the client compiles. The root `build` and
`typecheck` scripts already chain this. Do not add a tsconfig `paths` mapping
pointing at a workspace package's `src/` — Turbopack honours `paths` and will
bundle the TypeScript source, where the NodeNext-style `./x.js` re-exports fail
to resolve.

## How to Test

```bash
pnpm test              # chem-core + client unit tests
pnpm test:core         # chem-core only
pnpm test:client       # client only (Vitest, jsdom — packages/client/vitest.config.ts)
pnpm --filter @starter/chem-core test:watch

# Playwright. Browsers are not downloaded by `pnpm install` (allowBuilds in
# pnpm-workspace.yaml omits playwright), so install them once:
pnpm exec playwright install chromium
pnpm test:e2e          # root playwright.config.ts, specs in e2e/, baseURL :6337
```

`*.test.ts(x)` is Vitest, `*.spec.ts` is Playwright — the split is what keeps
each runner from collecting the other's files.

New chemistry behaviour needs a `chem-core` unit test. Prefer real molecules
over synthetic graphs in assertions — benzene, ethanol, acetate, a sulfone —
so a regression reads as a chemistry error rather than a graph error.

## Code Style

- TypeScript strict everywhere. `chem-core` additionally runs with
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
  `verbatimModuleSyntax`.
- Comments explain *why*, especially where a rule looks arbitrary but encodes a
  chemistry convention.

## Commit Messages

Conventional Commits. Explain the reasoning, not the diff. No AI attribution
lines.
