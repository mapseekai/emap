// Unit tests for the ops added in the mapshaper-capability gap-fill
// pass: clip/erase bbox extension, filterIslands, filterSlivers,
// filterGeom, affineLayer, dataFill.
//
// Tests focus on:
//   1. Validation: bad inputs return structured `Err.*`, no dispatch.
//   2. Happy path: dispatch produces the expected ParsedCommand[]
//      shape and label.
//
// Each op gets a stubbed `OpContext` whose `runDatasetCommandParsed`
// records the call instead of running mapshaper. That keeps these
// tests fast and free of mapshaper-state coupling.

import { describe, expect, it } from 'vitest';
import { clipLayer, eraseLayer } from './clip-erase';
import { filterIslands } from './filter-islands';
import { filterSlivers } from './filter-slivers';
import { filterGeom } from './filter-geom';
import { affineLayer } from './affine';
import { dataFill } from './data-fill';
import { makeStubCtx } from './_test-helpers';

// =========================================================================
// clip / erase — bbox path
// =========================================================================

describe('clipLayer / eraseLayer — bbox extension', () => {
  it('clips against a bbox without a mask layer', async () => {
    const { ctx, calls } = makeStubCtx();
    const r = await clipLayer(ctx, {
      source: 's1',
      target: 'parks',
      bbox: [0, 0, 10, 10],
    });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].cmds[1].name).toBe('clip');
    expect(calls[0].cmds[1].options).toEqual({ bbox: [0, 0, 10, 10] });
  });

  it('forwards cleanup + removeSlivers to the mapshaper option keys', async () => {
    const { ctx, calls } = makeStubCtx();
    await clipLayer(ctx, {
      source: 's1',
      target: 'parks',
      mask: 'parks',
      cleanup: true,
      removeSlivers: true,
    });
    expect(calls[0].cmds[1].options).toEqual({
      source: 'parks',
      cleanup: true,
      remove_slivers: true,
    });
  });

  it('rejects when neither mask nor bbox is supplied', async () => {
    const { ctx } = makeStubCtx();
    const r = await clipLayer(ctx, { source: 's1', target: 'parks' } as any);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('validation');
  });

  it('rejects when both mask AND bbox are supplied', async () => {
    const { ctx } = makeStubCtx();
    const r = await clipLayer(ctx, {
      source: 's1',
      target: 'parks',
      mask: 'parks',
      bbox: [0, 0, 1, 1],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects bbox with xmin >= xmax', async () => {
    const { ctx } = makeStubCtx();
    const r = await clipLayer(ctx, {
      source: 's1',
      target: 'parks',
      bbox: [10, 0, 10, 10],
    });
    expect(r.ok).toBe(false);
  });

  it('eraseLayer also accepts bbox', async () => {
    const { ctx, calls } = makeStubCtx();
    await eraseLayer(ctx, { source: 's1', target: 'parks', bbox: [0, 0, 1, 1] });
    expect(calls[0].cmds[1].name).toBe('erase');
    expect(calls[0].cmds[1].options).toEqual({ bbox: [0, 0, 1, 1] });
  });
});

// =========================================================================
// filterIslands
// =========================================================================

