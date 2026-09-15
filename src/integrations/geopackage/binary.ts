/** GeoPackageBinary + ISO/EWKB decoder with no coordinate-object or GeoJSON intermediate. */
export interface GeometrySink {
  point(x: number, y: number): void;
  startPath(count: number, polygon: boolean, hole: boolean): void;
  coordinate(x: number, y: number): void;
  endPath(): void;
}
export interface GeometrySummary {
  /** point=1, polyline=2, polygon=4; collections may contain several families. */
  families: number;
  paths: number;
  vertices: number;
  points: number;
  hasZ: boolean;
  hasM: boolean;
  type: number;
}

/** Null SQL geometries are handled by the reader; every non-null blob must be valid. */
export function readGeoPackageGeometry(
  bytes: Uint8Array,
  expectedSrs: number,
  maxDepth: number,
  sink?: GeometrySink,
): GeometrySummary {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (message: string): never => {
    throw new Error(`Invalid GeoPackage geometry: ${message}`);
  };
  if (bytes.length < 13 || bytes[0] !== 0x47 || bytes[1] !== 0x50)
    fail('missing GP binary header or WKB');
  if (bytes[2] !== 0) fail('unsupported binary version');
  const flags = bytes[3];
  if (flags & 0xc0) fail('reserved header bits are set');
  if (flags & 0x20) fail('extended user-defined geometry is not supported');
  const envelope = (flags >> 1) & 7;
  const envelopeDoubles = [0, 4, 6, 6, 8][envelope];
  if (envelopeDoubles === undefined) fail('invalid envelope indicator');
  if (view.getInt32(4, !!(flags & 1)) !== expectedSrs)
    fail('SRS id differs from gpkg_geometry_columns');
  let offset = 8 + envelopeDoubles * 8;
  const summary: GeometrySummary = {
    families: 0,
    paths: 0,
    vertices: 0,
    points: 0,
    hasZ: false,
    hasM: false,
    type: 0,
  };
  const ensure = (size: number) => {
    if (!Number.isSafeInteger(size) || size < 0 || size > bytes.length - offset)
      fail('truncated WKB');
  };
  const uint = (little: boolean) => {
    ensure(4);
    const value = view.getUint32(offset, little);
    offset += 4;
    return value;
  };
  const geometry = (depth: number, requiredType?: number): void => {
    if (depth > maxDepth) fail('geometry nesting exceeds limit');
    ensure(5);
    const order = view.getUint8(offset++);
    if (order !== 0 && order !== 1) fail('invalid WKB byte order');
    const little = order === 1;
    const encoded = uint(little);
    const base = encoded & 0x0fffffff;
    if (encoded & 0x10000000) fail('unsupported WKB BBOX flag');
    const dimensionCode = Math.floor(base / 1000);
    if (dimensionCode > 3) fail('unsupported WKB dimension code');
    const type = base % 1000;
    if (type < 1 || type > 7) fail(`unsupported geometry type ${type}; curves are not linearized`);
    if (requiredType !== undefined && type !== requiredType)
      fail('invalid child type in multi-geometry');
    if (depth === 0) summary.type = type;
    const z = !!(encoded & 0x80000000) || dimensionCode === 1 || dimensionCode === 3;
    const m = !!(encoded & 0x40000000) || dimensionCode === 2 || dimensionCode === 3;
    summary.hasZ ||= z;
    summary.hasM ||= m;
    if (encoded & 0x20000000) {
      const srid = uint(little) | 0;
      if (srid !== expectedSrs) fail('embedded EWKB SRID differs from header');
    }
    const dimensions = 2 + Number(z) + Number(m);
    if (type === 1) {
      summary.families |= 1;
      ensure(dimensions * 8);
      const x = view.getFloat64(offset, little);
      const y = view.getFloat64(offset + 8, little);
      offset += dimensions * 8;
      if (Number.isNaN(x) && Number.isNaN(y)) return;
      if (!Number.isFinite(x) || !Number.isFinite(y)) fail('non-finite XY coordinate');
      summary.points++;
      sink?.point(x, y);
      return;
    }
    const path = (polygon: boolean, hole = false): void => {
      const count = uint(little);
      ensure(count * dimensions * 8);
      if (count === 0 && !polygon) return;
      if (count < (polygon ? 4 : 2))
        fail(
          polygon
            ? 'polygon ring needs at least four vertices'
            : 'line needs at least two vertices',
        );
      summary.paths++;
      summary.vertices += count;
      sink?.startPath(count, polygon, hole);
      let firstX = 0;
      let firstY = 0;
      let lastX = 0;
      let lastY = 0;
      for (let i = 0; i < count; i++) {
        // Read straight into the caller's numeric sink. No nested coordinate arrays.
        ensure(dimensions * 8);
        const x = view.getFloat64(offset, little);
        const y = view.getFloat64(offset + 8, little);
        offset += dimensions * 8;
        if (!Number.isFinite(x) || !Number.isFinite(y)) fail('non-finite XY coordinate');
        if (i === 0) {
          firstX = x;
          firstY = y;
        }
        lastX = x;
        lastY = y;
        sink?.coordinate(x, y);
      }
      if (polygon && (firstX !== lastX || firstY !== lastY)) fail('polygon ring is not closed');
      sink?.endPath();
    };
    if (type === 2) {
      summary.families |= 2;
      path(false);
      return;
    }
    if (type === 3) {
      summary.families |= 4;
      const rings = uint(little);
      ensure(rings * 4);
      for (let ring = 0; ring < rings; ring++) path(true, ring > 0);
      return;
    }
    if (type === 4) summary.families |= 1;
    if (type === 5) summary.families |= 2;
    if (type === 6) summary.families |= 4;
    const children = uint(little);
    ensure(children * 5);
    for (let child = 0; child < children; child++)
      geometry(depth + 1, type === 7 ? undefined : type - 3);
  };
  geometry(0);
  if (offset !== bytes.length) fail('unexpected trailing bytes');
  if (flags & 0x10 && (summary.points || summary.vertices))
    fail('empty header flag with non-empty WKB');
  return summary;
}
