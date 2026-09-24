/** Stable ascending unsigned-key order. Ties keep the original triangle order.
 * Four byte passes use bounded numeric scratch rather than O(n log n) callbacks.
 */
export function radixOrder(keys: Uint32Array): Uint32Array {
  let order = Uint32Array.from(keys, (_, i) => i);
  if (keys.length < 2) return order;
  let scratch = new Uint32Array(keys.length);
  const counts = new Uint32Array(256);
  for (let shift = 0; shift < 32; shift += 8) {
    counts.fill(0);
    for (let i = 0; i < keys.length; i++) counts[(keys[i] >>> shift) & 255]++;
    let total = 0;
    for (let i = 0; i < 256; i++) {
      const n = counts[i];
      counts[i] = total;
      total += n;
    }
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      scratch[counts[(keys[id] >>> shift) & 255]++] = id;
    }
    const previous = order;
    order = scratch;
    scratch = previous;
  }
  return order;
}
