import type { Table } from 'apache-arrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDuckDbRuntimeFromJsDelivr,
  getDuckDbRuntime,
  setDuckDbRuntime,
  type DuckDbRuntime,
  type DuckDbWasmModule,
} from './index';

class FakeDuckDbConnection {
  readonly insertCalls: Array<{ table: Table; opts: { name: string } }> = [];
  readonly queries: string[] = [];
  closed = false;

  constructor(private readonly resultTable: Table) {}

  async insertArrowTable(table: Table, opts: { name: string }): Promise<void> {
    this.insertCalls.push({ table, opts });
  }

  async query(sql: string): Promise<Table> {
    this.queries.push(sql);
    return this.resultTable;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeAsyncDuckDB {
  static instances: FakeAsyncDuckDB[] = [];

  readonly connections: FakeDuckDbConnection[] = [];
  readonly instantiateCalls: Array<{ mainModule: string; pthreadWorker?: string }> = [];
  terminated = false;

  constructor(
    readonly logger: unknown,
    readonly worker: Worker,
    private readonly resultTable: Table = {} as Table,
  ) {
    FakeAsyncDuckDB.instances.push(this);
  }

  async instantiate(mainModule: string, pthreadWorker?: string): Promise<void> {
    this.instantiateCalls.push({ mainModule, pthreadWorker });
  }

  async connect(): Promise<FakeDuckDbConnection> {
    const conn = new FakeDuckDbConnection(this.resultTable);
    this.connections.push(conn);
    return conn;
  }

  async terminate(): Promise<void> {
    this.terminated = true;
  }
}

function fakeDuckDbModule(): DuckDbWasmModule {
  FakeAsyncDuckDB.instances = [];
  return {
    getJsDelivrBundles: vi.fn(() => ({ mvp: { mainModule: 'mvp.wasm', mainWorker: 'mvp.worker.js' } })),
    selectBundle: vi.fn(async () => ({
      mainModule: 'selected.wasm',
      mainWorker: 'selected.worker.js',
      pthreadWorker: 'selected.pthread.worker.js',
    })),
    ConsoleLogger: class FakeConsoleLogger {},
    AsyncDuckDB: FakeAsyncDuckDB,
  } as unknown as DuckDbWasmModule;
}

async function makeRuntime(duckdb = fakeDuckDbModule()): Promise<DuckDbRuntime> {
  return createDuckDbRuntimeFromJsDelivr({
    duckdb,
    workerFactory: (url) => ({ url }) as unknown as Worker,
    createObjectURL: vi.fn(() => 'blob:duckdb-worker'),
    revokeObjectURL: vi.fn(),
  });
}

describe('DuckDB runtime injection', () => {
  beforeEach(() => {
    setDuckDbRuntime(null);
  });

  it('stores injected runtime', async () => {
    const runtime: DuckDbRuntime = {
      connect: async () => ({
        insertArrowTable: async () => undefined,
        query: async () => {
          throw new Error('not implemented');
        },
      }),
      ensureSpatial: async () => undefined,
    };

    setDuckDbRuntime(runtime);

    expect(getDuckDbRuntime()).toBe(runtime);
  });
});

describe('createDuckDbRuntimeFromJsDelivr', () => {
  it('creates a runtime with connect and ensureSpatial methods', async () => {
    const duckdb = fakeDuckDbModule();
    const revokeObjectURL = vi.fn();

    const runtime = await createDuckDbRuntimeFromJsDelivr({
      duckdb,
      workerFactory: (url) => ({ url }) as unknown as Worker,
      createObjectURL: vi.fn(() => 'blob:duckdb-worker'),
      revokeObjectURL,
    });

    expect(runtime.connect).toEqual(expect.any(Function));
    expect(runtime.ensureSpatial).toEqual(expect.any(Function));
    expect(runtime.close).toEqual(expect.any(Function));
    expect(duckdb.getJsDelivrBundles).toHaveBeenCalledTimes(1);
    expect(duckdb.selectBundle).toHaveBeenCalledTimes(1);
    expect(FakeAsyncDuckDB.instances[0]?.instantiateCalls).toEqual([
      { mainModule: 'selected.wasm', pthreadWorker: 'selected.pthread.worker.js' },
    ]);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:duckdb-worker');
  });

  it('runs INSTALL spatial and LOAD spatial only once', async () => {
    const runtime = await makeRuntime();

    await runtime.ensureSpatial();
    await runtime.ensureSpatial();

    const db = FakeAsyncDuckDB.instances[0]!;
    expect(db.connections).toHaveLength(1);
    expect(db.connections[0]?.queries).toEqual(['INSTALL spatial; LOAD spatial;']);
    expect(db.connections[0]?.closed).toBe(true);
  });

  it('delegates insertArrowTable and query to a DuckDB connection', async () => {
    const runtime = await makeRuntime();
    const conn = await runtime.connect();
    const table = {} as Table;

    await conn.insertArrowTable(table, { name: 'input' });
    const result = await conn.query('select * from input');
    await conn.close?.();

    const duckdbConn = FakeAsyncDuckDB.instances[0]?.connections[0];
    expect(duckdbConn?.insertCalls).toEqual([{ table, opts: { name: 'input' } }]);
    expect(duckdbConn?.queries).toEqual(['select * from input']);
    expect(duckdbConn?.closed).toBe(true);
    expect(result).toBe(duckdbConn?.['resultTable']);
  });
});
