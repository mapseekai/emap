import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { TaskHandler } from '@mapseekai/tasklane/host';
import { TasklaneTestWorker, flushTasks } from '../../../../test/utils/tasklane-worker';
import { GeometryWorker } from '../../../integrations/luma/geometry-worker';
import { buildGeometryPacket } from './geometry-packet';
import type { GeometryPacket } from './geometry-jobs';
import { createEmapWorkerRuntime } from '../../../integrations/tasklane/runtime';

const entry = vi.hoisted(() => ({
  port: {},
  geometry: undefined as TaskHandler<unknown, unknown> | undefined,
}));
vi.mock('@mapseekai/tasklane/host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mapseekai/tasklane/host')>();
  return {
    ...actual,
    browserHost: () => entry.port,
    serve: (...args: Parameters<typeof actual.serve>) => {
      if (args[0] !== entry.port) return actual.serve(...args);
      entry.geometry = args[1].geometry;
      return () => {};
    },
  };
});
const clients: GeometryWorker[] = [];
function client() {
  const value = new GeometryWorker(new URL('https://example.test/geometry.js'));
  clients.push(value);
  return value;
}
function packet(recycleInput = true): GeometryPacket & { recycleInput: boolean } {
  return {
    kind: 'path',
    coordinates: Float64Array.from([1, 2, 3, 4, 5, 2]),
    offsets: Uint32Array.from([0, 3]),
    features: Uint32Array.from([0, 1]),
    recycleInput,
  };
}
beforeAll(async () => {
  vi.stubGlobal('self', {});
  await import('./geometry-worker-entry');
});
beforeEach(() => {
  TasklaneTestWorker.instances = [];
  TasklaneTestWorker.handlers = { geometry: entry.geometry! };
  vi.stubGlobal('Worker', TasklaneTestWorker);
});
afterEach(async () => {
  for (const value of clients.splice(0)) value.dispose();
  await flushTasks();
  vi.unstubAllGlobals();
});
it('round-trips real Worker input allocations without changing the rendered geometry', async () => {
  const value = client(),
    input = packet(),
    expected = buildGeometryPacket(input);
  for (let i = 0; i < 2; i++) {
    const result = await value.build(input, new AbortController().signal);
    expect(input.coordinates.byteLength).toBe(48);
    expect(result.geometries).toEqual(expected.geometries);
    const received = TasklaneTestWorker.instances[0].requests[i].payload.packet;
    expect(received.coordinates.byteLength).toBe(0);
  }
  expect(value.stats).toMatchObject({ recycledInputBytes: 128, jobs: 2 });
});
it('returns recyclable inputs from successful and failed batch items while leaving ordinary ownership transferred', async () => {
  const value = client(),
    invalid = packet(),
    valid = packet(),
    ordinary = packet(false);
  invalid.coordinates[0] = NaN;
  const expected = buildGeometryPacket(valid),
    results = await value.buildBatch([invalid, ordinary, valid], new AbortController().signal);
  expect(results[0]).toEqual({ error: 'Non-finite geometry coordinate' });
  expect(results[1].result!.geometries).toEqual(expected.geometries);
  expect(results[2].result!.geometries).toEqual(expected.geometries);
  expect(invalid.offsets.byteLength).toBe(8);
  expect(valid.offsets.byteLength).toBe(8);
  expect(ordinary.offsets.byteLength).toBe(0);
  expect(value.stats).toMatchObject({ recycledInputBytes: 128, jobs: 2 });
});
it('round-trips valid empty inputs and keeps the existing triangulation reservation', async () => {
  const runtime = createEmapWorkerRuntime({ sizes: { geometry: 1 } }),
    value = new GeometryWorker(new URL('https://example.test/geometry.js'), runtime),
    input = {
      ...packet(),
      coordinates: new Float64Array(),
      offsets: Uint32Array.of(0),
      features: Uint32Array.of(0),
    };
  try {
    for (let i = 0; i < 2; i++) {
      const result = await value.build(input, new AbortController().signal);
      expect(result.geometries).toEqual([]);
      expect(input.offsets.byteLength).toBe(4);
      expect(input.features.byteLength).toBe(4);
    }
    expect(value.stats).toMatchObject({ recycledInputBytes: 16, jobs: 2 });
    expect(runtime.diagnostics().pools.find((p) => p.name === 'geometry')).toMatchObject({
      cacheBytesPerWorker: 64 * 1024 ** 2,
      cacheUsedBytes: 64 * 1024 ** 2,
    });
  } finally {
    value.dispose();
    await value.closed;
    await runtime.dispose();
  }
});
it('uses current screen and compact settings when preparing the same returned input', async () => {
  const value = client(),
    input = packet();
  input.screen = {
    view: [16, -16, 0, 100],
    width: 100,
    height: 100,
    pixelRatio: 2,
    initialScale: 0,
    smallArcs: false,
    halfPixel: true,
    cull: false,
    padding: 8,
    revision: 0,
  };
  for (const scale of [16, 4]) {
    input.screen = { ...input.screen, view: [scale, -scale, 0, 100] };
    input.compactStroke = scale === 4;
    const expected = buildGeometryPacket(input),
      result = await value.build(input, new AbortController().signal);
    expect(result.geometries).toEqual(expected.geometries);
    expect(result.screenStats).toEqual(expected.screenStats);
    expect(input.coordinates).toEqual(Float64Array.from([1, 2, 3, 4, 5, 2]));
  }
});
it('preserves single-item failure semantics and recovers with a new input', async () => {
  const value = client(),
    invalid = packet();
  invalid.coordinates[0] = NaN;
  await expect(value.build(invalid, new AbortController().signal)).rejects.toThrow(
    'Non-finite geometry coordinate',
  );
  expect(invalid.offsets.byteLength).toBe(0);
  const fresh = packet();
  await value.build(fresh, new AbortController().signal);
  expect(fresh.offsets.byteLength).toBe(8);
  expect(TasklaneTestWorker.instances).toHaveLength(2);
});
it('preserves shared backing storage and view offsets through input ownership transfers', async () => {
  const value = client(),
    input = packet(),
    storage = new ArrayBuffer(64);
  input.coordinates = new Float64Array(storage, 0, 6);
  input.offsets = new Uint32Array(storage, 48, 2);
  input.features = new Uint32Array(storage, 56, 2);
  input.coordinates.set([1, 2, 3, 4, 5, 2]);
  input.offsets.set([0, 3]);
  input.features.set([0, 1]);
  const expected = buildGeometryPacket(input),
    result = await value.build(input, new AbortController().signal);
  expect(result.geometries).toEqual(expected.geometries);
  expect(input.offsets.buffer).toBe(input.coordinates.buffer);
  expect(input.features.buffer).toBe(input.coordinates.buffer);
  expect(input.offsets.byteOffset).toBe(48);
  expect(input.features.byteOffset).toBe(56);
  expect(value.stats).toMatchObject({ recycledInputBytes: 64 });
  expect(TasklaneTestWorker.instances[0].requests[0].context.outputLimit).toBe(
    256 * 1024 ** 2 + 64,
  );
});
