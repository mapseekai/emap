import { describe, expect, it } from 'vitest';
import { dissolveLayer } from '../../../src/engine/map/ops/dissolve';
import { divideLayer } from '../../../src/engine/map/ops/divide';
import { filterFields } from '../../../src/engine/map/ops/filter-fields';
import { joinTable } from '../../../src/engine/map/ops/join-table';
import { linesLayer } from '../../../src/engine/map/ops/lines';
import { unionLayers } from '../../../src/engine/map/ops/union';
import { makeStubCtx } from '../../utils/map-ops';

function expectValidation(result: Awaited<ReturnType<typeof dissolveLayer>>): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.kind).toBe('validation');
}

describe('op field list validation', () => {
  it.each([
    '',
    0,
    false,
    {},
    { length: 0 },
  ])('rejects malformed optional field lists %j in every shared-validator caller', async (value) => {
    const { ctx, calls } = makeStubCtx([
      { name: 'parks', geometry_type: 'polygon' },
      { name: 'districts', geometry_type: 'polygon' },
      { name: 'roads', geometry_type: 'polyline' },
    ]);
    const fields = value as never;
    const results = await Promise.all([
      dissolveLayer(ctx, { source: 's1', target: 'parks', fields }),
      dissolveLayer(ctx, { source: 's1', target: 'parks', sumFields: fields }),
      dissolveLayer(ctx, { source: 's1', target: 'parks', copyFields: fields }),
      linesLayer(ctx, { source: 's1', target: 'parks', fields }),
      joinTable(ctx, {
        source: 's1',
        target: 'parks',
        data: { csv: 'id,pop\n1,2\n' },
        keys: ['id', 'id'],
        fields,
      }),
      unionLayers(ctx, { source: 's1', targets: ['parks', 'districts'], fields }),
      divideLayer(ctx, { source: 's1', target: 'roads', divider: 'parks', fields }),
    ]);
    for (const result of results) expectValidation(result);
    expect(calls).toHaveLength(0);
  });

  it.each([
    { label: 'omitted', value: undefined },
    { label: 'null', value: null },
    { label: 'empty', value: [] },
  ])('preserves $label optional field lists', async ({ value }) => {
    const { ctx, calls } = makeStubCtx([
      { name: 'parks', geometry_type: 'polygon' },
      { name: 'districts', geometry_type: 'polygon' },
      { name: 'roads', geometry_type: 'polyline' },
    ]);
    const fields = value as never;
    const results = await Promise.all([
      dissolveLayer(ctx, { source: 's1', target: 'parks', fields }),
      linesLayer(ctx, { source: 's1', target: 'parks', fields }),
      joinTable(ctx, {
        source: 's1',
        target: 'parks',
        data: { csv: 'id,pop\n1,2\n' },
        keys: ['id', 'id'],
        fields,
      }),
      unionLayers(ctx, { source: 's1', targets: ['parks', 'districts'], fields }),
      divideLayer(ctx, { source: 's1', target: 'roads', divider: 'parks', fields }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.cmds[1].options).not.toHaveProperty('fields');
    }
  });

  it('keeps the filterFields wildcard selector separate from ordinary field names', async () => {
    const { ctx, calls } = makeStubCtx();
    const result = await filterFields(ctx, { source: 's1', target: 'parks', fields: ['*'] });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].cmds[1]).toMatchObject({
      name: 'filter-fields',
      options: { fields: ['*'] },
    });
  });

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
