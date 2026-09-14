const SAFE_DUCKDB_FUNCTION = /^ST_[A-Za-z0-9_]+$/;

/** Validate the only raw SQL token accepted from tool descriptors. */
export function assertSafeDuckDbFunction(duckDbFunction: string): string {
  if (!SAFE_DUCKDB_FUNCTION.test(duckDbFunction)) {
    throw new Error(`Unsafe DuckDB function name: ${JSON.stringify(duckDbFunction)}`);
  }
  return duckDbFunction;
}
