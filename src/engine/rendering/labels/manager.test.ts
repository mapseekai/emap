// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BoundLabelManager, drawCanvasLabels } from './manager';
import { AffineTransform } from '../../../domain/geo/transform';
import { PerspectiveTransform } from '../../../domain/geo/perspective-transform';
import Flatbush from 'flatbush';

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
  it('places point labels directly above their point with a fixed screen gap', async () => {
    const f = fixture();
    const frame = await prepare(f);
    for (const label of frame.labels) {
      const point = f.binding.layer.shapes[label.featureId][0];
      const [x, y] = view.project(...(point as [number, number]));
      expect(label.x).toBe(x);
      expect(label.y + label.raster.height / 2).toBe(y - 7);
      expect(label.bounds[3]).toBeLessThan(y - 4);
    }
    f.manager.dispose();
  });
  it('hides colliding point labels by default instead of moving them away from the point', async () => {
    const f = fixture();
    f.binding.layer.shapes[1] = [[100, 100]];
    expect((await prepare(f)).labels.map((l) => l.featureId)).toEqual([0]);
    Object.assign(f.binding.options, { allowOverlap: true });
    expect((await prepare(f)).labels.map((l) => l.featureId)).toEqual([0, 1]);
    f.manager.dispose();
  });
  it('uses the same scaled glyph size and collision bounds during navigation and a settled layout', async () => {
    const f = fixture();
    Object.assign(f.binding.options, { fontSize: 64, offset: [12, -8] });
    Object.assign(f.binding, { pointRadius: 10 });
    const first = await prepare(f),
      original = first.labels[0],
      camera = view.clone();
    camera.scale(0.25, 100, 100);
    const preview = f.manager.preview(camera, 800, 600, 0.25),
      label = preview.labels.find((l) => l.featureId === 0)!;
    expect(label.scale).toBe(0.25);
    expect(label.raster).toBe(original.raster);
    expect(label.x).toBe(112);
    expect(label.y + (original.raster.height * 0.25) / 2).toBe(100 - 10 - 3 - 8);
    expect(label.bounds[2] - label.bounds[0]).toBeCloseTo(original.raster.width * 0.25 + 4);
    f.manager.request([f.binding], camera, 800, 600, 1, false, 0.25);
    await f.manager.settled();
    const settled = f.manager.request([f.binding], camera, 800, 600, 1, false, 0.25);
    expect(settled.labels[0]).toMatchObject({
      scale: 0.25,
      x: label.x,
      y: label.y,
      bounds: label.bounds,
    });
    const restored = await prepare(f);
    expect(restored.labels[0].scale).toBe(1);
    expect(restored.labels[0].raster).toBe(original.raster);
    f.manager.dispose();
  });
  it.each([
    6, 12, 16, 64, 96,
  ])('keeps %spx labels readable when zooming far out without enlarging smaller configured fonts', async (fontSize) => {
    const f = fixture();
    Object.assign(f.binding.options, { fontSize });
    const camera = new AffineTransform(0.001, 0.001, 400, 300);
    f.manager.request([f.binding], camera, 800, 600, 1, false, 0.001);
    await f.manager.settled();
    const full = f.manager.request([f.binding], camera, 800, 600, 1, false, 0.001);
    expect(full.labels.length).toBeGreaterThan(0);
    for (const label of full.labels)
      expect((label.scale ?? 1) * fontSize).toBeCloseTo(Math.min(12, fontSize));
    const next = camera.clone();
    next.scale(0.1, 400, 300);
    const preview = f.manager.preview(next, 800, 600, 0.0001);
    expect(preview.labels.length).toBeGreaterThan(0);
    for (const label of preview.labels) {
      expect((label.scale ?? 1) * fontSize).toBeCloseTo(Math.min(12, fontSize));
      const [, y] = next.project(...label.anchor!);
      expect(label.y + (label.raster.height * (label.scale ?? 1)) / 2).toBeCloseTo(y - 7);
    }
    f.manager.dispose();
  });
  it('prepares healthy owners together so glyph pages are pinned before allocation', async () => {
    const f = fixture(),
      atlas = (f.manager as any).atlas;
    atlas.prepare = vi.fn();
    atlas.prepareGlyphs = vi.fn();
    const other = {
      ...f.binding,
      id: 'other',
      options: { text: 'other', allowOverlap: true, offset: [80, 0] as const },
    };
    f.manager.request([f.binding, other], view, 800, 600, 1);
    await f.manager.settled();
    expect(atlas.prepare).toHaveBeenCalledTimes(1);
    expect(atlas.prepareGlyphs).toHaveBeenCalledTimes(1);
    expect(new Set(atlas.prepareGlyphs.mock.calls[0][0].map((r: any) => r.ownerId))).toEqual(
      new Set(['cities', 'other']),
    );
    f.manager.dispose();
  });
  it('cancels a failed old layout without reporting it or excluding the layer from the replacement', async () => {
    const f = fixture(),
      atlas = (f.manager as any).atlas;
    let reject!: (error: Error) => void;
    atlas.prepare = vi.fn().mockImplementationOnce(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    );
    f.manager.request([f.binding], view, 800, 600, 1);
    await vi.waitFor(() => expect(reject).toBeDefined());
    f.binding.dataset.attributeVersion++;
    f.manager.request([f.binding], view, 800, 600, 1);
    reject(new Error('Cancelled font request'));
    await f.manager.settled();
    expect(f.manager.request([f.binding], view, 800, 600, 1).labels).toHaveLength(2);
    expect(f.report).not.toHaveBeenCalled();
    f.manager.dispose();
  });
  it.each([
    'prepare',
    'prepareGlyphs',
    'measure',
    'reserve',
    'get',
  ] as const)('isolates a layer whose atlas %s fails and retries it after its configuration is repaired', async (stage) => {
    const f = fixture();
    const atlas = (f.manager as any).atlas;
    const original = atlas[stage]?.bind(atlas);
    const failure = new Error('Font failed');
    atlas[stage] = (...args: any[]) => {
      const requests =
        stage === 'prepare' || stage === 'prepareGlyphs' ? args[0] : [{ options: args[1] }];
      if (requests.some((r: any) => r.options.fontFamily === 'broken')) throw failure;
      return original?.(...args);
    };
    const bad = {
      ...f.binding,
      id: 'bad-font',
      options: { text: 'bad', fontFamily: 'broken', priority: 100 },
    };
    f.manager.request([f.binding, bad], view, 800, 600, 1);
    await f.manager.settled();
    const frame = f.manager.request([f.binding, bad], view, 800, 600, 1);
    expect(frame.labels.map((l) => l.ownerId)).toEqual(['cities', 'cities']);
    expect(f.manager.stats.placed).toBe(2);
    expect(f.manager.stats.pending).toBe(false);
    expect(f.report).toHaveBeenCalledTimes(1);
    expect(f.report.mock.calls[0][0].message).toContain('bad-font');
    bad.options.fontFamily = 'sans-serif';
    f.manager.request([f.binding, bad], view, 800, 600, 1);
    await f.manager.settled();
    expect(
      f.manager
        .request([f.binding, bad], view, 800, 600, 1)
        .labels.some((l) => l.ownerId === 'bad-font'),
    ).toBe(true);
    expect(f.report).toHaveBeenCalledTimes(1);
    f.manager.dispose();
  });
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
    expect(next.labels[0].x).toBe(400);
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

