import type { DatasetFormatPlugin, FormatRegistryContract } from '../../runtime/services/formats';
export type {
  DatasetFormatPlugin,
  ExportedFormatFile,
} from '../../runtime/services/formats';

interface Entry {
  readonly plugin: DatasetFormatPlugin;
  readonly controller: AbortController;
}

function abortError(): DOMException {
  return new DOMException('Format registration has been unloaded', 'AbortError');
}

/** Each workspace or detached source owns its registry; importing modules changes no registry. */
export class FormatRegistry implements FormatRegistryContract {
  private readonly entries = new Map<string, Entry>();
  private readonly extensions = new Map<string, Entry>();
  private readonly exports = new Map<string, Entry>();
  private disposed = false;

  register(plugin: DatasetFormatPlugin): () => void {
    if (this.disposed) throw new Error('Format registry has been disposed');
    if (!plugin || typeof plugin.name !== 'string' || !plugin.name.trim())
      throw new TypeError('Format plugin name is required');
    if (this.entries.has(plugin.name))
      throw new Error(`Format plugin already registered: ${plugin.name}`);
    if (!Array.isArray(plugin.extensions) || typeof plugin.importBinary !== 'function')
      throw new TypeError('Invalid format importer');
    const extensions = plugin.extensions.map((extension) => {
      if (typeof extension !== 'string' || !/^[a-z0-9_-]+$/i.test(extension))
        throw new TypeError('Invalid format extension');
      return extension.toLowerCase();
    });
    if (new Set(extensions).size !== extensions.length)
      throw new Error('Duplicate format extension');
    if (!plugin.exportFormats || typeof plugin.exportFormats !== 'object')
      throw new TypeError('Format export handlers are required');
    for (const extension of extensions) {
      if (this.extensions.has(extension))
        throw new Error(`Format extension already registered: ${extension}`);
    }
    const handlers = Object.entries(plugin.exportFormats);
    for (const [format, handler] of handlers) {
      if (!format.trim() || typeof handler !== 'function')
        throw new TypeError(`Invalid export handler: ${format}`);
      if (this.exports.has(format)) throw new Error(`Export format already registered: ${format}`);
    }
    const controller = new AbortController();
    const exportFormats: Record<string, DatasetFormatPlugin['exportFormats'][string]> =
      Object.create(null);
    for (const [format, handler] of handlers) {
      exportFormats[format] = (dataset, options) =>
        this.run(controller.signal, () => handler(dataset, options));
    }
    const importer = plugin.importBinary.bind(plugin);
    const registered: DatasetFormatPlugin = Object.freeze({
      name: plugin.name,
      extensions: Object.freeze(extensions),
      importBinary: (content: Uint8Array, filename: string) =>
        this.run(controller.signal, () => importer(content, filename)),
      exportFormats: Object.freeze(exportFormats),
      mimeTypes: Object.freeze({ ...plugin.mimeTypes }),
    });
    const entry: Entry = { plugin: registered, controller };
    this.entries.set(plugin.name, entry);
    for (const extension of extensions) this.extensions.set(extension, entry);
    for (const [format] of handlers) this.exports.set(format, entry);
    return () => {
      if (this.entries.get(registered.name) === entry) this.unregister(registered.name);
    };
  }

  unregister(name: string): void {
    const entry = this.entries.get(name);
    if (!entry) return;
    this.entries.delete(name);
    for (const extension of entry.plugin.extensions) {
      if (this.extensions.get(extension) === entry) this.extensions.delete(extension);
    }
    for (const format of Object.keys(entry.plugin.exportFormats)) {
      if (this.exports.get(format) === entry) this.exports.delete(format);
    }
    entry.controller.abort(abortError());
  }

  list(): readonly DatasetFormatPlugin[] {
    return [...this.entries.values()].map((entry) => entry.plugin);
  }
  getFormatForExtension(extension: string): DatasetFormatPlugin | undefined {
    return this.extensions.get(extension.toLowerCase())?.plugin;
  }
  getExportHandler(format: string): DatasetFormatPlugin['exportFormats'][string] | undefined {
    return this.exports.get(format)?.plugin.exportFormats[format];
  }
  getMimeType(format: string): string | undefined {
    return this.exports.get(format)?.plugin.mimeTypes?.[format];
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const name of [...this.entries.keys()]) this.unregister(name);
  }

  private run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason ?? abortError());
    return new Promise<T>((resolve, reject) => {
      const aborted = () => reject(signal.reason ?? abortError());
      signal.addEventListener('abort', aborted, { once: true });
      let work: Promise<T>;
      try {
        work = operation();
      } catch (error) {
        signal.removeEventListener('abort', aborted);
        reject(error);
        return;
      }
      // Keep rejection observation after cancellation; a late result cannot escape its owner.
      Promise.resolve(work).then(
        (value) => {
          signal.removeEventListener('abort', aborted);
          if (signal.aborted) aborted();
          else resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', aborted);
          reject(error);
        },
      );
    });
  }
}

/** Explicit convenience helper, not an import-time or process-global registration. */
export function registerFormat(
  registry: FormatRegistryContract,
  plugin: DatasetFormatPlugin,
): () => void {
  return registry.register(plugin);
}
export function unregisterFormat(registry: FormatRegistryContract, name: string): void {
  registry.unregister(name);
}
export function getFormatForExtension(
  registry: FormatRegistryContract,
  extension: string,
): DatasetFormatPlugin | undefined {
  return registry.getFormatForExtension(extension);
}
export function getExportHandler(
  registry: FormatRegistryContract,
  format: string,
): DatasetFormatPlugin['exportFormats'][string] | undefined {
  return registry.getExportHandler(format);
}

const KNOWN_PLUGIN_EXTENSIONS = new Set([
  'parquet',
  'geoparquet',
  'arrow',
  'arrows',
  'feather',
  'fgb',
]);
export function isKnownPluginExtension(extension: string): boolean {
  return KNOWN_PLUGIN_EXTENSIONS.has(extension.toLowerCase());
}
export function getFileExtension(filename: string): string {
  return /\.([a-z0-9_-]+)$/i.exec(filename)?.[1].toLowerCase() ?? '';
}
