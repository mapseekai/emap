import { PointLod } from '../point-lod';
import { AffineTransform } from '../../../domain/geo/transform';
import { normalizePointShape } from '../../../domain/source/layer-utils';
import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
import type { GeometryBuffer } from '../../../integrations/luma/types';
import { pointsFromShapes } from './geometry';
import type { SpatialChunk } from './spatial-chunks';

export const DEFAULT_LUMA_POINT_LOD_CELL_SIZE = 3;
export interface PointLodRequest {
  transform: { mx: number; my: number; bx: number; by: number };
  width: number;
  height: number;
  cellSize: number;
  /** Existing conservative full-view chunk query, not the pointer pick rectangle. */
  visibleChunkIds: number[];
  knownKeys: string[];
}
export interface PointLodPacket {
  layer: number;
  /** null means that the existing PointLod policy requested full detail. */
  key: string | null;
  count: number;
  sourcePoints: number;
  featureIds?: Uint32Array;
  componentIds?: Uint32Array;
  geometry?: GeometryBuffer;
}
export function validatePointLodCellSize(value: number): void {
  if (!Number.isFinite(value) || value < 1 || value > 64)
    throw new Error('Point LOD cellSize must be between 1 and 64 CSS pixels.');
}

/** Worker-side adapter. Uses emap's existing PointLod unchanged, including world-
 * anchored binary cells, first-original-point selection, sparse/small bypass,
 * bounded three-level caching, and full-view budget fallback. No new clustering
 * algorithm, centroid, coordinate rounding, or line/polygon simplification.
 */
export class LumaPointLodSource {
  private readonly lod = new PointLod();
  private identities = new WeakMap<Uint32Array, string>();
  private serial = 0;
  private featureMaps = new Map<number, Uint32Array>();
  constructor(private readonly dataset: MapshaperDataset) {}

  query(request: PointLodRequest, chunks: readonly SpatialChunk[]): PointLodPacket[] {
    validatePointLodCellSize(request.cellSize);
    const { mx, my, bx, by } = request.transform;
    if (
      ![mx, my, bx, by, request.width, request.height].every(Number.isFinite) ||
      !mx ||
      !my ||
      request.width <= 0 ||
      request.height <= 0
    )
      throw new Error('Invalid point LOD viewport.');
    const transform = new AffineTransform(mx, my, bx, by);
    const visible = new Set(request.visibleChunkIds);
    const known = new Set(request.knownKeys);
    const results: PointLodPacket[] = [];
    for (let layerId = 0; layerId < this.dataset.layers.length; layerId++) {
      const layer = this.dataset.layers[layerId];
      if (layer.geometry_type !== 'point' || !layer.shapes) continue;
      const pointChunks = chunks.filter((c) => c.layer === layerId && c.kind === 'point');
      const sourcePoints = pointChunks.reduce((n, c) => n + c.rawVertices, 0);
      const spec = {
        id: `luma-point-${layerId}`,
        source: 'luma',
        type: 'circle' as const,
        pointLod: { cellSize: request.cellSize },
      };
      // Refine over whole visible chunks when the global grid hits its budget.
      // Coverage changes with chunk IDs, so panning inside the same chunks still
      // reuses the resident buffer and the main-thread view cache remains valid.
      const selected = pointChunks.filter((chunk) => visible.has(chunk.id));
      const coverage = [Infinity, Infinity, -Infinity, -Infinity];
      for (const chunk of selected) {
        coverage[0] = Math.min(coverage[0], chunk.bounds[0]);
        coverage[1] = Math.min(coverage[1], chunk.bounds[1]);
        coverage[2] = Math.max(coverage[2], chunk.bounds[2]);
        coverage[3] = Math.max(coverage[3], chunk.bounds[3]);
      }
      const selection = this.lod.query(
        spec,
        layer,
        this.dataset,
        null,
        transform,
        [-Infinity, -Infinity, Infinity, Infinity],
        {
          width: request.width,
          height: request.height,
          bounds: coverage,
          getCandidates: () => {
            let mapping = this.featureMaps.get(layerId);
            if (!mapping) {
              // Chunk point IDs address the flattened Point/MultiPoint stream.
              // Preserve feature identity when null shapes or multipart rows exist.
              mapping = new Uint32Array(pointChunks[0]?.points?.length ?? sourcePoints);
              let cursor = 0;
              for (let id = 0; id < layer.shapes!.length; id++)
                for (const _point of normalizePointShape(layer.shapes![id])) mapping[cursor++] = id;
              this.featureMaps.set(layerId, mapping);
            }
            const candidates = new Uint32Array(selected.reduce((n, c) => n + c.ids.length, 0));
            let cursor = 0;
            for (const chunk of selected)
              for (const id of chunk.ids) candidates[cursor++] = mapping[id];
            return candidates;
          },
        },
      );
      if (!selection) {
        results.push({ layer: layerId, key: null, count: sourcePoints, sourcePoints });
        continue;
      }
      let key = this.identities.get(selection.featureIds);
      if (!key) {
        key = `${layerId}:${this.dataset.editVersion ?? 0}:${++this.serial}`;
        this.identities.set(selection.featureIds, key);
      }
      const packet: PointLodPacket = {
        layer: layerId,
        key,
        count: selection.featureIds.length,
        sourcePoints,
      };
      if (!known.has(key)) {
        packet.geometry = pointsFromShapes(
          layer.shapes,
          selection.featureIds,
          selection.componentIds,
        );
        // Transferring these copies must not detach PointLod's resident indexes.
        packet.featureIds = selection.featureIds.slice();
        packet.componentIds = selection.componentIds.slice();
      }
      results.push(packet);
    }
    return results;
  }
  clear(): void {
    this.lod.clear();
    this.featureMaps.clear();
    this.identities = new WeakMap();
  }
}
