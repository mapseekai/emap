import '../mapshaper/browser-shim';
import { importGeoPackage } from './import';
import { streamGeoPackageDataset, type GeoPackageStreamMessage } from './stream';
import type { ImportGeoPackageOptions } from './types';

const scope = self as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{
          type: string;
          sequence?: number;
          bytes: Uint8Array;
          options: ImportGeoPackageOptions;
        }>,
      ) => void)
    | null;
  postMessage(value: unknown, transfer?: Transferable[]): void;
};
let running = false;
let acknowledgement: { sequence: number; resolve: () => void } | null = null;
function send(message: GeoPackageStreamMessage, transfers: Transferable[]): Promise<void> {
  return new Promise((resolve) => {
    acknowledgement = { sequence: message.sequence, resolve };
    scope.postMessage(message, transfers);
  });
}
scope.onmessage = (event) => {
  if (event.data.type === 'ack') {
    if (acknowledgement && acknowledgement.sequence === event.data.sequence) {
      const { resolve } = acknowledgement;
      acknowledgement = null;
      resolve();
    }
    return;
  }
  if (running || event.data.type !== 'import') return;
  running = true;
  void importGeoPackage(event.data.bytes, {
    ...event.data.options,
    onProgress: (progress) => scope.postMessage({ type: 'progress', progress }),
  })
    .then((dataset) => streamGeoPackageDataset(dataset, send))
    .catch((error) => {
      scope.postMessage({
        type: 'error',
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      });
    });
};
