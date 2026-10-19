import { describe, expect, it, vi } from 'vitest';
import { createEditHandlerFixture } from './edit-handler-host';

describe('createEditHandlerFixture', () => {
  it('uses native selection and event services', () => {
    const host = createEditHandlerFixture();
    const listener = vi.fn();
    const ref = { source: 's', layer: 'l', id: 0 };
    host.on('change', listener);
    host.fire('change', { value: 1 });
    host.off('change', listener);
    host.fire('change', { value: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
    host.select([ref]);
    expect(host.isSelected(ref)).toBe(true);
    expect(host.getSelection()).toEqual([ref]);
  });

  it('preserves dataset and arc identity while completing vertex contracts', () => {
    const vertices = {
      nn: new Uint32Array([2]),
      xx: new Float64Array([0, 1]),
      yy: new Float64Array([0, 1]),
      ii: new Uint32Array([0]),
    };
    const arcs = { getVertexData: () => vertices, getVertex2: () => [0, 1] };
    const dataset = { arcs };
    const source = { getArcs: () => arcs, getDataset: () => dataset };
    const host = createEditHandlerFixture({ getSource: () => source });
    const completed = host.getSource('s');
    expect(host.getSource('s')).toBe(completed);
    expect(completed?.getDataset()).toBe(dataset);
    expect(completed?.getDataset()?.layers).toEqual([]);
    expect(completed?.getArcs()).toBe(arcs);
    expect(completed?.getArcs()?.size()).toBe(1);
    expect(completed?.getArcs()?.getVertexData?.()).toEqual({
      ...vertices,
      zz: null,
      bb: undefined,
    });
    expect(completed?.getArcs()?.getVertex2?.(0)).toEqual([0, 1]);
    expect(completed?.getDataset()).toBe(dataset);
  });

  it('rejects malformed vertices and unconfigured arc iteration', () => {
    const host = createEditHandlerFixture({
      getSource: () => ({ getArcs: () => ({ getVertex2: () => [1] }) }),
    });
    const arcs = host.getSource('s')?.getArcs();
    expect(() => arcs?.getVertex2?.(0)).toThrow('Expected a two-coordinate fixture vertex');
    expect(() => arcs?.getArcIter(0)).toThrow('Arc iteration is not configured');
  });
});