it('scales Canvas2D glyphs and halos around the placed anchor', () => {
  const canvas = {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
  };
  const label: any = {
    x: 100,
    y: 120,
    angle: 0,
    scale: 0.5,
    raster: { page: { canvas: {} }, rect: [0, 0, 20, 30], width: 20, height: 30 },
  };
  drawCanvasLabels(canvas as any, { key: 'scaled', labels: [label] }, 2);
  expect(canvas.translate).toHaveBeenCalledWith(100, 120);
  expect(canvas.scale).toHaveBeenCalledWith(0.5, 0.5);
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

it('keeps the last valid labels while the settled camera waits for an asynchronous layout', async () => {
  const f = fixture();
  const first = await prepare(f);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => (release = resolve));
  const atlas = (f.manager as any).atlas;
  atlas.prepare = vi.fn(() => pending);
  const moved = new AffineTransform(1, 1, 7, 0);
  const preview = f.manager.request([f.binding], moved, 800, 600, 1, false);
  expect(preview.labels).toHaveLength(first.labels.length);
  expect(preview.labels[0].x).toBeCloseTo(first.labels[0].x + 7);
  expect(preview.labels[0].raster).toBe(first.labels[0].raster);
  expect(f.manager.stats.pending).toBe(true);
  await vi.waitFor(() => expect(atlas.prepare).toHaveBeenCalled());
  expect(f.manager.request([f.binding], moved, 800, 600, 1).labels).toHaveLength(2);
  release();
  await f.manager.settled();
  expect(f.manager.request([f.binding], moved, 800, 600, 1).labels).toHaveLength(2);
  f.binding.dataset.attributeVersion++;
  expect(f.manager.request([f.binding], moved, 800, 600, 1).labels).toHaveLength(0);
  f.manager.dispose();
  await f.manager.settled();
});

it('reprojects retained labels when only perspective orientation changes', async () => {
  const f = fixture();
  const first = await prepare(f);
  const tilted = new PerspectiveTransform(view, 800, 600, { pitch: 30, bearing: 10 });
  f.manager.pause(true);
  const preview = f.manager.request([f.binding], tilted, 800, 600, 1);
  const label = preview.labels.find((l) => l.featureId === first.labels[0].featureId)!;
  expect(label.raster).toBe(first.labels[0].raster);
  expect(label.x).toBeCloseTo(tilted.project(...label.anchor!)[0] + label.screenOffset![0]);
  expect(preview.key).not.toBe(first.key);
  tilted.setOrientation({ bearing: 20 });
  expect(f.manager.request([f.binding], tilted, 800, 600, 1).key).not.toBe(preview.key);
  f.manager.dispose();
});

it('stops shaping exhausted layer quotas without skipping candidates in other layers', async () => {
  const f = fixture();
  const atlas = (f.manager as any).atlas;
  const shaped: string[] = [];
  atlas.prepare = vi.fn(async (requests: { text: string }[]) => {
    shaped.push(...requests.map((r) => r.text));
  });
  f.binding.layer.shapes = Array.from({ length: 1024 }, () => [[100, 100]]);
  f.binding.layer.data = { getRecordAt: (id: number) => ({ name: String(id) }) };
  Object.assign(f.binding.options, { maxLabels: 1, allowOverlap: true, priority: 1 });
  const other = {
    ...f.binding,
    id: 'other',
    options: { text: 'other', maxLabels: 2, allowOverlap: true, priority: 0 },
  };
  f.manager.request([other, f.binding], view, 800, 600, 1);
  await f.manager.settled();
  const frame = f.manager.request([other, f.binding], view, 800, 600, 1);
  expect(frame.labels.filter((l) => l.ownerId === 'cities')).toHaveLength(1);
  expect(frame.labels.filter((l) => l.ownerId === 'other')).toHaveLength(2);
  expect(shaped.filter((s) => s !== 'other').length).toBeLessThanOrEqual(128);
  expect(shaped.filter((s) => s === 'other').length).toBeLessThanOrEqual(128);
  expect(f.manager.stats.capacitySkipped).toBe(2045);
  f.manager.dispose();
});

it('keeps priority collision winners and draw order through navigation without sorting each preview', async () => {
  const f = fixture();
  Object.assign(f.binding.options, { priority: ['get', 'rank'], offset: [0, 0] });
  await prepare(f);
  const camera = new AffineTransform(0.01, 0.01, 200, 200);
  const sort = vi.spyOn(Array.prototype, 'sort');
  const first = f.manager.preview(camera, 800, 600);
  const next = f.manager.preview(new AffineTransform(0.01, 0.01, 201, 200), 800, 600);
  expect(sort).not.toHaveBeenCalled();
  sort.mockRestore();
  expect(first.labels.map((l) => l.featureId)).toEqual([1]);
  expect(next.labels.map((l) => l.featureId)).toEqual([1]);
  expect(next.labels[0].x - first.labels[0].x).toBeCloseTo(1);
  f.binding.layer.data.getRecordAt = (id: number) => ({
    ...records[id],
    rank: 3 - records[id].rank,
  });
  f.binding.dataset.attributeVersion++;
  await prepare(f);
  expect(f.manager.preview(camera, 800, 600).labels.map((l) => l.featureId)).toEqual([0]);
  f.manager.invalidateLayout();
  expect(f.manager.preview(camera, 800, 600).labels).toEqual([]);
  f.manager.dispose();
});

it('bounds index builds and full-view queries, and finds later chunks after panning', async () => {
  const f = fixture(),
    count = 100000;
  f.binding.layer.shapes = Array.from({ length: count }, (_, i) => [[i + 100, 100]]);
  f.binding.layer.data = { getRecordAt: (id: number) => ({ name: String(id), rank: id }) };
  Object.assign(f.binding.options, { maxLabels: 1, priority: ['get', 'rank'] });
  const sizes: number[] = [],
    finish = Flatbush.prototype.finish;
  vi.spyOn(Flatbush.prototype, 'finish').mockImplementation(function (this: Flatbush) {
    sizes.push(this.numItems);
    return finish.call(this);
  });
  const search = vi.spyOn(Flatbush.prototype, 'search');
  const full = await prepare(f, new AffineTransform(0.005, 1));
  expect(sizes.length).toBeGreaterThan(1);
  expect(Math.max(...sizes)).toBeLessThanOrEqual(8192);
  expect(f.manager.stats.candidates).toBe(20000);
  expect(full.labels[0].featureId).toBe(count - 1);
  expect(search.mock.calls.length).toBe(sizes.length);
  expect(search.mock.results.every((result) => result.value.length <= 8192)).toBe(true);
  const built = sizes.length;
  const frame = await prepare(f, new AffineTransform(1, 1, -99500, 0));
  expect(frame.labels).toHaveLength(1);
  expect(frame.labels[0].featureId).toBe(count - 1);
  expect(sizes).toHaveLength(built);
  f.manager.dispose();
  expect(f.report).not.toHaveBeenCalled();
});

it.each([
  'mask',
  'empty text',
] as const)('does not spend the candidate budget on %s exclusions', async (exclusion) => {
  const f = fixture(),
    count = 33000;
  f.binding.layer.shapes = Array.from({ length: count }, () => [[100, 100]]);
  f.binding.layer.data = {
    getRecordAt: (id: number) => ({
      name: exclusion === 'empty text' && id < 32768 ? '' : String(id),
    }),
  };
  f.binding.options = { field: 'name', maxLabels: 1 } as any;
  if (exclusion === 'mask') {
    const mask = new Uint8Array(count);
    mask.fill(1, 32768);
    Object.assign(f.binding, { mask });
  }
  const frame = await prepare(f);
  expect(frame.labels.map((l) => l.featureId)).toEqual([32768]);
  expect(f.manager.stats.candidates).toBe(232);
  expect(f.report).not.toHaveBeenCalled();
  f.manager.dispose();
});

it.each([
  true,
  false,
])('only materializes fallback records when indexed access is unavailable: %s', async (indexed) => {
  const f = fixture(),
    getRecords = vi.fn(() => records);
  f.binding.layer.data = {
    getRecords,
    ...(indexed ? { getRecordAt: (id: number) => records[id] } : {}),
  };
  expect((await prepare(f)).labels).toHaveLength(2);
  expect(getRecords).toHaveBeenCalledTimes(indexed ? 0 : 1);
  f.manager.dispose();
});

it('keeps global priority across chunks and layers with bounded sorting and per-layer placement quotas', async () => {
  const f = fixture(),
    count = 33000;
  f.binding.layer.shapes = Array.from({ length: count }, () => [[100, 100]]);
  f.binding.layer.data = { getRecordAt: (id: number) => ({ name: String(id), rank: id }) };
  Object.assign(f.binding.options, { priority: ['get', 'rank'], maxLabels: 1 });
  const layer: any = {
    geometry_type: 'point',
    shapes: [[[300, 100]]],
    data: { getRecordAt: () => ({ name: 'other', rank: count }) },
  };
  const other = { ...f.binding, id: 'other', dataset: { layers: [layer] }, layer };
  const sizes: number[] = [],
    sort = Array.prototype.sort;
  const spy = vi.spyOn(Array.prototype, 'sort').mockImplementation(function (this: any[], compare) {
    if (this[0]?.binding) sizes.push(this.length);
    return sort.call(this, compare);
  });
  try {
    const bindings = [other, f.binding];
    f.manager.request(bindings, view, 800, 600, 1);
    await f.manager.settled();
    const frame = f.manager.request(bindings, view, 800, 600, 1);
    expect(frame.labels.map((l) => [l.ownerId, l.featureId])).toEqual([
      ['other', 0],
      ['cities', count - 1],
    ]);
    expect(f.manager.stats.candidates).toBe(20000);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(20000 + 8192);
    expect(f.report).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
    f.manager.dispose();
  }
});

it('yields and cancels a fully excluded scan without publishing stale placements', async () => {
  const f = fixture(),
    count = 33000;
  f.binding.layer.shapes = Array.from({ length: count }, () => [[100, 100]]);
  Object.assign(f.binding.options, { maxLabels: 1 });
  await prepare(f);
  const layouts = f.manager.stats.layouts;
  let reads = 0,
    tick = 0;
  f.binding.layer.data = {
    getRecordAt: () => {
      if (++reads === 1) setTimeout(() => f.manager.clear(), 0);
      return { name: '' };
    },
  };
  f.binding.dataset.attributeVersion++;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => (tick += 5));
  try {
    await prepare(f);
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThan(20000);
    expect(f.manager.stats.layouts).toBe(layouts);
    expect(f.manager.placements).toEqual([]);
    expect(f.report).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
    f.manager.dispose();
    await f.manager.settled();
  }
});
