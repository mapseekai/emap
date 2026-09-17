import { RasterError } from '../../domain/raster/policy';
import { GeoTIFFReader } from './reader';
import type { GeoTIFFWorkerRequest, GeoTIFFWorkerResponse } from './worker-protocol';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<GeoTIFFWorkerRequest>) => void) | null;
  postMessage(message: GeoTIFFWorkerResponse, transfer?: Transferable[]): void;
};
let reader: GeoTIFFReader | undefined;
let opening = false;
const controllers = new Map<number, AbortController>();
scope.onmessage = ({ data }) => {
  if (data.type === 'cancel') {
    controllers.get(data.id)?.abort(new DOMException('Read cancelled', 'AbortError'));
    return;
  }
  const controller = new AbortController();
  controllers.set(data.id, controller);
  const run = async () => {
    if (data.type === 'open') {
      if (opening || reader)
        throw new RasterError('SOURCE_ALREADY_OPEN', 'Worker already owns a raster file.');
      opening = true;
      try {
        reader = await GeoTIFFReader.open(data.file, {
          overviewFile: data.overviewFile,
          crs: data.crs,
          signal: controller.signal,
        });
        scope.postMessage({ id: data.id, type: 'metadata', metadata: reader.metadata });
      } finally {
        opening = false;
      }
    } else {
      if (!reader) throw new RasterError('SOURCE_NOT_OPEN', 'Raster file is not open.');
      const result = await reader.readWindow(data.request, controller.signal);
      const transfer = [...new Set(result.data.map((array) => array.buffer))] as ArrayBuffer[];
      scope.postMessage({ id: data.id, type: 'result', result }, transfer);
    }
  };
  void run()
    .catch((error) => {
      scope.postMessage({
        id: data.id,
        type: 'error',
        code: error instanceof RasterError ? error.code : undefined,
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => controllers.delete(data.id));
};