describe('filterIslands', () => {
  it('forwards minArea + minVertices + removeEmpty', async () => {
    const { ctx, calls } = makeStubCtx();
    const r = await filterIslands(ctx, {
      source: 's1',
      target: 'parks',
      minArea: 100,
      minVertices: 5,
      removeEmpty: true,
    });
    expect(r.ok).toBe(true);
    expect(calls[0].cmds[1]).toEqual({
      name: 'filter-islands',
      options: { min_area: '100', min_vertices: 5, remove_empty: true },
    });
  });

  it('rejects when neither minArea nor minVertices is supplied', async () => {
    const { ctx } = makeStubCtx();
    const r = await filterIslands(ctx, { source: 's1', target: 'parks' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('validation');
  });

  it('accepts minVertices alone', async () => {
    const { ctx, calls } = makeStubCtx();
    const r = await filterIslands(ctx, { source: 's1', target: 'parks', minVertices: 3 });
    expect(r.ok).toBe(true);
    expect(calls[0].cmds[1].options).toEqual({ min_vertices: 3 });
  });
});

// =========================================================================
// filterSlivers
// =========================================================================

describe('filterSlivers', () => {
  it('happy path with minArea', async () => {
    const { ctx, calls } = makeStubCtx();
    const r = await filterSlivers(ctx, { source: 's1', target: 'parks', minArea: 0.5 });
    expect(r.ok).toBe(true);
    expect(calls[0].cmds[1]).toEqual({
      name: 'filter-slivers',
      options: { min_area: '0.5' },
    });
  });

  it('forwards weighted flag', async () => {
    const { ctx, calls } = makeStubCtx();
    await filterSlivers(ctx, { source: 's1', target: 'parks', minArea: 1, weighted: true });
    expect(calls[0].cmds[1].options).toEqual({ min_area: '1', weighted: true });
  });

  it('rejects non-positive minArea', async () => {
    const { ctx } = makeStubCtx();
    const r1 = await filterSlivers(ctx, { source: 's1', target: 'parks', minArea: 0 });
    expect(r1.ok).toBe(false);
    const r2 = await filterSlivers(ctx, { source: 's1', target: 'parks', minArea: -1 });
    expect(r2.ok).toBe(false);
  });
});

// =========================================================================
// filterGeom
// =========================================================================

describe('filterGeom', () => {
  it('happy path', async () => {
    const { ctx, calls } = makeStubCtx();
    const r = await filterGeom(ctx, { source: 's1', target: 'parks', bbox: [0, 0, 10, 10] });
    expect(r.ok).toBe(true);
    expect(calls[0].cmds[1]).toEqual({
      name: 'filter-geom',
      options: { bbox: [0, 0, 10, 10] },
    });
  });

  it('rejects malformed bbox', async () => {
    const { ctx } = makeStubCtx();
    const r1 = await filterGeom(ctx, {
      source: 's1',
      target: 'parks',
      bbox: [0, 0, 0, 10],
    });
    expect(r1.ok).toBe(false);
    const r2 = await filterGeom(ctx, {
      source: 's1',
      target: 'parks',
      bbox: [0, 0, NaN, 10],
    });
    expect(r2.ok).toBe(false);
  });
});

// =========================================================================
// affineLayer
// =========================================================================

describe('affineLayer', () => {
  it('forwards shift / rotate / scale / anchor', async () => {
    const { ctx, calls } = makeStubCtx();
    const r = await affineLayer(ctx, {
      source: 's1',
      target: 'parks',
      shift: [10, 5],
      rotate: 45,
      scale: 2,
      anchor: [0, 0],
    });
    expect(r.ok).toBe(true);
    const c = calls[0].cmds[1];
    expect(c.name).toBe('affine');
    expect(c.options).toEqual({
      shift: ['10', '5'],
      rotate: 45,
      scale: 2,
      anchor: [0, 0],
    });
  });

  it('accepts non-uniform scale', async () => {
    const { ctx, calls } = makeStubCtx();
    await affineLayer(ctx, { source: 's1', target: 'parks', scale: [2, 3] });
    expect(calls[0].cmds[1].options).toEqual({ scale: [2, 3] });
  });

  it('omits target command when no target supplied (whole dataset)', async () => {
    const { ctx, calls } = makeStubCtx();
    await affineLayer(ctx, { source: 's1', shift: [1, 1] });
    expect(calls[0].cmds).toHaveLength(1);
    expect(calls[0].cmds[0].name).toBe('affine');
  });

  it('rejects when no transform component is supplied', async () => {
    const { ctx } = makeStubCtx();
    const r = await affineLayer(ctx, { source: 's1', target: 'parks' });
    expect(r.ok).toBe(false);
  });

  it('rejects identity scale/rotate as no-op', async () => {
    const { ctx } = makeStubCtx();
    const r = await affineLayer(ctx, { source: 's1', target: 'parks', scale: 1, rotate: 0 });
    expect(r.ok).toBe(false);
  });
});

// =========================================================================
// dataFill
// =========================================================================

describe('dataFill', () => {
  it('forwards field + weightField + contiguous', async () => {
    const { ctx, calls } = makeStubCtx();
    const r = await dataFill(ctx, {
      source: 's1',
      target: 'parks',
      field: 'region',
      weightField: 'area',
      contiguous: true,
    });
    expect(r.ok).toBe(true);
    expect(calls[0].cmds[1]).toEqual({
      name: 'data-fill',
      options: { field: 'region', weight_field: 'area', contiguous: true },
    });
  });

  it('rejects empty field', async () => {
    const { ctx } = makeStubCtx();
    const r = await dataFill(ctx, { source: 's1', target: 'parks', field: '' });
    expect(r.ok).toBe(false);
  });

  it('rejects field with comma or =', async () => {
    const { ctx } = makeStubCtx();
    const r1 = await dataFill(ctx, { source: 's1', target: 'parks', field: 'a,b' });
    expect(r1.ok).toBe(false);
    const r2 = await dataFill(ctx, { source: 's1', target: 'parks', field: 'a=b' });
    expect(r2.ok).toBe(false);
  });
});
