import { renderRasterWindow } from './render-window';
import { RasterError } from '../../domain/raster/policy';
import { GeoTIFFReader } from './reader';
import { GEOTIFF_WORKER_PROTOCOL_VERSION } from './worker-protocol';
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
        reader = await GeoTIFFReader.open(
          data.file,
          {
            overviewFile: data.overviewFile,
            crs: data.crs,
            noData: data.noData,
            signal: controller.signal,
          },
          {
            cacheBytes: data.cacheBytes,
            pageLimit: data.pageLimit,
            maxMetadataBytes: data.maxMetadataBytes,
            statistics: data.statistics,
          },
        );
        scope.postMessage({
          id: data.id,
          type: 'metadata',
          metadata: reader.metadata,
          directoryBytes: reader.directoryBytes,
          protocolVersion: GEOTIFF_WORKER_PROTOCOL_VERSION,
        });
        reader.clearBlockAccessTrace();
      } finally {
        opening = false;
      }
    } else {
      if (!reader) throw new RasterError('SOURCE_NOT_OPEN', 'Raster file is not open.');
      if (data.type === 'configure') {
        reader.setBlockCacheLimit(data.cacheBytes);
        scope.postMessage({ id: data.id, type: 'configured' });
      } else if (data.type === 'render') {
        const cursor = reader.getBlockAccessCursor();
        try {
          const result = await renderRasterWindow(reader, data.request, controller.signal);
          const blockAccess = reader.takeBlockAccessesSince(cursor),
            nativeDeflateStatus = reader.getNativeDeflateStatus();
          scope.postMessage(
            { id: data.id, type: 'rendered', result, blockAccess, nativeDeflateStatus },
            [result.rgba.buffer],
          );
        } catch (error) {
          reader.takeBlockAccessesSince(cursor);
          throw error;
        }
      } else {
        const cursor = reader.getBlockAccessCursor();
        try {
          const result = await reader.readWindow(data.request, controller.signal);
          const blockAccess = reader.takeBlockAccessesSince(cursor),
            nativeDeflateStatus = reader.getNativeDeflateStatus();
          const transfer = [...new Set(result.data.map((array) => array.buffer))] as ArrayBuffer[];
          scope.postMessage(
            { id: data.id, type: 'result', result, blockAccess, nativeDeflateStatus },
            transfer,
          );
        } catch (error) {
          reader.takeBlockAccessesSince(cursor);
          throw error;
        }
      }
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
