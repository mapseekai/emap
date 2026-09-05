import { describe, expect, it, vi } from 'vitest';
import { EventDispatcher } from './events';

describe('event names are own dictionary keys', () => {
  it.each([
    'constructor',
    'toString',
    'hasOwnProperty',
    '__proto__',
  ])('%s supports on/off/once', (name) => {
    const events = new EventDispatcher();
    const listener = vi.fn();
    expect(() => events.fire(name).off(name, listener)).not.toThrow();
    events.on(name, listener).fire(name, { value: 1 });
    expect(listener).toHaveBeenCalledWith({ type: name, value: 1 });
    events.off(name, listener).fire(name);
    expect(listener).toHaveBeenCalledTimes(1);
    const once = vi.fn(() => events.fire(name));
    events.once(name, once).fire(name).fire(name);
    expect(once).toHaveBeenCalledTimes(1);
  });
});
