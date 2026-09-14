import { describe, expect, it } from 'vitest';
import { MapshaperOps } from './mapshaper-ops';
import type { EmapHostInternal } from './emap-host';

describe('MapshaperOps context lifecycle', () => {
  it('reuses one operation context per facade instance', () => {
    const ops = new MapshaperOps({} as EmapHostInternal);
    const first = Reflect.get(ops, '_ctx');
    const second = Reflect.get(ops, '_ctx');

    expect(first).toBe(second);
  });

  it('does not share a context between facade instances', () => {
    const host = {} as EmapHostInternal;
    const first = new MapshaperOps(host);
    const second = new MapshaperOps(host);

    expect(Reflect.get(first, '_ctx')).not.toBe(Reflect.get(second, '_ctx'));
  });
});
