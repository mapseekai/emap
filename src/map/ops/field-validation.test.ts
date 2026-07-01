import { describe, expect, it } from 'vitest';
import { dissolveLayer } from './dissolve';
import { divideLayer } from './divide';
import { joinTable } from './join-table';
import { linesLayer } from './lines';
import { unionLayers } from './union';
import { makeStubCtx } from './_test-helpers';

function expectValidation(result: Awaited<ReturnType<typeof dissolveLayer>>): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.kind).toBe('validation');
}

describe('op field list validation', () => {
  it('dissolveLayer rejects invalid group, sum, and copy fields before dispatch', async () => {
    for (const opts of [
      { fields: ['region,name'] },
      { sumFields: ['pop=2020'] },
      { copyFields: [''] },
    ]) {
      const { ctx, calls } = makeStubCtx();
      const result = await dissolveLayer(ctx, { source: 's1', target: 'parks', ...opts });
      expectValidation(result);
      expect(calls).toHaveLength(0);
    }
  });

  it('linesLayer rejects invalid fields before dispatch', async () => {
    const { ctx, calls } = makeStubCtx([{ name: 'parks', geometry_type: 'polygon' }]);
    const result = await linesLayer(ctx, { source: 's1', target: 'parks', fields: ['a,b'] });
    expectValidation(result);
    expect(calls).toHaveLength(0);
  });

  it('joinTable rejects invalid fields before dispatch', async () => {
    const { ctx, calls } = makeStubCtx();
    const result = await joinTable(ctx, {
      source: 's1',
      target: 'parks',
      data: { csv: 'id,pop\n1,2\n' },
      keys: ['id', 'id'],
      fields: ['pop=bad'],
    });
    expectValidation(result);
    expect(calls).toHaveLength(0);
  });

  it('unionLayers rejects invalid fields before dispatch', async () => {
    const { ctx, calls } = makeStubCtx([
      { name: 'a', geometry_type: 'polygon' },
      { name: 'b', geometry_type: 'polygon' },
    ]);
    const result = await unionLayers(ctx, {
      source: 's1',
      targets: ['a', 'b'],
      fields: ['bad,field'],
    });
    expectValidation(result);
    expect(calls).toHaveLength(0);
  });

  it('divideLayer rejects invalid fields before dispatch', async () => {
    const { ctx, calls } = makeStubCtx([
      { name: 'roads', geometry_type: 'polyline' },
      { name: 'districts', geometry_type: 'polygon' },
    ]);
    const result = await divideLayer(ctx, {
      source: 's1',
      target: 'roads',
      divider: 'districts',
      fields: ['bad,field'],
    });
    expectValidation(result);
    expect(calls).toHaveLength(0);
  });
});
