// _classify-breaks — classifyFeatures 的断点/计数纯函数。断点权威在 emap：
// mapshaper 只收显式 breaks/colors 做逐记录映射。

/** Interior breaks (length classes-1) at quantile positions. 输入须已升序。 */
export function quantileBreaks(sorted: readonly number[], classes: number): number[] {
  const n = sorted.length;
  if (n === 0) return [];
  const out: number[] = [];
  for (let i = 1; i < classes; i++) {
    out.push(sorted[Math.floor((i * (n - 1)) / classes)]);
  }
  return out;
}

export function equalIntervalBreaks(min: number, max: number, classes: number): number[] {
  const step = (max - min) / classes;
  return Array.from({ length: classes - 1 }, (_, i) => min + step * (i + 1));
}

/** Nice-number breaks：取不大于 rough 的 nice 单位（1/2/2.5/5×10^k），
 * 把 [min,max] 向外形舍到单位整数倍，再等分为 classes 段取内部断点。 */
export function niceBreaks(min: number, max: number, classes: number): number[] {
  const rough = (max - min) / classes;
  if (!(rough > 0) || !Number.isFinite(rough)) return equalIntervalBreaks(min, max, classes);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const unit = (norm >= 5 ? 5 : norm >= 2.5 ? 2.5 : norm >= 2 ? 2 : 1) * mag;
  const lo = Math.floor(min / unit) * unit;
  const hi = Math.ceil(max / unit) * unit;
  return equalIntervalBreaks(lo, hi, classes).map((v) => +v.toFixed(10));
}

/** 边界归上段（v >= break 前进）；低于首断点 → 0。 */
export function classIndexOf(value: number, breaks: readonly number[]): number {
  let idx = 0;
  while (idx < breaks.length && value >= breaks[idx]) idx++;
  return idx;
}

function isNullish(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
}

export function summarizeSequential(
  values: readonly unknown[],
  breaks: readonly number[],
): { counts: number[]; nullCount: number } {
  const counts = new Array<number>(breaks.length + 1).fill(0);
  let nullCount = 0;
  for (const v of values) {
    if (isNullish(v)) nullCount++;
    else counts[classIndexOf(Number(v), breaks)]++;
  }
  return { counts, nullCount };
}

export function summarizeCategorical(
  values: readonly unknown[],
  categories: readonly (string | number)[],
): { counts: number[]; otherCount: number; nullCount: number } {
  const index = new Map<unknown, number>(categories.map((c, i) => [c, i]));
  const counts = new Array<number>(categories.length).fill(0);
  let otherCount = 0;
  let nullCount = 0;
  for (const v of values) {
    if (isNullish(v)) nullCount++;
    else {
      const i = index.get(v as string | number);
      if (i === undefined) otherCount++;
      else counts[i]++;
    }
  }
  return { counts, otherCount, nullCount };
}
