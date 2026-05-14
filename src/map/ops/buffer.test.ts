// Unit tests for bufferLayer — parameter passthrough, polygon-type
// warning, and validation rejects.

import { describe, expect, it, vi } from 'vitest';
import { bufferLayer } from './buffer';
import { makeStubCtx } from './_test-helpers';

describe('bufferLayer — parameter passthrough', () => {
  it('forwards every new option as snake_case keys', async () => {
    // type=outer on the default polygon layer triggers a polyline-only warn;
    // silence it since this test is about passthrough, not warning behaviour.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { ctx, calls } = makeStubCtx();
    const r = await bufferLayer(ctx, {
      source: 's1',
      target: 'parks',
      radius: 100,
      capStyle: 'flat',
      vertices: 36,
      arcQuality: 4,
      tolerance: 0.5,
      type: 'outer',
      planar: true,
      v2: true,
      sliceLength: 1024,
      backtrack: 8,
    });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const bufferCmd = calls[0].cmds.find((c) => c.name === 'buffer')!;
    expect(bufferCmd.options).toEqual({
      radius: '100',
      cap_style: 'flat',
      vertices: 36,
      arc_quality: 4,
      tolerance: 0.5,
      type: 'outer',
      planar: true,
      v2: true,
      slice_length: 1024,
      backtrack: 8,
    });
    warn.mockRestore();
  });

  it('emits exactly target + buffer (no dissolve2)', async () => {
    const { ctx, calls } = makeStubCtx();
    await bufferLayer(ctx, { source: 's1', target: 'parks', radius: 50 });
    expect(calls[0].cmds.map((c) => c.name)).toEqual(['target', 'buffer']);
    expect(calls[0].label).toBe('Buffer parks');
  });
});

describe('bufferLayer — type warning on polygon', () => {
  it('warns (but does not reject) when type is set on a polygon layer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { ctx, calls } = makeStubCtx([{ name: 'parks', geometry_type: 'polygon' }]);
    const r = await bufferLayer(ctx, {
      source: 's1', target: 'parks', radius: 50, type: 'outer',
    });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/type="outer".*polyline.*polygon layer "parks"/);
    warn.mockRestore();
  });

  it('does not warn when type is set on a polyline layer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { ctx } = makeStubCtx([{ name: 'roads', geometry_type: 'polyline' }]);
    const r = await bufferLayer(ctx, {
      source: 's1', target: 'roads', radius: 50, type: 'outer',
    });
    expect(r.ok).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not warn when type is omitted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { ctx } = makeStubCtx();
    await bufferLayer(ctx, { source: 's1', target: 'parks', radius: 50 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('bufferLayer — validation', () => {
  it.each([
    ['radius', { radius: 0 }],
    ['radius', { radius: -1 }],
    ['radius', { radius: Infinity }],
    ['radius', { radius: '' }],
    ['radius', { radius: '0' }],
    ['radius', { radius: '-5' }],
    ['type', { type: 'sideways' as any }],
    ['capStyle', { capStyle: 'square' as any }],
    ['vertices', { vertices: 0 }],
    ['vertices', { vertices: 1.5 }],
    ['arcQuality', { arcQuality: -1 }],
    ['tolerance', { tolerance: -0.1 }],
    ['sliceLength', { sliceLength: 0 }],
    ['backtrack', { backtrack: 1.2 }],
  ])('rejects %s with bad value and does not dispatch', async (field, override) => {
    const { ctx, calls } = makeStubCtx();
    const r = await bufferLayer(ctx, {
      source: 's1', target: 'parks', radius: 50,
      ...(override as Partial<import('../types').BufferOptions>),
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'validation') {
      expect(r.error.field).toBe(field);
    } else {
      throw new Error(`expected validation error, got ${JSON.stringify(r)}`);
    }
    expect(calls).toHaveLength(0);
  });

  it('returns expression-disabled when radius is a string and eval is off', async () => {
    const { ctx, calls } = makeStubCtx();
    (ctx.host as any)._allowExpressionEvaluation = () => false;
    const r = await bufferLayer(ctx, { source: 's1', target: 'parks', radius: 'this.x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('expression-disabled');
    expect(calls).toHaveLength(0);
  });

  it('does not include unset optional keys in the ParsedCommand options', async () => {
    const { ctx, calls } = makeStubCtx();
    await bufferLayer(ctx, { source: 's1', target: 'parks', radius: 50 });
    const bufferCmd = calls[0].cmds.find((c) => c.name === 'buffer')!;
    expect(bufferCmd.options).toEqual({ radius: '50' });
  });
});
