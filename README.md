# chemistry-sketcher

A chemical structure editor aimed at producing figures for papers — draw a
molecule once, then export it in whichever representation the figure needs.

Status: **early**. The chemistry core is built and tested; the canvas is not
written yet.

## What it is for

Most structure editors optimise for entering a molecule and exporting one
picture. This one treats the representation as a view over a single model, so
the same structure can be shown as:

- skeletal (implicit carbons and hydrogens)
- Kekulé, with explicit heteroatom hydrogens
- fully explicit, every atom labelled
- Lewis dot structures, with lone pairs and formal charges
- condensed formula
- sum formula, molecular weight, exact mass
- 3D — wireframe, ball-and-stick, space-filling

…and rendered under a chosen style preset (ACS bond lengths, line widths and
fonts), including a panel mode that lays several representations side by side
as one labelled figure.

## Layout

```
packages/
  chem-core/   pure TypeScript chemistry model — graph, valence, formula.
               No React, no DOM, no dependencies. Fully unit-tested.
  client/      Next.js app (App Router, Tailwind v4, shadcn/ui).
  shared/      zod schemas shared across packages.
```

`chem-core` is deliberately framework-free so the chemistry can be tested
without a browser and reused server-side for headless rendering.

### Design decisions worth knowing

- **Hydrogens are implicit.** They are derived from valence when queried, not
  stored as atoms in the graph.
- **Elements carry valence *lists*, not a single max-bond count.** Sulfur is
  divalent in a thiol and hexavalent in a sulfone; one number cannot express
  that. The lists follow RDKit's default valence table so SMILES round-trips
  do not drift.
- **The molecule graph is flat and acyclic.** Atoms reference each other only
  through ids on bonds, which is what makes snapshots, undo and serialization
  possible.
- **Rendering targets SVG, not canvas.** The output goal is publication
  figures, so the rendered DOM *is* the export.

## Development

```bash
pnpm install
pnpm dev          # client at http://localhost:6337
pnpm test         # chem-core + client
pnpm typecheck
pnpm build
```

## Deployment

Managed by [hatchkit](https://hatchkit.trebeljahr.com) — Docker image built in
CI, deployed to Coolify on a Hetzner VPS.

## Licence

Not yet chosen.
