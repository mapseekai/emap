import { afterEach, describe, expect, it, vi } from 'vitest';
import { RasterPresentationQueue } from './presentation';

afterEach(() => vi.useRealTimers());
describe('time-bounded progressive presentation', () => {
  it('presents a short group without waiting for unfinished siblings', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const queue = new RasterPresentationQueue(60, flush);
    queue.add('a');
    vi.advanceTimersByTime(20);
    queue.add('b');
    queue.add('b');
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40);
    expect(flush).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
    queue.add('slow');
    vi.advanceTimersByTime(60);
    expect(flush).toHaveBeenLastCalledWith(['slow']);
    queue.dispose();
  });
  it('flushes completed batches immediately and does not leave a timer', () => {
    vi.useFakeTimers();
    const flush = vi.fn(),
      queue = new RasterPresentationQueue(60, flush);
    queue.add('a');
    queue.add('b', true);
    expect(flush).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
    expect(vi.getTimerCount()).toBe(0);
    queue.dispose();
  });
  it('drops stale keys on cancellation and never calls consumers after dispose', () => {
    vi.useFakeTimers();
    const flush = vi.fn(),
      queue = new RasterPresentationQueue(60, flush);
    queue.add('old');
    queue.clear();
    vi.advanceTimersByTime(100);
    expect(flush).not.toHaveBeenCalled();
    queue.add('next');
    queue.dispose();
    queue.add('late');
    vi.advanceTimersByTime(100);
    expect(flush).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('supports immediate presentation for low-latency callers', () => {
    const flush = vi.fn(),
      queue = new RasterPresentationQueue(0, flush);
    queue.add('a');
    expect(flush).toHaveBeenCalledExactlyOnceWith(['a']);
    queue.dispose();
  });
});
