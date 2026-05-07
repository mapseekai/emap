// Quoting + identifier validation for values that flow into mapshaper
// CLI-style command strings.
//
// Why this exists: mapshaper's `parseCommands` consumes a shell-like syntax
// where `-target NAME`, `field=VALUE`, `EXPR` etc. are split on whitespace
// and `=`. A user-controlled layer or field name that embeds `=`, `\n`,
// `"`, `\` or a control character can confuse the parser into seeing a
// different command than what was intended. Until PR-4b replaces string
// concatenation with a parsed-command builder, the defence is two-layer:
//
//   1. `quoteCliArg(value)` escapes characters that would break out of a
//      double-quoted argument or smuggle in a newline / NUL.
//   2. `isValidLayerName` / `isValidFieldName` reject inputs that contain
//      the structural separators `=` and `,` even before they hit the
//      quoter, because mapshaper splits options on those internally and
//      escaping doesn't help.
//
// Both helpers are pure and cheap; call them at every op entry point that
// accepts an identifier from caller code.

/**
 * Escape a value for embedding inside a double-quoted CLI argument.
 *
 * Wraps the result in `"..."`. Inside the quotes:
 *   - `\` → `\\`
 *   - `"` → `\"`
 *   - `\n` / `\r` / `\t` / `\0` → escaped escape sequences. `\n`/`\r`
 *     would otherwise terminate mapshaper's argument scan; `\0` would
 *     truncate the C-style strings inside mapshaper-vendor's bundled
 *     mproj. Other control chars (U+0001..U+001F minus the ones above)
 *     get rejected by validators upstream so they never reach here.
 *
 * The function does NOT validate the argument is identifier-safe — it only
 * makes whatever you hand it round-trip safely through mapshaper's quote
 * stripper. Pair it with {@link isValidLayerName} / {@link isValidFieldName}
 * for inputs that are supposed to be identifiers.
 */
export function quoteCliArg(value: string): string {
  // Order matters: backslash MUST be replaced first. After that, doubling
  // a backslash for any subsequent escape sequence would erase the literal
  // backslashes we just wrote.
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\0/g, '\\0');
  return `"${escaped}"`;
}

/**
 * Identifier rule for layer names. Allows ASCII alphanumerics, `_`, `-`,
 * `.`, `:`, plus CJK characters; first character must not be a space.
 *
 * The set deliberately excludes:
 *   - `=` and `,` — mapshaper option-list separators
 *   - `"` and `'` — would terminate the CLI quote
 *   - `\` — escape introducer for the parser
 *   - whitespace (other than internal spaces, which we DO permit since
 *     real-world shapefile names sometimes contain them)
 *   - control characters 0x00..0x1F
 *   - `<>{}[];|&$` — reserved for future hygiene
 */
const LAYER_NAME_RE =
  /^[A-Za-z0-9_\-:.一-鿿][A-Za-z0-9_\-:. 一-鿿]*$/;

/**
 * Field-name rule. Slightly stricter than {@link LAYER_NAME_RE}: no `:`
 * (mapshaper field-name parsers in some places treat `:` as a type tag).
 */
const FIELD_NAME_RE =
  /^[A-Za-z0-9_\-.一-鿿][A-Za-z0-9_\-. 一-鿿]*$/;

/** True iff `value` looks like a safe mapshaper layer name. */
export function isValidLayerName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && LAYER_NAME_RE.test(value);
}

/** True iff `value` looks like a safe mapshaper field name. */
export function isValidFieldName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && FIELD_NAME_RE.test(value);
}

/**
 * Validate a list of field names. Returns `null` on success or the FIRST
 * offending name as a structured-friendly error tuple. Empty arrays are
 * permitted (caller decides whether to reject).
 */
export function findInvalidFieldName(values: ReadonlyArray<unknown>): string | null {
  for (const v of values) {
    if (!isValidFieldName(v)) return typeof v === 'string' ? v : String(v);
  }
  return null;
}
