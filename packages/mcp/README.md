# hydroxyl-mcp

`hydroxyl-mcp` is a local [Model Context Protocol](https://modelcontextprotocol.io)
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

Add it to your MCP client; `npx` fetches the
[`hydroxyl-mcp`](https://www.npmjs.com/package/hydroxyl-mcp) package from npm
(Node.js 22 or newer). For Claude Desktop, edit `claude_desktop_config.json`
(Settings → Developer → Edit Config) and restart the app:

```json
{
  "mcpServers": {
    "hydroxyl": {
      "command": "npx",
      "args": ["-y", "hydroxyl-mcp"]
    }
  }
}
```

Other clients that start stdio servers take the same command and arguments. For
Claude Code:

```bash
claude mcp add hydroxyl -- npx -y hydroxyl-mcp
```

`editor_link` points at `https://hydroxyl.app/editor/`. Set
`HYDROXYL_EDITOR_URL` in the server's environment to link to a local or
self-hosted editor instead.

The editor itself is at [hydroxyl.app](https://hydroxyl.app); source at
[github.com/trebeljahr/hydroxyl.app](https://github.com/trebeljahr/hydroxyl.app).

## Licence

MIT. The package depends on RDKit (BSD-3-Clause) and resvg-wasm (MPL-2.0), and
ships the Arimo font (OFL-1.1, text in `dist/arimo-OFL.txt`).
