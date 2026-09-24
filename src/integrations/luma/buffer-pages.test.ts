import { describe, expect, it, vi } from 'vitest';
import type { Device } from '@luma.gl/core';
import { GeometryBufferPages, pagePayloadBytes, PAGE_SLACK_RESERVE } from './buffer-pages';
import type { GeometryBuffer } from './types';
function fixture() {
  const buffers: {
    byteLength: number;
    write: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }[] = [];
  const device = {
    createBuffer: vi.fn((p: { byteLength: number }) => {
      const b = { ...p, write: vi.fn(), destroy: vi.fn() };
      buffers.push(b);
      return b;
    }),
  };
  return { pool: new GeometryBufferPages(device as unknown as Device), buffers, device };
}
const triangle = (): GeometryBuffer => ({
  kind: 'fill',
  vertices: new Float32Array(12),
  indices: new Uint16Array([0, 1, 2]),
  count: 3,
});
describe('direct first-upload geometry pages', () => {
  it('shares a page, rebases uint16 indices and pads only whole degenerate triangles', () => {
    const { pool, buffers } = fixture();
    const a = pool.allocate(triangle(), 'a'),
      b = pool.allocate(triangle(), 'a');
    expect(a.page).toBe(b.page);
    expect(b.firstIndex).toBe(6);
    expect(buffers[1].write.mock.calls[1][0]).toEqual(new Uint16Array([3, 4, 5, 0, 0, 0]));
    expect(a.bytes).toBe(pagePayloadBytes(triangle()));
    const capacity = pool.allocatedBytes;
    pool.release(a);
    expect(pool.allocatedBytes).toBe(capacity);
    expect(pool.slackBytes).toBe(capacity - b.bytes);
    pool.release(b);
    expect(pool.allocatedBytes).toBe(0);
    expect(pool.liveBytes).toBe(0);
    expect(buffers.every((b) => b.destroy.mock.calls.length === 1)).toBe(true);
  });
  it('separates owners and formats, bounds new slack and never detaches the input', () => {
    const { pool } = fixture();
    const g = triangle(),
      source = g.indices!.slice();
    const slices = Array.from({ length: 60 }, (_, i) => pool.allocate(g, 'owner' + i));
    expect(pool.slackBytes).toBeLessThanOrEqual(PAGE_SLACK_RESERVE);
    expect(g.indices).toEqual(source);
    // At the reserve cap exact-size allocations are intentional. Release other
    // owners before asserting that this next pair has room to share a page.
    for (const slice of slices.slice(1)) pool.release(slice);
    const stroke: GeometryBuffer = {
      kind: 'path',
      compactStroke: true,
      vertices: new Float32Array(16),
      count: 1,
    };
    const a = pool.allocate(stroke, 'x'),
      b = pool.allocate(stroke, 'x');
    expect(b.firstInstance).toBe(1);
    expect(a.page).toBe(b.page);
    expect(a.page).not.toBe(slices[0].page);
    for (const s of [...slices, a, b]) pool.release(s);
    expect(pool.size).toBe(0);
  });
  it('cleans a new page on upload failure and does not advance an existing page', () => {
    const { pool, buffers } = fixture(),
      a = pool.allocate(triangle(), 'a');
    buffers[0].write.mockImplementationOnce(() => {
      throw new Error('write failed');
    });
    expect(() => pool.allocate(triangle(), 'a')).toThrow('write failed');
    const b = pool.allocate(triangle(), 'a');
    expect(b.firstIndex).toBe(6);
    pool.release(a);
    pool.release(b);
    expect(pool.allocatedBytes).toBe(0);
  });
});

it('reuses a retired slot without retaining stale data or increasing physical allocation', () => {
  const { pool, buffers } = fixture();
  const a = pool.allocate(triangle(), 's'),
    b = pool.allocate(triangle(), 's'),
    c = pool.allocate(triangle(), 's');
  const allocated = pool.allocatedBytes;
  pool.release(b);
  const d = pool.allocate(triangle(), 's');
  expect(d.page).toBe(a.page);
  expect(d.firstIndex).toBe(b.firstIndex);
  expect(pool.allocatedBytes).toBe(allocated);
  expect(buffers[1].write.mock.calls.at(-1)?.[1]).toBe(b.firstIndex * 2);
  pool.release(a);
  pool.release(c);
  pool.release(d);
  expect(pool.allocatedBytes).toBe(0);
});
it('does not retain an overlapping free slot after an append upload fails', () => {
  const { pool, buffers } = fixture(),
    a = pool.allocate(triangle(), 's');
  buffers[0].write.mockImplementationOnce(() => {
    throw new Error('upload');
  });
  expect(() => pool.allocate(triangle(), 's')).toThrow();
  const b = pool.allocate(triangle(), 's'),
    c = pool.allocate(triangle(), 's');
  expect(c.firstIndex).toBe(b.firstIndex + 6);
  pool.release(a);
  pool.release(b);
  pool.release(c);
  expect(pool.allocatedBytes).toBe(0);
});

