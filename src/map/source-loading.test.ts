import { describe, expect, it, vi } from 'vitest';
import { Projection } from '../geo/projection';
import { Viewport } from '../geo/viewport';
import { EditHistory } from '../edit/edit-history';
import { TopologySource } from '../source/topology-source';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { Emap } from './map';
import { Selection } from './selection';

function setPrivate(target: object, key: string, value: unknown): void {
  Reflect.set(target, key, value);
}

function createBareMap(): {
  readonly map: Emap;
  readonly scheduleRender: ReturnType<typeof vi.fn>;
  readonly viewportSetCrs: ReturnType<typeof vi.spyOn>;
} {
  const map = Object.create(Emap.prototype) as Emap;
  const projection = new Projection();
  const viewport = new Viewport();
  const scheduleRender = vi.fn();
  const viewportSetCrs = vi.spyOn(viewport, 'setCRS');
  setPrivate(map, '_sources', new globalThis.Map());
  setPrivate(map, '_sourceListeners', new globalThis.Map());
  setPrivate(map, '_pendingSourceCommits', new globalThis.Map());
  setPrivate(map, '_projection', projection);
  setPrivate(map, '_viewport', viewport);
  setPrivate(map, '_crsEstablished', false);
  setPrivate(map, '_layers', []);
  setPrivate(map, '_effectiveLayersCache', []);
  setPrivate(map, '_defaultLayersDirty', false);
  setPrivate(map, '_layerArcIdsCache', new globalThis.Map());
  setPrivate(map, '_selection', new Selection());
  setPrivate(map, '_history', new EditHistory());
  setPrivate(map, '_featureQuery', { clear: vi.fn() });
  setPrivate(map, '_highlightManager', { removeSource: vi.fn() });
  setPrivate(map, '_scheduleRender', scheduleRender);
  setPrivate(map, '_listeners', {});
  setPrivate(map, '_removed', false);
  setPrivate(map, '_rafId', 0);
  setPrivate(map, '_wheelSettleTimer', null);
  setPrivate(map, '_controls', []);
  setPrivate(map, '_controlContainers', new globalThis.Map());
  return { map, scheduleRender, viewportSetCrs };
}

function sourceWithDataset(id: string, dataset: MapshaperDataset): TopologySource {
  const source = new TopologySource(id);
  source.setDataset(dataset, false);
  return source;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}

