import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm';
import { runPendingQuery } from '../../../src/integrations/duckdb/pending-query';

const require = createRequire(import.meta.url);

describe.skipIf(process.env.DUCKDB_WASM_INTEGRATION !== '1')(
  'direct query cancellation in real WASM',
  () => {
    it.each([
      'mvp',
      'eh',
    ] as const)('%s releases unread streams while preserving connection state and sibling streams', async (platform) => {
      const duckdb =
        require('@duckdb/duckdb-wasm/blocking') as typeof import('@duckdb/duckdb-wasm/blocking');
      const bundles = {
        mvp: {
          mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'),
          mainWorker: '',
        },
        ...(platform === 'eh'
          ? {
              eh: {
                mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm'),
                mainWorker: '',
              },
            }
          : {}),
      };
      const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
      await db.instantiate();
      const conn = db.connect();
      const other = db.connect();
      const query = 'SELECT sqrt(i::DOUBLE) AS value FROM range(1000000000) t(i)';
      conn.query('CREATE TEMP TABLE retained(value INTEGER)');
      conn.query('INSERT INTO retained VALUES (41)');
      conn.query('SET preserve_insertion_order=false');
      const prepared = conn.prepare('SELECT sum(value)::INT AS value FROM retained');
      const scalar = (sql: string) => conn.query(sql).getChild('value')!.get(0);
      try {
        for (const transaction of [false, true]) {
          for (const phase of ['header', 'chunk'] as const) {
            if (transaction) {
              conn.query('BEGIN TRANSACTION');
              conn.query('INSERT INTO retained VALUES (1)');
            }
            const controller = new AbortController();
            const acknowledgements: boolean[] = [];
            let aborted = false;
            const abort = (stage: typeof phase) => {
              if (phase === stage && !aborted) {
                aborted = true;
                controller.abort();
              }
            };
            await other.useUnsafe(async (sibling, siblingId) => {
              let header = sibling.startPendingQuery(siblingId, query, true);
              while (header === null) header = sibling.pollPendingQuery(siblingId);
              await conn.useUnsafe(async (bindings, id) => {
                const asyncBindings = {
                  async startPendingQuery(...args: Parameters<typeof bindings.startPendingQuery>) {
                    const result = bindings.startPendingQuery(...args);
                    if (result !== null) abort('header');
                    return result;
                  },
                  async pollPendingQuery(connectionId: number) {
                    const result = bindings.pollPendingQuery(connectionId);
                    if (result !== null) abort('header');
                    return result;
                  },
                  async fetchQueryResults(connectionId: number) {
                    const result = bindings.fetchQueryResults(connectionId);
                    if (result?.length) abort('chunk');
                    return result;
                  },
                  async cancelPendingQuery(connectionId: number) {
                    const result = bindings.cancelPendingQuery(connectionId);
                    acknowledgements.push(result);
                    return result;
                  },
                  async runQuery(connectionId: number, sql: string) {
                    return bindings.runQuery(connectionId, sql);
                  },
                };
                const failure = await runPendingQuery(
                  { useUnsafe: (run) => run(asyncBindings as unknown as AsyncDuckDB, id) },
                  query,
                  controller.signal,
                ).then(
                  () => 'delivered',
                  (error: unknown) => error,
                );
                expect(failure).toBe(controller.signal.reason);
                expect(acknowledgements).toContain(false);
                expect(bindings.fetchQueryResults(id)?.length ?? 0).toBe(0);
                expect(bindings.cancelPendingQuery(id)).toBe(false);
                expect(sibling.fetchQueryResults(siblingId)!.length).toBeGreaterThan(0);
              });
            });
            expect(prepared.query().getChild('value')!.get(0)).toBe(transaction ? 42 : 41);
            expect(scalar("SELECT current_setting('preserve_insertion_order') AS value")).toBe(
              false,
            );
            expect(other.query('SELECT 7 AS value').getChild('value')!.get(0)).toBe(7);
            if (transaction) conn.query('ROLLBACK');
            expect(scalar('SELECT sum(value)::INT AS value FROM retained')).toBe(41);
          }
        }
        // Compare the installed engine's error state with and without EMap cleanup.
        const control = db.connect();
        control.query('BEGIN TRANSACTION');
        control.useUnsafe((bindings, id) => {
          expect(() => {
            let header = bindings.startPendingQuery(id, "SELECT error('failed query probe')", true);
            while (header === null) header = bindings.pollPendingQuery(id);
          }).toThrow();
        });
        let abortedTransaction = false;
        try {
          control.query('SELECT 1');
        } catch {
          abortedTransaction = true;
        }
        control.query('ROLLBACK');
        control.close();
        conn.query('BEGIN TRANSACTION');
        conn.query('INSERT INTO retained VALUES (1)');
        await conn.useUnsafe(async (bindings, id) => {
          let originalError: unknown;
          const asyncBindings = {
            async startPendingQuery(...args: Parameters<typeof bindings.startPendingQuery>) {
              try {
                return bindings.startPendingQuery(...args);
              } catch (error) {
                originalError = error;
                throw error;
              }
            },
            async pollPendingQuery(connectionId: number) {
              try {
                return bindings.pollPendingQuery(connectionId);
              } catch (error) {
                originalError = error;
                throw error;
              }
            },
            async fetchQueryResults(connectionId: number) {
              return bindings.fetchQueryResults(connectionId);
            },
            async cancelPendingQuery(connectionId: number) {
              return bindings.cancelPendingQuery(connectionId);
            },
            async runQuery(connectionId: number, sql: string) {
              return bindings.runQuery(connectionId, sql);
            },
          };
          const failure = await runPendingQuery(
            { useUnsafe: (run) => run(asyncBindings as unknown as AsyncDuckDB, id) },
            "SELECT error('failed query probe')",
            new AbortController().signal,
          ).then(
            () => 'delivered',
            (error: unknown) => error,
          );
          expect(originalError).toBeDefined();
          expect(failure).toBe(originalError);
          expect(bindings.fetchQueryResults(id)?.length ?? 0).toBe(0);
          expect(bindings.cancelPendingQuery(id)).toBe(false);
        });
        if (abortedTransaction) expect(() => scalar('SELECT * FROM retained')).toThrow();
        else expect(scalar('SELECT sum(value)::INT AS value FROM retained')).toBe(42);
        conn.query('ROLLBACK');
        expect(scalar('SELECT sum(value)::INT AS value FROM retained')).toBe(41);
      } finally {
        prepared.close();
        conn.close();
        other.close();
      }
    }, 15_000);
  },
);
