# AGENTS.md — Rules for AI agents working in `emap`

`emap` is a browser-only TypeScript topology-oriented map rendering and editing
engine built on `mapshaper` data structures and HTML5 Canvas.

## Project guidance

- **Architecture, repository layout, patterns, code conventions, and change locations** → [README.md — Architecture](README.md#architecture)
- **Install, typecheck, test, build, and manual-example workflows** → [README.md — Development](README.md#development)

## Hard Rules — Code Search

Structural code search MUST go through GitNexus or CodeGraph first; `grep` and
`find` are fallbacks for literal text, comments, log messages, or string
literals that the graph cannot answer. Trust graph results rather than
re-verifying them with text search. If an index is stale, refresh it before
falling back to text search.

- Use CodeGraph to locate or read symbols, trace flows, and inspect focused
  context.
- Use GitNexus `query` for unfamiliar execution flows, `context` for complete
  symbol context, `impact` before changing symbols, and `rename` for renames.

## Hard Rules — Code Conventions

- Use `EventDispatcher` (`on` / `fire`) for internal signals, never raw DOM events at the engine layer.
- All coordinate math goes through `AffineTransform`, never ad-hoc matrices.
- Layer resolution goes through `LayerRegistry.resolve(...)`, never inline `layers.find(...)`.
- Render-loop side effects must defer via `requestAnimationFrame` or tween callbacks, never inline in `render()`.
- New ops MUST classify their effect (`shape-count` / `topology-only` / `attribute-only` / `crs-only`) in `src/map/ops/_runner.ts`'s `COMMAND_EFFECTS` table; selection preservation depends on it.
- Do not import `mapshaper` directly outside `src/adapter/mapshaper-adapter.ts`, worker entry, vendor modules, and type/shim boundaries.

## Development behavior

### Think before you write

- State assumptions explicitly; when unsure, ask.
- When multiple interpretations exist, lay them out rather than silently picking one.
- Prefer a simpler approach; push back when it avoids unnecessary complexity.
- Stop and name genuine ambiguity rather than hiding it.

### Simplicity first

- Implement only the requested behavior.
- Do not add abstractions, configurability, or error handling without a concrete need.
- Rewrite overbuilt code until every piece earns its place.

### Surgical edits

- Touch only lines required by the request; do not refactor adjacent code or formatting.
- Match established style.
- Mention unrelated dead code; do not delete it unless asked.
- Remove imports, variables, and functions made unused by the current change.
- Every diff line must trace to the request.

### Goal-driven work

Define a verifiable success criterion before implementation. For multi-step work,
write a short plan with a concrete verification for every step. For behavior
changes, use a failing reproduction or focused test, then verify the intended
contract after the change.

## Issue tracking — Multica

Before leaving a discovered bug, security concern, performance issue, or deferred
work unfixed, search the **emap** Multica project for an existing issue. Create a
concise issue when none exists; never leave a finding only in chat.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **emap** (8795 symbols, 31038 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
| Work in the Map area (518 symbols) | `.claude/skills/generated/map/SKILL.md` |
| Work in the Ops area (284 symbols) | `.claude/skills/generated/ops/SKILL.md` |
| Work in the Handlers area (271 symbols) | `.claude/skills/generated/handlers/SKILL.md` |
| Work in the Duckdb area (177 symbols) | `.claude/skills/generated/duckdb/SKILL.md` |
| Work in the Commands area (152 symbols) | `.claude/skills/generated/commands/SKILL.md` |
| Work in the Geo area (151 symbols) | `.claude/skills/generated/geo/SKILL.md` |
| Work in the Ui area (141 symbols) | `.claude/skills/generated/ui/SKILL.md` |
| Work in the Arrow area (103 symbols) | `.claude/skills/generated/arrow/SKILL.md` |
| Work in the Runners area (102 symbols) | `.claude/skills/generated/runners/SKILL.md` |
| Work in the Adapter area (95 symbols) | `.claude/skills/generated/adapter/SKILL.md` |
| Work in the Renderer area (65 symbols) | `.claude/skills/generated/renderer/SKILL.md` |
| Work in the Scripts area (64 symbols) | `.claude/skills/generated/scripts/SKILL.md` |
| Work in the Attributes area (46 symbols) | `.claude/skills/generated/attributes/SKILL.md` |
| Work in the Source area (45 symbols) | `.claude/skills/generated/source/SKILL.md` |
| Work in the Join area (43 symbols) | `.claude/skills/generated/join/SKILL.md` |
| Work in the Geometry area (39 symbols) | `.claude/skills/generated/geometry/SKILL.md` |
| Work in the Geoparquet area (33 symbols) | `.claude/skills/generated/geoparquet/SKILL.md` |
| Work in the Cluster_250 area (23 symbols) | `.claude/skills/generated/cluster-250/SKILL.md` |
| Work in the Selection area (23 symbols) | `.claude/skills/generated/selection/SKILL.md` |
| Work in the Examples area (16 symbols) | `.claude/skills/generated/examples/SKILL.md` |

<!-- gitnexus:end -->

<!-- rtk-instructions v2 -->

# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:

```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)

```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)

```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)

```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)

```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)

```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
rtk uv run <cmd>        # Compact uv project command output
```

### Files & Search (60-75% savings)

```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)

```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)

```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)

```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands

```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category         | Commands                       | Typical Savings |
| ---------------- | ------------------------------ | --------------- |
| Tests            | vitest, playwright, cargo test | 90-99%          |
| Build            | next, tsc, lint, prettier      | 70-87%          |
| Git              | status, log, diff, add, commit | 59-80%          |
| GitHub           | gh pr, gh run, gh issue        | 26-87%          |
| Package Managers | pnpm, npm, npx                 | 70-90%          |
| Files            | ls, read, grep, find           | 60-75%          |
| Infrastructure   | docker, kubectl                | 85%             |
| Network          | curl, wget                     | 65-70%          |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->
