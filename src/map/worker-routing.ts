// Decide whether a given mapshaper command should run on the main thread or
// be dispatched to the worker pool.
//
// The legacy heuristic (PR-3) was simply "vertex count >= threshold". That
// missed two real cases:
//
//   1. `rename-fields` / `sort-features` / `filter-fields` are O(N) over
//      records and dirt-cheap; routing them through the worker pays the
//      ~50–100 ms pack/unpack cost on top, slowing every call. Always
//      keep them on the main thread.
//   2. `buffer`, `clean`, `dissolve`, `mosaic`, `union`, `snap`,
//      `check-geometry`, `simplify` are O(N²) or geometry-heavy. Even
//      moderate-sized datasets benefit from going off-thread. Use a
//      reduced threshold for these.
//
// The router is a pure function of the command head, the dataset's vertex
// count, the user's `useWorker` mode, and the configured threshold. Apps
// that want a fully custom decision can pass `workerRouting` in
// `MapOptions` to bypass.

/**
 * Commands that mapshaper completes in microseconds-to-milliseconds even
 * on large datasets. Routing them off-thread is pure overhead.
 */
const CHEAP_COMMANDS: ReadonlySet<string> = new Set([
  'rename-fields',
  'rename-layers',
  'sort',
  'sort-features',
  'filter-fields',
  'drop',
  'target',
  'uniq',
  'unique-features',
]);

/**
 * Commands whose runtime grows worse than linearly with vertex count
 * (overlay tests, intersection cuts, repeated polygon construction).
 * They cross the worker break-even point at much smaller datasets than
 * the default threshold suggests.
 */
const EXPENSIVE_COMMANDS: ReadonlySet<string> = new Set([
  'buffer',
  'clean',
  'dissolve',
  'dissolve2',
  'mosaic',
  'union',
  'snap',
  'check-geometry',
  'simplify',
]);

/** Multiplier applied to the user's `workerThreshold` for expensive cmds. */
const EXPENSIVE_THRESHOLD_RATIO = 0.5;

/** Commands whose cost scales with record count, not vertex count. */
const RECORD_SCALE_COMMANDS: ReadonlySet<string> = new Set(['classify', 'style']);

/**
 * Routing decision over pre-extracted command heads. Used by the PR-4b
 * parsed-command path
 * (`commands.map(c => c.name)`) so it doesn't have to round-trip through
 * a CLI string just to make a routing call.
 */
export function shouldUseWorkerForHeads(
  heads: string[],
  vertexCount: number,
  mode: boolean | 'auto',
  threshold: number,
  recordCount = 0,
): boolean {
  if (mode === false) return false;
  if (mode === true) return true;
  if (heads.length === 0) return vertexCount >= threshold;

  const allCheap = heads.every((h) => CHEAP_COMMANDS.has(h));
  if (allCheap) return false;

  const anyExpensive = heads.some((h) => EXPENSIVE_COMMANDS.has(h));
  const effectiveThreshold = anyExpensive
    ? Math.floor(threshold * EXPENSIVE_THRESHOLD_RATIO)
    : threshold;
  // 记录数主键：classify/style 成本随 records 线性，vertexCount≈0 不得排除卸载。
  if (heads.some((h) => RECORD_SCALE_COMMANDS.has(h))) {
    return recordCount >= effectiveThreshold;
  }
  return vertexCount >= effectiveThreshold;
}

/** Custom routing-decision callback users can supply via `MapOptions`. */
export type WorkerRoutingFn = (info: {
  cmd: string;
  heads: string[];
  vertexCount: number;
  /** Layer record total; primary key for record-scale commands (classify/style). */
  recordCount: number;
  mode: boolean | 'auto';
  threshold: number;
  /** Default decision the engine would have made; user may return it as-is. */
  defaultDecision: boolean;
}) => boolean;
