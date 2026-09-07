import { describe, expect, it } from 'vitest';
import type { MapshaperDataset } from '../types/mapshaper-types';
import {
  duckDbGeoParquetQueryLayer,
  type DuckDbMapOpContext,
  type DuckDbMapOpSource,
} from './map-operations';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  const queries: ReturnType<typeof deferred<MapshaperDataset>>[] = [];
  const input: MapshaperDataset = { layers: [], editVersion: 0, attributeVersion: 0 };
  const output: MapshaperDataset = { layers: [] };
  let bytes = new Uint8Array([1]);
  const querySource = {
    query() {
      const pending = deferred<MapshaperDataset>();
      queries.push(pending);
      return pending.promise;
    },
    async close() {},
  };
  const source: DuckDbMapOpSource = {
    getDataset: () => input,
    getBytes: () => bytes,
    getGeoParquetQuerySource: () => querySource,
  };
  const sources = new Map<string, DuckDbMapOpSource>([['input', source]]);
  const writes: MapshaperDataset[] = [];
  const context: DuckDbMapOpContext = {
    getSource: (id) => sources.get(id),
    setSourceDataset(id, dataset) {
      writes.push(dataset);
      sources.set(id, { getDataset: () => dataset });
    },
  };
  const run = (destination = 'output') =>
    duckDbGeoParquetQueryLayer(context, {
      src: 'input',
      output: { sourceId: destination },
      sql: 'SELECT * FROM input',
    });
  return {
    input,
    output,
    source,
    sources,
    writes,
    context,
    queries,
    run,
    replaceBytes() {
      bytes = new Uint8Array([2]);
    },
  };
}

describe('DuckDB map adapter stale-result protection', () => {
  it.each([
    'source replacement',
    'source removal',
    'geometry edit',
    'attribute edit',
    'byte replacement',
    'output creation',
  ])('rejects writeback after %s', async (change) => {
    const state = setup();
    const pending = state.run();
    if (change === 'source replacement')
      state.sources.set('input', { getDataset: () => state.input });
    if (change === 'source removal') state.sources.delete('input');
    if (change === 'geometry edit') state.input.editVersion! += 1;
    if (change === 'attribute edit') state.input.attributeVersion! += 1;
    if (change === 'byte replacement') state.replaceBytes();
    if (change === 'output creation')
      state.sources.set('output', { getDataset: () => state.output });
    state.queries[0]!.resolve(state.output);
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'stale-operation' } });
    expect(state.writes).toEqual([]);
  });

  it('rejects edits to an existing output dataset', async () => {
    const state = setup();
    state.sources.set('output', { getDataset: () => state.output });
    const pending = state.run();
    state.output.attributeVersion = 1;
    state.queries[0]!.resolve({ layers: [] });
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'stale-operation' } });
    expect(state.writes).toEqual([]);
  });

  it('allows an unchanged source to be its own explicit output', async () => {
    const state = setup();
    const pending = state.run('input');
    state.queries[0]!.resolve(state.output);
    expect(await pending).toMatchObject({ ok: true });
    expect(state.writes).toEqual([state.output]);
  });

  it('rejects in-place output when input changed during the query', async () => {
    const state = setup();
    const pending = state.run('input');
    state.input.attributeVersion = 1;
    state.queries[0]!.resolve(state.output);
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'stale-operation' } });
    expect(state.writes).toEqual([]);
  });

  it.each([
    'old-first',
    'new-first',
  ] as const)('latest request wins with %s completion', async (order) => {
    const state = setup();
    const older = state.run();
    const newer = state.run();
    const oldResult: MapshaperDataset = { layers: [], info: { input_formats: ['old'] } };
    if (order === 'old-first') {
      state.queries[0]!.resolve(oldResult);
      expect(await older).toMatchObject({ ok: false, error: { kind: 'stale-operation' } });
      state.queries[1]!.resolve(state.output);
      expect(await newer).toMatchObject({ ok: true });
    } else {
      state.queries[1]!.resolve(state.output);
      expect(await newer).toMatchObject({ ok: true });
      state.queries[0]!.resolve(oldResult);
      expect(await older).toMatchObject({ ok: false, error: { kind: 'stale-operation' } });
    }
    expect(state.writes).toEqual([state.output]);
  });

  it('does not cancel concurrent queries to independent output sources', async () => {
    const state = setup();
    const first = state.run('a');
    const second = state.run('b');
    state.queries[1]!.resolve(state.output);
    state.queries[0]!.resolve(state.output);
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(state.writes).toHaveLength(2);
  });
});