it('rolls back a recycled slot after index upload failure without releasing live neighbours', () => {
  const { pool, buffers } = fixture();
  const a = pool.allocate(triangle(), 's'),
    b = pool.allocate(triangle(), 's');
  pool.release(a);
  const allocated = pool.allocatedBytes,
    live = pool.liveBytes;
  buffers[1].write.mockImplementationOnce(() => {
    throw new Error('index upload');
  });
  expect(() => pool.allocate(triangle(), 's')).toThrow('index upload');
  expect(pool.allocatedBytes).toBe(allocated);
  expect(pool.liveBytes).toBe(live);
  expect(b.page.refs).toBe(1);
  expect(buffers.every((buffer) => buffer.destroy.mock.calls.length === 0)).toBe(true);
  const replacement = pool.allocate(triangle(), 's');
  expect(replacement.firstIndex).toBe(a.firstIndex);
  pool.release(replacement);
  pool.release(b);
  expect(pool.size).toBe(0);
  expect(pool.allocatedBytes).toBe(0);
});

it('releases a new vertex allocation if its index allocation fails', () => {
  const { pool, device } = fixture();
  const vertex = { byteLength: 65535 * 16, write: vi.fn(), destroy: vi.fn() };
  device.createBuffer.mockReturnValueOnce(vertex).mockImplementationOnce(() => {
    throw new Error('index allocation');
  });
  expect(() => pool.allocate(triangle(), 's')).toThrow('index allocation');
  expect(vertex.destroy).toHaveBeenCalledOnce();
  expect(pool.allocatedBytes).toBe(0);
  expect(pool.liveBytes).toBe(0);
  expect(pool.size).toBe(0);
});

it('starts a new page before rebased uint16 indices could wrap or become the restart index', () => {
  const { pool, buffers } = fixture();
  const full: GeometryBuffer = {
    kind: 'fill',
    vertices: new Float32Array(65535 * 4),
    indices: new Uint16Array([65532, 65533, 65534]),
    count: 3,
  };
  const a = pool.allocate(full, 's'),
    b = pool.allocate(triangle(), 's');
  expect(a.page).not.toBe(b.page);
  expect(b.firstIndex).toBe(0);
  expect(buffers[1].write.mock.calls[0][0]).toEqual(
    new Uint16Array([65532, 65533, 65534, 0, 0, 0]),
  );
  pool.dispose();
  pool.release(a);
  pool.release(b);
  expect(pool.liveBytes).toBe(0);
  expect(pool.allocatedBytes).toBe(0);
  expect(buffers.every((buffer) => buffer.destroy.mock.calls.length === 1)).toBe(true);
});

it('splits recycled capacity and coalesces adjacent free intervals without moving live slices', () => {
  const { pool } = fixture();
  const path = (n: number): GeometryBuffer => ({
    kind: 'path',
    compactStroke: true,
    vertices: new Float32Array(16 * n),
    count: n,
  });
  const a = pool.allocate(path(4), 's'),
    live = pool.allocate(path(1), 's');
  const bytes = pool.allocatedBytes;
  pool.release(a);
  const b = pool.allocate(path(1), 's'),
    c = pool.allocate(path(3), 's');
  expect(b.firstInstance).toBe(0);
  expect(c.firstInstance).toBe(1);
  expect(live.firstInstance).toBe(4);
  pool.release(b);
  pool.release(c);
  const combined = pool.allocate(path(4), 's');
  expect(combined.firstInstance).toBe(0);
  expect(pool.allocatedBytes).toBe(bytes);
  pool.release(combined);
  pool.release(live);
  expect(pool.liveBytes).toBe(0);
});
it('does not lose or duplicate split capacity when a recycled upload fails', () => {
  const { pool, buffers } = fixture();
  const g = (n: number): GeometryBuffer => ({
    kind: 'path',
    compactStroke: true,
    vertices: new Float32Array(16 * n),
    count: n,
  });
  const a = pool.allocate(g(6), 's'),
    live = pool.allocate(g(1), 's');
  pool.release(a);
  buffers[0].write.mockImplementationOnce(() => {
    throw new Error('upload');
  });
  expect(() => pool.allocate(g(2), 's')).toThrow('upload');
  const b = pool.allocate(g(3), 's'),
    c = pool.allocate(g(3), 's');
  expect(b.firstInstance).toBe(0);
  expect(c.firstInstance).toBe(3);
  pool.release(b);
  pool.release(c);
  pool.release(live);
  expect(pool.allocatedBytes).toBe(0);
});

it('keeps 48-byte XY slices aligned and separate from high/low stroke pages', () => {
  const { pool, buffers } = fixture();
  const xy: GeometryBuffer = {
    kind: 'path',
    compactStroke: true,
    compactStrokeXY: true,
    vertices: new Float32Array(12),
    count: 1,
  };
  const hi: GeometryBuffer = {
    kind: 'path',
    compactStroke: true,
    vertices: new Float32Array(16),
    count: 1,
  };
  const a = pool.allocate(xy, 's'),
    b = pool.allocate(xy, 's'),
    c = pool.allocate(hi, 's');
  expect(a.page).toBe(b.page);
  expect(a.page).not.toBe(c.page);
  expect(b.firstInstance).toBe(1);
  expect(b.slot.vertexStart).toBe(48);
  expect(buffers[0].write.mock.calls[1][1]).toBe(48);
  pool.release(a);
  const d = pool.allocate(xy, 's');
  expect(d.firstInstance).toBe(0);
  pool.release(b);
  pool.release(c);
  pool.release(d);
  expect(pool.allocatedBytes).toBe(0);
});
