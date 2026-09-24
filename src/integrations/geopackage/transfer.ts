import { getDefaultMapshaperAdapter } from '../mapshaper/adapter';
import { bindLayerFields } from '../../domain/source/layer-fields';
import type {
  FeatureShape,
  MapshaperLayer,
  PointShape,
  PathShape,
} from '../../shared/types/mapshaper-types';
import type { GeoPackageDataset } from './types';

/** @internal Plain worker payload. All coordinate buffers are transferable. */
export interface GeoPackageTransfer {
  layers: Array<
    Omit<MapshaperLayer, 'data'> & {
      records: Record<string, unknown>[];
      pointCoordinates?: Float64Array;
      pointCounts?: Int32Array;
      pathCounts?: Int32Array;
      partCounts?: Uint32Array;
      arcIds?: Int32Array;
    }
  >;
  arcs?: { nn: Int32Array | Uint32Array; xx: Float64Array; yy: Float64Array };
  info: GeoPackageDataset['info'];
}

/** @internal Rehydrate native classes without JSON or format re-import. */
export function restoreGeoPackageDataset(payload: GeoPackageTransfer): GeoPackageDataset {
  const adapter = getDefaultMapshaperAdapter();
  const layers = payload.layers.map(
    ({ records, pointCoordinates, pointCounts, pathCounts, partCounts, arcIds, ...shape }) => {
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
      if (pathCounts && partCounts && arcIds) {
        let part = 0,
          arc = 0;
        shape.shapes = Array.from(pathCounts, (count) => {
          if (count === -1) return null;
          if (count < 0 || part + count > partCounts.length)
            throw new Error('Invalid packed GeoPackage path counts');
          const paths: PathShape = new Array(count);
          for (let i = 0; i < count; i++) {
            const length = partCounts[part++];
            if (arc + length > arcIds.length)
              throw new Error('Invalid packed GeoPackage arc counts');
            const ids = new Array<number>(length);
            for (let j = 0; j < length; j++) ids[j] = arcIds[arc++];
            paths[i] = ids;
          }
          return paths;
        });
        if (part !== partCounts.length || arc !== arcIds.length)
          throw new Error('Unexpected packed GeoPackage path data');
      }
      const layer = { ...shape, data: adapter.createDataTable(records) };
      bindLayerFields(layer);
      return layer;
    },
  );
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
      let packedPaths:
        | Pick<GeoPackageTransfer['layers'][number], 'pathCounts' | 'partCounts' | 'arcIds'>
        | undefined;
      if (
        (layer.geometry_type === 'polygon' || layer.geometry_type === 'polyline') &&
        layer.shapes
      ) {
        const shapes = layer.shapes as (PathShape | null)[];
        const pathCounts = Int32Array.from(shapes, (shape) => (shape ? shape.length : -1));
        let parts = 0,
          arcs = 0;
        for (const shape of shapes)
          if (shape) {
            parts += shape.length;
            for (const part of shape) arcs += part.length;
          }
        const partCounts = new Uint32Array(parts),
          arcIds = new Int32Array(arcs);
        let part = 0,
          arc = 0;
        for (const shape of shapes)
          if (shape)
            for (const ids of shape) {
              partCounts[part++] = ids.length;
              for (const id of ids) arcIds[arc++] = id;
            }
        packedPaths = { pathCounts, partCounts, arcIds };
      }
      return {
        name: layer.name,
        geometry_type: layer.geometry_type,
        shapes:
          pointCoordinates || packedPaths ? null : (layer.shapes as (FeatureShape | null)[] | null),
        fields: layer.fields,
        records: layer.data?.getRecords?.() ?? [],
        ...(pointCoordinates ? { pointCoordinates, pointCounts } : {}),
        ...packedPaths,
      };
    }),
    ...(data ? { arcs: { nn: data.nn, xx: data.xx, yy: data.yy } } : {}),
    info: { ...dataset.info, crs: undefined },
  };
}
