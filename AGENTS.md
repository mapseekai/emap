# AGENTS.md — Rules for AI agents working in `emap`

`emap` is a browser-only TypeScript topology-oriented map rendering and editing
engine built on `mapshaper` data structures and HTML5 Canvas.

## Read only what the task needs

| Task | Guidance |
| --- | --- |
| Locate responsibilities or change architecture/runtime composition | [README architecture](README.md#architecture) and the [architecture guide](packages/docs/docs/concepts/architecture.md) |
| Install dependencies or select development commands | [README development](README.md#development); `package.json` defines executable commands |
| Change public APIs or package entry points | The explicit export list in `src/index.ts` and affected type contracts |
| Change DuckDB SQL, tables, or data access | [DuckDB guide](packages/docs/docs/data/duckdb.md) |
| Change expression execution or untrusted input handling; report a vulnerability | [SECURITY.md](SECURITY.md) |
| Publish a package, deploy docs, or prepare a release | [Release checklist](docs/release-checklist.md) and relevant `.github/workflows/` file |
| Navigate/refactor code with graph tools | [Code intelligence](docs/agent-tools.md#code-intelligence) |
| Investigate WebGL2/WebGPU performance, GPU memory, or resource leaks | [luma.gl profiling guide](https://luma.gl/docs/developer-guide/profiling) and the installed `lumagl` skill |
| Use or maintain a skill | [Skill selection and maintenance](docs/agent-tools.md#skills) |

Read only the relevant sections and follow deeper references as needed. This is a
browser-only project with optional DuckDB-Wasm, not a server database application;
do not invent a database migration or deployment workflow.

## Hard Rules — Source and test layout

- `src/` has exactly six responsibility zones: `domain`, `engine`, `runtime`, `integrations`, `ui`, and `shared`; do not add a new top-level source area without an ADR.
- `domain` must stay independent of Cordis, DOM, UI and concrete providers. Runtime composition belongs in `runtime`; hot map/render/interaction paths belong in `engine`; third-party bridges belong in `integrations`.
- Unit tests are colocated and named exactly `foo.test.ts` for `foo.ts`. One implementation file may have at most one colocated unit-test file.
- Cross-module regression/integration tests belong in `test/integration`; browser/build/type/docs/examples/security suites stay in their dedicated `test/` directories. Never put `*.integration.test.ts`, audit suites, or `*.test-d.ts` back under `src/`.
- Run `pnpm test-layout:check` after moving source/tests and `pnpm typecheck:contracts` after changing public types.

## Code search and commands

Use GitNexus or CodeGraph first for structural navigation and assess callers before
changing symbols. Read [code intelligence](docs/agent-tools.md#code-intelligence)
for commands, freshness checks, and the unavailable-tool fallback. Use `rg` for
literal text and file discovery. Documentation-only edits do not require a graph.

When RTK is installed, prefix shell commands with `rtk`; use
`rtk proxy <command>` when unfiltered output is needed. Without RTK, run commands
directly. Tool setup must not block otherwise safe, verifiable work.

## Hard Rules — Code Conventions

- Use `EventDispatcher` (`on` / `fire`) for internal signals, never raw DOM events at the engine layer.
- All coordinate math goes through `AffineTransform`, never ad-hoc matrices.
- Layer resolution goes through `LayerRegistry.resolve(...)`, never inline `layers.find(...)`.
- Render-loop side effects must defer via `requestAnimationFrame` or tween callbacks, never inline in `render()`.
- New ops MUST classify their effect (`shape-count` / `topology-only` / `attribute-only` / `crs-only`) in `src/engine/map/ops/_runner.ts`'s `COMMAND_EFFECTS` table; selection preservation depends on it. Update existing classifications when effects change.
- Do not import `mapshaper` directly outside `src/integrations/mapshaper/adapter.ts`, worker entry, vendor modules, and type/shim boundaries.

## Work through completion

Understand the task, implement, run relevant checks, inspect results, fix problems
introduced by the change, and rerun affected checks. Define an observable success
criterion; use a short plan for multi-step work. Completion requires the intended
behavior and applicable checks to pass, with no known unresolved in-scope issue.
Report unavailable checks or external blockers explicitly; do not claim success
for them. Continue independent work when one part is blocked.

Within the authorized task, proceed with local edits, tests, formatting, builds,
debugging, and fixes without step-by-step approval. Make reasonable reversible
choices and state material assumptions. Ask only when missing information changes
scope, correctness, safety, or an irreversible outcome. Do not stop after a plan
or a small step when the remaining work is authorized.

Keep edits scoped and match existing style. Preserve unrelated worktree changes;
remove code made unused by your change, but leave unrelated cleanup alone.
Preserve native Cordis ownership and lifecycle, public API contracts, reversible
edits, history, transactions, selection restoration, and stale-result protection.

Prepare and verify work before asking for any necessary final approval.
Production changes, publishing, destructive data operations, credential changes,
and external writes require authorization covering that specific action. Do not
repeat approval already given or treat a local build as permission to deploy.
Respect host permissions; do not expose secrets or upload private data.

## Verification

For behavior changes, use a failing reproduction or focused regression test,
then verify the intended contract. Select checks for the affected area:

- Source/test moves and public types: the required checks under source/test layout
  above; changed exports also require `pnpm run api:check-surface`.
- Dependency boundaries/runtime composition: `pnpm run architecture:check` plus
  affected lifecycle tests. AI capability changes: `pnpm run capabilities:check`.
- Other code changes: affected tests, typecheck, and build when output is affected.
- Agent instructions or prose only: inspect links, command names, and conflicting
  rules. Product documentation/API/example changes use `pnpm run docs:verify`.
- Release preparation: the complete `pnpm run release:verify` gate remains required.

Once applicable checks pass, repeat or broaden them only for new changes,
failures, or unresolved concerns. Do not add tests that merely mirror prose edits.
Summarize changes, verification evidence, and remaining blockers concisely.

For GPU performance investigations, check the installed luma.gl version before
using the profiling guide. Inspect probe.gl resource/memory counters and use
asynchronous GPU timestamp queries when supported; report unavailable or disjoint
samples. Separate CPU submission time, GPU duration, completion latency, and FPS.
Compare the same data, view, DPR, and filtering settings, and destroy owned query
resources after profiling. Typechecking or CPU timings alone do not verify GPU
performance or rendering correctness.

## Issue tracking — Multica

Before deferring a non-sensitive bug, performance issue, or follow-up, search the
emap Multica project and create a concise issue if none exists and issue-writing
is authorized. If unavailable or unauthorized, record the finding and reproduction
in the local task report and report the tracking blocker; continue other work.
For vulnerabilities, follow `SECURITY.md`'s private reporting route rather than a
public issue; obtain authorization before sending a report externally.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **emap** (21258 symbols, 68959 relationships, 831 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact analysis before editing.** Use `impact({target: "symbolName", direction: "upstream"})` (MCP) or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .` (CLI fallback); report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "master"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "master" --repo .`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/emap/context` | Codebase overview, check index freshness |
| `gitnexus://repo/emap/clusters` | All functional areas |
| `gitnexus://repo/emap/processes` | All execution flows |
| `gitnexus://repo/emap/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
