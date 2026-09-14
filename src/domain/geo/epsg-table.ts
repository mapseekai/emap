/**
 * Look up `code`'s row value in a bundled `code\tvalue\n` TSV table.
 * Returns `null` when the code is absent.
 */
export function lookupEpsgTsv(table: string, code: string): string | null {
  const firstNeedle = `${code}\t`;
  let start = table.startsWith(firstNeedle) ? 0 : -1;
  if (start === -1) {
    const index = table.indexOf(`\n${firstNeedle}`);
    if (index === -1) return null;
    start = index + 1;
  }
  const valueStart = start + firstNeedle.length;
  const valueEnd = table.indexOf('\n', valueStart);
  return table.slice(valueStart, valueEnd === -1 ? undefined : valueEnd);
}
