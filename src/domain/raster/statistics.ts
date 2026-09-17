import { validateRasterWindow } from './policy';
import type {
  RasterBandStatistics,
  RasterMetadata,
  RasterSource,
  RasterStyle,
  RasterWindow,
} from './types';

const GRID_SIZE = 4;
const WINDOW_SIZE = 64;
const SAMPLE_LIMIT = GRID_SIZE ** 2 * WINDOW_SIZE ** 2;

/** Bounded source-wide stratified sampling, normally executed inside the decoder Worker. */
export async function collectRasterStatistics(
  source: RasterSource,
  signal?: AbortSignal,
): Promise<readonly RasterBandStatistics[]> {
  signal?.throwIfAborted();
  const { metadata } = source,
    base = metadata.levels[0];
  const sorted = [...metadata.levels].sort((a, b) => a.width * a.height - b.width * b.height);
  const level = sorted.filter((item) => item.width * item.height <= 1024 ** 2).at(-1) ?? sorted[0];
  const arrays = Array.from(
    { length: base.samples },
    () => new Float64Array(Math.min(SAMPLE_LIMIT, level.width * level.height)),
  );
  const counts = Array(base.samples).fill(0) as number[];
  const samples = Array.from({ length: base.samples }, (_, i) => i);
  let pixels = 0;
  // Each stratum contributes at most 64x64 positions; no full-sized output array.
  for (let row = 0; row < GRID_SIZE; row++)
    for (let col = 0; col < GRID_SIZE; col++) {
      signal?.throwIfAborted();
      const x0 = Math.floor((col * level.width) / GRID_SIZE),
        x1 = Math.floor(((col + 1) * level.width) / GRID_SIZE);
      const y0 = Math.floor((row * level.height) / GRID_SIZE),
        y1 = Math.floor(((row + 1) * level.height) / GRID_SIZE);
      const width = Math.min(WINDOW_SIZE, x1 - x0),
        height = Math.min(WINDOW_SIZE, y1 - y0);
      if (!width || !height) continue;
      const x = Math.floor((x0 + x1 - width) / 2),
        y = Math.floor((y0 + y1 - height) / 2);
      const window: RasterWindow = [x, y, x + width, y + height];
      validateRasterWindow(level, window, samples);
      const result = await source.readWindow({ level: level.id, window, samples }, signal);
      signal?.throwIfAborted();
      pixels += width * height;
      for (let i = 0; i < width * height; i++) {
        if (
          metadata.alphaBand !== null &&
          (!Number.isFinite(result.data[metadata.alphaBand][i]) ||
            result.data[metadata.alphaBand][i] <= 0)
        )
          continue;
        for (let band = 0; band < base.samples; band++) {
          const value = result.data[band][i];
          if (!Number.isFinite(value) || (metadata.noData !== null && value === metadata.noData))
            continue;
          arrays[band][counts[band]++] = value;
        }
      }
    }
  const approximate = level.id !== base.id || pixels < base.width * base.height;
  return arrays.map((buffer, band) => {
    const count = counts[band],
      values = buffer.subarray(0, count);
    values.sort();
    if (!count) return { min: 0, max: 1, p02: 0, p98: 1, count: 0, approximate };
    const quantile = (p: number) => {
      const position = (count - 1) * p,
        lower = Math.floor(position),
        weight = position - lower;
      // Weighted addition avoids overflow for large, opposite-sign Float64 samples.
      return values[lower] * (1 - weight) + values[Math.min(count - 1, lower + 1)] * weight;
    };
    return {
      min: values[0],
      max: values[count - 1],
      p02: quantile(0.02),
      p98: quantile(0.98),
      count,
      approximate,
    };
  });
}

/** Explicit ranges override stretch modes; all tiles share the same source statistics. */
export function resolveRasterRanges(
  metadata: RasterMetadata,
  style: RasterStyle,
  bands: readonly number[],
): readonly (readonly [number, number])[] {
  const base = metadata.levels[0],
    mode = style.stretch ?? 'auto';
  return bands.map((band, index) => {
    if (style.ranges?.[index]) return style.ranges[index];
    const bits = base.bits[band],
      format = base.formats[band],
      stats = metadata.statistics?.[band];
    const enabled = mode !== 'none' && (mode !== 'auto' || format !== 1 || bits !== 8);
    if (enabled && stats?.count) {
      if (mode === 'minmax' || stats.p02 >= stats.p98) return [stats.min, stats.max] as const;
      return [stats.p02, stats.p98] as const;
    }
    return format === 3
      ? ([0, 1] as const)
      : format === 2
        ? ([-(2 ** (bits - 1)), 2 ** (bits - 1) - 1] as const)
        : ([0, 2 ** bits - 1] as const);
  });
}

export function stretchRasterValue(value: number, range: readonly [number, number]): number {
  const [min, max] = range;
  if (min === max) return 128;
  if (value <= min) return 0;
  if (value >= max) return 255;
  const width = max - min;
  const normalized = Number.isFinite(width)
    ? (value - min) / width
    : (value / 2 - min / 2) / (max / 2 - min / 2);
  return Math.round(Math.max(0, Math.min(1, normalized)) * 255);
}
