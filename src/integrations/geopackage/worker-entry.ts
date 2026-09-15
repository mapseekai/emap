import '../mapshaper/browser-shim';
import { collectTransferables } from '../../engine/worker/transferables';
import { importGeoPackage } from './import';
import { transferGeoPackageDataset } from './transfer';
import type { ImportGeoPackageOptions } from './types';

const scope = self as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{ type: string; bytes: Uint8Array; options: ImportGeoPackageOptions }>,
      ) => void)
    | null;
  postMessage(value: unknown, transfer?: Transferable[]): void;
};
let running = false;
scope.onmessage = (event) => {
  if (running || event.data.type !== 'import') return;
  running = true;
  void importGeoPackage(event.data.bytes, {
    ...event.data.options,
    onProgress: (progress) => scope.postMessage({ type: 'progress', progress }),
  })
    .then((dataset) => {
      const payload = transferGeoPackageDataset(dataset);
      scope.postMessage({ type: 'result', dataset: payload }, collectTransferables(payload));
    })
    .catch((error) => {
      scope.postMessage({
        type: 'error',
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      });
    });
};
