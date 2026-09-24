import { validateGeometryBatch, type GeometryBatchItem } from './geometry-batch';
import { FeatureGeometryCache } from './feature-geometry-cache';
import { buildGeometryPacket } from './geometry-packet';
import type { GeometryPacket } from './geometry-jobs';
import { collectTransferables } from '../../worker/transferables';
const scope = self as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{
          id: number;
          packet: GeometryPacket;
          packets?: GeometryPacket[];
          retainSources?: string[];
        }>,
      ) => void)
    | null;
  postMessage(value: unknown, transfer?: Transferable[]): void;
};
const cache = new FeatureGeometryCache();
scope.onmessage = ({ data }) => {
  if (data.retainSources) {
    cache.retain(new Set(data.retainSources));
    scope.postMessage({ type: 'geometry-cache-stats', cache: cache.stats });
    return;
  }
  const started = performance.now();
  try {
    if (data.packets) {
      validateGeometryBatch(data.packets);
      const results: GeometryBatchItem[] = data.packets.map((packet) => {
        try {
          return { result: buildGeometryPacket(packet, cache) };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      });
      scope.postMessage(
        { id: data.id, results, elapsedMs: performance.now() - started, cache: cache.stats },
        collectTransferables(results),
      );
      return;
    }
    const result = buildGeometryPacket(data.packet, cache);
    scope.postMessage(
      { id: data.id, result, elapsedMs: performance.now() - started, cache: cache.stats },
      collectTransferables(result),
    );
  } catch (error) {
    scope.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
