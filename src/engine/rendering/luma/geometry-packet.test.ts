import { describe, expect, it } from 'vitest';
import { buildGeometryPacket, splitGeometry } from './geometry-packet';
import { pathGeometry, PATH_STRIDE } from './path-geometry';
import type { GeometryPacket } from './geometry-jobs';
import type { Point } from './geometry';
describe('geometry Worker packet boundary', () => {
  it('triangulates holes and keeps disjoint features independent', () => {
    const packet: GeometryPacket = {
      kind: 'fill',
      coordinates: Float64Array.from([
        0, 0, 10, 0, 10, 10, 0, 10, 0, 0, 2, 2, 2, 8, 8, 8, 8, 2, 2, 2, 20, 0, 22, 0, 22, 2, 20, 2,
        20, 0,
      ]),
      offsets: Uint32Array.from([0, 5, 10, 15]),
      features: Uint32Array.from([0, 2, 3]),
    };
    const { geometries } = buildGeometryPacket(packet);
    let area = 0;
    for (const g of geometries) {
      for (let i = 0; i < g.indices!.length; i += 3) {
        const p = [...g.indices!.subarray(i, i + 3)].map((id) => [
          g.vertices[id * 4] + g.vertices[id * 4 + 2],
          g.vertices[id * 4 + 1] + g.vertices[id * 4 + 3],
        ]);
        area +=
          Math.abs(
            (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]),
          ) / 2;
      }
    }
    expect(area).toBe(68);
  });
  it('splits long paths without losing neighbors, dash distance, or valid instances', () => {
    const path: Point[] = Array.from({ length: 150000 }, (_, i) => [
      13_000_000 + i / 100,
      4_000_000 + Math.sin(i),
    ]);
    const original = pathGeometry([path]),
      pieces = splitGeometry(original);
    expect(pieces.length).toBe(3);
    let first = 0;
    for (const piece of pieces) {
      expect(piece.vertices.length).toBe((piece.count + 3) * PATH_STRIDE);
      expect(
        piece.vertices.findIndex(
          (value, index) => !Object.is(value, original.vertices[first * PATH_STRIDE + index]),
        ),
      ).toBe(-1);
      first += piece.count;
      expect(piece.vertices.byteLength).toBeLessThan(2 * 1024 ** 2);
    }
    expect(first).toBe(original.count);
  });
  it('screens only a derived copy and falls back safely outside int32 snapping range', () => {
    const packet: GeometryPacket = {
      kind: 'path',
      coordinates: Float64Array.from([0, 0, 0.001, 0.001, 1, 1]),
      offsets: Uint32Array.from([0, 3]),
      features: Uint32Array.from([0, 1]),
      screen: {
        view: [1, -1, 0, 0],
        width: 100,
        height: 100,
        pixelRatio: 2,
        initialScale: 0,
        smallArcs: false,
        halfPixel: true,
        cull: false,
        padding: 8,
        revision: 0,
      },
    };
    const before = packet.coordinates.slice(),
      result = buildGeometryPacket(packet);
    expect(result.screenSpace).toBe(true);
    expect(result.screenStats!.duplicateVertices).toBe(1);
    expect(packet.coordinates).toEqual(before);
    packet.screen!.view[2] = 2 ** 32;
    const fallback = buildGeometryPacket(packet);
    expect(fallback.screenSpace).toBe(false);
    expect(fallback.geometries.length).toBe(1);
  });
  it('rejects invalid offsets and non-finite coordinates', () => {
    const packet: GeometryPacket = {
      kind: 'point',
      coordinates: Float64Array.from([0, 0]),
      offsets: Uint32Array.from([0, 1]),
      features: Uint32Array.from([0, 1]),
    };
    expect(() => buildGeometryPacket({ ...packet, offsets: Uint32Array.from([1, 0]) })).toThrow();
    packet.coordinates[0] = Infinity;
    expect(() => buildGeometryPacket(packet)).toThrow('Non-finite');
  });
});

