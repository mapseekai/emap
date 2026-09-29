import type { WorkerRuntime } from '@mapseekai/tasklane';
import type { MapshaperDataset } from '../../shared/types/mapshaper-types';
import {
  DEFAULT_IMPORT_RESOURCE_LIMITS,
  type ImportResourceLimits,
} from '../../shared/import-resource-limits';

/** Resource limits are enforced before typed coordinate storage is allocated. */
export interface GeoPackageLimits extends ImportResourceLimits {
  maxDecodedBytes: number;
  maxFeatures: number;
  maxLayers: number;
  maxGeometryDepth: number;
}
export interface GeoPackageProgress {
  phase: 'scan' | 'decode' | 'topology';
  table?: string;
  rows: number;
}
/** Vector-only GeoPackage import. No GeoJSON is constructed in this pipeline. */
export interface ImportGeoPackageOptions {
  /** Feature table names; omitted means all feature tables, not tile/attribute tables. */
  layers?: readonly string[];
  /** Default: the CRS of the first selected table. Other tables are transformed to it. */
  targetCrs?: string;
  /** Explicit overrides for undefined/unresolvable table CRS metadata. */
  sourceCrs?: Readonly<Record<string, string>>;
  /** Browser URL of the sql-wasm.wasm shipped by @ngageoint/geopackage. */
  wasmUrl?: string;
  /** Disable shared-arc topology only for disposable read-only output. */
  noTopology?: boolean;
  limits?: Partial<GeoPackageLimits>;
  signal?: AbortSignal;
  onProgress?: (progress: GeoPackageProgress) => void;
}
/** Worker input buffers are copied unless transferInput explicitly transfers ownership. */
export interface GeoPackageWorkerOptions extends ImportGeoPackageOptions {
  /** Borrowed tasklane runtime; the application remains responsible for disposal. */
  workerRuntime?: WorkerRuntime;
  workerUrl: string | URL;
  transferInput?: boolean;
}
/** Native Cordis format plugin configuration. Worker use is explicit and never silently falls back. */
export interface GeoPackagePluginOptions extends ImportGeoPackageOptions {
  workerRuntime?: WorkerRuntime;
  workerUrl?: string | URL;
}

/** @internal */
export const DEFAULT_GEOPACKAGE_LIMITS: Readonly<GeoPackageLimits> = Object.freeze({
  ...DEFAULT_IMPORT_RESOURCE_LIMITS,
  maxDecodedBytes: 2 * 1024 ** 3,
  maxFeatures: 10_000_000,
  maxLayers: 4096,
  maxGeometryDepth: 32,
});

/** @internal */
export function geoPackageLimits(options: ImportGeoPackageOptions): GeoPackageLimits {
  const limits = { ...DEFAULT_GEOPACKAGE_LIMITS, ...options.limits };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new RangeError(`Invalid GeoPackage limit: ${name}`);
  }
  if (limits.maxGeometryDepth > 256)
    throw new RangeError('GeoPackage geometry depth cannot exceed 256');
  return limits;
}

/** @internal */
export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException('GeoPackage import cancelled', 'AbortError');
}

/** Geometry and attribute storage remains editable native mapshaper data. */
export interface GeoPackageTableMetadata {
  table: string;
  geometryColumn: string;
  declaredType: string;
  sourceSrsId: number;
  sourceCrs: string | null;
  rows: number;
  outputLayers: string[];
  hasZ: boolean;
  hasM: boolean;
  columns: Array<{ name: string; type: string; primary: number }>;
}
export interface GeoPackageMetadata {
  tables: GeoPackageTableMetadata[];
  dimensions: 'xy';
  integerEncoding: 'safe-number-or-decimal-string';
}
export type GeoPackageDataset = MapshaperDataset & {
  info: NonNullable<MapshaperDataset['info']> & { geopackage: GeoPackageMetadata };
};
