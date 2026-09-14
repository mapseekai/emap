import type { MapshaperDataset } from '../../shared/types/mapshaper-types';
export interface ExportedFormatFile {
  filename: string;
  content: Uint8Array | string;
}
/** A format contributes binary I/O; no map, DOM, or global registry is available. */
export interface DatasetFormatPlugin {
  readonly name: string;
  readonly extensions: readonly string[];
  importBinary(content: Uint8Array, filename: string): Promise<MapshaperDataset>;
  readonly exportFormats: Readonly<
    Record<string, (dataset: MapshaperDataset, options?: object) => Promise<ExportedFormatFile[]>>
  >;
  readonly mimeTypes?: Readonly<Record<string, string>>;
}
/** Registrations are local to one workspace and are revoked with their owner. */
export interface FormatRegistryContract {
  register(plugin: DatasetFormatPlugin): () => void;
  unregister(name: string): void;
  list(): readonly DatasetFormatPlugin[];
  getFormatForExtension(extension: string): DatasetFormatPlugin | undefined;
  getExportHandler(format: string): DatasetFormatPlugin['exportFormats'][string] | undefined;
  getMimeType(format: string): string | undefined;
  dispose(): void;
}

/** Native Cordis service contracts; no emap-specific service container. */
declare module 'cordis' {
  interface Context {
    formats: FormatRegistryContract;
  }
}
