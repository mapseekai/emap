import { tableToIPC, type Table } from 'apache-arrow';
import { runPendingQuery } from './pending-query';
import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';

/**
 * @example
 * const connection: DuckDbConnection = await runtime.connect();
 */
export interface DuckDbConnection {
  insertArrowTable(table: Table, opts: { name: string }): Promise<void>;
  /** With a signal, completion includes pending-query cancellation and result cleanup. */
  query(sql: string, signal?: AbortSignal): Promise<Table>;
  close?(): Promise<void>;
}

/**
 * @example
 * const runtime: DuckDbRuntime = await createDuckDbRuntimeFromJsDelivr();
 */
export interface DuckDbRuntime {
  connect(): Promise<DuckDbConnection>;
  ensureSpatial(): Promise<void>;
  registerFileBuffer?(name: string, buffer: Uint8Array): Promise<void>;
  dropFile?(name: string): Promise<void>;
  close?(): Promise<void>;
}

/**
 * @example
 * const duckdb: DuckDbWasmModule = await import('@duckdb/duckdb-wasm');
 */
export type DuckDbWasmModule = typeof import('@duckdb/duckdb-wasm');

/**
 * Self-hosted DuckDB spatial extension `.wasm` URLs, one per DuckDB-Wasm bundle platform.
 *
 * @example
 * const urls: DuckDbSpatialExtensionUrls = { eh: '/duckdb/spatial-eh.wasm' };
 */
export interface DuckDbSpatialExtensionUrls {
  /** Spatial extension URL for the `eh` (exception-handling) bundle. */
  eh?: string;
  /** Spatial extension URL for the `mvp` bundle. */
  mvp?: string;
  /** Spatial extension URL for the `coi` (cross-origin-isolated) bundle. */
  coi?: string;
}

/**
 * @example
 * const options: CreateDuckDbRuntimeOptions = { customExtensionRepository: '/duckdb/extensions' };
 */
export interface CreateDuckDbRuntimeOptions {
  duckdb?: DuckDbWasmModule;
  customExtensionRepository?: string;
  /**
   * Self-hosted spatial extension files. When set, `ensureSpatial()` fetches the URL
   * matching the selected bundle once and loads it from DuckDB's in-memory filesystem
   * instead of installing the extension from the DuckDB extension repository.
   */
  spatialExtensionUrls?: DuckDbSpatialExtensionUrls;
  workerFactory?: (url: string) => Worker | Promise<Worker>;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

type DuckDbWasmConnectionLike = {
  insertArrowFromIPCStream(
    buffer: Uint8Array,
    opts: { name: string; create?: boolean },
  ): Promise<void>;
  query(sql: string): Promise<Table>;
  useUnsafe: AsyncDuckDBConnection['useUnsafe'];
  close(): Promise<void>;
};

type DuckDbWasmDatabaseLike = {
  connect(): Promise<unknown>;
  dropFile?(name: string): Promise<unknown>;
  instantiate(mainModule: string, pthreadWorker?: string): Promise<unknown>;
  registerFileBuffer?(name: string, buffer: Uint8Array): Promise<void>;
  terminate(): Promise<unknown>;
};

const SPATIAL_EXTENSION_FILE = 'spatial.duckdb_extension.wasm';

/** Close only the explicitly supplied runtime; no process-global runtime is consulted. */
export async function closeDuckDbRuntime(runtime: DuckDbRuntime | null = null): Promise<void> {
  await runtime?.close?.();
}

async function loadDuckDbWasm(): Promise<DuckDbWasmModule> {
  return import('@duckdb/duckdb-wasm');
}

/**
 * @example
 * const literal = quoteSqlString("O'Reilly");
 */
export function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function resolveSpatialExtensionUrl(
  urls: DuckDbSpatialExtensionUrls | undefined,
  bundles: object,
  selectedBundle: { mainModule: string },
): string | null {
  if (!urls) return null;
  const entries: Array<[string, unknown]> = Object.entries(bundles);
  const matchingPlatforms = entries
    .filter(
      ([, bundle]) =>
        typeof bundle === 'object' &&
        bundle !== null &&
        'mainModule' in bundle &&
        bundle.mainModule === selectedBundle.mainModule,
    )
    .map(([platform]) => platform);
  if (matchingPlatforms.length !== 1) {
    throw new Error(
      `DuckDB-Wasm selected bundle could not be identified from the configured bundle table`,
    );
  }
  const platform = matchingPlatforms[0] as keyof DuckDbSpatialExtensionUrls;
  const url = urls[platform];
  if (!url) {
    throw new Error(
      `DuckDB-Wasm spatial extension URL for the '${platform}' bundle is not configured`,
    );
  }
  return url;
}

function createJsDelivrWorkerUrl(
  workerScriptUrl: string,
  createObjectURL: (blob: Blob) => string,
): string {
  return createObjectURL(
    new Blob([`importScripts(${JSON.stringify(workerScriptUrl)});`], { type: 'text/javascript' }),
  );
}

async function createDuckDbWorker(
  workerScriptUrl: string,
  opts: CreateDuckDbRuntimeOptions,
): Promise<{ worker: Worker; revoke: () => void }> {
  if (!opts.workerFactory && typeof Worker === 'undefined') {
    throw new Error(
      `DuckDB-Wasm jsDelivr runtime requires a browser Worker or a workerFactory option for ${workerScriptUrl}`,
    );
  }
  const createObjectURL = opts.createObjectURL ?? URL.createObjectURL.bind(URL);
  const revokeObjectURL = opts.revokeObjectURL ?? URL.revokeObjectURL.bind(URL);
  const workerUrl = createJsDelivrWorkerUrl(workerScriptUrl, createObjectURL);
  const revoke = () => revokeObjectURL(workerUrl);
  try {
    const worker = opts.workerFactory ? await opts.workerFactory(workerUrl) : new Worker(workerUrl);
    return { worker, revoke };
  } catch (error) {
    revoke();
    throw error;
  }
}

function terminateWorker(worker: Worker): void {
  worker.terminate();
}

async function terminateDuckDbAfterFailure(
  db: DuckDbWasmDatabaseLike,
  worker: Worker,
): Promise<void> {
  try {
    await db.terminate();
  } catch {
    terminateWorker(worker);
  }
}

async function terminateDuckDbRuntime(db: DuckDbWasmDatabaseLike, worker: Worker): Promise<void> {
  try {
    await db.terminate();
  } catch (err) {
    terminateWorker(worker);
    throw err;
  }
}

/**
 * @example
 * const runtime = await createDuckDbRuntimeFromJsDelivr();
 */
export async function createDuckDbRuntimeFromJsDelivr(
  opts: CreateDuckDbRuntimeOptions = {},
): Promise<DuckDbRuntime> {
  if (opts.customExtensionRepository && opts.spatialExtensionUrls) {
    throw new Error('customExtensionRepository and spatialExtensionUrls cannot be used together');
  }
  const duckdb = opts.duckdb ?? (await loadDuckDbWasm());
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);
  if (!bundle.mainWorker) {
    throw new Error('Selected DuckDB-Wasm bundle does not include a worker script');
  }
  const { worker, revoke } = await createDuckDbWorker(bundle.mainWorker, opts);
  let db: DuckDbWasmDatabaseLike;
  try {
    db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  } catch (err) {
    revoke();
    terminateWorker(worker);
    throw err;
  }

