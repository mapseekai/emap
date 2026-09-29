import type { ArcCollection } from '../../shared/types/mapshaper-types';
import { restoreTransferredArcs } from './adapter';

/** Mapshaper's display-only threshold/radial filter, with bounded CPU slices.
 * Read raw storage rather than retaining mapshaper's shared iterator across a yield.
 * The caller cancels when coordinates change; source topology is never mutated. */
export async function prepareDisplayLod(
  arcs: ArcCollection,
  signal: AbortSignal,
): Promise<{ arcs: ArcCollection; segmentLength: number }> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  signal.throwIfAborted();
  const data = arcs.getVertexData!(),
    { xx, yy, zz, nn, ii } = data;
  const filteredCounts = zz ? new Int32Array(nn.length) : new Uint32Array(nn.length);
  let slice = performance.now(),
    work = 0;
  const yieldSlice = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal.throwIfAborted();
    slice = performance.now();
  };
  let segmentLength = 0,
    threshold = 0;
  if (zz) {
    // mapshaper bounds this rank selection to roughly 500k sampled thresholds.
    threshold = arcs.getThresholdByPct!(0.08, Math.ceil(xx.length / 500_000));
  } else {
    let sum = 0,
      segments = 0;
    for (let arc = 0; arc < nn.length; arc++) {
      for (let i = ii[arc] + 1, end = ii[arc] + nn[arc]; i < end; i++) {
        const dx = xx[i] - xx[i - 1],
          dy = yy[i] - yy[i - 1];
        sum += Math.sqrt(dx * dx + dy * dy);
        segments++;
        if ((++work & 4095) === 0 && performance.now() - slice > 4) await yieldSlice();
      }
      if ((++work & 4095) === 0 && performance.now() - slice > 4) await yieldSlice();
    }
    segmentLength = (sum / segments || 0) * 4;
  }
  let outX = new Float64Array(0),
    outY = new Float64Array(0);
  let outZ: Float64Array | null = null;
  // Count first to avoid a second full-size coordinate copy or boxed JS arrays.
  for (const write of [false, true]) {
    let out = 0,
      sum = 0,
      segments = 0;
    for (let arc = 0; arc < nn.length; arc++) {
      let count = 0,
        previousX = NaN,
        previousY = NaN;
      for (let i = ii[arc], end = i + nn[arc]; i < end; i++) {
        const x = xx[i],
          y = yy[i];
        const dx = x - previousX,
          dy = y - previousY;
        const keep = zz
          ? !threshold || zz[i] >= threshold
          : count === 0 ||
            Math.sqrt(dx * dx + dy * dy) > segmentLength ||
            (i === end - 1 && (x !== previousX || y !== previousY));
        if (keep) {
          if (write) {
            outX[out] = x;
            outY[out] = y;
            if (outZ) outZ[out] = zz![i];
            if (count) {
              sum += Math.sqrt(dx * dx + dy * dy);
              segments++;
            }
          }
          previousX = x;
          previousY = y;
          count++;
          out++;
        }
        if ((++work & 4095) === 0 && performance.now() - slice > 4) await yieldSlice();
      }
      if (count === 1) {
        if (zz && threshold) throw new Error('Collapsed display arc');
        if (!zz) {
          count = 0;
          out--;
        }
      }
      if (!write) filteredCounts[arc] = count;
      if ((++work & 4095) === 0 && performance.now() - slice > 4) await yieldSlice();
    }
    if (!write) {
      outX = new Float64Array(out);
      outY = new Float64Array(out);
      outZ = zz ? new Float64Array(out) : null;
    } else if (zz) segmentLength = sum / segments || 0;
    await yieldSlice();
  }
  const filtered = restoreTransferredArcs({ nn: filteredCounts, xx: outX, yy: outY });
  if (outZ) filtered.setThresholds!(outZ);
  return { arcs: filtered, segmentLength };
}
