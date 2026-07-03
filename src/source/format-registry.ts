import type { MapshaperDataset } from '../types/mapshaper-types';

/** One output file produced by a format plugin's export handler. */
export interface ExportedFormatFile {
  filename: string;
  content: Uint8Array | string;
}

/**
 * Rich import result: the dataset plus the Arrow table it was parsed
 * from, so TopologySource can seed its revision-0 table cache and
 * unedited data pays zero conversion on later DuckDB/export use.
 */
export interface ImportedBinaryDataset {
  dataset: MapshaperDataset;
  arrowTable?: unknown;
  arrowEncoding?: 'native' | 'wkb';
}

/**
 * A pluggable dataset format (import and/or export) registered at runtime.
 *
 * Plugins exist so optional, heavyweight format support (GeoParquet /
 * GeoArrow with apache-arrow + parquet-wasm) can live in a separate bundle
 * (`@zwishing/emap/formats`) without growing the core `emap.js`. Importing
 * that bundle registers its plugin as a side effect; the core import/export
 * paths consult this registry by file extension / format name.
 */
export interface DatasetFormatPlugin {
  /** Plugin id, e.g. `'geoarrow-formats'`. Re-registering a name replaces it. */
  name: string;
  /** File extensions (lowercase, without dot) routed to {@link importBinary}. */
  extensions: string[];
  /**
   * Parse one binary file into a mapshaper dataset. May return either a bare
   * `MapshaperDataset`, or the richer {@link ImportedBinaryDataset} (dataset
   * plus the Arrow table it was parsed from) so TopologySource can seed its
   * revision-0 Arrow cache and skip a redundant conversion on first
   * DuckDB/export use.
   */
  importBinary(
    content: Uint8Array,
    filename: string,
  ): Promise<MapshaperDataset | ImportedBinaryDataset>;
  /** Export handlers keyed by `ExportOptions.format` value. */
  exportFormats: Record<
    string,
    (dataset: MapshaperDataset, options?: object) => Promise<ExportedFormatFile[]>
  >;
}

/**
 * Extensions the core recognizes as "needs a format plugin". Used to produce
 * a helpful "import the formats module" error instead of a generic mapshaper
 * parse failure when the plugin is not registered.
 */
const KNOWN_PLUGIN_EXTENSIONS = ['parquet', 'geoparquet', 'arrow', 'arrows', 'feather'];

/**
 * Registry state lives on `globalThis` under a well-known symbol. The core
 * bundle and the formats bundle each compile their own copy of this module;
 * sharing through a global slot makes registration visible across copies.
 */
const REGISTRY_KEY = Symbol.for('emap.formatRegistry');

function getRegistry(): Map<string, DatasetFormatPlugin> {
  const g = globalThis as Record<symbol, unknown>;
  let reg = g[REGISTRY_KEY] as Map<string, DatasetFormatPlugin> | undefined;
  if (!reg) {
    reg = new Map();
    g[REGISTRY_KEY] = reg;
  }
  return reg;
}

/** Register (or replace, by `name`) a dataset format plugin. */
export function registerFormat(plugin: DatasetFormatPlugin): void {
  getRegistry().set(plugin.name, plugin);
}

/** Remove a previously registered plugin (primarily a test seam). */
export function unregisterFormat(name: string): void {
  getRegistry().delete(name);
}

/** Find the plugin handling a file extension (lowercase, without dot). */
export function getFormatForExtension(ext: string): DatasetFormatPlugin | undefined {
  const lower = ext.toLowerCase();
  for (const plugin of getRegistry().values()) {
    if (plugin.extensions.includes(lower)) return plugin;
  }
  return undefined;
}

/** Find the export handler registered for an `ExportOptions.format` value. */
export function getExportHandler(
  format: string,
): ((dataset: MapshaperDataset, options?: object) => Promise<ExportedFormatFile[]>) | undefined {
  for (const plugin of getRegistry().values()) {
    const handler = plugin.exportFormats[format];
    if (handler) return handler;
  }
  return undefined;
}

/**
 * Is this extension one that requires a format plugin (whether or not one is
 * currently registered)?
 */
export function isKnownPluginExtension(ext: string): boolean {
  return KNOWN_PLUGIN_EXTENSIONS.includes(ext.toLowerCase());
}

/** Extract the lowercase extension (no dot) from a filename, or ''. */
export function getFileExtension(filename: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename);
  return m ? m[1].toLowerCase() : '';
}

/**
 * Dataset → Arrow-table converter, registered by the formats bundle.
 * The table crosses this boundary as `unknown` because the core bundle
 * must not depend on apache-arrow types.
 */
export interface DatasetTableConverter {
  toTable(
    dataset: MapshaperDataset,
    opts: { layer?: number | string; encoding: 'native' | 'wkb' },
  ): unknown;
}

const CONVERTER_KEY = Symbol.for('emap.tableConverter');

export function registerTableConverter(converter: DatasetTableConverter): void {
  (globalThis as Record<symbol, unknown>)[CONVERTER_KEY] = converter;
}

/** Test seam, mirroring {@link unregisterFormat}. */
export function unregisterTableConverter(): void {
  delete (globalThis as Record<symbol, unknown>)[CONVERTER_KEY];
}

export function getTableConverter(): DatasetTableConverter | undefined {
  return (globalThis as Record<symbol, unknown>)[CONVERTER_KEY] as
    | DatasetTableConverter
    | undefined;
}
