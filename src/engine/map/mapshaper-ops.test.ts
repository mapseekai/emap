import { describe, expect, it, vi } from 'vitest';
import { Emap } from './map';
import * as filterFieldOps from './ops/filter-fields';

describe('MapshaperOps context lifecycle', () => {
  it('reuses its operation context across real dispatches', async () => {
    const dispatch = vi.spyOn(filterFieldOps, 'filterFields');
    const map = await Emap.create({ preset: 'headless' });
    try {
      const options = { source: 'missing', target: 'missing', fields: ['name'] };
      for (let i = 0; i < 2; i++) {
        await expect(map.ops.filterFields(options)).resolves.toMatchObject({
          ok: false,
          error: { kind: 'not-found' },
        });
      }
      expect(dispatch).toHaveBeenCalledTimes(2);
      const first = dispatch.mock.calls[0]![0];
      expect(first.host._sources).toBe(map.ctx.document._sources);
      expect(first.runDatasetCommandParsed).toBeTypeOf('function');
      expect(dispatch.mock.calls[1]![0]).toBe(first);
    } finally {
      await map.dispose();
      dispatch.mockRestore();
    }
  });
});
