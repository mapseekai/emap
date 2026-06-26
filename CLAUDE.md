# CLAUDE.md — Rules for AI agents working in `emap`

`emap` is a browser-only TypeScript topology-oriented map rendering and editing
engine built on `mapshaper` data structures and Canvas.

For repo layout, architectural patterns, code conventions, and where each kind
of change goes, read [README.md — Architecture](README.md#architecture).

---

## Hard Rules — Code Search (MANDATORY)

**Structural code search MUST go through GitNexus or CodeGraph first. `grep` /
`find` is a fallback, not a default.**

| Question | Tool |
|---|---|
| "Where is X defined?" / "Find symbol X" | `codegraph_search` or `gitnexus_query` |
| "What calls Y?" | `codegraph_callers` or `gitnexus_context` |
| "What does Y call?" | `codegraph_callees` |
| "What breaks if I change Z?" | `codegraph_impact` or `gitnexus_impact` |
| "Show Y's signature / source" | `codegraph_node` |
| "Focused context for an area" | `codegraph_context` |
| "Several related symbols at once" | `codegraph_explore` |
| "How does X reach Y? / trace the flow" | `codegraph_trace` |

Trust the results — do NOT re-verify with `grep`; the AST index is more
accurate than text matching. Use `grep` only for literal text the graph can't
answer (log messages, comment text, string literals) and briefly say why.

If the graph tools report a stale index: run `npx gitnexus analyze` and/or
`codegraph init -i` first; do not switch to grep as a shortcut.

## Hard Rules — Code Conventions

- Use `EventDispatcher` (`on` / `fire`) for internal signals, never raw DOM events at the engine layer.
- All coordinate math goes through `AffineTransform`, never ad-hoc matrices.
- Layer resolution goes through `LayerRegistry.resolve(...)`, never inline `layers.find(...)`.
- Render-loop side effects must defer via `requestAnimationFrame` or tween callbacks, never inline in `render()`.
- New ops MUST classify their effect (`shape-count` / `topology-only` / `attribute-only` / `crs-only`) in `src/map/ops/_runner.ts`'s `COMMAND_EFFECTS` table — selection preservation depends on it.
- Do not import `mapshaper` directly outside `src/adapter/mapshaper-adapter.ts`, worker entry, vendor modules, and type/shim boundaries.

## GitNexus — Before Editing

This repo is indexed by GitNexus as **emap**.

- **MUST run `gitnexus_impact({target, direction: "upstream"})` before modifying any function/class/method.** Report the blast radius (direct callers, affected processes, risk) to the user before editing.
- **MUST run `gitnexus_detect_changes()` before committing** to verify changes only affect expected symbols.
- **MUST warn the user** if impact returns HIGH or CRITICAL risk before proceeding.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.

Useful MCP resources:

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/emap/context` | Codebase overview, check index freshness |
| `gitnexus://repo/emap/processes` | All execution flows |
| `gitnexus://repo/emap/process/{name}` | Step-by-step execution trace |

## Development Behavior

Guardrails against the LLM coding failure modes that bite this codebase most
often. **Bias toward caution over speed; use judgment on trivial tasks.**

### Think before you write

**Don't assume, don't hide confusion, surface the tradeoffs.**

Before implementing:

- State your assumptions explicitly; if unsure, ask.
- When multiple interpretations exist, lay them out — don't silently pick one.
- If a simpler approach exists, say so; push back when you should.
- If something is unclear, stop, name the confusion, and ask.

### Simplicity first

**Solve the problem with the minimum code. No speculative code.**

- No features that weren't asked for.
- No abstractions for code used only once.
- No "flexibility" / "configurability" that wasn't requested.
- No error handling for situations that can't happen.
- If you wrote 200 lines that could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overbuilt?" If yes, simplify.

### Surgical edits

**Only touch what needs to change; only clean up your own debris.**

When modifying existing code:

- Don't "improve" adjacent code, comments, or formatting along the way.
- Don't refactor things that aren't broken.
- Match the existing style even if you dislike it.
- Notice unrelated dead code? **Mention it** — don't delete it.

When your change creates orphans:

- Delete imports / variables / functions made unused **by your change**.
- Don't delete pre-existing dead code unless asked.

Test: every line of the diff should trace back to the user's request.

### Goal-driven work

**Define a success criterion, close the loop on verification.**

Convert tasks into verifiable goals:

- "Add validation" → "write a test for invalid input, then make it pass"
- "Fix this bug" → "write a failing repro test first, then make it pass"
- "Refactor X" → "confirm tests pass before and after the refactor"

For multi-step work, lay out a short plan first:

```
1. [step] → verify: [check]
2. [step] → verify: [check]
3. [step] → verify: [check]
```

Strong criteria let you close the loop independently. Weak criteria ("make it
work") force the user into repeated clarification rounds.

**Signals these rules are working**: fewer stray edits in diffs; less rework
from over-engineering; clarifying questions land before implementation rather
than after a broken result.

## Development

See [README.md — Development](README.md#development) for install / typecheck /
test / build commands and the manual-example workflow.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **emap** (3683 symbols, 14364 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
