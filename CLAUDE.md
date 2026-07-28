<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **emap** (6149 symbols, 19824 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "master"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/emap/context` | Codebase overview, check index freshness |
| `gitnexus://repo/emap/clusters` | All functional areas |
| `gitnexus://repo/emap/processes` | All execution flows |
| `gitnexus://repo/emap/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |
| Work in the Duckdb area (351 symbols) | `.claude/skills/generated/duckdb/SKILL.md` |
| Work in the Map area (256 symbols) | `.claude/skills/generated/map/SKILL.md` |
| Work in the Docs-meta area (194 symbols) | `.claude/skills/generated/docs-meta/SKILL.md` |
| Work in the Handlers area (147 symbols) | `.claude/skills/generated/handlers/SKILL.md` |
| Work in the Geo area (106 symbols) | `.claude/skills/generated/geo/SKILL.md` |
| Work in the Formats area (94 symbols) | `.claude/skills/generated/formats/SKILL.md` |
| Work in the Ops area (92 symbols) | `.claude/skills/generated/ops/SKILL.md` |
| Work in the Scripts area (79 symbols) | `.claude/skills/generated/scripts/SKILL.md` |
| Work in the Adapter area (70 symbols) | `.claude/skills/generated/adapter/SKILL.md` |
| Work in the Assets area (67 symbols) | `.claude/skills/generated/assets/SKILL.md` |
| Work in the Ui area (53 symbols) | `.claude/skills/generated/ui/SKILL.md` |
| Work in the Commands area (44 symbols) | `.claude/skills/generated/commands/SKILL.md` |
| Work in the Source area (44 symbols) | `.claude/skills/generated/source/SKILL.md` |
| Work in the Renderer area (35 symbols) | `.claude/skills/generated/renderer/SKILL.md` |
| Work in the Docs area (30 symbols) | `.claude/skills/generated/docs/SKILL.md` |
| Work in the Cluster_126 area (8 symbols) | `.claude/skills/generated/cluster-126/SKILL.md` |
| Work in the Cluster_44 area (7 symbols) | `.claude/skills/generated/cluster-44/SKILL.md` |
| Work in the Cluster_55 area (6 symbols) | `.claude/skills/generated/cluster-55/SKILL.md` |
| Work in the Cluster_121 area (6 symbols) | `.claude/skills/generated/cluster-121/SKILL.md` |
| Work in the Cluster_11 area (5 symbols) | `.claude/skills/generated/cluster-11/SKILL.md` |

<!-- gitnexus:end -->
