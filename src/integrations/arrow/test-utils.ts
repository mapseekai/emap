/** Shared helpers for the formats test suite (not part of the public API). */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { getDefaultMapshaperAdapter } from '../mapshaper/adapter';
import type { MapshaperDataset } from '../../shared/types/mapshaper-types';
import { setParquetWasm, type ParquetWasmModule } from './parquet-wasm-loader';

/**
 * Import a GeoJSON object through real mapshaper into a dataset — the same
 * pipeline `TopologySource.setData` uses. Test fixtures only; production
 * conversion never goes through GeoJSON.
 */
export async function datasetFromGeoJSON(geojson: unknown): Promise<MapshaperDataset> {
  const adapter = getDefaultMapshaperAdapter();
  return adapter.runImport('-i "fixture.geojson"', {
    'fixture.geojson': JSON.stringify(geojson),
  });
}

/**
 * Initialize parquet-wasm from the package's esm build with wasm bytes read
 * off disk, and inject it via `setParquetWasm`. The package's `node` build
 * is broken in 0.7.x (CJS file shipped under `"type": "module"`), so tests
 * use the esm build with manual init — same code path browsers run.
 */
export async function injectParquetWasmForTests(): Promise<ParquetWasmModule> {
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve('parquet-wasm/esm/parquet_wasm_bg.wasm');
  const mod = (await import('parquet-wasm/esm')) as unknown as ParquetWasmModule & {
    default: (opts: { module_or_path: Uint8Array }) => Promise<unknown>;
  };
  await mod.default({ module_or_path: readFileSync(wasmPath) });
  setParquetWasm(mod);
  return mod;
}
