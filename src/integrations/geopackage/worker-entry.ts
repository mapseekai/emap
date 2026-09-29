import '../mapshaper/browser-shim';
import {
  serve,
  browserHost,
  output,
  createSizedResultSource,
  type SizedResultSource,
} from '@mapseekai/tasklane/host';
import { importGeoPackage } from './import';
import { geoPackageChunks } from './stream';
import { geoPackageLimits, type ImportGeoPackageOptions } from './types';
import {
  encodeWorkerPacket,
  workerPacketTransfers,
  workerDataByteBound,
} from '../mapshaper/binary';

serve(browserHost(self as unknown as Parameters<typeof browserHost>[0]), {
  import: async (payload, ctx) => {
    const data = payload as { bytes: Uint8Array; options: ImportGeoPackageOptions };
    const dataset = await importGeoPackage(data.bytes, {
      ...data.options,
      wasmUrl: data.options.wasmUrl ?? new URL('sql-wasm.wasm', self.location.href).href,
      signal: ctx.signal,
      onProgress: (progress) => ctx.progress(progress),
    });
    const chunks = geoPackageChunks(dataset);
    const source = createSizedResultSource({
      maxChunkBytes: 2 * 1024 ** 3,
      plan: async (context) => {
        context.signal.throwIfAborted();
        const part = await chunks.next();
        if (part.done) return null;
        return {
          outputBytes: workerDataByteBound(part.value.message),
          encode: (context) => {
            context.signal.throwIfAborted();
            const packet = encodeWorkerPacket(part.value.message, part.value.transfers);
            return output(packet, workerPacketTransfers(packet));
          },
          // The iterator owns the dataset; output buffers belong to the receiver.
          dispose: () => {},
        };
      },
    });
    ctx.cache.setResource(
      'chunks',
      source,
      geoPackageLimits(data.options).maxDecodedBytes,
      async (value) => {
        await value.close();
        await chunks.return(undefined);
      },
    );
    return output(null);
  },
  next: (_payload, ctx) => {
    const source = ctx.cache.get<SizedResultSource<unknown>>('chunks');
    if (!source) throw new Error('GeoPackage import Session is not initialized');
    return source.describe(ctx);
  },
  take: (token, ctx) => {
    const source = ctx.cache.get<SizedResultSource<unknown>>('chunks');
    if (!source) throw new Error('GeoPackage import Session is not initialized');
    return source.take(token as string, ctx);
  },
});
