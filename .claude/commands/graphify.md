You are operating inside the MAMMOTH monorepo. A graphify knowledge graph exists at `graphify-out/graph.json` (3000 nodes, 4465 edges, 195 communities).

The user invoked `/graphify` with these arguments: $ARGUMENTS

Parse the arguments and run the correct graphify command(s) below. If no arguments given, run the full remap.

---

## Argument → Command mapping

| User types | Run |
|---|---|
| _(nothing)_ | `graphify . --backend claude-cli` |
| `./raw` or any path | `graphify <path> --backend claude-cli` |
| `--update` | `graphify . --update` |
| `--mode deep` | `graphify . --mode deep --backend claude-cli` |
| `--directed` | `graphify . --directed --backend claude-cli` |
| `--cluster-only` | `graphify cluster-only .` |
| `--no-viz` | `graphify . --no-viz --backend claude-cli` |
| `--obsidian` | `graphify . --obsidian --backend claude-cli` |
| `--wiki` | `graphify . --wiki --backend claude-cli` |
| `--svg` | `graphify . --svg` |
| `--graphml` | `graphify . --graphml` |
| `--watch` | `graphify . --watch` |
| `--mcp` | `graphify . --mcp` |
| `add <url>` | `graphify add <url>` |
| `query "<question>"` | `graphify query "<question>"` |
| `path "<A>" "<B>"` | `graphify path "<A>" "<B>"` |
| `explain "<concept>"` | `graphify explain "<concept>"` |

---

## Always do after running

1. Report node/edge/community counts from the output.
2. If `graphify-out/GRAPH_REPORT.md` was updated, summarize top 10 communities.
3. For `query`/`explain`/`path` — format the result as a clear answer, not raw node dumps.
4. If graph is stale (`graphify . --update` needed), say so.

---

## Graph awareness rules (always active)

- NEVER grep raw files before checking the graph. Run `graphify query "<question>"` first.
- Use `graphify explain "<Symbol>"` before reading any source file for a symbol.
- Use `graphify path "<A>" "<B>"` to find how two things connect instead of tracing imports manually.
- After any code edit, remind the user to run `graphify . --update` (free, AST-only, no API cost).
