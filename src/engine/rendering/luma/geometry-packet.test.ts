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
      expect(piece.vertices).toEqual(
        original.vertices.slice(first * PATH_STRIDE, (first + piece.count + 3) * PATH_STRIDE),
      );
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
