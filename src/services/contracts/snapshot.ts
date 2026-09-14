import type { ExportSnapshotOptions, LoadSnapshotOptions } from '../../map/types';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface SnapshotContract {
  exportSnapshot(opts?: ExportSnapshotOptions): Promise<Blob>;
  loadSnapshot(
    input: Blob | Uint8Array | ArrayBuffer,
    opts?: LoadSnapshotOptions,
  ): Promise<string[]>;
}
