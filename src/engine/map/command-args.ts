// Identifier validation for values that flow into mapshaper command args.
//
// Why this exists: mapshaper's option parsing splits values on `=` and
// `,` internally, so a user-controlled field name that embeds those
// structural separators can confuse the parser into seeing a different
// option than what was intended. The validators reject such inputs at
// every op entry point that accepts an identifier from caller code.

/**
 * Field-name rule. No `:` (mapshaper field-name parsers in some places
 * treat `:` as a type tag); excludes `=`/`,`, quotes, backslash,
 * whitespace (other than internal spaces, which we DO permit since
 * real-world shapefile names sometimes contain them) and control
 * characters 0x00..0x1F.
 */
const FIELD_NAME_RE = /^[A-Za-z0-9_\-.一-鿿][A-Za-z0-9_\-. 一-鿿]*$/;

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
