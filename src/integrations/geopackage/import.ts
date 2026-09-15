import { getDefaultMapshaperAdapter, createWgs84CoordinateTransformer } from '../mapshaper/adapter';
import {
  resolveProjectCrsDefinition,
  normalizeProjectCrsMetadata,
} from '../../domain/geo/crs-resolver';
import { bindLayerFields } from '../../domain/source/layer-fields';
import type { LayerFieldDefinition } from '../../domain/source/create-layer';
import type {
  FeatureShape,
  GeometryType,
  MapshaperLayer,
  PathShape,
} from '../../shared/types/mapshaper-types';
import { readGeoPackageGeometry, type GeometrySink } from './binary';
import { openGeoPackageSqlite, quoteIdentifier, readFeatureTables } from './sqlite';
import {
  assertNotAborted,
  geoPackageLimits,
  type GeoPackageDataset,
  type GeoPackageTableMetadata,
  type ImportGeoPackageOptions,
} from './types';

const families: Readonly<Record<number, GeometryType>> = {
  1: 'point',
  2: 'polyline',
  4: 'polygon',
};
function declaredFamily(type: string): number {
  if (type.endsWith('POINT')) return 1;
  if (type.endsWith('LINESTRING')) return 2;
  if (type.endsWith('POLYGON')) return 4;
  return 0;
}
function attribute(value: unknown, type: string): unknown {
  if (typeof value === 'bigint') {
    if (type === 'BOOLEAN' && (value === 0n || value === 1n)) return value === 1n;
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  return value;
}
function fieldType(type: string): LayerFieldDefinition['type'] {
  if (type === 'BOOLEAN') return 'boolean';
  if (/INT|REAL|FLOA|DOUB|NUM|DEC/.test(type)) return 'number';
  return 'string';
}
interface LayerBuilder {
  name: string;
  family: number;
  shapes: Array<PathShape | number[] | null>;
  records: Record<string, unknown>[];
  fields: LayerFieldDefinition[];
}

/**
 * Read feature tables with SQLite WASM, scan GP/WKB for exact buffer sizes, and
 * write XY directly into TypedArrays. All layers share one ArcCollection and
 * receive one topology build. Raster tables are never decoded or queried.
 *
 * Point coordinates are materialized as tuples only at the final mapshaper
 * boundary, because native mapshaper PointShape is an array of XY tuples.
 */
export async function importGeoPackage(
  content: ArrayBuffer | Uint8Array,
  options: ImportGeoPackageOptions = {},
): Promise<GeoPackageDataset> {
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  const limits = geoPackageLimits(options);
  if (bytes.byteLength > limits.maxInputBytes)
    throw new RangeError('GeoPackage input byte limit exceeded');
  if (
    bytes.byteLength < 100 ||
    new TextDecoder().decode(bytes.subarray(0, 16)) !== 'SQLite format 3\0'
  )
    throw new Error('Invalid GeoPackage SQLite file header');
  assertNotAborted(options.signal);
  const db = await openGeoPackageSqlite(bytes, options);
  let dataset: GeoPackageDataset;
  try {
    const tables = readFeatureTables(db, options, limits.maxLayers);
    if (!tables.length) throw new Error('GeoPackage contains no selected vector feature tables');
    const targetCrs = options.targetCrs ?? tables[0].crs;
    const target = targetCrs ? await resolveProjectCrsDefinition(targetCrs) : undefined;
    const projectors = new Map<
      string,
      ((x: number, y: number) => readonly [number, number]) | undefined
    >();
    for (const table of tables) {
      if (!target || !table.crs) {
        if (!!target !== !!table.crs || table.srs !== tables[0].srs)
          throw new Error(
            `Cannot combine undefined and known/different CRS in ${table.name}; supply sourceCrs and targetCrs`,
          );
        continue;
      }
      const source = await resolveProjectCrsDefinition(table.crs);
      if (source.signature === target.signature) continue;
      const input = createWgs84CoordinateTransformer(source.definition);
      const output = createWgs84CoordinateTransformer(target.definition);
      projectors.set(table.name, (x, y) => {
        const geographic = input.inverse([x, y]);
        const projected = geographic && output.forward(geographic);
        if (!projected) throw new Error(`Coordinate outside supported CRS domain in ${table.name}`);
        return projected;
      });
    }

    let vertices = 0;
    let paths = 0;
    let points = 0;
    let rows = 0;
    const plans = tables.map((table) => ({
      ...table,
      families: 0,
      rows: 0,
      hasZ: false,
      hasM: false,
    }));
    const report = async (phase: 'scan' | 'decode', table: string, processed: number) => {
      assertNotAborted(options.signal);
      options.onProgress?.({ phase, table, rows: processed });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      assertNotAborted(options.signal);
    };
    for (const table of plans) {
      for (const [blob] of db.rows(
        `SELECT ${quoteIdentifier(table.column)} FROM ${quoteIdentifier(table.name)} ORDER BY ${table.order}`,
      )) {
        assertNotAborted(options.signal);
        rows++;
        table.rows++;
        if (rows > limits.maxFeatures) throw new RangeError('GeoPackage feature limit exceeded');
        if (blob !== null) {
          if (!(blob instanceof Uint8Array))
            throw new Error(`Non-binary geometry in ${table.name}, row ${table.rows}`);
          let summary;
          try {
            summary = readGeoPackageGeometry(blob, table.srs, limits.maxGeometryDepth);
          } catch (error) {
            throw new Error(`${table.name}, row ${table.rows}: ${(error as Error).message}`, {
              cause: error,
            });
          }
          const declared = declaredFamily(table.geometryType);
          if (declared && summary.families & ~declared)
            throw new Error(`Geometry family differs from declared type in ${table.name}`);
          table.families |= summary.families;
          table.hasZ ||= summary.hasZ;
          table.hasM ||= summary.hasM;
          vertices += summary.vertices;
          paths += summary.paths;
          points += summary.points;
          if (
            (vertices + points) * 16 + paths * 4 > limits.maxDecodedBytes ||
            vertices > 0x7fffffff ||
            paths > 0x7fffffff
          )
            throw new RangeError('GeoPackage decoded coordinate budget exceeded');
        }
        if (rows % 4096 === 0) await report('scan', table.name, rows);
      }
      table.families ||= declaredFamily(table.geometryType);
      await report('scan', table.name, rows);
    }
    const xx = new Float64Array(vertices);
    const yy = new Float64Array(vertices);
    const nn = new Int32Array(paths);
    const px = new Float64Array(points);
    const py = new Float64Array(points);
    let vertex = 0;
    let arc = 0;
    let point = 0;
    let decoded = 0;
    const builders: LayerBuilder[] = [];
    const usedNames = new Set(tables.map((table) => table.name));
    const metadata: GeoPackageTableMetadata[] = [];
    for (const table of plans) {
      const attributes = table.columns.filter((column) => column.name !== table.column);
      const fields = attributes.map((column) => ({
        name: column.name,
        type: fieldType(column.type),
      }));
      const active = [1, 2, 4].filter((family) => table.families & family);
      const groups = new Map<number, LayerBuilder>();
      const makeLayer = (family: number): LayerBuilder => {
        const suffix = families[family] ?? 'null';
        const mixed = active.length > 1;
        let name = mixed ? `${table.name}__${suffix}` : table.name;
        if (mixed) {
          const base = name;
          let index = 2;
          while (usedNames.has(name)) name = `${base}_${index++}`;
        }
        usedNames.add(name);
        const builder: LayerBuilder = {
          name,
          family,
          shapes: [],
          records: [],
          fields: fields.map((field) => ({ ...field })),
        };
        builders.push(builder);
        groups.set(family, builder);
        return builder;
      };
      for (const family of active.length ? active : [0]) makeLayer(family);
      const project = projectors.get(table.name);
      const columns = table.columns.map((column) => quoteIdentifier(column.name)).join(', ');
      const geometryIndex = table.columns.findIndex((column) => column.name === table.column);
      let tableRows = 0;
      for (const values of db.rows(
        `SELECT ${columns} FROM ${quoteIdentifier(table.name)} ORDER BY ${table.order}`,
      )) {
        assertNotAborted(options.signal);
        tableRows++;
        decoded++;
        const record: Record<string, unknown> = {};
        table.columns.forEach((column, index) => {
          if (index === geometryIndex) return;
          Object.defineProperty(record, column.name, {
            value: attribute(values[index], column.type),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        });
        const pointIds: number[] = [];
        const lines: PathShape = [];
        const rings: PathShape = [];
        let start = vertex;
        let polygon = false;
        let hole = false;
        const sink: GeometrySink = {
          point(x, y) {
            if (project) [x, y] = project(x, y);
            px[point] = x;
            py[point] = y;
            pointIds.push(point++);
          },
          startPath(count, isPolygon, isHole) {
            start = vertex;
            polygon = isPolygon;
            hole = isHole;
            nn[arc] = count;
            (polygon ? rings : lines).push([arc++]);
          },
          coordinate(x, y) {
            if (project) [x, y] = project(x, y);
            xx[vertex] = x;
            yy[vertex++] = y;
          },
          endPath() {
            if (!polygon) return;
            let area = 0;
            const originX = xx[start];
            const originY = yy[start];
            for (let i = start + 1; i < vertex; i++)
              area +=
                (xx[i - 1] - originX) * (yy[i] - originY) -
                (xx[i] - originX) * (yy[i - 1] - originY);
            // mapshaper uses clockwise shells and counter-clockwise holes.
            if ((!hole && area > 0) || (hole && area < 0)) {
              for (let left = start, right = vertex - 1; left < right; left++, right--) {
                [xx[left], xx[right]] = [xx[right], xx[left]];
                [yy[left], yy[right]] = [yy[right], yy[left]];
              }
            }
          },
        };
        const blob = values[geometryIndex];
        const summary =
          blob === null
            ? undefined
            : readGeoPackageGeometry(blob as Uint8Array, table.srs, limits.maxGeometryDepth, sink);
        let rowFamilies = summary?.families ?? 0;
        if (!rowFamilies && active.length === 1) rowFamilies = active[0];
        const assigned = [1, 2, 4].filter((family) => rowFamilies & family);
        if (!assigned.length) assigned.push(0);
        for (const family of assigned) {
          const group = groups.get(family) ?? makeLayer(family);
          const shape = family === 1 ? pointIds : family === 2 ? lines : family === 4 ? rings : [];
          group.shapes.push(shape.length ? shape : null);
          // A mixed GeometryCollection is split by dimension; attributes stay independently editable.
          group.records.push(
            assigned.length === 1 ? record : Object.fromEntries(Object.entries(record)),
          );
        }
        if (decoded % 4096 === 0) await report('decode', table.name, decoded);
      }
      if (tableRows !== table.rows)
        throw new Error(`GeoPackage row count changed in ${table.name}`);
      metadata.push({
        table: table.name,
        geometryColumn: table.column,
        declaredType: table.geometryType,
        sourceSrsId: table.srs,
        sourceCrs: table.crs ?? null,
        rows: table.rows,
        outputLayers: [...groups.values()].map((group) => group.name),
        hasZ: table.hasZ,
        hasM: table.hasM,
        columns: table.columns,
      });
      await report('decode', table.name, decoded);
    }
    if (vertex !== vertices || arc !== paths || point !== points)
      throw new Error('GeoPackage geometry changed between count and decode');
    const adapter = getDefaultMapshaperAdapter();
    const layers: MapshaperLayer[] = builders.map((builder) => {
      const shapes =
        builder.family === 1
          ? builder.shapes.map((shape) =>
              shape ? (shape as number[]).map((id) => [px[id], py[id]] as [number, number]) : null,
            )
          : (builder.shapes as (FeatureShape | null)[]);
      const layer: MapshaperLayer = {
        name: builder.name,
        geometry_type: families[builder.family],
        shapes,
        fields: builder.fields,
        data: adapter.createDataTable(builder.records),
      };
      bindLayerFields(layer);
      return layer;
    });
    const arcs = builders.some((builder) => builder.family & 6)
      ? adapter.createArcCollection([])
      : undefined;
    arcs?.updateVertexData!(nn, xx, yy, null);
    dataset = {
      layers,
      ...(arcs ? { arcs } : {}),
      info: {
        input_formats: ['geopackage'],
        ...(targetCrs ? { crs_string: normalizeProjectCrsMetadata(targetCrs) ?? targetCrs } : {}),
        geopackage: {
          tables: metadata,
          dimensions: 'xy',
          integerEncoding: 'safe-number-or-decimal-string',
        },
      },
    };
  } finally {
    db.close();
  }
  assertNotAborted(options.signal);
  if (dataset.arcs && !options.noTopology) {
    options.onProgress?.({
      phase: 'topology',
      rows: dataset.layers.reduce((total, layer) => total + (layer.shapes?.length ?? 0), 0),
    });
    assertNotAborted(options.signal);
    getDefaultMapshaperAdapter().buildTopology(dataset);
  }
  assertNotAborted(options.signal);
  return dataset;
}
