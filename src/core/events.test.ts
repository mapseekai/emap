import { describe, expect, it, vi } from 'vitest';
import { EventDispatcher } from './events';

describe('EventDispatcher listener failures', () => {
  it('reports a listener failure and continues the original event delivery', () => {
    const dispatcher = new EventDispatcher();
    const failure = new Error('listener failed');
    const delivered = vi.fn();
    const reported = vi.fn();
    dispatcher.on('change', () => {
      throw failure;
    });
    dispatcher.on('change', delivered);
    dispatcher.on<{ error: unknown }>('error', reported);

    expect(() => dispatcher.fire('change')).not.toThrow();

    expect(delivered).toHaveBeenCalledTimes(1);
    expect(reported).toHaveBeenCalledWith({ type: 'error', error: failure });
  });

  it('continues error delivery when an error listener also throws', () => {
    const dispatcher = new EventDispatcher();
    const delivered = vi.fn();
    dispatcher.on<{ error: unknown }>('error', () => {
      throw new Error('error listener failed');
    });
    dispatcher.on<{ error: unknown }>('error', delivered);

    expect(() => dispatcher.fire('error', { error: new Error('reported failure') })).not.toThrow();

    expect(delivered).toHaveBeenCalledTimes(1);
  });
});

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
