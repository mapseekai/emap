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

This project is indexed by GitNexus as **emap** (6467 symbols, 20385 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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

<!-- gitnexus:end -->


<claude-mem-context>
# Memory Context

# [emap] recent context, 2026-08-10 9:37pm GMT+8

No previous sessions found.
</claude-mem-context>
