import { describe, expect, it, vi } from 'vitest';
import { DuckDbRuntimeScope } from './runtime-scope';
import type { DuckDbRuntime } from './runtime';

describe('DuckDbRuntimeScope', () => {
  it('propagates factory failures even when their message resembles disposal', async () => {
    const failure = new Error('backend failed: disposed during initialization: I/O failure');
    const creation = Promise.withResolvers<DuckDbRuntime>();
    const scope = new DuckDbRuntimeScope({ create: () => creation.promise });
    const pending = scope.get();
    const disposed = scope.dispose();
    const initializationFailure = expect(pending).rejects.toBe(failure);
    const disposalFailure = expect(disposed).rejects.toBe(failure);
    creation.reject(failure);
    await Promise.all([initializationFailure, disposalFailure]);
  });

  it('suppresses only its own disposal error after closing a late runtime', async () => {
    const creation = Promise.withResolvers<DuckDbRuntime>();
    const close = vi.fn(() => Promise.resolve());
    const scope = new DuckDbRuntimeScope({ create: () => creation.promise });
    const pending = scope.get();
    const disposed = scope.dispose();
    const initializationFailure = expect(pending).rejects.toThrow('disposed');
    creation.resolve({ connect: vi.fn(), ensureSpatial: vi.fn(), close });
    await initializationFailure;
    await disposed;
    expect(close).toHaveBeenCalledOnce();
  });
});
