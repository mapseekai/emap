import { describe, expect, it, vi } from 'vitest';
import { awaitWithSignal } from './await-with-signal';

describe('detachable cancelled await', () => {
  it('forwards a result and removes its abort listener', async () => {
    const controller = new AbortController(),
      remove = vi.spyOn(controller.signal, 'removeEventListener');
    expect(await awaitWithSignal(Promise.resolve(42), controller.signal)).toBe(42);
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it('releases a waiter even if the producer never settles', async () => {
    const controller = new AbortController();
    const operation = awaitWithSignal(new Promise(() => {}), controller.signal);
    const failure = expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await failure;
  });
  it.each([
    null,
    false,
    0,
    'cancelled',
  ])('preserves the explicit abort reason %j', async (reason) => {
    for (const alreadyAborted of [false, true]) {
      const controller = new AbortController();
      if (alreadyAborted) controller.abort(reason);
      const operation = awaitWithSignal(new Promise<never>(() => {}), controller.signal);
      const failure = expect(operation).rejects.toBe(reason);
      if (!alreadyAborted) controller.abort(reason);
      await failure;
    }
  });
  it('consumes late errors without reactivating an aborted consumer', async () => {
    const controller = new AbortController();
    let reject!: (reason: unknown) => void;
    const pending = new Promise((_, fail) => {
      reject = fail;
    });
    const operation = awaitWithSignal(pending, controller.signal);
    const failure = expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await failure;
    reject(new Error('late failure'));
    await Promise.resolve();
  });
  it('handles an already aborted signal and a producer failure', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      awaitWithSignal(Promise.reject(new Error('late')), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      awaitWithSignal(Promise.reject(new Error('source failed')), new AbortController().signal),
    ).rejects.toThrow('source failed');
  });
});
