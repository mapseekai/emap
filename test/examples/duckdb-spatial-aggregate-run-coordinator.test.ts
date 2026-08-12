import { describe, expect, it, vi } from 'vitest';
import {
  createDuckDbSpatialAggregateRunCoordinator,
  executeDuckDbSpatialAggregateQuery,
  removeDuckDbSpatialAggregateSource,
} from '../../packages/examples/src/duckdb-spatial-aggregate-run-coordinator';

function createDeferred<T>() {
  let resolve: (value: T) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    reject: (reason?: unknown) => reject!(reason),
    resolve: (value: T) => resolve!(value),
  };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness() {
  let inputGeneration = 0;
  const coordinator = createDuckDbSpatialAggregateRunCoordinator(() => inputGeneration);
  return {
    coordinator,
    invalidateInput() {
      inputGeneration += 1;
      coordinator.invalidateRuns();
    },
  };
}

class PendingSourceMap {
  private readonly layers: Array<{ id: string; source: string }> = [];
  private readonly sources = new Map<string, string>();
  private readonly pending = new Map<string, symbol>();

  getLayers() {
    return this.layers;
  }

  removeLayer(id: string) {
    const index = this.layers.findIndex((layer) => layer.id === id);
    if (index >= 0) this.layers.splice(index, 1);
  }

  removeSource(id: string) {
    this.pending.delete(id);
    this.sources.delete(id);
  }

  async addSource(id: string, source: string, preparation: Promise<void> = Promise.resolve()) {
    if (this.sources.has(id) || this.pending.has(id)) {
      throw new Error(`source-id-conflict: ${id}`);
    }
    const token = Symbol(id);
    this.pending.set(id, token);
    try {
      await preparation;
      if (this.pending.get(id) !== token) throw new Error(`source-load-cancelled: ${id}`);
      this.sources.set(id, source);
    } finally {
      if (this.pending.get(id) === token) this.pending.delete(id);
    }
  }

  getSource(id: string) {
    return this.sources.get(id);
  }
}