  try {
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker ?? undefined);
  } catch (err) {
    await terminateDuckDbAfterFailure(db, worker);
    throw err;
  } finally {
    // WebKit can still be loading the Blob URL after the Worker constructor returns.
    revoke();
  }

  let spatialReady: Promise<void> | null = null;
  let closed = false;

  function assertOpen(): void {
    if (closed) throw new Error('DuckDB-Wasm runtime is closed');
  }

  function createSpatialReadyPromise(): Promise<void> {
    const ready = (async () => {
      const bundledUrl = resolveSpatialExtensionUrl(opts.spatialExtensionUrls, bundles, bundle);
      if (bundledUrl) {
        await loadBundledSpatialExtension(bundledUrl);
        return;
      }
      const conn = (await db.connect()) as unknown as DuckDbWasmConnectionLike;
      try {
        if (opts.customExtensionRepository) {
          await conn.query(
            `SET custom_extension_repository = ${quoteSqlString(opts.customExtensionRepository)};`,
          );
        }
        await conn.query('INSTALL spatial; LOAD spatial;');
      } finally {
        await conn.close();
      }
    })();
    ready.catch(() => {
      if (spatialReady === ready) spatialReady = null;
    });
    return ready;
  }

  async function loadBundledSpatialExtension(url: string): Promise<void> {
    if (typeof db.registerFileBuffer !== 'function') {
      throw new Error('DuckDB-Wasm runtime does not support registerFileBuffer');
    }
    if (typeof db.dropFile !== 'function') {
      throw new Error('DuckDB-Wasm runtime does not support dropFile for bundled extensions');
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `DuckDB-Wasm spatial extension fetch failed with HTTP ${response.status} for ${url}`,
      );
    }
    let registered = false;
    try {
      await db.registerFileBuffer(
        SPATIAL_EXTENSION_FILE,
        new Uint8Array(await response.arrayBuffer()),
      );
      registered = true;
      const conn = (await db.connect()) as unknown as DuckDbWasmConnectionLike;
      try {
        await conn.query(`LOAD ${quoteSqlString(SPATIAL_EXTENSION_FILE)};`);
      } finally {
        await conn.close();
      }
    } catch (err) {
      if (registered) {
        try {
          await db.dropFile(SPATIAL_EXTENSION_FILE);
        } catch {
          // Preserve the extension load failure; cleanup can only be best-effort.
        }
      }
      throw err;
    }
  }

  async function ensureSpatial(): Promise<void> {
    assertOpen();
    spatialReady ??= createSpatialReadyPromise();
    return spatialReady;
  }

  return {
    async connect(): Promise<DuckDbConnection> {
      assertOpen();
      const conn = (await db.connect()) as unknown as DuckDbWasmConnectionLike;
      let pending = Promise.resolve();
      function serial<T>(run: () => Promise<T>): Promise<T> {
        const result = pending.then(run);
        pending = result.then(
          () => {},
          () => {},
        );
        return result;
      }
      return {
        insertArrowTable(table, insertOpts) {
          return serial(() =>
            conn.insertArrowFromIPCStream(tableToIPC(table, 'stream'), {
              name: insertOpts.name,
              create: true,
            }),
          );
        },
        async query(sql, signal) {
          signal?.throwIfAborted();
          return serial(() => (signal ? runPendingQuery(conn, sql, signal) : conn.query(sql)));
        },
        close() {
          return serial(() => conn.close());
        },
      };
    },
    ensureSpatial,
    async registerFileBuffer(name, buffer) {
      assertOpen();
      if (typeof db.registerFileBuffer !== 'function') {
        throw new Error('DuckDB-Wasm runtime does not support registerFileBuffer');
      }
      await db.registerFileBuffer(name, buffer);
    },
    async dropFile(name) {
      assertOpen();
      await db.dropFile?.(name);
    },
    async close() {
      if (closed) return;
      closed = true;
      spatialReady = null;
      await terminateDuckDbRuntime(db, worker);
    },
  };
}