describe('source loading preflight', () => {
  it('returns needs-input without changing map or source state when CRS metadata is missing', async () => {
    const { map, viewportSetCrs } = createBareMap();
    const dataset: MapshaperDataset = { layers: [], info: {} };
    const source = sourceWithDataset('missing-crs', dataset);
    const crsChange = vi.fn();
    const data = vi.fn();
    map.on('crschange', crsChange);
    map.on('data', data);
    const beforeCrs = map.getCRS();

    const result = await map.preflightSource({ id: 'missing-crs', source });

    expect(result.status).toBe('needs-input');
    if (result.status !== 'needs-input') throw new Error('expected sourceCrs requirement');
    expect(result.requirements).toEqual([
      { code: 'source-crs', field: 'sourceCrs', reason: 'missing' },
    ]);
    expect(map.getSource('missing-crs')).toBeUndefined();
    expect(map.getCRS()).toBe(beforeCrs);
    expect(viewportSetCrs).not.toHaveBeenCalled();
    expect(source.getDataset()).toBe(dataset);
    expect(dataset.info).toEqual({});
    expect(crsChange).not.toHaveBeenCalled();
    expect(data).not.toHaveBeenCalled();
  });

  it('reuses a draft after the caller supplies the missing source CRS', async () => {
    const { map } = createBareMap();
    const dataset: MapshaperDataset = { layers: [], info: {} };
    const source = sourceWithDataset('draft', dataset);
    const first = await map.preflightSource({ id: 'draft', source });
    if (first.status !== 'needs-input') throw new Error('expected sourceCrs requirement');

    const second = await map.preflightSource(first.draft, { sourceCrs: 'EPSG:3857' });

    expect(second.status).toBe('ready');
    if (second.status !== 'ready') throw new Error('expected ready source plan');
    expect(second.summary.sourceCrs).toBe('EPSG:3857');
    expect(source.getDataset()).toBe(dataset);
    expect(dataset.info).toEqual({});
  });

  it('reports a structured warning when explicit CRS overrides different metadata', async () => {
    const { map } = createBareMap();
    const dataset: MapshaperDataset = { layers: [], info: { crs_string: 'EPSG:4326' } };
    const source = sourceWithDataset('override', dataset);

    const result = await map.preflightSource({
      id: 'override',
      source,
      sourceCrs: 'EPSG:3857',
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected ready source plan');
    expect(result.diagnostics).toEqual([
      {
        code: 'source-crs-overrides-metadata',
        severity: 'warning',
        suppliedCrs: 'EPSG:3857',
        metadataCrs: 'EPSG:4326',
        effectiveCrs: 'EPSG:3857',
      },
    ]);
    expect(source.getDataset()).toBe(dataset);
    expect(dataset.info?.crs_string).toBe('EPSG:4326');
  });

  it('returns needs-input instead of falling back when an explicit CRS is invalid', async () => {
    const { map } = createBareMap();
    const source = sourceWithDataset('invalid', {
      layers: [],
      info: { crs_string: 'EPSG:4326' },
    });

    const result = await map.preflightSource({
      id: 'invalid',
      source,
      sourceCrs: 'EPSG:999999999',
    });

    expect(result.status).toBe('needs-input');
    if (result.status !== 'needs-input') throw new Error('expected invalid sourceCrs requirement');
    expect(result.requirements).toEqual([
      { code: 'source-crs', field: 'sourceCrs', reason: 'invalid' },
    ]);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'source-crs-invalid',
      severity: 'error',
      suppliedCrs: 'EPSG:999999999',
    });
  });

  it('rejects arbitrary text that is not a parseable projection', async () => {
    const { map } = createBareMap();
    const source = sourceWithDataset('invalid-text', {
      layers: [],
      info: { crs_string: 'EPSG:4326' },
    });

    const result = await map.preflightSource({
      id: 'invalid-text',
      source,
      sourceCrs: 'not-a-coordinate-system',
    });

    expect(result.status).toBe('needs-input');
    if (result.status !== 'needs-input') throw new Error('expected invalid sourceCrs requirement');
    expect(result.requirements).toEqual([
      { code: 'source-crs', field: 'sourceCrs', reason: 'invalid' },
    ]);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'source-crs-invalid',
      severity: 'error',
      suppliedCrs: 'not-a-coordinate-system',
    });
  });

  it('treats EPSG and equivalent Proj.4 definitions as the same CRS', async () => {
    const { map } = createBareMap();
    map.setCRS('EPSG:4326');
    const source = sourceWithDataset('equivalent', {
      layers: [],
      info: { crs_string: '+proj=longlat +ellps=WGS84 +no_defs' },
    });
    const prepare = vi.spyOn(source, 'prepareReprojectDataset');

    const result = await map.preflightSource({
      id: 'equivalent',
      source,
      sourceCrs: 'EPSG:4326',
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected ready source plan');
    expect(result.diagnostics).toEqual([]);
    await map.confirmSource(result.plan);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('normalizes a custom mutable source without consulting getCRS', async () => {
    const { map } = createBareMap();
    map.setCRS('EPSG:3857');
    const source = sourceWithDataset('custom-no-get-crs', {
      layers: [],
      info: { crs_string: 'EPSG:4326' },
    });
    Reflect.set(source, 'getCRS', undefined);
    const projected: MapshaperDataset = {
      layers: [],
      info: { crs_string: 'EPSG:3857' },
    };
    const prepare = vi.spyOn(source, 'prepareReprojectDataset').mockResolvedValue(projected);

    const result = await map.preflightSource({ id: 'custom-no-get-crs', source });
    if (result.status !== 'ready') throw new Error('expected ready source plan');
    await map.confirmSource(result.plan);

    expect(prepare).toHaveBeenCalledWith(expect.any(Object), 'EPSG:3857', 'EPSG:3857');
    expect(source.getDataset()).toBe(projected);
  });

  it('treats an explicit whitespace CRS as invalid instead of falling back to metadata', async () => {
    const { map } = createBareMap();
    const dataset: MapshaperDataset = {
      layers: [],
      info: { crs_string: 'EPSG:4326' },
    };
    const source = sourceWithDataset('blank-explicit', dataset);

    const result = await map.preflightSource({
      id: 'blank-explicit',
      source,
      sourceCrs: '   ',
    });

    expect(result.status).toBe('needs-input');
    if (result.status !== 'needs-input') throw new Error('expected invalid sourceCrs requirement');
    expect(result.requirements).toEqual([
      { code: 'source-crs', field: 'sourceCrs', reason: 'invalid' },
    ]);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'source-crs-invalid',
      severity: 'error',
    });
    expect(source.getDataset()).toBe(dataset);
    expect(dataset.info?.crs_string).toBe('EPSG:4326');
  });

  it('parses a raw input into a detached ready plan without registering it', async () => {
    const { map } = createBareMap();
    const content = new TextEncoder().encode(
      JSON.stringify({ type: 'FeatureCollection', features: [] }),
    );

    const result = await map.preflightSource({
      id: 'input',
      input: { filename: 'input.geojson', content },
    });

    expect(result.status).toBe('ready');
    expect(map.getSource('input')).toBeUndefined();
    expect(map.getCRS()).toBe('EPSG:4326');
  });
});