describe('DuckDB spatial aggregate example run coordinator', () => {
  it('does not execute, register, publish, error, or finish after input changes during runtime acquisition', async () => {
    const { coordinator, invalidateInput } = createHarness();
    const runtime = createDeferred<string>();
    const execute = vi.fn();
    const register = vi.fn();
    const publish = vi.fn();
    const publishError = vi.fn();
    const finish = vi.fn();

    const run = coordinator.run({
      getRuntime: () => runtime.promise,
      execute,
      register,
      publish,
      publishError,
      finish,
    });
    invalidateInput();
    runtime.resolve('runtime');
    await run;

    expect(execute).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(publishError).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  it.each([
    'helper',
    'mapop',
  ] as const)('runs the actual %s query branch inside the coordinator and discards its stale result', async (entrypoint) => {
    const { coordinator, invalidateInput } = createHarness();
    const query = createDeferred<string>();
    const discardResult = vi.fn();
    const register = vi.fn();
    const publish = vi.fn();
    const runHelper = vi.fn(() => query.promise);
    const runMapOp = vi.fn(async () => ({
      ok: true as const,
      value: { dataset: await query.promise },
    }));

    const run = coordinator.run({
      getRuntime: async () => 'runtime',
      execute: () => executeDuckDbSpatialAggregateQuery({ entrypoint, runHelper, runMapOp }),
      discardResult,
      register,
      publish,
    });
    await flushAsyncWork();
    invalidateInput();
    query.resolve(`${'result'}`);
    await run;

    expect(discardResult).toHaveBeenCalledWith('result');
    expect(register).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    if (entrypoint === 'helper') {
      expect(runHelper).toHaveBeenCalledOnce();
      expect(runMapOp).not.toHaveBeenCalled();
    } else {
      expect(runMapOp).toHaveBeenCalledOnce();
      expect(runHelper).not.toHaveBeenCalled();
    }
  });

  it('cancels a pending Map source commit before the next aggregate output uses its id', async () => {
    const map = new PendingSourceMap();
    const firstPreparation = createDeferred<void>();
    const firstRegistration = map.addSource(
      'duckdb-aggregate-output',
      'first',
      firstPreparation.promise,
    );
    await flushAsyncWork();

    await expect(map.addSource('duckdb-aggregate-output', 'second')).rejects.toThrow(
      'source-id-conflict',
    );

    removeDuckDbSpatialAggregateSource(map, 'duckdb-aggregate-output');
    await expect(map.addSource('duckdb-aggregate-output', 'second')).resolves.toBeUndefined();
    expect(map.getSource('duckdb-aggregate-output')).toBe('second');

    firstPreparation.resolve();
    await expect(firstRegistration).rejects.toThrow('source-load-cancelled');
    expect(map.getSource('duckdb-aggregate-output')).toBe('second');
  });

  it('lets a newer run replace an older pending source registration with the same id', async () => {
    const { coordinator } = createHarness();
    const map = new PendingSourceMap();
    const firstPreparation = createDeferred<void>();
    const publish = vi.fn();

    const run = (source: string, preparation: Promise<void>) =>
      coordinator.run({
        getRuntime: async () => 'runtime',
        execute: async () => source,
        register: async (dataset) => {
          removeDuckDbSpatialAggregateSource(map, 'duckdb-aggregate-output');
          await map.addSource('duckdb-aggregate-output', dataset, preparation);
          return {
            source: dataset,
            cleanup: () => {
              if (map.getSource('duckdb-aggregate-output') === dataset) {
                removeDuckDbSpatialAggregateSource(map, 'duckdb-aggregate-output');
              }
            },
          };
        },
        publish,
      });

    const firstRun = run('first', firstPreparation.promise);
    await flushAsyncWork();
    await run('second', Promise.resolve());

    expect(map.getSource('duckdb-aggregate-output')).toBe('second');
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset: 'second',
        registration: expect.objectContaining({ source: 'second' }),
      }),
    );

    firstPreparation.resolve();
    await firstRun;

    expect(map.getSource('duckdb-aggregate-output')).toBe('second');
    expect(publish).toHaveBeenCalledOnce();
  });

  it('cleans only a stale registration while a newer run publishes its own output', async () => {
    const { coordinator, invalidateInput } = createHarness();
    const oldRegistration = createDeferred<{ source: string; cleanup: () => void }>();
    const oldCleanup = vi.fn();
    const newCleanup = vi.fn();
    const publish = vi.fn();

    const oldRun = coordinator.run({
      getRuntime: async () => 'runtime',
      execute: async () => 'old-result',
      register: async () => oldRegistration.promise,
      publish,
    });
    await flushAsyncWork();
    invalidateInput();
    const newRun = coordinator.run({
      getRuntime: async () => 'runtime',
      execute: async () => 'new-result',
      register: async () => ({ source: 'new-source', cleanup: newCleanup }),
      publish,
    });
    await newRun;

    oldRegistration.resolve({ source: 'old-source', cleanup: oldCleanup });
    await oldRun;

    expect(oldCleanup).toHaveBeenCalledOnce();
    expect(newCleanup).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset: 'new-result',
        registration: expect.objectContaining({ source: 'new-source' }),
      }),
    );
  });

  it('suppresses stale rejection status and finish while retaining current rejection handling', async () => {
    const { coordinator, invalidateInput } = createHarness();
    const staleQuery = createDeferred<string>();
    const staleError = vi.fn();
    const staleFinish = vi.fn();

    const staleRun = coordinator.run({
      getRuntime: async () => 'runtime',
      execute: () => staleQuery.promise,
      register: vi.fn(),
      publish: vi.fn(),
      publishError: staleError,
      finish: staleFinish,
    });
    await flushAsyncWork();
    invalidateInput();
    staleQuery.reject(new Error('stale failure'));
    await staleRun;

    expect(staleError).not.toHaveBeenCalled();
    expect(staleFinish).not.toHaveBeenCalled();

    const currentError = vi.fn();
    const currentFinish = vi.fn();
    await coordinator.run({
      getRuntime: async () => 'runtime',
      execute: async () => {
        throw new Error('current failure');
      },
      register: vi.fn(),
      publish: vi.fn(),
      publishError: currentError,
      finish: currentFinish,
    });

    expect(currentError).toHaveBeenCalledOnce();
    expect(currentFinish).toHaveBeenCalledOnce();
  });

  it('lets only a newer run publish when inputs do not change', async () => {
    const { coordinator } = createHarness();
    const oldQuery = createDeferred<string>();
    const publish = vi.fn();

    const oldRun = coordinator.run({
      getRuntime: async () => 'runtime',
      execute: () => oldQuery.promise,
      register: vi.fn(),
      publish,
    });
    await flushAsyncWork();
    const newRun = coordinator.run({
      getRuntime: async () => 'runtime',
      execute: async () => 'new-result',
      register: async () => ({ source: 'new-source', cleanup: vi.fn() }),
      publish,
    });
    await newRun;
    oldQuery.resolve('old-result');
    await oldRun;

    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ dataset: 'new-result' }));
  });
});
