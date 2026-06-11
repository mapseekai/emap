import { describe, expect, it } from 'vitest';
import { DuckDbOperationError, getDuckDbRuntime, setDuckDbRuntime, type DuckDbRuntime } from './index';

describe('DuckDB runtime injection', () => {
  it('stores and clears an injected runtime', async () => {
    const runtime: DuckDbRuntime = {
      connect: async () => ({
        insertArrowTable: async () => undefined,
        query: async () => {
          throw new Error('not used');
        },
      }),
      ensureSpatial: async () => undefined,
    };

    setDuckDbRuntime(runtime);
    expect(getDuckDbRuntime()).toBe(runtime);

    setDuckDbRuntime(null);
    expect(getDuckDbRuntime()).toBeNull();
  });

  it('exposes typed DuckDB operation errors', () => {
    const cause = new Error('inner');
    const err = new DuckDbOperationError('validation', 'bad distance', {
      cause,
      field: 'distance',
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('DuckDbOperationError');
    expect(err.kind).toBe('validation');
    expect(err.field).toBe('distance');
    expect(err.cause).toBe(cause);
  });
});