describe('source loading confirmation', () => {
  it('publishes first-source events only after source and map CRS state commit together', async () => {
    const { map, scheduleRender } = createBareMap();
    const source = sourceWithDataset('first', {
      layers: [],
      info: { crs_string: 'EPSG:3857' },
    });
    const states: string[] = [];
    map.on('crschange', () => {
      states.push(`${map.getSource('first') === source}:${map.getCRS()}`);
    });
    map.on('data', () => {
      states.push(`${map.getSource('first') === source}:${map.getCRS()}`);
    });
    const result = await map.preflightSource({ id: 'first', source });
    if (result.status !== 'ready') throw new Error('expected ready source plan');

    await map.confirmSource(result.plan);

    expect(map.getSource('first')).toBe(source);
    expect(map.getCRS()).toBe('EPSG:3857');
    expect(states).toEqual(['true:EPSG:3857', 'true:EPSG:3857']);
    expect(scheduleRender).toHaveBeenCalledOnce();
  });

  it('normalizes a losing first-load candidate to the CRS established by the winner', async () => {
    const { map } = createBareMap();
    const winner = sourceWithDataset('winner', {
      layers: [],
      info: { crs_string: 'EPSG:4326' },
    });
    const loser = sourceWithDataset('loser', {
      layers: [],
      info: { crs_string: 'EPSG:3857' },
    });
    const projected: MapshaperDataset = {
      layers: [],
      info: { crs_string: 'EPSG:4326' },
    };
    const prepare = vi.spyOn(loser, 'prepareReprojectDataset').mockResolvedValue(projected);
    const winnerResult = await map.preflightSource({ id: 'winner', source: winner });
    const loserResult = await map.preflightSource({ id: 'loser', source: loser });
    if (winnerResult.status !== 'ready' || loserResult.status !== 'ready') {
      throw new Error('expected both source plans to be ready');
    }

    await map.confirmSource(winnerResult.plan);
    await map.confirmSource(loserResult.plan);

    expect(map.getCRS()).toBe('EPSG:4326');
    expect(loser.getDataset()).toBe(projected);
    expect(prepare).toHaveBeenCalledWith(expect.any(Object), 'EPSG:4326', 'EPSG:4326');
  });

  it('keeps the committed source and continues notifications when a listener throws', async () => {
    const { map, scheduleRender } = createBareMap();
    const dataset: MapshaperDataset = {
      layers: [],
      info: { crs_string: 'EPSG:3857' },
    };
    const source = sourceWithDataset('listener-error', dataset);
    const data = vi.fn();
    const remainingCrsListener = vi.fn();
    const reported = vi.fn();
    map.on('crschange', () => {
      throw new Error('listener failed');
    });
    map.on('crschange', remainingCrsListener);
    map.on('data', data);
    map.on<{ error: unknown }>('error', reported);
    const result = await map.preflightSource({ id: 'listener-error', source });
    if (result.status !== 'ready') throw new Error('expected ready source plan');

    await expect(map.confirmSource(result.plan)).resolves.toBeUndefined();

    expect(map.getSource('listener-error')).toBe(source);
    expect(map.getCRS()).toBe('EPSG:3857');
    expect(remainingCrsListener).toHaveBeenCalledOnce();
    expect(data).toHaveBeenCalledOnce();
    expect(reported).toHaveBeenCalledWith({
      type: 'error',
      error: expect.objectContaining({ message: 'listener failed' }),
    });
    expect(scheduleRender).toHaveBeenCalledOnce();
  });

  it('rejects a candidate superseded while asynchronous normalization is in flight', async () => {
    const { map } = createBareMap();
    const established = sourceWithDataset('established', {
      layers: [],
      info: { crs_string: 'EPSG:3857' },
    });
    const establishedResult = await map.preflightSource({ id: 'established', source: established });
    if (establishedResult.status !== 'ready') throw new Error('expected ready source plan');
    await map.confirmSource(establishedResult.plan);

    const candidate = sourceWithDataset('superseded', {
      layers: [],
      info: { crs_string: 'EPSG:4326' },
    });
    const pending = deferred<MapshaperDataset>();
    const prepare = vi.spyOn(candidate, 'prepareReprojectDataset').mockReturnValue(pending.promise);
    const result = await map.preflightSource({ id: 'superseded', source: candidate });
    if (result.status !== 'ready') throw new Error('expected ready source plan');

    const confirmation = map.confirmSource(result.plan);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
    candidate.setDataset({ layers: [], info: { crs_string: 'EPSG:4326' } }, false);
    pending.resolve({ layers: [], info: { crs_string: 'EPSG:3857' } });

    await expect(confirmation).rejects.toMatchObject({ code: 'source-plan-stale' });
    expect(map.getSource('superseded')).toBeUndefined();
    expect(map.getCRS()).toBe('EPSG:3857');
  });

  it('cancels an in-flight confirmation when removeSource is called for its id', async () => {
    const { map } = createBareMap();
    const established = sourceWithDataset('established', {
      layers: [],
      info: { crs_string: 'EPSG:3857' },
    });
    const establishedResult = await map.preflightSource({ id: 'established', source: established });
    if (establishedResult.status !== 'ready') throw new Error('expected ready source plan');
    await map.confirmSource(establishedResult.plan);

    const candidate = sourceWithDataset('cancelled', {
      layers: [],
      info: { crs_string: 'EPSG:4326' },
    });
    const pending = deferred<MapshaperDataset>();
    const prepare = vi.spyOn(candidate, 'prepareReprojectDataset').mockReturnValue(pending.promise);
    const result = await map.preflightSource({ id: 'cancelled', source: candidate });
    if (result.status !== 'ready') throw new Error('expected ready source plan');

    const confirmation = map.confirmSource(result.plan);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
    map.removeSource('cancelled');
    pending.resolve({ layers: [], info: { crs_string: 'EPSG:3857' } });

    await expect(confirmation).rejects.toMatchObject({ code: 'source-load-cancelled' });
    expect(map.getSource('cancelled')).toBeUndefined();
    expect(map.getCRS()).toBe('EPSG:3857');
  });

  it('consumes each ready plan exactly once', async () => {
    const { map } = createBareMap();
    const source = sourceWithDataset('single-use', {
      layers: [],
      info: { crs_string: 'EPSG:4326' },
    });
    const result = await map.preflightSource({ id: 'single-use', source });
    if (result.status !== 'ready') throw new Error('expected ready source plan');

    await map.confirmSource(result.plan);

    await expect(map.confirmSource(result.plan)).rejects.toMatchObject({
      code: 'source-plan-invalid',
    });
  });

  it('rejects a ready plan after map removal', async () => {
    const { map } = createBareMap();
    const source = sourceWithDataset('removed-map', {
      layers: [],
      info: { crs_string: 'EPSG:4326' },
    });
    const result = await map.preflightSource({ id: 'removed-map', source });
    if (result.status !== 'ready') throw new Error('expected ready source plan');

    map.remove();

    await expect(map.confirmSource(result.plan)).rejects.toMatchObject({
      code: 'source-load-cancelled',
    });
    expect(map.getSource('removed-map')).toBeUndefined();
  });

  it('rejects an in-place dataset edit made after preflight', async () => {
    const { map } = createBareMap();
    const dataset: MapshaperDataset = {
      layers: [],
      info: { crs_string: 'EPSG:4326' },
      editVersion: 3,
    };
    const source = sourceWithDataset('edited', dataset);
    const result = await map.preflightSource({ id: 'edited', source });
    if (result.status !== 'ready') throw new Error('expected ready source plan');
    dataset.editVersion = 4;

    await expect(map.confirmSource(result.plan)).rejects.toMatchObject({
      code: 'source-plan-stale',
    });
    expect(map.getSource('edited')).toBeUndefined();
  });

  it('keeps addSource as a preflight and confirm wrapper with an explicit CRS answer', async () => {
    const { map } = createBareMap();
    const source = sourceWithDataset('wrapper', { layers: [], info: {} });

    await map.addSource('wrapper', source, { sourceCrs: 'EPSG:3857' });

    expect(map.getSource('wrapper')).toBe(source);
    expect(map.getCRS()).toBe('EPSG:3857');
    expect(source.getDataset()?.info?.crs_string).toBe('EPSG:3857');
  });
});
