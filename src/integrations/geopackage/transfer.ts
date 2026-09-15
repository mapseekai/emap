import { getDefaultMapshaperAdapter } from '../mapshaper/adapter';
import { bindLayerFields } from '../../domain/source/layer-fields';
import type { FeatureShape, MapshaperLayer, PointShape } from '../../shared/types/mapshaper-types';
import type { GeoPackageDataset } from './types';

/** @internal Plain worker payload. All coordinate buffers are transferable. */
export interface GeoPackageTransfer {
  layers: Array<
    Omit<MapshaperLayer, 'data'> & {
      records: Record<string, unknown>[];
      pointCoordinates?: Float64Array;
      pointCounts?: Int32Array;
    }
  >;
  arcs?: { nn: Int32Array | Uint32Array; xx: Float64Array; yy: Float64Array };
  info: GeoPackageDataset['info'];
}

/** @internal Rehydrate native classes without JSON or format re-import. */
export function restoreGeoPackageDataset(payload: GeoPackageTransfer): GeoPackageDataset {
  const adapter = getDefaultMapshaperAdapter();
  const layers = payload.layers.map(({ records, pointCoordinates, pointCounts, ...shape }) => {
    if (pointCoordinates && pointCounts) {
      let point = 0;
      shape.shapes = Array.from(pointCounts, (count) => {
        if (count < 0) return null;
        const points: PointShape = new Array(count);
        for (let i = 0; i < count; i++)
          points[i] = [pointCoordinates[point++], pointCoordinates[point++]];
        return points;
      });
    }
    const layer = { ...shape, data: adapter.createDataTable(records) };
    bindLayerFields(layer);
    return layer;
  });
  let arcs: GeoPackageDataset['arcs'];
  if (payload.arcs) {
    arcs = adapter.createArcCollection([]);
    arcs.updateVertexData!(payload.arcs.nn, payload.arcs.xx, payload.arcs.yy, null);
  }
  return { layers, ...(arcs ? { arcs } : {}), info: payload.info };
}

/** @internal Transfer buffers and plain attributes, not ArcCollection/DataTable instances. */
export function transferGeoPackageDataset(dataset: GeoPackageDataset): GeoPackageTransfer {
  const data = dataset.arcs?.getVertexData?.();
  return {
    layers: dataset.layers.map((layer) => {
      let pointCoordinates: Float64Array | undefined;
      let pointCounts: Int32Array | undefined;
      if (layer.geometry_type === 'point') {
        const shapes = layer.shapes as (PointShape | null)[];
        pointCounts = Int32Array.from(shapes, (shape) => (shape ? shape.length : -1));
        pointCoordinates = new Float64Array(
          shapes.reduce((size, shape) => size + (shape?.length ?? 0), 0) * 2,
        );
        let offset = 0;
        for (const shape of shapes)
          if (shape)
            for (const [x, y] of shape) {
              pointCoordinates[offset++] = x;
              pointCoordinates[offset++] = y;
            }
      }
      return {
        name: layer.name,
        geometry_type: layer.geometry_type,
        shapes: pointCoordinates ? null : (layer.shapes as (FeatureShape | null)[] | null),
        fields: layer.fields,
        records: layer.data?.getRecords?.() ?? [],
        ...(pointCoordinates ? { pointCoordinates, pointCounts } : {}),
      };
    }),
    ...(data ? { arcs: { nn: data.nn, xx: data.xx, yy: data.yy } } : {}),
    info: { ...dataset.info, crs: undefined },
  };
}
