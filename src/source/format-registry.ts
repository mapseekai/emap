import type { MapshaperDataset } from '../types/mapshaper-types';

/** One output file produced by a format plugin's export handler. */
export interface ExportedFormatFile {
  filename: string;
  content: Uint8Array | string;
}

/**
 * A pluggable dataset format (import and/or export) registered at runtime.
 *
 * Plugins exist so optional, heavyweight format support (GeoParquet /
 * GeoArrow with apache-arrow + parquet-wasm) can live in a separate bundle
 * (`@zwishing/emap/arrow`) without growing the core `emap.js`. Importing
 * that bundle registers its plugin as a side effect; the core import/export
 * paths consult this registry by file extension / format name.
 */
export interface DatasetFormatPlugin {
  /** Plugin id, e.g. `'geoarrow-formats'`. Re-registering a name replaces it. */
  name: string;
  /** File extensions (lowercase, without dot) routed to {@link importBinary}. */
  extensions: string[];
  /** Parse one binary file into a mapshaper dataset. */
  importBinary(content: Uint8Array, filename: string): Promise<MapshaperDataset>;
  /** Export handlers keyed by `ExportOptions.format` value. */
  exportFormats: Record<
    string,
    (dataset: MapshaperDataset, options?: object) => Promise<ExportedFormatFile[]>
  >;
}

/**
 * Extensions the core recognizes as "needs a format plugin". Used to produce
 * a helpful "import the Arrow module" error instead of a generic mapshaper
 * parse failure when the plugin is not registered.
 */
const KNOWN_PLUGIN_EXTENSIONS = ['parquet', 'geoparquet', 'arrow', 'arrows', 'feather'];

/**
 * Registry state lives on `globalThis` under a well-known symbol. The core
 * bundle and the Arrow bundle each compile their own copy of this module;
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