it('uses lossless uint16 local indices for split fills, including the 65535 boundary', () => {
  const vertices = new Float32Array(70002 * 4);
  for (let i = 0; i < 70002; i++) {
    vertices[i * 4] = i;
    vertices[i * 4 + 1] = i % 3;
  }
  const pieces = splitGeometry({
    kind: 'fill',
    vertices,
    indices: Uint32Array.from({ length: 70002 }, (_, i) => i),
    count: 70002,
  });
  expect(pieces.length).toBe(2);
  const original = new Set<number>();
  for (const piece of pieces) {
    expect(piece.indices).toBeInstanceOf(Uint16Array);
    expect(piece.vertices.length / 4).toBeLessThanOrEqual(65535);
    for (const id of piece.indices!) original.add(piece.vertices[id * 4]);
  }
  expect(original.size).toBe(70002);
});

it('splits lossless XY strokes at record boundaries without inserting or losing segments', () => {
  const count = 30000,
    vertices = new Float32Array(count * 12);
  for (let i = 0; i < count; i++) vertices[i * 12] = i;
  const parts = splitGeometry({
    kind: 'path',
    compactStroke: true,
    compactStrokeXY: true,
    vertices,
    count,
  });
  expect(parts.length).toBe(2);
  expect(parts.reduce((n, p) => n + p.count, 0)).toBe(count);
  let cursor = 0;
  for (const part of parts) {
    expect(part.compactStrokeXY).toBe(true);
    expect(part.vertices.length).toBe(part.count * 12);
    for (let i = 0; i < part.count; i++) expect(part.vertices[i * 12]).toBe(cursor++);
  }
});

it('uses one exact owned backing allocation for multi-mesh path output without copying neighbor records', async () => {
  const { collectTransferables } = await import('../../worker/transferables');
  const count = 150000,
    vertices = new Float32Array((count + 3) * PATH_STRIDE);
  const parts = splitGeometry({ kind: 'path', vertices, count });
  expect(parts).toHaveLength(3);
  expect(new Set(parts.map((p) => p.vertices.buffer)).size).toBe(1);
  expect(parts[1].vertices.byteOffset).toBe(65536 * PATH_STRIDE * 4);
  expect(collectTransferables(parts).filter((b) => b === vertices.buffer)).toHaveLength(1);
});
it('does not retain an oversized backing allocation when exposing a small geometry result', () => {
  const backing = new Float32Array(1024 * 1024);
  const vertices = backing.subarray(100, 108);
  vertices.set([1, 2, 0, 0, 3, 4, 0, 0]);
  const [part] = splitGeometry({ kind: 'point', count: 2, vertices });
  expect(part.vertices).toEqual(vertices);
  expect(part.vertices.buffer.byteLength).toBe(32);
  expect(part.vertices.buffer).not.toBe(backing.buffer);
});
it('transferring assembled output does not detach source coordinates or Worker feature cache entries', async () => {
  const { FeatureGeometryCache } = await import('./feature-geometry-cache');
  const { collectTransferables } = await import('../../worker/transferables');
  const cache = new FeatureGeometryCache();
  const packet: GeometryPacket = {
    kind: 'fill',
    sourceId: 's',
    cacheKey: 'n',
    featureIds: new Int32Array([0]),
    coordinates: Float64Array.from([0, 0, 1, 0, 1, 1, 0, 1, 0, 0]),
    offsets: new Uint32Array([0, 5]),
    features: new Uint32Array([0, 1]),
  };
  const result = buildGeometryPacket(packet, cache);
  const clone = structuredClone(result, {
    transfer: collectTransferables(result) as ArrayBuffer[],
  });
  expect(clone.geometries[0].count).toBe(6);
  expect(packet.coordinates.byteLength).toBe(80);
  expect(buildGeometryPacket(packet, cache).geometries[0].count).toBe(6);
  expect(cache.stats.hits).toBe(1);
});

it('reports a finite per-packet preparation cost without retaining timing objects', () => {
  const result = buildGeometryPacket({
    kind: 'point',
    coordinates: Float64Array.from([1, 2]),
    offsets: Uint32Array.from([0, 1]),
    features: Uint32Array.from([0, 1]),
  });
  expect(Number.isFinite(result.preparationMs)).toBe(true);
  expect(result.preparationMs).toBeGreaterThanOrEqual(0);
});
