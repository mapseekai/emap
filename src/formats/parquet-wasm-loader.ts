/**
 * Lazy loader / injection seam for `parquet-wasm`.
 *
 * The wasm payload (~1.2 MB) must not load unless GeoParquet is actually
 * used, so the module is `import()`ed on first need. Environments where
 * the dynamic specifier can't resolve (IIFE/script-tag consumers without
 * an import map, Node tests using the `parquet-wasm/esm` build) inject a
 * pre-initialized module via {@link setParquetWasm} instead.
 */

/** Subset of the parquet-wasm module surface the formats module consumes. */
export interface ParquetWasmTable {
  intoIPCStream(): Uint8Array;
}

export interface ParquetWasmWriterPropertiesBuilder {
  setKeyValueMetadata(metadata: Map<string, string>): ParquetWasmWriterPropertiesBuilder;
  setCompression(c: number): ParquetWasmWriterPropertiesBuilder;
  build(): unknown;
}

export interface ParquetWasmModule {
  readParquet(bytes: Uint8Array): ParquetWasmTable;
  writeParquet(table: ParquetWasmTable, properties?: unknown): Uint8Array;
  Table: { fromIPCStream(ipc: Uint8Array): ParquetWasmTable };
  WriterPropertiesBuilder: new () => ParquetWasmWriterPropertiesBuilder;
  ParquetFile: {
    fromFile(handle: Blob): Promise<{
      metadata(): { fileMetadata(): { keyValueMetadata(): Map<unknown, unknown> } };
      free?(): void;
    }>;
  };
  Compression: Record<string, number>;
}

type WasmInput = string | URL | Request | Uint8Array | ArrayBuffer | WebAssembly.Module;

interface ParquetWasmEsmModule extends ParquetWasmModule {
  default?: (options?: { module_or_path: WasmInput }) => Promise<unknown>;
}

let injected: ParquetWasmModule | null = null;
let loadPromise: Promise<ParquetWasmModule> | null = null;

/**
 * Inject a ready-to-use parquet-wasm module (wasm already initialized).
 * Wins over the dynamic-import path. Pass `null` to reset (tests).
 */
export function setParquetWasm(mod: ParquetWasmModule | null): void {
  injected = mod;
  loadPromise = null;
}

export interface InitParquetWasmOptions {
  /**
   * Explicit wasm binary location (URL / bytes / compiled module) forwarded
   * to parquet-wasm's init. When omitted, parquet-wasm resolves
   * `parquet_wasm_bg.wasm` relative to its own module URL — which works
   * under bundlers that emit wasm assets (Vite, webpack 5) but not from a
   * plain `<script>` tag.
   */
  wasmInput?: WasmInput;
}

/** Load (or return the injected/cached) parquet-wasm module. */
export async function initParquetWasm(
  opts: InitParquetWasmOptions = {},
): Promise<ParquetWasmModule> {
  if (injected) return injected;

  // IIFE / script-tag environments: the Rollup config maps the 'parquet-wasm'
  // external to `globalThis.parquetWasm`. If a script has already set that
  // global (e.g. via <script src="parquet-wasm.js">), use it directly and
  // skip the dynamic import — which would fail without a bundler/import-map.
  const globalMod = (globalThis as Record<string, unknown>)[
    'parquetWasm'
  ] as ParquetWasmEsmModule | undefined;
  if (globalMod && typeof globalMod.readParquet === 'function') {
    injected = globalMod;
    return injected;
  }

  if (!loadPromise) {
    loadPromise = (async () => {
      let mod: ParquetWasmEsmModule;
      try {
        mod = (await import('parquet-wasm')) as unknown as ParquetWasmEsmModule;
      } catch (err) {
        loadPromise = null;
        throw new Error(
          'Failed to load parquet-wasm. Install it as a dependency (bundled apps), ' +
            'or call setParquetWasm(module) / set window.parquetWasm before use ' +
            `(script-tag environments). Original error: ${err}`,
        );
      }
      if (typeof mod.default === 'function') {
        await mod.default(opts.wasmInput ? { module_or_path: opts.wasmInput } : undefined);
      }
      return mod;
    })();
  }
  return loadPromise;
}
