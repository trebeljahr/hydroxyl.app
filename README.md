# Hydroxyl

A chemical structure editor for figures in papers. Draw a molecule once, then
export it in each representation the figure needs.

The repository keeps its working name, `chemistry-sketcher`.

Status: **early**. The chemistry core, the renderer and the editor canvas are
built and tested: `/editor` draws, edits, and renders every 2D representation
listed below.

## What it is for

Most structure editors optimise for entering a molecule and exporting one
picture. This one treats the representation as a view over a single model, so
the same structure can be shown as:

- skeletal (implicit carbons and hydrogens, aromatic rings as one circle)
- Kekulé (localised alternating double bonds, carbons still bare)
- fully explicit, every atom labelled and every hydrogen drawn
- Lewis dot structures, with lone pairs and formal charges
- condensed formula — `CH3CH2OH`, walked from the graph
- sum formula, molecular weight, exact mass

…and rendered under a chosen style preset (ACS bond lengths, line widths and
fonts), including a panel mode that lays several representations side by side
as one labelled figure.

## Layout

```
packages/
  chem-core/   pure TypeScript chemistry model — graph, valence, formula.
               No React, no DOM, no dependencies. Fully unit-tested.
  client/      Next.js app (App Router, Tailwind v4, shadcn/ui).
  mcp/         Local MCP server for AI assistants (not published yet).
  shared/      zod schemas shared across packages.
```

`chem-core` is deliberately framework-free so the chemistry can be tested
without a browser and reused headlessly. There is no server package — the
editor runs entirely in the browser.

## 3D is post-v1, and the reason is settled

Wireframe, ball-and-stick and space-filling views are **not** in v1, and
neither are the projections that need real geometry (chair, Newman, sawhorse).
This is a decision, not a backlog item that slipped.

RDKit-WASM is this project's import/export oracle, and the MinimalLib build it
ships contains **no conformer generation at all** — no DistGeom, no ETKDG, no
`EmbedMolecule`, no force field. It does 2D depiction (RDDepict + CoordGen) and
nothing else. `has_coords()` can report `3` for a conformer read out of a file,
but nothing in this build can generate or minimise one.

So a 3D view is not a rendering feature bolted onto what is here; it needs a
different component entirely — a full RDKit build, OpenBabel-wasm, or
hand-rolled geometry — with its own size, licence and correctness questions.
Anything drawn from 2D coordinates alone would be a picture of a guess.

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
pnpm test         # chem-core, chem-render, shared, client and mcp unit tests
pnpm typecheck
pnpm build

# End-to-end (Playwright). Browsers are NOT downloaded by `pnpm install`
# — pnpm-workspace.yaml's allowBuilds allowlist omits playwright on
# purpose. Install them once:
pnpm exec playwright install chromium
pnpm test:e2e
```

## MCP server for AI assistants

`packages/mcp` is a local [Model Context Protocol](https://modelcontextprotocol.io)
server. An assistant such as Claude Desktop can use it to draw a structure as a
journal figure, check it, and convert it. It runs on your machine over stdio
and makes no network calls. Structures you send go to your assistant's
provider, never to us.

It has five tools:

| Tool | Input | Output |
|---|---|---|
| `render_figure` | a structure; views; width (`single`, `double` or cm); `png` or `svg` | the figure, its printed size, its label size, and a warning for text under 8 pt |
| `check_structure` | a structure | the valence and drawing issues the editor flags, each with its one-click fixes |
| `describe` | a structure | formula, molecular weight, exact mass, net charge, CIP labels |
| `convert` | a structure | a molfile or a canonical SMILES |
| `editor_link` | a structure | a link that opens the structure in the editor |

A structure is one of `smiles`, `molfile`, or `name` (a compound from the
editor's insert box, such as `caffeine`).

The package is not on npm yet. Build it from this repository:

```bash
pnpm install
pnpm build:mcp    # writes packages/mcp/dist/server.js
```

Then add it to your MCP client. For Claude Desktop, edit
`claude_desktop_config.json` (Settings → Developer → Edit Config) and restart
the app:

```json
{
  "mcpServers": {
    "hydroxyl": {
      "command": "node",
      "args": ["/absolute/path/to/chemistry-sketcher/packages/mcp/dist/server.js"]
    }
  }
}
```

Other clients that start stdio servers take the same command and argument. For
Claude Code:

```bash
claude mcp add hydroxyl -- node /absolute/path/to/chemistry-sketcher/packages/mcp/dist/server.js
```

`editor_link` points at `https://hydroxyl.app/editor/`. Set
`HYDROXYL_EDITOR_URL` in the server's environment to link to a local or
self-hosted editor instead.

## Deployment

Managed by [hatchkit](https://hatchkit.trebeljahr.com) — Docker image built in
CI, deployed to Coolify on a Hetzner VPS.

Analytics is one cookie-less Plausible pageview per page load, sent only when
the GitHub repository variables `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` and
`NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL` are set. It sends the page's path, never its
query string, and the static export contains none of it. See
`packages/client/src/lib/analytics.ts`.

## Licence

MIT — see [`LICENSE`](LICENSE). Bundled fonts, RDKit and other third-party
components keep their own licences; see
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
