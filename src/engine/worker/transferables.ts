/**
 * Walk a packed payload and gather every referenced ArrayBuffer for
 * postMessage transfer. De-dups by buffer identity so the same backing store
 * isn't transferred twice.
 */
export function collectTransferables(root: unknown): Transferable[] {
  const out: Transferable[] = [];
  const seen = new Set<ArrayBuffer>();
  const visit = (val: unknown): void => {
    if (!val || typeof val !== 'object') return;
    if (val instanceof Uint8Array) {
      const buf = val.buffer;
      if (buf instanceof ArrayBuffer && !seen.has(buf)) {
        seen.add(buf);
        out.push(buf);
      }
      return;
    }
    if (val instanceof ArrayBuffer) {
      if (!seen.has(val)) {
        seen.add(val);
        out.push(val);
      }
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) visit(item);
      return;
    }
    for (const key of Object.keys(val)) {
      visit((val as Record<string, unknown>)[key]);
    }
  };
  visit(root);
  return out;
}
