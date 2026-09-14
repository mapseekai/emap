# Agent tools

Use this reference only for code intelligence or skill maintenance. Repository
behavior and safety boundaries are defined in [AGENTS.md](../AGENTS.md).

## Code intelligence

For structural navigation, use an available GitNexus or CodeGraph integration
first. CodeGraph provides focused symbol reads and flows; GitNexus provides:

- `query`: unfamiliar execution flows.
- `context`: a symbol's callers, callees, and processes.
- `impact({target: "symbolName", direction: "upstream"})`: blast radius before
  changing a function, class, or method. Report material risk; warn before edits
  rated HIGH or CRITICAL and choose verification for affected callers/processes.
- `rename`: symbol-aware renames, followed by review of the resulting diff.
- `detect_changes()`: affected symbols and flows before committing code. For a
  branch review, use compare scope with the actual target branch; do not assume
  that every task targets `master`.

Inspect freshness when graph results matter. If the local runner exists, use
`rtk node .gitnexus/run.cjs status`; refresh stale data with
`rtk node .gitnexus/run.cjs analyze`. Review generated instruction-file changes
after analysis; keep maintained rules in `AGENTS.md` and avoid duplicate generated
policy or committed index statistics.

If the graph/runner is unavailable or refresh fails, report the limitation and
use targeted `rg` searches and source reads to inspect callers, imports, and
tests. Review the diff and run relevant checks before proceeding. Use a language
server rename when available; otherwise review every rename reference explicitly.
Do not install global tools or repeatedly rebuild an unusable index to unblock a
routine edit. Documentation-only edits do not require graph analysis. Generated
indexes supplement current source; they are not authority over it.

## Skills

Select a skill for its actual purpose and trigger, not an incidental keyword.
Load its entrypoint first, then only the references needed for the task. Preserve
the user's scope and already-granted authorization; a skill must not introduce
unrelated work or repeated approval pauses.

When adding or editing a repository-owned skill:

- Keep its description to purpose, precise trigger, and any necessary exclusion.
- Keep the entrypoint to essential constraints and the next relevant reference;
  leave short skills self-contained. Put substantial conditional workflows,
  examples, and scripts in linked references/resources.
- Check positive and negative trigger examples, reference paths, and any changed
  executable helpers. Use behavioral scenarios when changing behavioral guidance.
- Keep security and irreversible-action boundaries explicit. Avoid global
  requirements to plan, delegate, read every document, or stop for confirmation.

`skills-lock.json` records external skill provenance and hashes; it does not
contain skill prompts. Personal skills and installed plugin caches are outside
this repository. Do not copy or rewrite them as a substitute for a missing local
skill, or change lock hashes without actually updating the associated dependency.
