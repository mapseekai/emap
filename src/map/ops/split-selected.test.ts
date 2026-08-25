import { describe, expect, it } from 'vitest';
import { splitSelected } from './split-selected';
import { makeStubCtx } from './_test-helpers';

describe('splitSelected', () => {
  it('rejects an empty selection without dispatching a prepared mutation', async () => {
    const { ctx } = makeStubCtx();
    let dispatched = false;
    // This stub only reaches the selection read boundary.
    ctx.host._selection = { getAll: () => [] } as unknown as typeof ctx.host._selection;
    ctx.runPreparedDatasetMutation = async () => {
      dispatched = true;
      throw new Error('must not dispatch');
    };

    await expect(splitSelected(ctx, { cutter: { type: 'point', coordinates: [5, 0] } })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'selection' },
    });
    expect(dispatched).toBe(false);
  });

  it('rejects non-finite cutter coordinates without dispatching a prepared mutation', async () => {
    const { ctx } = makeStubCtx();
    let dispatched = false;
    // These stubs only reach pre-dispatch validation boundaries.
    ctx.host._selection = {
      getAll: () => [{ source: 's1', layer: 'parks', id: 0 }],
    } as unknown as typeof ctx.host._selection;
    ctx.host.layers = {
      resolve: () => ({ geometry_type: 'polyline', shapes: [[[0]]] }),
    } as unknown as typeof ctx.host.layers;
    ctx.runPreparedDatasetMutation = async () => {
      dispatched = true;
      throw new Error('must not dispatch');
    };

    await expect(splitSelected(ctx, { cutter: { type: 'point', coordinates: [Number.NaN, 0] } })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'cutter' },
    });
    expect(dispatched).toBe(false);
  });
});
