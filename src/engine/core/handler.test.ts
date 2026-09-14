// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { Handler, HandlerResult, NormalizedPointerEvent } from './handler';
import { isHandler } from './handler';

describe('Handler contract', () => {
  it('isHandler accepts a conforming object and rejects a non-conforming one', () => {
    const ok: Handler = {
      name: 'noop',
      enable() {},
      disable() {},
      isEnabled: () => true,
      setOptions() {},
      getOptions: () => ({}),
      handlePointer: () => 'passthrough' as HandlerResult,
    };
    expect(isHandler(ok)).toBe(true);
    expect(isHandler({ name: 'bad' })).toBe(false);
    expect(isHandler(null)).toBe(false);
    expect(isHandler('not an object')).toBe(false); // primitive branch
    expect(isHandler({ ...ok, handlePointer: 42 })).toBe(false); // wrong member type
  });

  it('NormalizedPointerEvent shape is usable', () => {
    const ev: NormalizedPointerEvent = {
      kind: 'down',
      point: { x: 1, y: 2 },
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      button: 0,
      originalEvent: new MouseEvent('mousedown'),
    };
    expect(ev.point.x).toBe(1);
  });
});
