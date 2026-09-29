import { diagnostics, renderRasterBatch, renderRasterWindow } from './render-window';
import { RasterError } from '../../domain/raster/policy';
import { GeoTIFFReader } from './reader';
import { GEOTIFF_READER_BYTES, GEOTIFF_WORKER_PROTOCOL_VERSION } from './worker-protocol';
import type { GeoTIFFWorkerCommand } from './worker-protocol';

import { serve, browserHost, output } from '@mapseekai/tasklane/host';
import type { CacheResourceLease, ScopedCache } from '@mapseekai/tasklane/host';
import { RuntimeError } from '@mapseekai/tasklane';

interface CachedReader {
  reader: GeoTIFFReader;
  resource: CacheResourceLease;
  targetBytes: number;
}

// Keep a conservative floor for directories, compressed pages and reader state.
// Only the independently bounded decoded block cache participates in trimming.
const READER_BYTES = GEOTIFF_READER_BYTES;
function reportReader({ reader, resource }: CachedReader): void {
  const stats = reader.getTaskDiagnosticsSnapshot();
  resource.report({
    keys: reader.getCacheFootprintKeys(),
    usedBytes: stats.blockCacheBytes,
    hits: stats.blockCacheHits,
    misses: stats.blockCacheMisses,
    evictions: stats.blockCacheEvictions,
  });
}

function retainReader(cache: ScopedCache, reader: GeoTIFFReader): CachedReader {
  const cached = {
    reader,
    targetBytes: reader.getTaskDiagnosticsSnapshot().blockCacheLimitBytes,
  } as CachedReader;
  cached.resource = cache.setResource(
    'reader',
    cached,
    READER_BYTES + reader.getTaskDiagnosticsSnapshot().blockCacheLimitBytes,
    ({ reader }) => reader.dispose(),
    {
      trim(targetBytes) {
        const current = reader.getTaskDiagnosticsSnapshot().blockCacheLimitBytes;
        reader.setBlockCacheLimit(Math.min(current, Math.max(0, targetBytes - READER_BYTES)));
        reportReader(cached);
        return READER_BYTES + reader.getTaskDiagnosticsSnapshot().blockCacheLimitBytes;
      },
    },
  );
  return cached;
}

serve(browserHost(self as unknown as Parameters<typeof browserHost>[0]), {
  raster: async (payload, ctx) => {
    // Group dispatch may choose any ready replica. Attribute gauges to its actual Session.
    const respond = (value: object, transfer: Transferable[] = []) =>
      output({ ...value, sessionId: ctx.sessionId }, transfer);
    const data = payload as GeoTIFFWorkerCommand;
    let cached = ctx.cache.get<CachedReader>('reader');
    let reader = cached?.reader;
    try {
      if (data.type === 'open') {
        if (reader)
          throw new RasterError('SOURCE_ALREADY_OPEN', 'Worker already owns a raster file.');

        reader = await GeoTIFFReader.open(
          data.file,
          {
            overviewFile: data.overviewFile,
            crs: data.crs,
            noData: data.noData,
            signal: ctx.signal,
          },
          {
            cacheBytes: data.cacheBytes,
            pageLimit: data.pageLimit,
            maxMetadataBytes: data.maxMetadataBytes,
            statistics: data.statistics,
          },
        );
        try {
          cached = retainReader(ctx.cache, reader);
        } catch (error) {
          reader.dispose();
          throw error;
        }
        return respond({
          id: 0,
          type: 'metadata',
          metadata: reader.metadata,
          directoryBytes: reader.directoryBytes,
          protocolVersion: GEOTIFF_WORKER_PROTOCOL_VERSION,
        });
      } else {
        if (!reader) throw new RasterError('SOURCE_NOT_OPEN', 'Raster file is not open.');
        if (data.type === 'configure') {
          const resource = cached!.resource;
          const reserved = READER_BYTES + data.cacheBytes;
          // Admit growth before allocating; return shrinking credits only after eviction.
          if (reserved > resource.bytes) resource.resize(reserved);
          reader.setBlockCacheLimit(data.cacheBytes);
          if (reserved < resource.bytes) resource.resize(reserved);
          cached!.targetBytes = data.cacheBytes;
          return respond({ id: 0, type: 'configured' });
        }
        // Recovery is demand-driven. The main thread supplies the current pool
        // target; native admission still checks the actual Worker capacity.
        const target = Math.min(cached!.targetBytes, data.cacheCapacityBytes ?? 0);
        if (target > reader.getTaskDiagnosticsSnapshot().blockCacheLimitBytes) {
          ctx.signal.throwIfAborted();
          try {
            cached!.resource.resize(READER_BYTES + target);
            reader.setBlockCacheLimit(target);
          } catch (error) {
            // A pool growth may have been refused; decoding with the smaller
            // cache remains valid. Never turn a capacity hint into a read failure.
            if (!(error instanceof RuntimeError) || error.code !== 'BUDGET_EXCEEDED') throw error;
          }
        }
        if (data.type === 'render' || data.type === 'render-batch') {
          if (data.type === 'render') {
            const result = await renderRasterWindow(reader, data.request, ctx.signal),
              nativeDeflateStatus = reader.getNativeDeflateStatus();
            return respond({ id: 0, type: 'rendered', result, nativeDeflateStatus }, [
              result.rgba.buffer,
            ]);
          } else {
            const results = await renderRasterBatch(reader, data.requests, ctx.signal),
              nativeDeflateStatus = reader.getNativeDeflateStatus();
            return respond(
              { id: 0, type: 'rendered-batch', results, nativeDeflateStatus },
              results.map((result) => result.rgba.buffer),
            );
          }
        } else if (data.type === 'texture') {
          const before = reader.getTaskDiagnosticsSnapshot(),
            started = performance.now();
          const packed = await reader.readTexture(data.request, ctx.signal);
          const result = {
            ...packed,
            diagnostics: diagnostics(reader, before, started, performance.now() - started, 0, 0),
          };
          return respond(
            {
              id: 0,
              type: 'texture',
              result,
              nativeDeflateStatus: reader.getNativeDeflateStatus(),
            },
            [result.data.buffer],
          );
        } else {
          const before = reader.getTaskDiagnosticsSnapshot(),
            started = performance.now();
          const samples = await reader.readWindow(data.request, ctx.signal);
          const result = {
              ...samples,
              diagnostics: diagnostics(reader, before, started, performance.now() - started, 0, 0),
            },
            nativeDeflateStatus = reader.getNativeDeflateStatus(),
            transfer = [...new Set(result.data.map((array) => array.buffer))] as ArrayBuffer[];
          return respond({ id: 0, type: 'result', result, nativeDeflateStatus }, transfer);
        }
      }
    } finally {
      if (cached) reportReader(cached);
    }
  },
});
