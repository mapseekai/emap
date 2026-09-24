// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BoundLabelManager } from './manager';
import { AffineTransform } from '../../../domain/geo/transform';
import { PerspectiveTransform } from '../../../domain/geo/perspective-transform';

const ctx = {
  font: '',
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  clearRect: vi.fn(),
  strokeText: vi.fn(),
  fillText: vi.fn(),
  measureText: (s: string) => ({
    width: Array.from(s).length * 8,
    actualBoundingBoxAscent: 11,
    actualBoundingBoxDescent: 3,
  }),
};
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as any);
});
afterEach(() => {
  vi.restoreAllMocks();
  ctx.fillText.mockClear();
});
const view = new AffineTransform();
const records = [
  { name: '北京', rank: 1 },
  { name: '上海', rank: 2 },
  { name: '', rank: 0 },
];
function fixture() {
  const layer: any = {
    geometry_type: 'point',
    shapes: [[[100, 100]], [[350, 250]], [[200, 200]]],
    data: { getRecordAt: (id: number) => records[id] },
  };
  const dataset = { layers: [layer], editVersion: 0, attributeVersion: 0 };
  const invalidate = vi.fn(),
    report = vi.fn(),
    manager = new BoundLabelManager(invalidate, report);
  return { manager, report, binding: { id: 'cities', dataset, layer, options: { field: 'name' } } };
}
async function prepare(f: ReturnType<typeof fixture>, camera = view) {
  f.manager.request([f.binding], camera, 800, 600, 1);
  await f.manager.settled();
  return f.manager.request([f.binding], camera, 800, 600, 1);
}
describe('asynchronous owner-bound labels', () => {
  it('labels features, reuses an unchanged frame and atlas, and never changes data', async () => {
    const f = fixture(),
      before = JSON.stringify(f.binding.dataset);
    const first = await prepare(f);
    expect(first.labels).toHaveLength(2);
    expect(f.report).not.toHaveBeenCalled();
    expect(first.labels.map((l) => l.ownerId)).toEqual(['cities', 'cities']);
    const writes = ctx.fillText.mock.calls.length;
    expect(await prepare(f)).toBe(first);
    expect(ctx.fillText.mock.calls.length).toBe(writes);
    expect(f.manager.stats.layouts).toBe(1);
    expect(JSON.stringify(f.binding.dataset)).toBe(before);
    f.manager.dispose();
    expect(f.manager.stats.atlasBytes).toBe(0);
  });
  it('inherits filter masks and drops labels when the parent disappears', async () => {
    const f = fixture();
    (f.binding as any).mask = new Uint8Array([0, 1, 1]);
    const frame = await prepare(f);
    expect(frame.labels.map((l) => l.featureId)).toEqual([1]);
    expect(f.manager.request([], view, 800, 600, 1).labels).toHaveLength(0);
    expect(f.manager.stats.atlasBytes).toBe(0);
    f.manager.dispose();
  });
  it('applies priority before per-layer budgets and reacts to geometry edits', async () => {
    const f = fixture();
    (f.binding.options as any).priority = ['get', 'rank'];
    (f.binding.options as any).maxLabels = 1;
    expect((await prepare(f)).labels[0].featureId).toBe(1);
    f.binding.layer.shapes[1] = [[400, 250]];
    f.binding.dataset.editVersion++;
    const next = await prepare(f);
    expect(next.labels[0].x).toBeGreaterThan(400);
    f.manager.dispose();
  });
  it('does not publish stale work, respects pause, and updates perspective poses', async () => {
    const f = fixture();
    f.manager.request([f.binding], view, 800, 600, 1);
    f.manager.clear();
    await f.manager.settled();
    expect(f.manager.placements).toEqual([]);
    f.manager.pause(true);
    await prepare(f);
    expect(f.manager.stats.layouts).toBe(0);
    f.manager.pause(false);
    const t = new PerspectiveTransform(view, 800, 600, { pitch: 50, bearing: 30 });
    const frame = await prepare(f, t);
    expect(frame.labels.length).toBeGreaterThan(0);
    expect(frame.labels[0].x).not.toBe(100);
    expect(f.report).not.toHaveBeenCalled();
    f.manager.dispose();
  });
});

it('reprojects navigation anchors without scaling glyphs or CSS offsets, and immediately invalidates filtered content', async () => {
  const f = fixture(),
    frame = await prepare(f),
    label = frame.labels[0],
    writes = ctx.fillText.mock.calls.length;
  const moved = new AffineTransform(2, 2, -100, -100),
    preview = f.manager.preview(moved, 800, 600);
  const next = preview.labels.find((l) => l.featureId === label.featureId)!;
  expect(next).toBeDefined();
  expect(next.raster).toBe(label.raster);
  expect(next.x - moved.project(...next.anchor!)[0]).toBeCloseTo(label.screenOffset![0]);
  expect(next.y - moved.project(...next.anchor!)[1]).toBeCloseTo(label.screenOffset![1]);
  expect(ctx.fillText.mock.calls.length).toBe(writes);
  (f.binding as any).mask = new Uint8Array([0, 1, 1]);
  expect(f.manager.request([f.binding], moved, 800, 600, 1, true).labels).toHaveLength(0);
  expect(f.manager.preview(moved, 800, 600).labels).toHaveLength(0);
  await f.manager.settled();
  f.manager.dispose();
});
