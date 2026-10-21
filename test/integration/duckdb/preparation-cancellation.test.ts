import { describe, expect, it, vi } from 'vitest';
import { createPolygonDrawing } from '../../utils/drawn-polygon';
import { getDefaultMapshaperAdapter } from '../../../src/integrations/mapshaper/adapter';
import type { PathShape } from '../../../src/shared/types/mapshaper-types';
import { intersect } from '../../../src/integrations/duckdb/overlay/intersect';
import { union } from '../../../src/integrations/duckdb/overlay/union';
import { spatialFilter } from '../../../src/integrations/duckdb/selection/spatial-filter';

describe('DuckDB cancellation during geometry preparation', () => {
  it.each([
    'intersect',
    'union',
    'spatialFilter',
  ] as const)('%s preserves cancellation before converting a legacy wrong-winding mask', async (operation) => {
    const { source, draw } = await createPolygonDrawing();
    draw([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    const good = source.getDataset()!;
    const bad = getDefaultMapshaperAdapter().copyDataset(good);
    bad.layers[0]!.shapes![0] = (bad.layers[0]!.shapes![0] as PathShape).map((part) =>
      part
        .slice()
        .reverse()
        .map((id) => ~id),
    );
    const runtime = { ensureSpatial: vi.fn(), connect: vi.fn() };
    const controller = new AbortController();
    const reason = new Error('cancel during CRS alignment');
    const pending =
      operation === 'intersect'
        ? intersect(good, bad, { signal: controller.signal }, runtime)
        : operation === 'union'
          ? union(good, bad, { signal: controller.signal }, runtime)
          : spatialFilter(
              good,
              bad,
              { predicate: 'intersects', signal: controller.signal },
              runtime,
            );
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(runtime.ensureSpatial).not.toHaveBeenCalled();
    expect(runtime.connect).not.toHaveBeenCalled();
  });
});
