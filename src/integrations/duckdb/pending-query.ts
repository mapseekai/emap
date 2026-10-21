import { RecordBatchReader, Table } from 'apache-arrow';
import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';

/** Own the polling loop so an abort cannot leave send() polling in the background. */
export async function runPendingQuery(
  connection: Pick<AsyncDuckDBConnection, 'useUnsafe'>,
  sql: string,
  signal: AbortSignal,
): Promise<Table> {
  signal.throwIfAborted();
  return connection.useUnsafe(async (db, id) => {
    let cancellation: Promise<boolean> | undefined;
    const cancel = () => {
      cancellation ??= db.cancelPendingQuery(id);
      void cancellation.catch(() => {});
    };
    const started = db.startPendingQuery(id, sql, true);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    let completed = false;
    let primaryError: unknown;
    let reader: Awaited<ReturnType<typeof RecordBatchReader.from>> | undefined;
    try {
      let header = await started;
      signal.throwIfAborted();
      while (header === null) {
        header = await db.pollPendingQuery(id);
        signal.throwIfAborted();
      }
      async function* chunks() {
        yield header!;
        while (true) {
          signal.throwIfAborted();
          const bytes = await db.fetchQueryResults(id);
          signal.throwIfAborted();
          if (bytes === null) continue;
          if (bytes.length === 0) return;
          yield bytes;
        }
      }
      reader = await RecordBatchReader.from(chunks());
      const batches = await reader.readAll();
      signal.throwIfAborted();
      const table = new Table(reader.schema, batches);
      completed = true;
      return table;
    } catch (error) {
      primaryError = signal.aborted ? signal.reason : error;
      throw primaryError;
    } finally {
      signal.removeEventListener('abort', cancel);
      if (!completed) cancel();
      const cleanupErrors: unknown[] = [];
      try {
        await cancellation;
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await reader?.cancel();
      } catch (error) {
        cleanupErrors.push(error);
      }
      if (cleanupErrors.length) {
        throw new AggregateError(
          [primaryError, ...cleanupErrors],
          'DuckDB pending query cleanup failed',
        );
      }
    }
  });
}
