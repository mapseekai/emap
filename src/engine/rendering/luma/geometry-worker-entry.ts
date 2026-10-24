import { validateGeometryBatch, type GeometryBatchItem } from './geometry-batch';
import { FeatureGeometryCache } from './feature-geometry-cache';
import { buildGeometryPacket } from './geometry-packet';
import type { GeometryPacket } from './geometry-jobs';
import { collectTransferables } from '../../worker/transferables';
import { serve, browserHost, output } from '@mapseekai/tasklane/host';
serve(browserHost(self as unknown as Parameters<typeof browserHost>[0]), {
  geometry: (payload, ctx) => {
    const data = payload as {
      packet?: GeometryPacket;
      packets?: GeometryPacket[];
      retainSources: string[];
    };
    let cache = ctx.cache.get<FeatureGeometryCache>('geometry');
    if (!cache) {
      cache = new FeatureGeometryCache();
      ctx.cache.setResource('geometry', cache, 64 * 1024 ** 2, (value) => value.clear());
    }
    cache.retain(new Set(data.retainSources));
    if (!data.packet && !data.packets) return output({ cache: cache.stats });
    if (data.packets) validateGeometryBatch(data.packets);
    const recycled = (data.packets ?? [data.packet!]).flatMap((packet, index) =>
      packet.recycleInput
        ? [
            {
              index,
              coordinates: packet.coordinates,
              offsets: packet.offsets,
              features: packet.features,
            },
          ]
        : [],
    );
    if (data.packets) {
      const results: GeometryBatchItem[] = data.packets.map((packet) => {
        try {
          return { result: buildGeometryPacket(packet, cache) };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      });
      const response = { results, cache: cache.stats, recycled };
      return output(response, collectTransferables(response));
    }
    const result = buildGeometryPacket(data.packet!, cache);
    const response = { result, cache: cache.stats, recycled };
    return output(response, collectTransferables(response));
  },
});
