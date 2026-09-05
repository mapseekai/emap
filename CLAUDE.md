# Project instructions

Follow the repository-wide guidance in [AGENTS.md](AGENTS.md). GitNexus index statistics are generated locally and must not be committed here; use `node .gitnexus/run.cjs status --repo .` when current graph information is needed.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **emap** (8548 symbols, 29817 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "master"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

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
| Work in the Map area (508 symbols) | `.claude/skills/generated/map/SKILL.md` |
| Work in the Duckdb area (435 symbols) | `.claude/skills/generated/duckdb/SKILL.md` |
| Work in the Handlers area (272 symbols) | `.claude/skills/generated/handlers/SKILL.md` |
| Work in the Ops area (263 symbols) | `.claude/skills/generated/ops/SKILL.md` |
| Work in the Commands area (158 symbols) | `.claude/skills/generated/commands/SKILL.md` |
| Work in the Ui area (141 symbols) | `.claude/skills/generated/ui/SKILL.md` |
| Work in the Geo area (139 symbols) | `.claude/skills/generated/geo/SKILL.md` |
| Work in the Adapter area (123 symbols) | `.claude/skills/generated/adapter/SKILL.md` |
| Work in the Arrow area (103 symbols) | `.claude/skills/generated/arrow/SKILL.md` |
| Work in the Renderer area (64 symbols) | `.claude/skills/generated/renderer/SKILL.md` |
| Work in the Scripts area (64 symbols) | `.claude/skills/generated/scripts/SKILL.md` |
| Work in the Source area (45 symbols) | `.claude/skills/generated/source/SKILL.md` |
| Work in the Examples area (16 symbols) | `.claude/skills/generated/examples/SKILL.md` |
| Work in the Cluster_12 area (10 symbols) | `.claude/skills/generated/cluster-12/SKILL.md` |
| Work in the Cluster_230 area (10 symbols) | `.claude/skills/generated/cluster-230/SKILL.md` |
| Work in the Edit area (9 symbols) | `.claude/skills/generated/edit/SKILL.md` |
| Work in the Cluster_15 area (7 symbols) | `.claude/skills/generated/cluster-15/SKILL.md` |
| Work in the Cluster_1 area (6 symbols) | `.claude/skills/generated/cluster-1/SKILL.md` |
| Work in the Cluster_2 area (6 symbols) | `.claude/skills/generated/cluster-2/SKILL.md` |
| Work in the Cluster_107 area (6 symbols) | `.claude/skills/generated/cluster-107/SKILL.md` |

<!-- gitnexus:end -->
