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
