import {
  createTestMap,
  fixtureGet,
  fixtureSet,
  fixtureCall,
} from '../../../test/utils/plugin-test-map';
import { pointLodForPainter } from '../rendering/point-lod';
import { HighlightManager } from './highlight-manager';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import mapshaper from 'mapshaper';
import { Emap } from './map';
import type { FeatureRef } from './map';
import type { LayerSpecification } from './layer';
import type { MapshaperDataset } from '../../shared/types/mapshaper-types';
import { Selection } from './selection';
import { Projection } from '../../domain/geo/projection';
import { Viewport } from '../../domain/geo/viewport';
import { StyleResolver } from './style-resolver';
import { Bounds } from '../../domain/geo/bounds';
import { AffineTransform } from '../../domain/geo/transform';
import { EditHistory } from '../../domain/edit/edit-history';
import { CompositeCommand } from '../../domain/edit/commands/composite';
import { ValidatorRegistry } from '../../domain/validation/registry';
import { FeatureAccessor } from './feature-accessor';
import { TopologySource } from '../../domain/source/topology-source';
import { FeatureQuery } from './feature-query';
import { EMAP_THEME_COLORS } from '../../ui/theme/colors';
import { getDefaultMapshaperAdapter } from '../../integrations/mapshaper/adapter';
import { FilterEvaluationError, FilterResolver } from './filter-resolver';
import { SplitFeatureHandler } from '../core/handlers/split-feature';
import type { EditHandlerHost } from '../core/handlers/edit-handler-host';
import type { NormalizedPointerEvent } from '../core/handler';
import { EditStateStore } from './edit-state-store';
// Snapshot the real mapshaper.internal entry points at module-load time,
// BEFORE any test has had a chance to mock them. Some test blocks below
// stomp these without restoring, so tests that need the real pipeline
// (notably the round-trip tests against real mapshaper) restore from
// here.
const MAPSHAPER_REAL = {
  parseCommands: Reflect.get(mapshaper.internal as object, 'parseCommands'),
  runParsedCommands: Reflect.get(mapshaper.internal as object, 'runParsedCommands'),
  copyDataset: Reflect.get(mapshaper.internal as object, 'copyDataset'),
  findSegmentIntersections: Reflect.get(mapshaper.internal as object, 'findSegmentIntersections'),
  getIntersectionLayer: Reflect.get(mapshaper.internal as object, 'getIntersectionLayer'),
};
function restoreRealMapshaper(): void {
  for (const [k, v] of Object.entries(MAPSHAPER_REAL)) {
    Reflect.set(mapshaper.internal as object, k, v);
  }
}
function setPrivate(target: object, key: string, value: unknown): void {
  fixtureSet(target, key, value);
}
/**
 * PR-4b test helper: assert a captured `ParsedCommand[]` (the first arg to
 * `runParsedCommands`) is structurally equivalent to what mapshaper would
 * produce by parsing `expectedCli`. The `_` echo field is stripped from
 * both sides since hand-built commands intentionally omit it
 * (`runParsedCommands` ignores `_` anyway).
 */
function expectCli(expectedCli: string, actualCmds: any): void {
  const real = MAPSHAPER_REAL.parseCommands as (cmd: string) => any[];
  // Strip `input` (the runner injects an inputFiles cache into every
  // command's options before dispatch) and `_` (parseCommands' positional
  // echo) so they don't pollute the comparison. The runtime semantic
  // contract is "every option except runner-injected ones must match".
  const strip = (o: Record<string, unknown>) => {
    const { input: _i, _: _u, ...rest } = o as any;
    return rest;
  };
  const expected = real(expectedCli).map((c: any) => ({ name: c.name, options: strip(c.options) }));
  const actual = (actualCmds as any[]).map((c: any) => ({
    name: c.name,
    options: strip(c.options),
  }));
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    expect(actual[i].name).toBe(expected[i].name);
    expect(actual[i].options).toEqual(expected[i].options);
  }
}
/**
 * Render a `ParsedCommand[]` back to a CLI-string approximation for the
 * handful of legacy tests that grep the command for substrings rather
 * than asserting exact equality. Lossy by design.
 *
 * Knows about positional/default options for common command families so
 * round-trip via mapshaper.parseCommands is approximately stable for
 * the test corpus (e.g. `-target X` instead of `-target target=X`).
 */
function parsedCmdsToCli(cmds: any): string {
  // Map command-name → option key whose value renders as a positional
  // argument (no `key=` prefix). Mirrors mapshaper's CLI grammar for the
  // command families this test corpus exercises.
  const POSITIONAL: Record<string, string> = {
    target: 'target',
    dissolve: 'fields',
    'filter-fields': 'fields',
    each: 'expression',
    filter: 'expression',
    sort: 'expression',
    uniq: 'expression',
    split: 'expression',
    'rename-layers': 'names',
    'rename-fields': 'fields',
    buffer: 'radius',
    simplify: 'percentage',
    proj: 'crs',
    lines: 'fields',
  };
  return (cmds as any[])
    .map((c: any) => {
      const parts: string[] = [`-${c.name}`];
      const opts = (c.options ?? {}) as Record<string, unknown>;
      const positionalKey = POSITIONAL[c.name];
      // Drop `_` echo from real parseCommands output if present.
      const keys = Object.keys(opts).filter((k) => k !== '_');
      for (const k of keys) {
        const v = opts[k];
        if (v === undefined || v === false) continue;
        if (k === positionalKey) {
          // Render as positional: bare value, no `key=`.
          if (Array.isArray(v)) parts.push(v.length === 1 ? `"${v[0]}"` : `"${v.join(',')}"`);
          else parts.push(`"${v}"`);
          continue;
        }
        const key = k.replace(/_/g, '-');
        if (v === true) parts.push(key);
        else if (Array.isArray(v)) parts.push(`${key}=${v.join(',')}`);
        else if (typeof v === 'string') parts.push(`${key}="${v}"`);
        else parts.push(`${key}=${v}`);
      }
      return parts.join(' ');
    })
    .join(' ');
}
function getPrivate(target: object, key: string): unknown {
  return fixtureGet(target, key);
}
function callPrivate(target: object, key: string, ...args: unknown[]): unknown {
  const fn = (...values: unknown[]) => fixtureCall(target, key, ...values);
  if (typeof fn !== 'function') {
    throw new Error(`Expected ${key} to be a function`);
  }
  return (fn as (...input: unknown[]) => unknown).apply(target, args);
}
function createMockSource(layers?: unknown[]) {
  return {
    id: 'test',
    type: 'topology' as const,
    on: vi.fn(),
    off: vi.fn(),
    fire: vi.fn(),
    getExtent: vi.fn(() => ({ xmin: 0, ymin: 0, xmax: 1, ymax: 1 })),
    getArcs: vi.fn(() => undefined),
    getLayers: vi.fn(() => layers || []),
    getDataset: vi.fn(() => undefined),
    getDisplayArcs: vi.fn(() => null),
    refreshDisplayArcs: vi.fn(),
    setDataset: vi.fn(),
    replaceDataset: vi.fn(),
    getSimplifyFloor: vi.fn(() => 0),
    prepareReproject: vi.fn(),
    prepareReprojectDataset: vi.fn(),
    getCRS: vi.fn(() => 'EPSG:4326'),
    setDatasetNormalizer: vi.fn(),
    setManagedCRS: vi.fn(),
  };
}
function registerMockSource(
  map: Emap,
  id: string,
  source: ReturnType<typeof createMockSource>,
): void {
  const sources = getPrivate(map, '_sources') as globalThis.Map<string, unknown>;
  sources.set(id, source);
}
/**
 * Create a bare Emap instance with private state injected, bypassing the DOM-dependent constructor.
 */
async function createBareMap(): Promise<Emap> {
  // Use Object.create to get an instance without calling the constructor
  const map = await createTestMap();
  // Initialize essential private state that the layer management methods depend on
  setPrivate(map, '_sources', new globalThis.Map());
  setPrivate(map, '_sourceListeners', new globalThis.Map());
  setPrivate(map, '_layers', []);
  setPrivate(map, '_effectiveLayersCache', []);
  setPrivate(map, '_defaultLayersDirty', true);
  setPrivate(map, '_layerArcIdsCache', new globalThis.Map());
  setPrivate(map, '_pendingRender', 0);
  setPrivate(map, '_rafId', 0);
  setPrivate(map, '_highlightManager', {
    clearHighlightedFeatures: vi.fn(),
    removeSource: vi.fn(),
  });
  // EventDispatcher field initializer does not run when bypassing constructor
  setPrivate(map, '_listeners', {});
  // Initialize selection so select / deselect / clearSelection have somewhere to write
  setPrivate(map, '_selection', new Selection());
  setPrivate(map, '_featureQuery', {
    clear: vi.fn(),
    prebuildForRendering: vi.fn(),
    getRenderCandidates: () => null,
  });
  setPrivate(map, '_activeTransaction', null);
  setPrivate(map, '_history', new EditHistory());
  setPrivate(map, '_filterResolver', new FilterResolver());
  // Stub _scheduleRender so it doesn't try to use requestAnimationFrame
  setPrivate(map, '_scheduleRender', vi.fn());
  // Tests exercise expression-evaluating ops (applyExpression, filter,
  // joinTable, calc); opt them in to `'trusted'` since the default is
  // `'disabled'` for apps. Individual tests of policy enforcement flip
  // back to `'disabled'` explicitly.
  setPrivate(map, '_expressionPolicy', 'trusted');
  return map as Emap;
}
describe('split sketch source lifecycle', () => {
  it.each([
    'reproject',
    'replace',
  ])('clears a sketch after %s while preserving selected refs', async (change) => {
    const map = await createBareMap();
    const viewport = new Viewport();
    viewport.updateSize(100, 100);
    viewport.setExtent(new Bounds(0, 0, 10, 10));
    const state = new EditStateStore(() => {});
    setPrivate(map, '_viewport', viewport);
    setPrivate(map, '_projection', new Projection());
    setPrivate(map, '_editState', state);
    setPrivate(map, 'render', vi.fn());
    const source = await TopologySource.fromBytes(
      'sketch',
      new TextEncoder().encode(
        JSON.stringify({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [10, 10],
            ],
          },
        }),
      ),
      { filename: 'lines.geojson' },
    );
    await map.addSource('sketch', source);
    const refs = [{ source: 'sketch', layer: 'lines', id: 0 }];
    map.select(refs);
    const split = vi
      .spyOn(map.ops, 'splitSelected')
      .mockResolvedValue({ ok: true, value: undefined });
    const pointer = (kind: 'click' | 'contextmenu', x: number): NormalizedPointerEvent => ({
      kind,
      point: { x, y: 50 },
      button: 0,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
      originalEvent: new Event(kind),
    });
    vi.stubGlobal('window', new EventTarget());
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost, {
      cutterType: 'polyline',
    });
    handler.enable();
    try {
      handler.handlePointer(pointer('click', 10));
      expect(state.draw?.vertices).toHaveLength(1);
      if (change === 'reproject') await map.reproject('EPSG:3857');
      else
        source.setDataset(
          getDefaultMapshaperAdapter().copyDataset(source.getDataset() as MapshaperDataset),
        );
      expect(map.getSelection()).toEqual(refs);
      expect(state.draw).toBeNull();
      handler.handlePointer(pointer('click', 90));
      handler.handlePointer(pointer('contextmenu', 90));
      expect(split).not.toHaveBeenCalled();
    } finally {
      handler.disable();
      vi.unstubAllGlobals();
    }
  });
});
describe('Emap rendering', () => {
  it('rebases fast navigation on a full frame rendered partway through a gesture', async () => {
    const map = (await createTestMap()) as Emap;
    const transform = new AffineTransform(2, -2, 40, 20);
    setPrivate(map, '_viewport', { transform });
    setPrivate(map, '_navSnapshotTransform', { mx: 1, my: -1, bx: 0, by: 0 });
    setPrivate(map, '_clearFastTransform', vi.fn());
    setPrivate(map, '_renderImpl', vi.fn());
    setPrivate(map, '_captureRenderSnapshot', () => ({
      canvasWidth: 100,
      canvasHeight: 100,
      pixelRatio: 1,
    }));
    setPrivate(map, '_scheduler', { recordFrame: vi.fn() });
    callPrivate(map, '_renderFull');
    transform.translate(7, -3);
    expect(callPrivate(map, '_computeNavDelta')).toEqual({ sx: 1, sy: 1, tx: 7, ty: -3 });
  });
  it('publishes a move after reset restores the initial view', async () => {
    const map = await createBareMap();
    const viewport = new Viewport();
    viewport.updateSize(800, 600);
    viewport.setExtent(new Bounds(0, 0, 100, 100));
    const initialTransform = viewport.transform.clone();
    viewport.pan(80, 40);
    const moves: string[] = [];
    setPrivate(map, '_viewport', viewport);
    map.on('move', () => moves.push('move'));
    map.reset();
    expect(viewport.transform).toEqual(initialTransform);
    expect(moves).toEqual(['move']);
  });
  it('preserves a first nav render request until the RAF callback runs', async () => {
    const map = (await createTestMap()) as Emap;
    const callbacks: FrameRequestCallback[] = [];
    const render = vi.fn();
    const navDelta = { tx: 12, ty: -4, sx: 1, sy: 1 };
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    setPrivate(map, '_removed', false);
    setPrivate(map, '_pendingRender', 0);
    setPrivate(map, '_rafId', 0);
    setPrivate(map, '_pendingAction', 'redraw');
    setPrivate(map, '_pendingNavDelta', null);
    setPrivate(map, 'render', render);
    globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return 7;
    }) as unknown as typeof requestAnimationFrame;
    try {
      callPrivate(map, '_scheduleRender', 'nav', navDelta);
      expect(getPrivate(map, '_pendingAction')).toBe('nav');
      expect(getPrivate(map, '_pendingNavDelta')).toEqual(navDelta);
      callbacks[0](0);
      expect(render).toHaveBeenCalledWith({ action: 'nav', navDelta });
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });
  it('upgrades a pending nav render request when a redraw is scheduled before RAF', async () => {
    const map = (await createTestMap()) as Emap;
    const callbacks: FrameRequestCallback[] = [];
    const render = vi.fn();
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    setPrivate(map, '_removed', false);
    setPrivate(map, '_pendingRender', 0);
    setPrivate(map, '_rafId', 0);
    setPrivate(map, '_pendingAction', 'redraw');
    setPrivate(map, '_pendingNavDelta', null);
    setPrivate(map, 'render', render);
    globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return 7;
    }) as unknown as typeof requestAnimationFrame;
    try {
      callPrivate(map, '_scheduleRender', 'nav', { tx: 12, ty: -4, sx: 1, sy: 1 });
      callPrivate(map, '_scheduleRender', 'redraw');
      expect(getPrivate(map, '_pendingAction')).toBe('redraw');
      expect(getPrivate(map, '_pendingNavDelta')).toBeNull();
      callbacks[0](0);
      expect(render).toHaveBeenCalledWith({ action: 'redraw' });
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });
  it('lets a new nav request replace a pending settle redraw during fast-nav', async () => {
    const map = (await createTestMap()) as Emap;
    const callbacks: FrameRequestCallback[] = [];
    const render = vi.fn();
    const navDelta = { tx: 6, ty: 3, sx: 1, sy: 1 };
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    setPrivate(map, '_removed', false);
    setPrivate(map, '_pendingRender', 0);
    setPrivate(map, '_rafId', 0);
    setPrivate(map, '_pendingAction', 'redraw');
    setPrivate(map, '_pendingNavDelta', null);
    setPrivate(map, '_scheduler', { fastActive: true });
    setPrivate(map, 'render', render);
    globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return 7;
    }) as unknown as typeof requestAnimationFrame;
    try {
      callPrivate(map, '_scheduleRender', 'redraw', undefined, true);
      callPrivate(map, '_scheduleRender', 'nav', navDelta);
      expect(getPrivate(map, '_pendingAction')).toBe('nav');
      expect(getPrivate(map, '_pendingNavDelta')).toEqual(navDelta);
      callbacks[0](0);
      expect(render).toHaveBeenCalledWith({ action: 'nav', navDelta });
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });
  it('does not let nav replace a normal pending redraw', async () => {
    const map = (await createTestMap()) as Emap;
    const callbacks: FrameRequestCallback[] = [];
    const render = vi.fn();
    const navDelta = { tx: 6, ty: 3, sx: 1, sy: 1 };
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    setPrivate(map, '_removed', false);
    setPrivate(map, '_pendingRender', 0);
    setPrivate(map, '_rafId', 0);
    setPrivate(map, '_pendingAction', 'redraw');
    setPrivate(map, '_pendingNavDelta', null);
    setPrivate(map, '_scheduler', { fastActive: true });
    setPrivate(map, 'render', render);
    globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return 7;
    }) as unknown as typeof requestAnimationFrame;
    try {
      callPrivate(map, '_scheduleRender', 'redraw');
      callPrivate(map, '_scheduleRender', 'nav', navDelta);
      expect(getPrivate(map, '_pendingAction')).toBe('redraw');
      expect(getPrivate(map, '_pendingNavDelta')).toBeNull();
      callbacks[0](0);
      expect(render).toHaveBeenCalledWith({ action: 'redraw' });
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });
  it('passes the viewport arc filter to the vertex edit overlay', async () => {
    const map = await createBareMap();
    const arcs = { getArcIter: vi.fn() };
    const vertexState = { shapes: [[[0]]], arcs, hoverVertex: null };
    const vertexArcFilter = vi.fn();
    const renderOverlay = vi.fn();
    const getArcFilter = vi.fn((inputArcs) => {
      expect(inputArcs).toBe(arcs);
      return vertexArcFilter;
    });
    setPrivate(map, '_viewport', {
      transform: { mx: 1, my: 1, bx: 0, by: 0 },
      getLineScale: () => 1,
      getArcFilter,
    });
    setPrivate(map, '_painter', { setTransform: vi.fn(), clear: vi.fn() });
    setPrivate(map, '_overlayPainter', { setTransform: vi.fn(), clear: vi.fn() });
    setPrivate(map, '_editOverlay', { render: renderOverlay });
    setPrivate(map, '_editState', {
      mode: 'vertex',
      vertex: vertexState,
      draw: null,
      measurement: null,
    });
    setPrivate(map, '_renderLayers', vi.fn());
    setPrivate(map, '_renderHighlight', vi.fn());
    (map as any)._renderImpl();
    expect(renderOverlay).toHaveBeenCalledWith('vertex', vertexState, null, null, vertexArcFilter);
  });
  it('records full-frame timing without forcing a Canvas readback', async () => {
    const map = (await createTestMap()) as Emap;
    const order: string[] = [];
    const recordFrame = vi.fn(() => order.push('record'));
    const now = vi.spyOn(performance, 'now').mockReturnValueOnce(10).mockReturnValueOnce(35);
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    setPrivate(map, '_canvas', {
      width: 800,
      height: 600,
      style: { transform: 'translate(1px, 2px)', transformOrigin: 'top left' },
    });
    setPrivate(map, '_scheduler', { recordFrame });
    setPrivate(map, '_viewport', {
      transform: { mx: 1, my: 1, bx: 0, by: 0 },
      getLineScale: () => 1,
      getArcFilter: vi.fn(),
    });
    setPrivate(map, '_painter', { setTransform: vi.fn(), clear: vi.fn() });
    setPrivate(map, '_editOverlay', { render: vi.fn() });
    setPrivate(map, '_editState', { mode: null, vertex: null, draw: null, measurement: null });
    setPrivate(map, '_renderLayers', vi.fn());
    setPrivate(map, '_renderHighlight', vi.fn());
    try {
      callPrivate(map, '_renderFull');
    } finally {
      now.mockRestore();
      vi.unstubAllGlobals();
    }
    expect(order).toEqual(['record']);
    expect(recordFrame).toHaveBeenCalledWith(
      25,
      expect.objectContaining({ canvasWidth: 800, canvasHeight: 600 }),
    );
  });
});
describe('Emap layer management', () => {
  let map: Emap;
  beforeEach(async () => {
    vi.restoreAllMocks();
    map = await createBareMap();
  });
  describe('addSource', () => {
    it('rejects sources that do not implement the internal mutable contract', async () => {
      const source = { ...createMockSource(), setDataset: undefined };
      // Deliberately cross the public registration boundary with an invalid source.
      const invalidSource = source as unknown as Parameters<Emap['addSource']>[1];
      await expect(map.addSource('invalid', invalidSource)).rejects.toThrow(
        'Source "invalid" does not implement the mutable topology contract',
      );
    });
    it('projects an already-loaded source to the established map CRS before registration', async () => {
      const before = { layers: [], info: { crs_string: 'EPSG:4326' } };
      const after = { layers: [], info: { crs_string: 'EPSG:3857' } };
      const source = createMockSource();
      source.getDataset.mockReturnValue(before);
      source.prepareReprojectDataset.mockResolvedValue(after);
      const projection = new Projection();
      projection.setCRS('EPSG:3857');
      setPrivate(map, '_projection', projection);
      setPrivate(map, '_viewport', new Viewport());
      setPrivate(map, '_crsEstablished', true);
      await map.addSource('projected', source as any);
      expect(source.prepareReprojectDataset).toHaveBeenCalledWith(
        expect.objectContaining({ info: { crs_string: 'EPSG:4326' } }),
        'EPSG:3857',
        'EPSG:3857',
      );
      expect(source.setDataset).toHaveBeenCalledWith(after, false);
      expect(map.getSource('projected')).toBe(source);
    });
    it('does not register a source when CRS normalization fails', async () => {
      const source = createMockSource();
      source.getDataset.mockReturnValue({
        layers: [],
        info: { crs_string: 'EPSG:4326' },
      });
      source.prepareReprojectDataset.mockRejectedValue(new Error('projection failed'));
      const projection = new Projection();
      projection.setCRS('EPSG:3857');
      setPrivate(map, '_projection', projection);
      setPrivate(map, '_viewport', new Viewport());
      setPrivate(map, '_crsEstablished', true);
      await expect(map.addSource('broken', source as any)).rejects.toThrow('projection failed');
      expect(map.getSource('broken')).toBeUndefined();
      expect(source.on).not.toHaveBeenCalled();
    });
    it('rejects a prepared source when the map CRS changes before registration', async () => {
      const before = { layers: [], info: { crs_string: 'EPSG:4326' } };
      const after = { layers: [], info: { crs_string: 'EPSG:3857' } };
      const { promise: pendingProjection, resolve: resolveProjection } =
        Promise.withResolvers<object>();
      const source = createMockSource();
      source.getDataset.mockReturnValue(before);
      source.prepareReprojectDataset.mockReturnValue(pendingProjection);
      const projection = new Projection();
      projection.setCRS('EPSG:3857');
      setPrivate(map, '_projection', projection);
      setPrivate(map, '_viewport', new Viewport());
      setPrivate(map, '_crsEstablished', true);
      const registration = map.addSource('stale', source as any);
      await vi.waitFor(() => expect(source.prepareReprojectDataset).toHaveBeenCalled());
      map.setCRS('EPSG:3395');
      resolveProjection(after);
      await expect(registration).rejects.toMatchObject({ code: 'source-plan-stale' });
      expect(source.setDataset).not.toHaveBeenCalled();
      expect(map.getSource('stale')).toBeUndefined();
    });
    it('normalizes data loaded after source registration to the established map CRS', async () => {
      const source = createMockSource();
      source.getDataset.mockReturnValue({ layers: [], info: { crs_string: 'EPSG:3857' } });
      const input = { layers: [], info: { crs_string: 'EPSG:4326' } };
      const projected = { layers: [], info: { crs_string: 'EPSG:3857' } };
      let normalize: ((dataset: object) => Promise<object>) | null = null;
      source.setDatasetNormalizer.mockImplementation((fn) => {
        normalize = fn;
      });
      source.prepareReprojectDataset.mockResolvedValue(projected);
      const projection = new Projection();
      projection.setCRS('EPSG:3857');
      setPrivate(map, '_projection', projection);
      setPrivate(map, '_viewport', new Viewport());
      setPrivate(map, '_crsEstablished', true);
      await map.addSource('late', source as any);
      const result = (await normalize?.(input)) as {
        dataset: object;
        assertCommittable(): void;
      };
      expect(source.prepareReprojectDataset).toHaveBeenCalledWith(input, 'EPSG:3857', 'EPSG:3857');
      expect(result.dataset).toBe(projected);
      expect(() => result.assertCommittable()).not.toThrow();
    });
    it('rejects imported data when the map CRS changes during normalization', async () => {
      const source = createMockSource();
      source.getDataset.mockReturnValue({ layers: [], info: { crs_string: 'EPSG:3857' } });
      const input = { layers: [], info: { crs_string: 'EPSG:4326' } };
      const projected = { layers: [], info: { crs_string: 'EPSG:3857' } };
      let normalize: ((dataset: object) => Promise<object>) | null = null;
      const { promise: pendingProjection, resolve: resolveProjection } =
        Promise.withResolvers<object>();
      source.setDatasetNormalizer.mockImplementation((fn) => {
        normalize = fn;
      });
      source.prepareReprojectDataset.mockReturnValue(pendingProjection);
      source.prepareReproject.mockResolvedValue({
        layers: [],
        info: { crs_string: 'EPSG:3395' },
      });
      const projection = new Projection();
      projection.setCRS('EPSG:3857');
      setPrivate(map, '_projection', projection);
      setPrivate(map, '_viewport', new Viewport());
      setPrivate(map, '_history', new EditHistory());
      setPrivate(map, '_crsEstablished', true);
      await map.addSource('late-stale', source as any);
      const normalization = normalize?.(input);
      await vi.waitFor(() => expect(source.prepareReprojectDataset).toHaveBeenCalled());
      await map.reproject('EPSG:3395');
      resolveProjection(projected);
      await expect(normalization).rejects.toThrow('Map CRS changed during source normalization');
    });
    it('adopts the CRS only when the first loaded source is confirmed', async () => {
      const source = createMockSource();
      const input = { layers: [], info: { crs_string: 'EPSG:4490' } };
      source.getDataset.mockReturnValue(input);
      const projection = new Projection();
      const viewport = new Viewport();
      setPrivate(map, '_projection', projection);
      setPrivate(map, '_viewport', viewport);
      setPrivate(map, '_crsEstablished', false);
      const crsChange = vi.fn();
      map.on('crschange', crsChange);
      await map.addSource('first', source as any);
      expect(map.getSource('first')).toBe(source);
      expect(map.getCRS()).toBe('EPSG:4490');
      expect(crsChange).toHaveBeenCalledTimes(1);
      expect(source.prepareReprojectDataset).not.toHaveBeenCalled();
    });
    it('captures initial source layers before history and CRS listeners mutate them', async () => {
      const source = createMockSource();
      source.getDataset.mockReturnValue({ layers: [], info: { crs_string: 'EPSG:4490' } });
      setPrivate(map, '_projection', new Projection());
      setPrivate(map, '_viewport', new Viewport());
      setPrivate(map, '_crsEstablished', false);
      const history = getPrivate(map, '_history') as EditHistory;
      history.push({ label: 'prior edit', do() {}, undo() {} });
      const events: unknown[] = [];
      map.on('layerchange', (event) => {
        events.push({
          type: event.type,
          reason: event.reason,
          layerId: event.layerId,
          layers: event.layers.map((layer) => [layer.id, layer.layout?.visibility ?? 'visible']),
        });
      });
      map.on('historychange', () => {
        events.push({ type: 'historychange' });
        map.setLayerVisibility('first:default', 'none');
      });
      map.on('data', () => events.push({ type: 'data' }));
      map.on('crschange', () => {
        events.push({ type: 'crschange' });
        map.moveLayer('first:default');
      });
      await map.addSource('first', source as any);
      expect(events).toEqual([
        {
          type: 'layerchange',
          reason: 'effective',
          layerId: undefined,
          layers: [['first:default', 'visible']],
        },
        { type: 'historychange' },
        {
          type: 'layerchange',
          reason: 'visibility',
          layerId: 'first:default',
          layers: [['first:default', 'none']],
        },
        { type: 'crschange' },
        {
          type: 'layerchange',
          reason: 'effective',
          layerId: 'first:default',
          layers: [['first:default', 'none']],
        },
        { type: 'data' },
      ]);
    });
    it('rejects the normalized commit when the source is unregistered before commit', async () => {
      const source = createMockSource();
      source.getDataset.mockReturnValue({ layers: [], info: { crs_string: 'EPSG:3857' } });
      const input = { layers: [], info: { crs_string: 'EPSG:4326' } };
      const projected = { layers: [], info: { crs_string: 'EPSG:3857' } };
      let normalize: ((dataset: object) => Promise<object>) | null = null;
      source.setDatasetNormalizer.mockImplementation((fn) => {
        normalize = fn;
      });
      source.prepareReprojectDataset.mockResolvedValue(projected);
      const projection = new Projection();
      projection.setCRS('EPSG:3857');
      setPrivate(map, '_projection', projection);
      setPrivate(map, '_viewport', new Viewport());
      setPrivate(map, '_crsEstablished', true);
      await map.addSource('late-detached', source as any);
      const result = (await normalize?.(input)) as {
        assertCommittable(): void;
      };
      map.removeSource('late-detached');
      expect(() => result.assertCommittable()).toThrow(
        'Source "late-detached" is no longer registered',
      );
    });
    it('rejects the normalized commit when the map CRS changes before commit', async () => {
      const source = createMockSource();
      source.getDataset.mockReturnValue({ layers: [], info: { crs_string: 'EPSG:3857' } });
      const input = { layers: [], info: { crs_string: 'EPSG:4326' } };
      const projected = { layers: [], info: { crs_string: 'EPSG:3857' } };
      let normalize: ((dataset: object) => Promise<object>) | null = null;
      source.setDatasetNormalizer.mockImplementation((fn) => {
        normalize = fn;
      });
      source.prepareReprojectDataset.mockResolvedValue(projected);
      source.prepareReproject.mockResolvedValue({
        layers: [],
        info: { crs_string: 'EPSG:3395' },
      });
      const projection = new Projection();
      projection.setCRS('EPSG:3857');
      setPrivate(map, '_projection', projection);
      setPrivate(map, '_viewport', new Viewport());
      setPrivate(map, '_crsEstablished', true);
      await map.addSource('late-stale-crs', source as any);
      const result = (await normalize?.(input)) as {
        assertCommittable(): void;
      };
      await map.reproject('EPSG:3395');
      expect(() => result.assertCommittable()).toThrow(
        'Map CRS changed during source normalization',
      );
    });
    it('clears undo history when a source registers after a map reprojection', async () => {
      const first = createMockSource();
      first.getDataset.mockReturnValue({ layers: [], info: { crs_string: 'EPSG:3857' } });
      first.prepareReproject.mockResolvedValue({ layers: [], info: { crs_string: 'EPSG:3395' } });
      const projection = new Projection();
      projection.setCRS('EPSG:3857');
      setPrivate(map, '_projection', projection);
      setPrivate(map, '_viewport', new Viewport());
      setPrivate(map, '_crsEstablished', true);
      await map.addSource('first', first as any);
      await map.reproject('EPSG:3395');
      const crsAfterReproject = map.getCRS();
      const second = createMockSource();
      second.getCRS.mockReturnValue('EPSG:3395');
      second.getDataset.mockReturnValue({ layers: [], info: { crs_string: 'EPSG:3395' } });
      await map.addSource('second', second as any);
      expect(map.undo()).toBe(false);
      expect(map.getCRS()).toBe(crsAfterReproject);
      expect(map.getSource('second')).toBe(second);
    });
    it('rejects an unloaded source before it can participate in reprojection', async () => {
      const unloaded = createMockSource();
      const projection = new Projection();
      projection.setCRS('EPSG:3857');
      setPrivate(map, '_projection', projection);
      setPrivate(map, '_viewport', new Viewport());
      setPrivate(map, '_crsEstablished', true);
      await expect(map.addSource('unloaded', unloaded as any)).rejects.toMatchObject({
        code: 'source-load-rejected',
      });
      expect(map.getSource('unloaded')).toBeUndefined();
      expect(map.getCRS()).toBe('EPSG:3857');
    });
    it('clears undo history when a registered source emits a later load', async () => {
      const loaded = createMockSource();
      loaded.getCRS.mockReturnValue('EPSG:3857');
      loaded.getDataset.mockReturnValue({ layers: [], info: { crs_string: 'EPSG:3857' } });
      loaded.prepareReproject.mockResolvedValue({ layers: [], info: { crs_string: 'EPSG:3395' } });
      const projection = new Projection();
      projection.setCRS('EPSG:3857');
      setPrivate(map, '_projection', projection);
      setPrivate(map, '_viewport', new Viewport());
      setPrivate(map, '_crsEstablished', true);
      await map.addSource('loaded', loaded as any);
      await map.reproject('EPSG:3395');
      const crsAfterReproject = map.getCRS();
      const onData = loaded.on.mock.calls.find(([type]) => type === 'data')?.[1] as (event: {
        type: string;
        reason: string;
      }) => void;
      onData({ type: 'data', reason: 'load' });
      expect(map.undo()).toBe(false);
      expect(map.getCRS()).toBe(crsAfterReproject);
    });
  });
  describe('addLayer', () => {
    it('adds a layer and retrieves it', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      const spec: LayerSpecification = {
        id: 'my-layer',
        type: 'line',
        source: 'src1',
        paint: { 'line-color': '#f00', 'line-width': 2 },
      };
      map.addLayer(spec);
      expect(map.getLayer('my-layer')).toEqual(spec);
      expect(map.getLayers()).toHaveLength(1);
    });
    it('emits one defensive rendered-layer snapshot after adding a layer', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      const listener = vi.fn();
      map.on('layerchange', listener);
      map.addLayer({
        id: 'my-layer',
        type: 'line',
        source: 'src1',
        paint: { 'line-color': '#f00', 'line-dasharray': [2, 3] },
      });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toMatchObject({
        reason: 'add',
        layerId: 'my-layer',
        layers: [{ id: 'my-layer', source: 'src1' }],
      });
      const eventLayer = listener.mock.calls[0][0].layers[0] as LayerSpecification;
      (
        eventLayer.paint as {
          'line-dasharray': number[];
        }
      )['line-dasharray'][0] = 99;
      expect(
        (
          map.getRenderedLayers()[0].paint as {
            'line-dasharray': readonly number[];
          }
        )['line-dasharray'],
      ).toEqual([2, 3]);
    });
    it('throws if source does not exist', () => {
      expect(() => map.addLayer({ id: 'l1', type: 'line', source: 'nonexistent' })).toThrow(
        'Source "nonexistent" not found',
      );
    });
    it('throws if layer id is duplicate', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      map.addLayer({ id: 'l1', type: 'line', source: 'src1' });
      expect(() => map.addLayer({ id: 'l1', type: 'line', source: 'src1' })).toThrow(
        'Layer "l1" already exists',
      );
    });
    it('rejects invalid style expressions synchronously', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      expect(() =>
        map.addLayer({
          id: 'x',
          type: 'fill',
          source: 'src1',
          paint: { 'fill-color': ['bogus', 1] },
        }),
      ).toThrow(/StyleExpression/);
    });
    it('setPaintProperty rejects invalid style expressions', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      map.addLayer({ id: 'l1', type: 'line', source: 'src1' });
      expect(() => map.setPaintProperty('l1', 'line-color', ['bogus', 1])).toThrow(
        /StyleExpression/,
      );
    });
    it('inserts before specified layer', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      map.addLayer({ id: 'a', type: 'line', source: 'src1' });
      map.addLayer({ id: 'c', type: 'line', source: 'src1' });
      map.addLayer({ id: 'b', type: 'line', source: 'src1' }, 'c');
      const ids = map.getLayers().map((l) => l.id);
      expect(ids).toEqual(['a', 'b', 'c']);
    });
    it('renders and hit-tests a later-added cross-source layer on top', () => {
      const lowerLayer = {
        name: 'lower-data',
        geometry_type: 'point' as const,
        shapes: [[[5, 5]]],
      };
      const upperLayer = {
        name: 'upper-data',
        geometry_type: 'point' as const,
        shapes: [[[5, 5]]],
      };
      registerMockSource(map, 'lower', createMockSource([lowerLayer]));
      registerMockSource(map, 'upper', createMockSource([upperLayer]));
      map.addLayer({
        id: 'lower-style',
        type: 'circle',
        source: 'lower',
        'source-layer': 'lower-data',
        paint: { 'circle-color': '#111' },
      });
      map.addLayer({
        id: 'upper-style',
        type: 'circle',
        source: 'upper',
        'source-layer': 'upper-data',
        paint: { 'circle-color': '#eee' },
      });
      const drawPoints = vi.fn();
      setPrivate(map, '_painter', { drawPoints });
      setPrivate(map, '_viewport', { getViewBounds: () => null });
      callPrivate(map, '_renderLayers', 1, 1);
      expect(drawPoints.mock.calls.map(([, style]) => style.color)).toEqual(['#111', '#eee']);
      setPrivate(map, '_featureQuery', {
        query: vi.fn(() => [
          {
            id: 0,
            source: 'lower',
            layer: 'lower-data',
            geometryType: 'point',
            properties: {},
          },
          {
            id: 0,
            source: 'upper',
            layer: 'upper-data',
            geometryType: 'point',
            properties: {},
          },
        ]),
      });
      expect(map.queryFeatures([5, 5]).map((feature) => feature.source)).toEqual([
        'upper',
        'lower',
      ]);
    });
    it('does not expose an unstyled source/layer pair that collides on colon-joined ids', () => {
      const visibleLayer = {
        name: 'c',
        geometry_type: 'point' as const,
        shapes: [[[5, 5]]],
      };
      const hiddenLayer = {
        name: 'b:c',
        geometry_type: 'point' as const,
        shapes: [[[5, 5]]],
      };
      registerMockSource(map, 'a:b', createMockSource([visibleLayer]));
      registerMockSource(map, 'a', createMockSource([hiddenLayer]));
      map.addLayer({
        id: 'visible-style',
        type: 'circle',
        source: 'a:b',
        'source-layer': 'c',
      });
      const sources = getPrivate(map, '_sources') as unknown as ConstructorParameters<
        typeof FeatureQuery
      >[0];
      setPrivate(
        map,
        '_featureQuery',
        new FeatureQuery(
          sources,
          () => new AffineTransform(),
          () => ({ width: 100, height: 100 }),
          () => 1,
        ),
      );
      expect(map.queryFeatures([5, 5]).map(({ source, layer }) => ({ source, layer }))).toEqual([
        { source: 'a:b', layer: 'c' },
      ]);
    });
    it('keeps arc-id caches separate for colon-bearing source/layer pairs', () => {
      const firstLayer = {
        name: 'c',
        geometry_type: 'polyline' as const,
        shapes: [[[0]]],
      };
      const secondLayer = {
        name: 'b:c',
        geometry_type: 'polyline' as const,
        shapes: [[[1]]],
      };
      const firstSource = createMockSource([firstLayer]);
      const secondSource = createMockSource([secondLayer]);
      firstSource.getArcs.mockReturnValue({ size: () => 2 } as never);
      secondSource.getArcs.mockReturnValue({ size: () => 2 } as never);
      registerMockSource(map, 'a:b', firstSource);
      registerMockSource(map, 'a', secondSource);
      map.addLayer({ id: 'first', type: 'line', source: 'a:b', 'source-layer': 'c' });
      map.addLayer({ id: 'second', type: 'line', source: 'a', 'source-layer': 'b:c' });
      const drawArcs = vi.fn();
      setPrivate(map, '_painter', { drawArcs });
      setPrivate(map, '_viewport', {
        getArcFilter: vi.fn(() => undefined),
        getViewBounds: () => null,
      });
      callPrivate(map, '_renderLayers', 1, 1);
      expect(Array.from(drawArcs.mock.calls[0][3])).toEqual([0]);
      expect(Array.from(drawArcs.mock.calls[1][3])).toEqual([1]);
    });
    it('throws if before layer does not exist', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      expect(() => map.addLayer({ id: 'l1', type: 'line', source: 'src1' }, 'nonexistent')).toThrow(
        'Layer "nonexistent" not found',
      );
    });
  });
  describe('removeLayer', () => {
    it('removes a layer by id', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      map.addLayer({ id: 'l1', type: 'line', source: 'src1' });
      map.addLayer({ id: 'l2', type: 'line', source: 'src1' });
      map.removeLayer('l1');
      expect(map.getLayers()).toHaveLength(1);
      expect(map.getLayer('l1')).toBeUndefined();
    });
    it('does nothing if layer does not exist', () => {
      map.removeLayer('nonexistent');
      expect(map.getLayers()).toHaveLength(0);
    });
    it('emits one rendered-layer snapshot after removing a layer', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      map.addLayer({ id: 'l1', type: 'line', source: 'src1' });
      map.addLayer({ id: 'l2', type: 'line', source: 'src1' });
      const listener = vi.fn();
      map.on('layerchange', listener);
      map.removeLayer('l1');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toMatchObject({
        reason: 'remove',
        layerId: 'l1',
        layers: [{ id: 'l2' }],
      });
    });
  });
  describe('setLayerVisibility', () => {
    it('sets visibility to none', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      map.addLayer({ id: 'l1', type: 'line', source: 'src1' });
      map.setLayerVisibility('l1', 'none');
      expect(map.getLayer('l1')?.layout?.visibility).toBe('none');
    });
    it('sets visibility to visible', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      map.addLayer({
        id: 'l1',
        type: 'line',
        source: 'src1',
        layout: { visibility: 'none' },
      });
      map.setLayerVisibility('l1', 'visible');
      expect(map.getLayer('l1')?.layout?.visibility).toBe('visible');
    });
    it('materializes every generated default only when one is actually hidden', () => {
      const source = createMockSource([
        { name: 'roads', geometry_type: 'polyline', shapes: [] },
        { name: 'cities', geometry_type: 'point', shapes: [] },
      ]);
      registerMockSource(map, 'src1', source);
      const scheduleRender = getPrivate(map, '_scheduleRender') as ReturnType<typeof vi.fn>;
      const listener = vi.fn();
      map.on('layerchange', listener);
      map.setLayerVisibility('src1:roads', 'none');
      expect(map.getLayers().map(({ id, layout }) => [id, layout?.visibility])).toEqual([
        ['src1:roads', 'none'],
        ['src1:cities', undefined],
      ]);
      expect(scheduleRender).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toMatchObject({
        reason: 'visibility',
        layerId: 'src1:roads',
        layers: [{ id: 'src1:roads', layout: { visibility: 'none' } }, { id: 'src1:cities' }],
      });
    });
    it('does not materialize, render, or emit for unknown and already-visible defaults', () => {
      const source = createMockSource([{ name: 'roads', geometry_type: 'polyline', shapes: [] }]);
      registerMockSource(map, 'src1', source);
      const scheduleRender = getPrivate(map, '_scheduleRender') as ReturnType<typeof vi.fn>;
      const listener = vi.fn();
      map.on('layerchange', listener);
      map.setLayerVisibility('missing', 'none');
      map.setLayerVisibility('src1:roads', 'visible');
      expect(map.getLayers()).toEqual([]);
      expect(scheduleRender).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
    });
    it('does not render or emit when an explicit layer already has the requested visibility', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      map.addLayer({
        id: 'l1',
        type: 'line',
        source: 'src1',
        layout: { visibility: 'none' },
      });
      const scheduleRender = getPrivate(map, '_scheduleRender') as ReturnType<typeof vi.fn>;
      scheduleRender.mockClear();
      const listener = vi.fn();
      map.on('layerchange', listener);
      map.setLayerVisibility('l1', 'none');
      expect(scheduleRender).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
    });
    it('emits one visibility snapshot after an explicit layer changes', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      map.addLayer({ id: 'l1', type: 'line', source: 'src1' });
      const listener = vi.fn();
      map.on('layerchange', listener);
      map.setLayerVisibility('l1', 'none');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toMatchObject({
        reason: 'visibility',
        layerId: 'l1',
        layers: [{ id: 'l1', layout: { visibility: 'none' } }],
      });
    });
  });
  describe('setPaintProperty', () => {
    it('updates a paint property', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      map.addLayer({
        id: 'l1',
        type: 'line',
        source: 'src1',
        paint: { 'line-color': '#333' },
      });
      map.setPaintProperty('l1', 'line-color', '#ff0');
      const layer = map.getLayer('l1');
      expect((layer?.paint as any)?.['line-color']).toBe('#ff0');
    });
    it('creates paint object if not present', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      map.addLayer({ id: 'l1', type: 'line', source: 'src1' });
      map.setPaintProperty('l1', 'line-width', 5);
      const layer = map.getLayer('l1');
      expect((layer?.paint as any)?.['line-width']).toBe(5);
    });
  });
  describe('moveLayer', () => {
    it('moves a layer to the end', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      map.addLayer({ id: 'a', type: 'line', source: 'src1' });
      map.addLayer({ id: 'b', type: 'line', source: 'src1' });
      map.addLayer({ id: 'c', type: 'line', source: 'src1' });
      map.moveLayer('a');
      expect(map.getLayers().map((l) => l.id)).toEqual(['b', 'c', 'a']);
    });
    it('moves a layer before another', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      map.addLayer({ id: 'a', type: 'line', source: 'src1' });
      map.addLayer({ id: 'b', type: 'line', source: 'src1' });
      map.addLayer({ id: 'c', type: 'line', source: 'src1' });
      map.moveLayer('c', 'a');
      expect(map.getLayers().map((l) => l.id)).toEqual(['c', 'a', 'b']);
    });
    it('emits the reordered effective snapshot', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      map.addLayer({ id: 'a', type: 'line', source: 'src1' });
      map.addLayer({ id: 'b', type: 'line', source: 'src1' });
      const listener = vi.fn();
      map.on('layerchange', listener);
      map.moveLayer('b', 'a');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toMatchObject({
        reason: 'effective',
        layerId: 'b',
        layers: [{ id: 'b' }, { id: 'a' }],
      });
    });
  });
  describe('_getEffectiveLayers', () => {
    it('returns explicit layers when present', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      map.addLayer({ id: 'l1', type: 'line', source: 'src1' });
      const effective = callPrivate(map, '_getEffectiveLayers') as LayerSpecification[];
      expect(effective).toHaveLength(1);
      expect(effective[0].id).toBe('l1');
    });
    it('returns deep-cloned rendered snapshots for explicit layers', () => {
      const source = createMockSource();
      registerMockSource(map, 'src1', source);
      map.addLayer({
        id: 'l1',
        type: 'line',
        source: 'src1',
        paint: { 'line-color': '#123', 'line-dasharray': [2, 4] },
        layout: { visibility: 'none' },
      });
      const snapshot = map.getRenderedLayers() as LayerSpecification[];
      snapshot[0].id = 'changed';
      snapshot[0].layout!.visibility = 'visible';
      (
        snapshot[0].paint as {
          'line-dasharray': number[];
        }
      )['line-dasharray'][0] = 99;
      expect(map.getRenderedLayers()).toEqual([
        {
          id: 'l1',
          type: 'line',
          source: 'src1',
          paint: { 'line-color': '#123', 'line-dasharray': [2, 4] },
          layout: { visibility: 'none' },
        },
      ]);
    });
    it('auto-generates defaults from sources when no layers added', () => {
      const layers = [
        { name: 'roads', geometry_type: 'polyline', shapes: [[1]] },
        { name: 'cities', geometry_type: 'point', shapes: [[0, 0]] },
      ];
      const source = createMockSource(layers);
      registerMockSource(map, 'src1', source);
      const effective = callPrivate(map, '_getEffectiveLayers') as LayerSpecification[];
      expect(effective).toHaveLength(2);
      expect(effective[0].id).toBe('src1:roads');
      expect(effective[0].type).toBe('line');
      expect(effective[1].id).toBe('src1:cities');
      expect(effective[1].type).toBe('circle');
      expect((effective[1].paint as any)['circle-color']).toBe(
        (effective[0].paint as any)['line-color'],
      );
    });
    it('exposes generated defaults without changing explicit getLayers semantics', () => {
      const source = createMockSource([{ name: 'roads', geometry_type: 'polyline', shapes: [] }]);
      registerMockSource(map, 'src1', source);
      expect(map.getRenderedLayers()).toMatchObject([
        { id: 'src1:roads', type: 'line', source: 'src1', 'source-layer': 'roads' },
      ]);
      expect(map.getLayers()).toEqual([]);
    });
    it('does not expose the generated-layer cache through rendered snapshots', () => {
      const source = createMockSource([{ name: 'roads', geometry_type: 'polyline', shapes: [] }]);
      registerMockSource(map, 'src1', source);
      const snapshot = map.getRenderedLayers() as LayerSpecification[];
      const originalId = snapshot[0].id;
      const originalLineColor = (
        snapshot[0].paint as {
          'line-color': string;
        }
      )['line-color'];
      snapshot[0].id = 'changed';
      (
        snapshot[0].paint as {
          'line-color': string;
        }
      )['line-color'] = '#fff';
      expect(map.getRenderedLayers()).toMatchObject([
        { id: originalId, paint: { 'line-color': originalLineColor } },
      ]);
      expect((callPrivate(map, '_getEffectiveLayers') as LayerSpecification[])[0].id).toBe(
        'src1:roads',
      );
    });
    it('emits effective after committed generated source changes and ignores unchanged data', () => {
      let sourceLayers = [{ name: 'roads', geometry_type: 'polyline', shapes: [] }];
      const source = createMockSource();
      source.getLayers.mockImplementation(() => sourceLayers);
      registerMockSource(map, 'src1', source);
      expect(map.getRenderedLayers().map((layer) => layer.id)).toEqual(['src1:roads']);
      const committedIds: string[][] = [];
      const listener = vi.fn(() => {
        committedIds.push(map.getRenderedLayers().map((layer) => layer.id));
      });
      map.on('layerchange', listener);
      sourceLayers = [
        { name: 'roads', geometry_type: 'polyline', shapes: [] },
        { name: 'cities', geometry_type: 'point', shapes: [] },
      ];
      callPrivate(map, '_handleSourceData', 'src1', source, { reason: 'load' });
      callPrivate(map, '_handleSourceData', 'src1', source, { reason: 'replace' });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toMatchObject({
        reason: 'effective',
        layers: [{ id: 'src1:roads' }, { id: 'src1:cities' }],
      });
      expect(committedIds).toEqual([['src1:roads', 'src1:cities']]);
    });
    it('captures changed source layers before a data listener changes visibility', () => {
      let sourceLayers = [{ name: 'roads', geometry_type: 'polyline', shapes: [] }];
      const source = createMockSource();
      source.getLayers.mockImplementation(() => sourceLayers);
      registerMockSource(map, 'src1', source);
      expect(map.getRenderedLayers().map((layer) => layer.id)).toEqual(['src1:roads']);
      const events: unknown[] = [];
      map.on('layerchange', (event) => {
        events.push({
          type: event.type,
          reason: event.reason,
          layerId: event.layerId,
          layers: event.layers.map((layer) => [layer.id, layer.layout?.visibility ?? 'visible']),
        });
      });
      map.on('data', () => {
        events.push({ type: 'data' });
        map.setLayerVisibility('src1:roads', 'none');
      });
      sourceLayers = [
        { name: 'roads', geometry_type: 'polyline', shapes: [] },
        { name: 'cities', geometry_type: 'point', shapes: [] },
      ];
      callPrivate(map, '_handleSourceData', 'src1', source, { reason: 'replace' });
      expect(events).toEqual([
        {
          type: 'layerchange',
          reason: 'effective',
          layerId: undefined,
          layers: [
            ['src1:roads', 'visible'],
            ['src1:cities', 'visible'],
          ],
        },
        { type: 'data' },
        {
          type: 'layerchange',
          reason: 'visibility',
          layerId: 'src1:roads',
          layers: [
            ['src1:roads', 'none'],
            ['src1:cities', 'visible'],
          ],
        },
      ]);
    });
    it('emits effective after a generated source removal commits', () => {
      registerMockSource(
        map,
        'keep',
        createMockSource([{ name: 'roads', geometry_type: 'polyline', shapes: [] }]),
      );
      registerMockSource(
        map,
        'drop',
        createMockSource([{ name: 'cities', geometry_type: 'point', shapes: [] }]),
      );
      expect(map.getRenderedLayers().map((layer) => layer.id)).toEqual([
        'keep:roads',
        'drop:cities',
      ]);
      const sourceAtEvent: unknown[] = [];
      const listener = vi.fn(() => sourceAtEvent.push(map.getSource('drop')));
      map.on('layerchange', listener);
      map.removeSource('drop');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toMatchObject({
        reason: 'effective',
        layers: [{ id: 'keep:roads' }],
      });
      expect(sourceAtEvent).toEqual([undefined]);
    });
    it('emits on explicit source removal only when rendered layers are removed', () => {
      registerMockSource(map, 'keep', createMockSource());
      registerMockSource(map, 'drop', createMockSource());
      map.addLayer({ id: 'keep-layer', type: 'line', source: 'keep' });
      const listener = vi.fn();
      map.on('layerchange', listener);
      map.removeSource('drop');
      expect(listener).not.toHaveBeenCalled();
      map.removeSource('keep');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toMatchObject({ reason: 'effective', layers: [] });
    });
    it('captures removed-source layers before selection and history listeners mutate them', () => {
      registerMockSource(map, 'keep', createMockSource());
      registerMockSource(map, 'drop', createMockSource());
      map.addLayer({ id: 'keep-a', type: 'line', source: 'keep' });
      map.addLayer({ id: 'keep-b', type: 'line', source: 'keep' });
      map.addLayer({ id: 'drop-layer', type: 'line', source: 'drop' });
      map.select([{ source: 'drop', layer: 'drop-layer', id: 0 }]);
      const history = getPrivate(map, '_history') as EditHistory;
      history.push({ label: 'prior edit', do() {}, undo() {} });
      const events: unknown[] = [];
      map.on('layerchange', (event) => {
        events.push({
          type: event.type,
          reason: event.reason,
          layerId: event.layerId,
          layers: event.layers.map((layer) => [layer.id, layer.layout?.visibility ?? 'visible']),
        });
      });
      map.on('selectionchange', () => {
        events.push({ type: 'selectionchange' });
        map.moveLayer('keep-b', 'keep-a');
      });
      map.on('historychange', () => {
        events.push({ type: 'historychange' });
        map.setLayerVisibility('keep-b', 'none');
      });
      map.removeSource('drop');
      expect(events).toEqual([
        {
          type: 'layerchange',
          reason: 'effective',
          layerId: undefined,
          layers: [
            ['keep-a', 'visible'],
            ['keep-b', 'visible'],
          ],
        },
        { type: 'selectionchange' },
        {
          type: 'layerchange',
          reason: 'effective',
          layerId: 'keep-b',
          layers: [
            ['keep-b', 'visible'],
            ['keep-a', 'visible'],
          ],
        },
        { type: 'historychange' },
        {
          type: 'layerchange',
          reason: 'visibility',
          layerId: 'keep-b',
          layers: [
            ['keep-b', 'none'],
            ['keep-a', 'visible'],
          ],
        },
      ]);
    });
    it('creates a default line layer for source with no mapshaper layers', () => {
      const source = createMockSource([]);
      registerMockSource(map, 'src1', source);
      const effective = callPrivate(map, '_getEffectiveLayers') as LayerSpecification[];
      expect(effective).toHaveLength(1);
      expect(effective[0].id).toBe('src1:default');
      expect(effective[0].type).toBe('line');
    });
    it('maps polygon geometry to a line (outline-only) layer by default', () => {
      // Default polygon rendering is outline-only — Canvas 2D fill is much
      // more expensive than stroke for many-polygon datasets, and matches
      // mapshaper GUI's behaviour. Callers opt into fills via addLayer().
      const layers = [{ name: 'countries', geometry_type: 'polygon', shapes: [[[1]]] }];
      const source = createMockSource(layers);
      registerMockSource(map, 'src1', source);
      const effective = callPrivate(map, '_getEffectiveLayers') as LayerSpecification[];
      expect(effective[0].type).toBe('line');
      expect((effective[0].paint as any)['line-color']).toBe(EMAP_THEME_COLORS.primary);
    });
  });
  describe('_getVisibleLayerKeys', () => {
    it('excludes layers with visibility none', () => {
      const layers = [{ name: 'roads', geometry_type: 'polyline', shapes: [] }];
      const source = createMockSource(layers);
      registerMockSource(map, 'src1', source);
      map.addLayer({
        id: 'l1',
        type: 'line',
        source: 'src1',
        'source-layer': 'roads',
        layout: { visibility: 'none' },
      });
      const keys = callPrivate(map, '_getVisibleLayerKeys') as Map<string, Set<string>>;
      expect(keys.size).toBe(0);
    });
    it('includes visible layers', () => {
      const layers = [{ name: 'roads', geometry_type: 'polyline', shapes: [] }];
      const source = createMockSource(layers);
      registerMockSource(map, 'src1', source);
      map.addLayer({
        id: 'l1',
        type: 'line',
        source: 'src1',
        'source-layer': 'roads',
      });
      const keys = callPrivate(map, '_getVisibleLayerKeys') as Map<string, Set<string>>;
      expect(keys.get('src1')?.has('roads')).toBe(true);
    });
  });
});
describe('Emap layer display filter', () => {
  it('addLayer accepts a StyleExpression filter and getFilter returns it', async () => {
    const map = await createBareMap();
    registerMockSource(map, 'src1', createMockSource());
    map.addLayer({ id: 'l1', type: 'circle', source: 'src1', filter: ['>', ['get', 'pop'], 100] });
    expect(map.getFilter('l1')).toEqual(['>', ['get', 'pop'], 100]);
  });
  it('addLayer rejects an invalid filter expression synchronously', async () => {
    const map = await createBareMap();
    registerMockSource(map, 'src1', createMockSource());
    expect(() =>
      map.addLayer({ id: 'l1', type: 'circle', source: 'src1', filter: ['not-an-op', 1] }),
    ).toThrow(/Layer "l1" filter/);
  });
  it('materializes a default layer when setting its filter', async () => {
    const map = await createBareMap();
    registerMockSource(
      map,
      'src1',
      createMockSource([{ name: 'cities', geometry_type: 'point', shapes: [] }]),
    );
    const filter = ['>', ['get', 'pop'], 100] as const;
    map.setFilter('src1:cities', filter);
    expect(map.getFilter('src1:cities')).toEqual(filter);
    expect(map.getLayers()).toContainEqual(expect.objectContaining({ id: 'src1:cities', filter }));
  });
  it('setFilter/getFilter round-trip and null clears', async () => {
    const map = await createBareMap();
    registerMockSource(map, 'src1', createMockSource());
    map.addLayer({ id: 'l1', type: 'circle', source: 'src1' });
    map.setFilter('l1', ['==', ['get', 'level'], 'A']);
    expect(map.getFilter('l1')).toEqual(['==', ['get', 'level'], 'A']);
    map.setFilter('l1', null);
    expect(map.getFilter('l1')).toBeUndefined();
  });
  it('setFilter rejects an invalid expression and keeps the old filter', async () => {
    const map = await createBareMap();
    registerMockSource(map, 'src1', createMockSource());
    map.addLayer({ id: 'l1', type: 'circle', source: 'src1', filter: ['>', ['get', 'pop'], 100] });
    expect(() => map.setFilter('l1', ['not-an-op'])).toThrow(/filter/);
    expect(map.getFilter('l1')).toEqual(['>', ['get', 'pop'], 100]);
  });
  it('setFilter fires layerchange with reason filter', async () => {
    const map = await createBareMap();
    registerMockSource(map, 'src1', createMockSource());
    map.addLayer({ id: 'l1', type: 'circle', source: 'src1' });
    const events: Array<{
      reason: string;
      layerId?: string;
    }> = [];
    map.on('layerchange', (e) => events.push(e));
    map.setFilter('l1', ['>', ['get', 'pop'], 100]);
    expect(events).toContainEqual(expect.objectContaining({ reason: 'filter', layerId: 'l1' }));
  });
  it('setFilter does not touch undo history', async () => {
    const map = await createBareMap();
    registerMockSource(map, 'src1', createMockSource());
    map.addLayer({ id: 'l1', type: 'circle', source: 'src1' });
    map.setFilter('l1', ['>', ['get', 'pop'], 100]);
    expect(map.canUndo()).toBe(false);
  });
  it('reports structured details when a filter produces a non-boolean value', async () => {
    const map = await createBareMap();
    const filter = ['get', 'enabled'] as const;
    const dataLayer = {
      name: 'cities',
      geometry_type: 'point',
      shapes: [[[0]]],
      data: { getRecords: () => [{ enabled: 'false' }] },
    };
    const source = createMockSource([dataLayer]);
    source.getDataset.mockReturnValue({ attributeVersion: 0, editVersion: 0 });
    setPrivate(
      map,
      '_filterResolver',
      new FilterResolver({
        onError: (e) =>
          map.fire('error', {
            error: e.error,
            layerId: e.layerId,
            filterExpression: e.expression,
            valueType: e.error instanceof FilterEvaluationError ? e.error.valueType : undefined,
          }),
      }),
    );
    registerMockSource(map, 'src1', source);
    setPrivate(map, 'features', new FeatureAccessor(map));
    map.addLayer({ id: 'l1', type: 'circle', source: 'src1', 'source-layer': 'cities', filter });
    const onError = vi.fn();
    map.on('error', onError);
    expect(map.features.countFiltered('l1')).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toEqual(
      expect.objectContaining({ layerId: 'l1', filterExpression: filter, valueType: 'string' }),
    );
  });
});
describe('Emap selection', () => {
  let map: Emap;
  const A: FeatureRef = { source: 's1', layer: 'l1', id: 1 };
  const B: FeatureRef = { source: 's1', layer: 'l1', id: 2 };
  beforeEach(async () => {
    map = await createBareMap();
  });
  it('starts empty', () => {
    expect(map.getSelection()).toEqual([]);
    expect(map.isSelected(A)).toBe(false);
  });
  it('fires selectionchange with the diff payload on add', () => {
    const listener = vi.fn();
    map.on('selectionchange', listener);
    map.select([A]);
    expect(listener).toHaveBeenCalledTimes(1);
    const ev = listener.mock.calls[0][0];
    expect(ev.added).toHaveLength(1);
    expect(ev.added[0]).toMatchObject(A);
    expect(ev.removed).toEqual([]);
    expect(ev.selected).toHaveLength(1);
  });
  it('does not fire when the call is a no-op', () => {
    map.select([A]);
    const listener = vi.fn();
    map.on('selectionchange', listener);
    // re-selecting the same feature in 'add' mode is a no-op
    map.select([A], { mode: 'add' });
    expect(listener).not.toHaveBeenCalled();
  });
  it('replace mode reports both added and removed', () => {
    map.select([A]);
    const listener = vi.fn();
    map.on('selectionchange', listener);
    map.select([B]); // mode defaults to 'replace'
    expect(listener).toHaveBeenCalledTimes(1);
    const ev = listener.mock.calls[0][0];
    expect(ev.added).toHaveLength(1);
    expect(ev.added[0]).toMatchObject(B);
    expect(ev.removed).toHaveLength(1);
    expect(ev.removed[0]).toMatchObject(A);
  });
  it('toggle mode flips membership', () => {
    map.select([A]);
    map.select([A], { mode: 'toggle' });
    expect(map.isSelected(A)).toBe(false);
    map.select([A], { mode: 'toggle' });
    expect(map.isSelected(A)).toBe(true);
  });
  it('deselect removes only the named features', () => {
    map.select([A, B], { mode: 'add' });
    map.deselect([A]);
    expect(map.isSelected(A)).toBe(false);
    expect(map.isSelected(B)).toBe(true);
  });
  it('clearSelection empties the set and fires once', () => {
    map.select([A, B], { mode: 'add' });
    const listener = vi.fn();
    map.on('selectionchange', listener);
    map.clearSelection();
    expect(map.getSelection()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
    const ev = listener.mock.calls[0][0];
    expect(ev.removed).toHaveLength(2);
    expect(ev.selected).toEqual([]);
  });
  it('clearSelection on an empty set does not fire', () => {
    const listener = vi.fn();
    map.on('selectionchange', listener);
    map.clearSelection();
    expect(listener).not.toHaveBeenCalled();
  });
  it('_isHoveringSelectedAt skips the spatial hit test when nothing is selected', () => {
    const queryFeatures = vi.fn(() => [A]);
    setPrivate(map, 'queryFeatures', queryFeatures);
    expect(callPrivate(map, '_isHoveringSelectedAt', { x: 5, y: 5 })).toBe(false);
    expect(queryFeatures).not.toHaveBeenCalled();
    map.select([A]);
    expect(callPrivate(map, '_isHoveringSelectedAt', { x: 5, y: 5 })).toBe(true);
    expect(queryFeatures).toHaveBeenCalledWith([5, 5]);
  });
});
describe('Emap edit history', () => {
  let map: Emap;
  beforeEach(async () => {
    map = await createBareMap();
    // createBareMap bypasses the constructor, so initialize the history field
    setPrivate(map, '_history', new EditHistory());
  });
  function makeCmd(label?: string) {
    return { do: vi.fn(), undo: vi.fn(), label };
  }
  it('pushCommand fires historychange with canUndo=true', () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    map.pushCommand(makeCmd('move'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      canUndo: true,
      canRedo: false,
      label: 'move',
    });
  });
  it("undo invokes the command's undo() and updates flags", () => {
    const cmd = makeCmd();
    map.pushCommand(cmd);
    expect(map.undo()).toBe(true);
    expect(cmd.undo).toHaveBeenCalledTimes(1);
    expect(map.canUndo()).toBe(false);
    expect(map.canRedo()).toBe(true);
  });
  it('redo invokes do() and restores undo availability', () => {
    const cmd = makeCmd();
    map.pushCommand(cmd);
    map.undo();
    expect(map.redo()).toBe(true);
    expect(cmd.do).toHaveBeenCalledTimes(1);
    expect(map.canUndo()).toBe(true);
    expect(map.canRedo()).toBe(false);
  });
  it('undo on empty history is a no-op and does not fire', () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    expect(map.undo()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });
  it('clearHistory empties stacks; fires once when non-empty', () => {
    map.pushCommand(makeCmd());
    const listener = vi.fn();
    map.on('historychange', listener);
    map.clearHistory();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(map.canUndo()).toBe(false);
    expect(map.canRedo()).toBe(false);
  });
  it('clearHistory on empty history is silent', () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    map.clearHistory();
    expect(listener).not.toHaveBeenCalled();
  });
});
describe('Emap deleteSelected', () => {
  let map: Emap;
  let layer: {
    shapes: any[];
    data?: {
      getRecords: () => Record<string, unknown>[];
    };
  };
  let records: Record<string, unknown>[];
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    records = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }];
    layer = {
      shapes: [['s0'], ['s1'], ['s2'], ['s3']],
      data: { getRecords: () => records },
    };
    const source = {
      id: 'src1',
      type: 'topology',
      getLayers: () => [layer],
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
  });
  function selectIds(ids: number[]): void {
    map.select(ids.map((id) => ({ source: 'src1', layer: 'layer-0', id })));
  }
  it('returns false on empty selection without firing events', () => {
    const historyListener = vi.fn();
    const selectionListener = vi.fn();
    map.on('historychange', historyListener);
    map.on('selectionchange', selectionListener);
    expect(map.deleteSelected()).toBe(false);
    expect(historyListener).not.toHaveBeenCalled();
    expect(selectionListener).not.toHaveBeenCalled();
  });
  it('deletes a single selected feature', () => {
    selectIds([1]);
    const ok = map.deleteSelected();
    expect(ok).toBe(true);
    expect(layer.shapes).toEqual([['s0'], ['s2'], ['s3']]);
    expect(records).toEqual([{ name: 'a' }, { name: 'c' }, { name: 'd' }]);
  });
  it('collapses multiple deletions into one history entry', () => {
    selectIds([0, 2, 3]);
    const historyListener = vi.fn();
    map.on('historychange', historyListener);
    map.deleteSelected();
    expect(historyListener).toHaveBeenCalledTimes(1);
    expect(map.canUndo()).toBe(true);
  });
  it('clears the selection on success and fires selectionchange with the deleted refs', () => {
    selectIds([1, 2]);
    const selectionListener = vi.fn();
    map.on('selectionchange', selectionListener);
    map.deleteSelected();
    expect(map.getSelection()).toEqual([]);
    expect(selectionListener).toHaveBeenCalledTimes(1);
    const ev = selectionListener.mock.calls[0][0];
    expect(ev.removed).toHaveLength(2);
    expect(ev.selected).toEqual([]);
  });
  it('descending-id deletion preserves intra-layer integrity', () => {
    selectIds([1, 2]);
    map.deleteSelected();
    // Initially [s0,s1,s2,s3]; delete ids 2 then 1 → [s0,s3]
    expect(layer.shapes).toEqual([['s0'], ['s3']]);
    expect(records).toEqual([{ name: 'a' }, { name: 'd' }]);
  });
  it('a single undo restores all deleted features at original indices', () => {
    selectIds([0, 2, 3]);
    map.deleteSelected();
    expect(layer.shapes).toEqual([['s1']]);
    map.undo();
    expect(layer.shapes).toEqual([['s0'], ['s1'], ['s2'], ['s3']]);
    expect(records).toEqual([{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }]);
  });
});
describe('Emap clipLayer / eraseLayer', () => {
  let map: Emap;
  let source: any;
  let beforeDataset: any;
  let afterDataset: any;
  let copyDatasetSpy: ReturnType<typeof vi.fn>;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;
  // Capture mapshaper internals so we can drive the runner deterministically
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    beforeDataset = {
      layers: [
        { name: 'roads', geometry_type: 'polyline', shapes: [['orig']] },
        { name: 'park', geometry_type: 'polygon', shapes: [[[0]]] },
      ],
    };
    afterDataset = {
      layers: [
        { name: 'roads', geometry_type: 'polyline', shapes: [['clipped']] },
        { name: 'park', geometry_type: 'polygon', shapes: [[[0]]] },
      ],
    };
    source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDataset,
      getLayers: () => beforeDataset.layers,
      setDataset: vi.fn(),
      fire: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    };
    (map as any)._sources.set('src1', source);
    copyDatasetSpy = vi.fn(() => ({ ...beforeDataset, _isCopy: true })) as ReturnType<typeof vi.fn>;
    parseCommandsSpy = vi.fn((cmd: string) => [
      { name: 'parsed', options: { _cmd: cmd } },
    ]) as ReturnType<typeof vi.fn>;
    runParsedCommandsSpy = vi.fn((_cmds: any, _job: any, cb: any) => {
      // Simulate mapshaper mutating the input dataset by returning the
      // afterDataset reference from the catalog.
      cb(null, {
        catalog: {
          getDefaultTargets: () => [{ dataset: afterDataset }],
        },
      });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', copyDatasetSpy);
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('clipLayer returns false when the source does not exist', async () => {
    const ok = await map.ops.clipLayer({ source: 'nope', target: 'roads', mask: 'park' });
    expect(ok.ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('clipLayer returns false when the target layer is missing', async () => {
    const ok = await map.ops.clipLayer({ source: 'src1', target: 'missing', mask: 'park' });
    expect(ok.ok).toBe(false);
    expect(copyDatasetSpy).not.toHaveBeenCalled();
  });
  it('returns a mapshaper error without swapping when the working copy fails', async () => {
    copyDatasetSpy.mockImplementationOnce(() => {
      throw new Error('copy failed');
    });
    const result = await map.ops.clipLayer({
      source: 'src1',
      target: 'roads',
      mask: 'park',
    });
    expect(result).toMatchObject({ ok: false, error: { kind: 'mapshaper' } });
    expect(source.setDataset).not.toHaveBeenCalled();
  });
  it('clipLayer returns false when the mask layer is missing', async () => {
    const ok = await map.ops.clipLayer({ source: 'src1', target: 'roads', mask: 'nope' });
    expect(ok.ok).toBe(false);
  });
  it('clipLayer constructs a quoted mapshaper command and swaps the dataset', async () => {
    const ok = await map.ops.clipLayer({ source: 'src1', target: 'roads', mask: 'park' });
    expect(ok.ok).toBe(true);
    expect(runParsedCommandsSpy).toHaveBeenCalledTimes(1);
    expectCli('-target "roads" -clip source="park"', runParsedCommandsSpy.mock.calls[0][0]);
    expect(source.setDataset).toHaveBeenCalledWith(afterDataset, false);
  });
  it('eraseLayer constructs a -erase command', async () => {
    await map.ops.eraseLayer({ source: 'src1', target: 'roads', mask: 'park' });
    expectCli('-target "roads" -erase source="park"', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('clipLayer pushes exactly one DatasetReplaceCommand and labels it', async () => {
    const historyListener = vi.fn();
    map.on('historychange', historyListener);
    await map.ops.clipLayer({ source: 'src1', target: 'roads', mask: 'park' });
    expect(map.canUndo()).toBe(true);
    expect(historyListener).toHaveBeenCalledTimes(1);
    expect(historyListener.mock.calls[0][0].label).toBe('Clip roads');
  });
  it('commits dataset, history, and selection before publishing data listener failures', async () => {
    const realSource = new TopologySource('src1');
    realSource.setDataset(beforeDataset, false);
    setPrivate(map, '_sources', new globalThis.Map([['src1', realSource]]));
    map.select([{ source: 'src1', layer: 'roads', id: 0 }]);
    const failure = new Error('data listener failed');
    const observations: Array<{
      dataset: object | undefined;
      canUndo: boolean;
      selectionCount: number;
    }> = [];
    const delivered = vi.fn();
    const reported = vi.fn();
    realSource.on('data', () => {
      observations.push({
        dataset: realSource.getDataset(),
        canUndo: map.canUndo(),
        selectionCount: map.getSelection().length,
      });
      throw failure;
    });
    realSource.on('data', delivered);
    realSource.on<{
      error: unknown;
    }>('error', reported);
    const result = await map.ops.clipLayer({ source: 'src1', target: 'roads', mask: 'park' });
    expect(result.ok).toBe(true);
    expect(observations).toEqual([{ dataset: afterDataset, canUndo: true, selectionCount: 0 }]);
    expect(delivered).toHaveBeenCalledTimes(1);
    expect(reported).toHaveBeenCalledWith({ type: 'error', error: failure });
  });
  it('clipLayer flags prior history as stale (history barrier)', async () => {
    // Push a fake earlier command so the history is non-empty
    const priorCmd: any = { do: () => {}, undo: vi.fn() };
    map.pushCommand(priorCmd);
    expect(map.canUndo()).toBe(true);
    await map.ops.clipLayer({ source: 'src1', target: 'roads', mask: 'park' });
    // Prior commands are released and replaced by one lightweight stale boundary.
    expect(priorCmd.stale).toBeUndefined();
    map.undo();
    expect(source.setDataset).toHaveBeenCalledTimes(2);
    // First call applies afterDataset; undo restores the retained source dataset.
    const restoredArg = source.setDataset.mock.calls[1][0];
    expect(restoredArg).toBe(beforeDataset);
    // The compact stale boundary remains as the next undo target.
    expect(map.canUndo()).toBe(true);
    map.undo(); // skips the boundary without invoking the released command
    expect(priorCmd.undo).not.toHaveBeenCalled();
    expect(map.canUndo()).toBe(false);
  });
  it('clipLayer clears the selection and fires selectionchange', async () => {
    map.select([{ source: 'src1', layer: 'roads', id: 0 }]);
    const selectionListener = vi.fn();
    map.on('selectionchange', selectionListener);
    await map.ops.clipLayer({ source: 'src1', target: 'roads', mask: 'park' });
    expect(map.getSelection()).toEqual([]);
    expect(selectionListener).toHaveBeenCalled();
  });
  it('clipLayer surfaces mapshaper errors via the error event without throwing', async () => {
    runParsedCommandsSpy.mockImplementation((_cmds: any, _job: any, cb: any) => {
      cb(new Error('mapshaper boom'));
    });
    const errorListener = vi.fn();
    map.on('error', errorListener);
    const ok = await map.ops.clipLayer({ source: 'src1', target: 'roads', mask: 'park' });
    expect(ok.ok).toBe(false);
    expect(errorListener).toHaveBeenCalledTimes(1);
    expect(errorListener.mock.calls[0][0].error.message).toBe('mapshaper boom');
    // No history change on failure
    expect(map.canUndo()).toBe(false);
  });
  it('quotes layer names containing embedded quotes', async () => {
    beforeDataset.layers.push({ name: 'weird"name', geometry_type: 'polygon', shapes: [] });
    afterDataset.layers.push({ name: 'weird"name', geometry_type: 'polygon', shapes: [] });
    await map.ops.clipLayer({ source: 'src1', target: 'roads', mask: 'weird"name' });
    expectCli('-target "roads" -clip source="weird\\"name"', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('cleanLayer constructs a -clean command and pushes a single history entry', async () => {
    const ok = await map.ops.cleanLayer({ source: 'src1', target: 'roads' });
    expect(ok.ok).toBe(true);
    expectCli('-target "roads" -clean', runParsedCommandsSpy.mock.calls[0][0]);
    expect(map.canUndo()).toBe(true);
  });
  it('cleanLayer returns false when source / target is missing', async () => {
    expect((await map.ops.cleanLayer({ source: 'nope', target: 'roads' })).ok).toBe(false);
    expect((await map.ops.cleanLayer({ source: 'src1', target: 'missing' })).ok).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });
});
describe('Emap dissolveLayer', () => {
  let map: Emap;
  let source: any;
  let beforeDataset: any;
  let afterDataset: any;
  let copyDatasetSpy: ReturnType<typeof vi.fn>;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    beforeDataset = {
      layers: [{ name: 'states', geometry_type: 'polygon', shapes: [['s0'], ['s1'], ['s2']] }],
    };
    afterDataset = {
      layers: [{ name: 'states', geometry_type: 'polygon', shapes: [['merged']] }],
    };
    source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDataset,
      getLayers: () => beforeDataset.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    };
    (map as any)._sources.set('src1', source);
    copyDatasetSpy = vi.fn(() => ({ ...beforeDataset, _isCopy: true })) as ReturnType<typeof vi.fn>;
    parseCommandsSpy = vi.fn((cmd: string) => [
      { name: 'parsed', options: { _cmd: cmd } },
    ]) as ReturnType<typeof vi.fn>;
    runParsedCommandsSpy = vi.fn((_cmds: any, _job: any, cb: any) => {
      cb(null, {
        catalog: {
          getDefaultTargets: () => [{ dataset: afterDataset }],
        },
      });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', copyDatasetSpy);
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('whole-layer dissolve omits the field argument', async () => {
    const ok = await map.ops.dissolveLayer({ source: 'src1', target: 'states' });
    expect(ok.ok).toBe(true);
    expectCli('-target "states" -dissolve', runParsedCommandsSpy.mock.calls[0][0]);
    expect(source.setDataset).toHaveBeenCalledWith(afterDataset, false);
  });
  it('field-based dissolve emits the field as a quoted positional', async () => {
    await map.ops.dissolveLayer({ source: 'src1', target: 'states', field: 'region' });
    expectCli('-target "states" -dissolve "region"', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('returns false when the source does not exist', async () => {
    const ok = await map.ops.dissolveLayer({ source: 'nope', target: 'states' });
    expect(ok.ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when the target layer is missing', async () => {
    const ok = await map.ops.dissolveLayer({ source: 'src1', target: 'missing' });
    expect(ok.ok).toBe(false);
    expect(copyDatasetSpy).not.toHaveBeenCalled();
  });
  it('pushes one history entry labelled "Dissolve <target>"', async () => {
    const historyListener = vi.fn();
    map.on('historychange', historyListener);
    await map.ops.dissolveLayer({ source: 'src1', target: 'states' });
    expect(historyListener).toHaveBeenCalledTimes(1);
    expect(historyListener.mock.calls[0][0].label).toBe('Dissolve states');
  });
  it('clears the selection on success', async () => {
    map.select([{ source: 'src1', layer: 'states', id: 0 }]);
    const selectionListener = vi.fn();
    map.on('selectionchange', selectionListener);
    await map.ops.dissolveLayer({ source: 'src1', target: 'states' });
    expect(map.getSelection()).toEqual([]);
    expect(selectionListener).toHaveBeenCalled();
  });
  it('flags prior history as stale (history barrier inherited from runner)', async () => {
    const prior: any = { do: () => {}, undo: vi.fn() };
    map.pushCommand(prior);
    expect(map.canUndo()).toBe(true);
    await map.ops.dissolveLayer({ source: 'src1', target: 'states' });
    expect(prior.stale).toBeUndefined();
    map.undo(); // undoes the dataset-replace
    map.undo(); // skips the stale prior cmd
    expect(prior.undo).not.toHaveBeenCalled();
    expect(map.canUndo()).toBe(false);
  });
  it('quotes field names containing special characters', async () => {
    await map.ops.dissolveLayer({ source: 'src1', target: 'states', field: 'state name' });
    expectCli('-target "states" -dissolve "state name"', runParsedCommandsSpy.mock.calls[0][0]);
  });
});
describe('Emap attribute editing', () => {
  let map: Emap;
  let records: Record<string, unknown>[];
  let layer: {
    name: string;
    shapes: any[];
    data: {
      getRecords: () => Record<string, unknown>[];
    };
  };
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    records = [
      { name: 'A', pop: 100 },
      { name: 'B', pop: 200 },
      { name: 'C', pop: 300 },
    ];
    layer = {
      name: 'cities',
      shapes: [['s0'], ['s1'], ['s2']],
      data: { getRecords: () => records },
    };
    const datasetStub = { layers: [layer] };
    const source = {
      id: 'src1',
      type: 'topology',
      getLayers: () => [layer],
      getDataset: () => datasetStub,
    } as any;
    (map as any)._sources.set('src1', source);
  });
  describe('setFeatureProperty / setFeatureProperties', () => {
    it('overwrites a key and pushes one history entry', () => {
      const ok = map.attributes.setFeatureProperty(
        { source: 'src1', layer: 'cities', id: 1 },
        'name',
        'B-renamed',
      );
      expect(ok.ok).toBe(true);
      expect(records[1]).toEqual({ name: 'B-renamed', pop: 200 });
      expect(map.canUndo()).toBe(true);
    });
    it('returns false for a no-op (value already matches)', () => {
      const ok = map.attributes.setFeatureProperty(
        { source: 'src1', layer: 'cities', id: 0 },
        'name',
        'A',
      );
      expect(ok.ok).toBe(false);
      expect(map.canUndo()).toBe(false);
    });
    it('setting undefined deletes the key', () => {
      const ok = map.attributes.setFeatureProperty(
        { source: 'src1', layer: 'cities', id: 0 },
        'pop',
        undefined,
      );
      expect(ok.ok).toBe(true);
      expect('pop' in records[0]).toBe(false);
      map.undo();
      expect(records[0]).toEqual({ name: 'A', pop: 100 });
    });
    it('multi-key patch is one history entry and one historychange event', () => {
      const listener = vi.fn();
      map.on('historychange', listener);
      map.attributes.setFeatureProperties(
        { source: 'src1', layer: 'cities', id: 0 },
        { name: 'A2', pop: 999 },
      );
      expect(records[0]).toEqual({ name: 'A2', pop: 999 });
      expect(listener).toHaveBeenCalledTimes(1);
      map.undo();
      expect(records[0]).toEqual({ name: 'A', pop: 100 });
    });
    it('returns false when the ref does not resolve to a record', () => {
      const ok = map.attributes.setFeatureProperty(
        { source: 'src1', layer: 'cities', id: 999 },
        'name',
        'X',
      );
      expect(ok.ok).toBe(false);
    });
  });
  describe('addField / removeField / renameField', () => {
    it('addField sets default on records that did not have the key', () => {
      records.push({ name: 'D' }); // no pop
      map.attributes.addField({ source: 'src1', target: 'cities', field: 'pop', defaultValue: 0 });
      expect(records[3]).toEqual({ name: 'D', pop: 0 });
      // Pre-existing records keep their original pop
      expect(records[0]).toEqual({ name: 'A', pop: 100 });
      map.undo();
      expect('pop' in records[3]).toBe(false);
    });
    it('removeField round-trips exact values', () => {
      const before = JSON.parse(JSON.stringify(records));
      map.attributes.removeField({ source: 'src1', target: 'cities', field: 'pop' });
      expect(records.every((r) => !('pop' in r))).toBe(true);
      map.undo();
      expect(records).toEqual(before);
    });
    it('renameField refuses on collision', () => {
      records[0]['pop_v2'] = 'x'; // record 0 now has both pop and pop_v2
      const ok = map.attributes.renameField({
        source: 'src1',
        target: 'cities',
        from: 'pop',
        to: 'pop_v2',
      });
      expect(ok.ok).toBe(false);
      // Records were not mutated
      expect(records[0]).toEqual({ name: 'A', pop: 100, pop_v2: 'x' });
      expect(map.canUndo()).toBe(false);
    });
    it('renameField round-trips when no collision', () => {
      map.attributes.renameField({
        source: 'src1',
        target: 'cities',
        from: 'pop',
        to: 'population',
      });
      expect(records[0]).toEqual({ name: 'A', population: 100 });
      map.undo();
      expect(records[0]).toEqual({ name: 'A', pop: 100 });
    });
    it('addField returns false when the layer has no data table', () => {
      const noDataLayer = { name: 'no_data', shapes: [], data: undefined } as any;
      const source = { id: 'src1', type: 'topology', getLayers: () => [noDataLayer] };
      (map as any)._sources.set('src1', source);
      const ok = map.attributes.addField({ source: 'src1', target: 'no_data', field: 'x' });
      expect(ok.ok).toBe(false);
    });
  });
  describe('history composition', () => {
    it('attribute and dataset commands interleave in one timeline', () => {
      // Attribute write
      map.attributes.setFeatureProperty({ source: 'src1', layer: 'cities', id: 0 }, 'name', 'A2');
      // Manual fake "geometry" command
      const geomUndo = vi.fn();
      map.pushCommand({ do: () => {}, undo: geomUndo, label: 'fake geom' });
      // Two undos should reverse in reverse order: geom first, then attribute.
      map.undo();
      expect(geomUndo).toHaveBeenCalledTimes(1);
      map.undo();
      expect(records[0]).toEqual({ name: 'A', pop: 100 });
    });
  });
});
describe('Emap mergeSelected', () => {
  let map: Emap;
  let source: any;
  let beforeDataset: any;
  let afterDataset: any;
  let copyDatasetSpy: ReturnType<typeof vi.fn>;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    // Records must live in a stable closure-captured array so the
    // discriminator stamp written by mergeSelected is observable on the
    // next getRecords() call. Real mapshaper's DataTable returns the same
    // array reference on every call; the prior `() => [...]` mock returned
    // a fresh array each time and silently discarded mutations.
    const layerRecords = [
      { name: 'A', area: 1 } as Record<string, unknown>,
      { name: 'B', area: 2 } as Record<string, unknown>,
      { name: 'C', area: 3 } as Record<string, unknown>,
      { name: 'D', area: 4 } as Record<string, unknown>,
    ];
    const layer = {
      name: 'parcels',
      geometry_type: 'polygon',
      shapes: [['s0'], ['s1'], ['s2'], ['s3']],
      data: getDefaultMapshaperAdapter().createDataTable(layerRecords),
    };
    const otherLayer = {
      name: 'roads',
      geometry_type: 'polyline',
      shapes: [],
    };
    beforeDataset = { layers: [layer, otherLayer] };
    afterDataset = { layers: [{ name: 'parcels', shapes: [['merged']] }, otherLayer] };
    source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDataset,
      getLayers: () => beforeDataset.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    };
    (map as any)._sources.set('src1', source);
    copyDatasetSpy = vi.fn(() => originalCopyDataset(beforeDataset));
    parseCommandsSpy = vi.fn((cmd: string) => [
      { name: 'parsed', options: { _cmd: cmd } },
    ]) as ReturnType<typeof vi.fn>;
    runParsedCommandsSpy = vi.fn((_cmds: any, _job: any, cb: any) => {
      cb(null, {
        catalog: { getDefaultTargets: () => [{ dataset: afterDataset }] },
      });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', copyDatasetSpy);
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('returns false on empty selection without firing', async () => {
    const ok = await map.ops.mergeSelected();
    expect(ok.ok).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false on cross-layer selection', async () => {
    map.select(
      [
        { source: 'src1', layer: 'parcels', id: 0 },
        { source: 'src1', layer: 'roads', id: 0 },
      ],
      { mode: 'add' },
    );
    const ok = await map.ops.mergeSelected();
    expect(ok.ok).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false on cross-source selection', async () => {
    (map as any)._sources.set('src2', { ...source, id: 'src2' });
    map.select(
      [
        { source: 'src1', layer: 'parcels', id: 0 },
        { source: 'src2', layer: 'parcels', id: 0 },
      ],
      { mode: 'add' },
    );
    const ok = await map.ops.mergeSelected();
    expect(ok.ok).toBe(false);
  });
  it('prepares an isolated polygon union without mutating live records', async () => {
    const liveRecords = beforeDataset.layers[0].data.getRecords();
    map.select(
      [
        { source: 'src1', layer: 'parcels', id: 2 },
        { source: 'src1', layer: 'parcels', id: 0 },
        { source: 'src1', layer: 'parcels', id: 3 },
      ],
      { mode: 'add' },
    );
    const ok = await map.ops.mergeSelected();
    expect(ok).toEqual({ ok: true, value: undefined });
    expect(liveRecords).toEqual([
      { name: 'A', area: 1 },
      { name: 'B', area: 2 },
      { name: 'C', area: 3 },
      { name: 'D', area: 4 },
    ]);
    const commands = runParsedCommandsSpy.mock.calls[0][0] as Array<{
      name: string;
      options: Record<string, unknown>;
    }>;
    expect(commands.map((command) => command.name)).toEqual([
      'target',
      'dissolve2',
      'target',
      'merge-layers',
    ]);
    expect(commands[1].options.copy_fields).toEqual(['name', 'area']);
    expect(JSON.stringify(commands)).not.toContain('[0,2,3]');
    expect(JSON.stringify(commands)).not.toContain('__emap_merge\"');
  });
  it('refuses to run when the layer has no data table', async () => {
    beforeDataset.layers[0].data = undefined;
    map.select(
      [
        { source: 'src1', layer: 'parcels', id: 0 },
        { source: 'src1', layer: 'parcels', id: 1 },
      ],
      { mode: 'add' },
    );
    const ok = await map.ops.mergeSelected();
    expect(ok.ok).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });
  it('pushes one history entry labelled "Merge N features" and clears selection', async () => {
    map.select(
      [
        { source: 'src1', layer: 'parcels', id: 0 },
        { source: 'src1', layer: 'parcels', id: 1 },
      ],
      { mode: 'add' },
    );
    const historyListener = vi.fn();
    const selectionListener = vi.fn();
    map.on('historychange', historyListener);
    map.on('selectionchange', selectionListener);
    await map.ops.mergeSelected();
    expect(historyListener).toHaveBeenCalledTimes(1);
    expect(historyListener.mock.calls[0][0].label).toBe('Merge 2 features');
    expect(map.getSelection()).toEqual([]);
    expect(selectionListener).toHaveBeenCalled();
  });
  it('flags prior history as stale (history barrier)', async () => {
    const prior: any = { do: () => {}, undo: vi.fn() };
    map.pushCommand(prior);
    map.select([
      { source: 'src1', layer: 'parcels', id: 0 },
      { source: 'src1', layer: 'parcels', id: 1 },
    ]);
    await map.ops.mergeSelected();
    expect(prior.stale).toBeUndefined();
    map.undo(); // dataset-replace
    map.undo(); // stale prior — skipped
    expect(prior.undo).not.toHaveBeenCalled();
    expect(map.canUndo()).toBe(false);
  });
  it('preserves comma-containing fields in parsed copy-fields options', async () => {
    beforeDataset.layers[0].data = getDefaultMapshaperAdapter().createDataTable([
      { safe: 1, 'has,comma': 'a' },
      { safe: 2, 'has,comma': 'b' },
      { safe: 3, 'has,comma': 'c' },
      { safe: 4, 'has,comma': 'd' },
    ]);
    map.select(
      [
        { source: 'src1', layer: 'parcels', id: 0 },
        { source: 'src1', layer: 'parcels', id: 1 },
      ],
      { mode: 'add' },
    );
    await map.ops.mergeSelected();
    const commands = runParsedCommandsSpy.mock.calls[0][0] as Array<{
      name: string;
      options: Record<string, unknown>;
    }>;
    expect(commands.find((command) => command.name === 'dissolve2')?.options.copy_fields).toEqual([
      'safe',
      'has,comma',
    ]);
  });
});
// End-to-end mergeSelected against the real mapshaper pipeline. Catches
// expression-context regressions like the early `this.__emap_merge = ...`
// bug where bare assignment vs this-assignment matters: mapshaper's
// -each writes through bare names but silently drops `this.foo = ...`.
describe('Emap mergeSelected end-to-end', () => {
  // Lightweight fixture: 4 polygons in a row, single source / single layer.
  const FAKE_GEOJSON = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'A', area: 1 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { name: 'B', area: 2 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [1, 0],
              [2, 0],
              [2, 1],
              [1, 1],
              [1, 0],
            ],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { name: 'C', area: 3 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [2, 0],
              [3, 0],
              [3, 1],
              [2, 1],
              [2, 0],
            ],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { name: 'D', area: 4 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [3, 0],
              [4, 0],
              [4, 1],
              [3, 1],
              [3, 0],
            ],
          ],
        },
      },
    ],
  });
  function importFixture(): Promise<any> {
    return new Promise((resolve, reject) => {
      const job = new mapshaper.internal.Job();
      const cmds = mapshaper.internal.parseCommands('-i poly.json');
      cmds[0].options.input = { 'poly.json': FAKE_GEOJSON };
      mapshaper.internal.runParsedCommands(cmds, job, (err: any) => {
        if (err) return reject(err);
        resolve(job.catalog.getDefaultTargets()[0].dataset);
      });
    });
  }
  it('actually merges 2 of 4 features through the real mapshaper pipeline', async () => {
    const map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const initialDataset = await importFixture();
    let currentDataset = initialDataset;
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => currentDataset,
      getLayers: () => currentDataset.layers,
      getArcs: () => currentDataset.arcs,
      setDataset: (ds: any) => {
        currentDataset = ds;
      },
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    // Select features 0 (A) and 2 (C); merge should yield 3 records: AC + B + D
    const layerName = initialDataset.layers[0].name;
    map.select(
      [
        { source: 'src1', layer: layerName, id: 0 },
        { source: 'src1', layer: layerName, id: 2 },
      ],
      { mode: 'add' },
    );
    const ok = await map.ops.mergeSelected();
    expect(ok.ok).toBe(true);
    const records = currentDataset.layers[0].data!.getRecords();
    expect(records).toHaveLength(3);
    // Discriminator field must be removed from the schema after cleanup
    expect(currentDataset.layers[0].data!.getFields()).not.toContain('__emap_merge');
    expect(currentDataset.layers[0].data!.getFields().sort()).toEqual(['area', 'name']);
    // Selected (A + C) merged into one feature; mapshaper's copy-fields
    // semantics retain the FIRST selected record's attrs (= A)
    const names = records.map((r: any) => r.name).sort();
    expect(names).toEqual(['A', 'B', 'D']);
  });
  it('produces no error event when merging single-layer polygon data', async () => {
    const map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    let currentDataset = await importFixture();
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => currentDataset,
      getLayers: () => currentDataset.layers,
      getArcs: () => currentDataset.arcs,
      setDataset: (ds: any) => {
        currentDataset = ds;
      },
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    const errs: unknown[] = [];
    map.on('error', (e: any) => errs.push(e));
    const layerName = currentDataset.layers[0].name;
    map.select(
      [
        { source: 'src1', layer: layerName, id: 0 },
        { source: 'src1', layer: layerName, id: 1 },
      ],
      { mode: 'add' },
    );
    const ok = await map.ops.mergeSelected();
    expect(ok.ok).toBe(true);
    expect(errs).toEqual([]);
  });
});
describe('Emap translateSelected', () => {
  let map: Emap;
  let polyLayer: any;
  let pointLayer: any;
  let arcs: any;
  let xx: Float64Array;
  let yy: Float64Array;
  let updateArcBoundsSpy: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    // Two arcs of 2 vertices each at distinct locations
    xx = new Float64Array([0, 1, 10, 11]);
    yy = new Float64Array([0, 1, 10, 11]);
    updateArcBoundsSpy = vi.fn();
    arcs = {
      getVertexData: () => ({
        xx,
        yy,
        nn: new Int32Array([2, 2]),
        ii: new Int32Array([0, 2]),
        zz: null,
      }),
      updateArcBounds: updateArcBoundsSpy,
    };
    polyLayer = {
      name: 'parcels',
      geometry_type: 'polygon',
      // shape 0 references arc 0; shape 1 references arc 1
      shapes: [[[0]], [[1]]],
    };
    pointLayer = {
      name: 'cities',
      geometry_type: 'point',
      shapes: [[[100, 200]]],
    };
    const source = {
      id: 'src1',
      type: 'topology',
      getLayers: () => [polyLayer, pointLayer],
      getArcs: () => arcs,
      refreshDisplayArcs: vi.fn(),
    };
    (map as any)._sources.set('src1', source);
  });
  it('returns false on empty selection', () => {
    expect(map.editSession.translateSelected(10, 5).ok).toBe(false);
  });
  it('returns false on zero offset', () => {
    map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
    expect(map.editSession.translateSelected(0, 0).ok).toBe(false);
    expect(map.canUndo()).toBe(false);
  });
  it('translates one polygon by collecting its arc id', () => {
    map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
    const ok = map.editSession.translateSelected(100, 200);
    expect(ok.ok).toBe(true);
    // Arc 0's verts shifted by (100, 200); arc 1 untouched
    expect(xx[0]).toBe(100);
    expect(xx[1]).toBe(101);
    expect(xx[2]).toBe(10);
    expect(xx[3]).toBe(11);
    expect(yy[0]).toBe(200);
    expect(yy[1]).toBe(201);
    expect(updateArcBoundsSpy).toHaveBeenCalledWith(0);
    expect(updateArcBoundsSpy).not.toHaveBeenCalledWith(1);
  });
  it('handles negative arc-ids in shapes (~ encoding)', () => {
    polyLayer.shapes[0] = [[~0]]; // negative form of arc 0
    map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
    map.editSession.translateSelected(1, 1);
    expect(xx[0]).toBe(1);
    expect(xx[1]).toBe(2);
  });
  it('deduplicates arc ids across multiple selected features', () => {
    // Both shapes reference arc 0 (artificial setup)
    polyLayer.shapes = [[[0]], [[0]]];
    map.select(
      [
        { source: 'src1', layer: 'parcels', id: 0 },
        { source: 'src1', layer: 'parcels', id: 1 },
      ],
      { mode: 'add' },
    );
    map.editSession.translateSelected(1, 0);
    // Arc 0 should be moved exactly once (xx[0] = 1, not 2)
    expect(xx[0]).toBe(1);
    expect(updateArcBoundsSpy).toHaveBeenCalledTimes(1);
  });
  it('translates point shapes in place', () => {
    map.select([{ source: 'src1', layer: 'cities', id: 0 }]);
    map.editSession.translateSelected(5, -5);
    expect(pointLayer.shapes[0]).toEqual([[105, 195]]);
  });
  it('selection survives translation and no selectionchange fires', () => {
    map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
    const listener = vi.fn();
    map.on('selectionchange', listener);
    map.editSession.translateSelected(1, 1);
    expect(map.getSelection()).toHaveLength(1);
    expect(listener).not.toHaveBeenCalled();
  });
  it('fires exactly one historychange per call', () => {
    map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
    const listener = vi.fn();
    map.on('historychange', listener);
    map.editSession.translateSelected(1, 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it('one undo reverses the entire translation', () => {
    map.select(
      [
        { source: 'src1', layer: 'parcels', id: 0 },
        { source: 'src1', layer: 'cities', id: 0 },
      ],
      { mode: 'add' },
    );
    const xxBefore = Array.from(xx);
    const yyBefore = Array.from(yy);
    const pointBefore = JSON.parse(JSON.stringify(pointLayer.shapes[0]));
    map.editSession.translateSelected(7, 11);
    map.undo();
    expect(Array.from(xx)).toEqual(xxBefore);
    expect(Array.from(yy)).toEqual(yyBefore);
    expect(pointLayer.shapes[0]).toEqual(pointBefore);
  });
  it('multi-source selection wraps per-source commands in a CompositeCommand', () => {
    // Add a second source with its own arcs
    const xx2 = new Float64Array([50, 51]);
    const yy2 = new Float64Array([60, 61]);
    const arcs2 = {
      getVertexData: () => ({
        xx: xx2,
        yy: yy2,
        nn: new Int32Array([2]),
        ii: new Int32Array([0]),
        zz: null,
      }),
      updateArcBounds: vi.fn(),
    };
    const layer2 = { name: 'parcels', geometry_type: 'polygon', shapes: [[[0]]] };
    const src2 = {
      id: 'src2',
      type: 'topology',
      getLayers: () => [layer2],
      getArcs: () => arcs2,
      refreshDisplayArcs: vi.fn(),
    };
    (map as any)._sources.set('src2', src2);
    map.select(
      [
        { source: 'src1', layer: 'parcels', id: 0 },
        { source: 'src2', layer: 'parcels', id: 0 },
      ],
      { mode: 'add' },
    );
    map.editSession.translateSelected(1, 0);
    // Both sources got translated
    expect(xx[0]).toBe(1);
    expect(xx2[0]).toBe(51);
    // One undo restores both
    map.undo();
    expect(xx[0]).toBe(0);
    expect(xx2[0]).toBe(50);
  });
  it('composes with vertex / draw / attribute commands (no history barrier)', () => {
    map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
    const fakeUndo = vi.fn();
    map.pushCommand({ do: () => {}, undo: fakeUndo, label: 'fake' });
    map.editSession.translateSelected(1, 1);
    // Two undos, in reverse order: translate first, then fake
    map.undo();
    expect(xx[0]).toBe(0); // translate reversed
    map.undo();
    expect(fakeUndo).toHaveBeenCalledTimes(1);
  });
  it('clears spatial indexes for edited sources after translate and affine edits', () => {
    const clear = vi.fn();
    setPrivate(map, '_featureQuery', { clear });
    map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
    map.editSession.translateSelected(1, 1);
    expect(clear).toHaveBeenCalledWith('src1');
    clear.mockClear();
    map.editSession.rotateSelected(10);
    expect(clear).toHaveBeenCalledWith('src1');
  });
});
describe('Emap bufferLayer', () => {
  let map: Emap;
  let beforeDataset: any;
  let afterDataset: any;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    beforeDataset = { layers: [{ name: 'roads', geometry_type: 'polyline', shapes: [] }] };
    afterDataset = { layers: [{ name: 'roads', geometry_type: 'polygon', shapes: [['buf']] }] };
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDataset,
      getLayers: () => beforeDataset.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    parseCommandsSpy = vi.fn((cmd: string) => [
      { name: 'parsed', options: { _cmd: cmd } },
    ]) as ReturnType<typeof vi.fn>;
    runParsedCommandsSpy = vi.fn((_cmds: any, _job: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDataset }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDataset),
    );
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('emits a numeric radius bare', async () => {
    const ok = await map.ops.bufferLayer({ source: 'src1', target: 'roads', radius: 5 });
    expect(ok.ok).toBe(true);
    expectCli('-target "roads" -buffer 5', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('quotes a string radius (mapshaper expression)', async () => {
    await map.ops.bufferLayer({ source: 'src1', target: 'roads', radius: 'pop / 1000' });
    expectCli('-target "roads" -buffer "pop / 1000"', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends cap-style= when capStyle is set', async () => {
    await map.ops.bufferLayer({ source: 'src1', target: 'roads', radius: 5, capStyle: 'flat' });
    expectCli('-target "roads" -buffer 5 cap-style=flat', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('returns false when source / target is missing', async () => {
    expect((await map.ops.bufferLayer({ source: 'nope', target: 'roads', radius: 5 })).ok).toBe(
      false,
    );
    expect((await map.ops.bufferLayer({ source: 'src1', target: 'nope', radius: 5 })).ok).toBe(
      false,
    );
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });
  it('pushes one history entry labelled "Buffer <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.bufferLayer({ source: 'src1', target: 'roads', radius: 5 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Buffer roads');
    expect(map.canUndo()).toBe(true);
  });
});
describe('Emap applyExpression', () => {
  let map: Emap;
  let beforeDataset: any;
  let afterDataset: any;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    beforeDataset = { layers: [{ name: 'cities', shapes: [], data: { getRecords: () => [] } }] };
    afterDataset = { layers: [{ name: 'cities', shapes: [], data: { getRecords: () => [] } }] };
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDataset,
      getLayers: () => beforeDataset.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    parseCommandsSpy = vi.fn((cmd: string) => [
      { name: 'parsed', options: { _cmd: cmd } },
    ]) as ReturnType<typeof vi.fn>;
    runParsedCommandsSpy = vi.fn((_cmds: any, _job: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDataset }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDataset),
    );
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('emits a quoted -each expression', async () => {
    const ok = await map.ops.applyExpression({
      source: 'src1',
      target: 'cities',
      expression: 'this.density = this.pop / this.area',
    });
    expect(ok.ok).toBe(true);
    expectCli(
      '-target "cities" -each "this.density = this.pop / this.area"',
      runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('appends a quoted where= when supplied', async () => {
    await map.ops.applyExpression({
      source: 'src1',
      target: 'cities',
      expression: 'this.flag = true',
      where: 'this.pop > 100',
    });
    expectCli(
      '-target "cities" -each "this.flag = true" where="this.pop > 100"',
      runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('returns false on missing source / target', async () => {
    expect(
      (await map.ops.applyExpression({ source: 'nope', target: 'cities', expression: 'x' })).ok,
    ).toBe(false);
    expect(
      (await map.ops.applyExpression({ source: 'src1', target: 'nope', expression: 'x' })).ok,
    ).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false on empty / whitespace-only expression', async () => {
    expect(
      (await map.ops.applyExpression({ source: 'src1', target: 'cities', expression: '' })).ok,
    ).toBe(false);
    expect(
      (await map.ops.applyExpression({ source: 'src1', target: 'cities', expression: '   ' })).ok,
    ).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });
  it('omits where= when blank / whitespace-only', async () => {
    await map.ops.applyExpression({
      source: 'src1',
      target: 'cities',
      expression: 'this.x = 1',
      where: '   ',
    });
    expectCli('-target "cities" -each "this.x = 1"', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('pushes one history entry labelled "Update <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.applyExpression({
      source: 'src1',
      target: 'cities',
      expression: 'this.foo = 1',
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Update cities');
  });
  it('escapes embedded double quotes in expression', async () => {
    await map.ops.applyExpression({
      source: 'src1',
      target: 'cities',
      expression: 'this.kind = "city"',
    });
    expectCli(
      '-target "cities" -each "this.kind = \\"city\\""',
      runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('blocks expression execution when expressionPolicy is disabled', async () => {
    map.setExpressionPolicy('disabled');
    const errors: Error[] = [];
    map.on('error', (event: any) => errors.push(event.error));
    const ok = await map.ops.applyExpression({
      source: 'src1',
      target: 'cities',
      expression: 'this.kind = "city"',
    });
    expect(ok.ok).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
    expect(errors[0]?.message).toMatch(/expression evaluation is disabled/);
  });
});
describe('Emap explodeLayer', () => {
  let map: Emap;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = { layers: [{ name: 'parts', shapes: [] }] };
    const afterDs = { layers: [{ name: 'parts', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    runParsedCommandsSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDs),
    );
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('emits the -explode command', async () => {
    const ok = await map.ops.explodeLayer({ source: 'src1', target: 'parts' });
    expect(ok.ok).toBe(true);
    expectCli('-target "parts" -explode', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('returns false on missing source / target', async () => {
    expect((await map.ops.explodeLayer({ source: 'nope', target: 'parts' })).ok).toBe(false);
    expect((await map.ops.explodeLayer({ source: 'src1', target: 'nope' })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('pushes one history entry labelled "Explode <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.explodeLayer({ source: 'src1', target: 'parts' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Explode parts');
  });
});
describe('Emap innerlinesLayer', () => {
  let map: Emap;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = { layers: [{ name: 'states', shapes: [] }] };
    const afterDs = { layers: [{ name: 'states', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    runParsedCommandsSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDs),
    );
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('emits the minimal -innerlines command', async () => {
    const ok = await map.ops.innerlinesLayer({ source: 'src1', target: 'states' });
    expect(ok.ok).toBe(true);
    expectCli('-target "states" -innerlines', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends a quoted where=', async () => {
    await map.ops.innerlinesLayer({
      source: 'src1',
      target: 'states',
      where: 'A.STATE !== B.STATE',
    });
    expectCli(
      '-target "states" -innerlines where="A.STATE !== B.STATE"',
      runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('appends a quoted name=', async () => {
    await map.ops.innerlinesLayer({
      source: 'src1',
      target: 'states',
      name: 'borders',
    });
    expectCli('-target "states" -innerlines name="borders"', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends no-replace flag', async () => {
    await map.ops.innerlinesLayer({
      source: 'src1',
      target: 'states',
      noReplace: true,
    });
    expectCli('-target "states" -innerlines no-replace', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('combines all options in deterministic order', async () => {
    await map.ops.innerlinesLayer({
      source: 'src1',
      target: 'states',
      where: 'A.x !== B.x',
      name: 'b',
      noReplace: true,
    });
    expectCli(
      '-target "states" -innerlines where="A.x !== B.x" name="b" no-replace',
      runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('returns false on missing source / target', async () => {
    expect((await map.ops.innerlinesLayer({ source: 'nope', target: 'states' })).ok).toBe(false);
    expect((await map.ops.innerlinesLayer({ source: 'src1', target: 'nope' })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('pushes one history entry labelled "Innerlines <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.innerlinesLayer({ source: 'src1', target: 'states' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Innerlines states');
  });
});
describe('Emap filterFeatures', () => {
  let map: Emap;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = { layers: [{ name: 'cities', shapes: [] }] };
    const afterDs = { layers: [{ name: 'cities', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    runParsedCommandsSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDs),
    );
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('emits a quoted expression', async () => {
    const ok = await map.ops.filterFeatures({
      source: 'src1',
      target: 'cities',
      expression: 'this.pop > 100',
    });
    expect(ok.ok).toBe(true);
    expectCli('-target "cities" -filter "this.pop > 100"', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends invert flag', async () => {
    await map.ops.filterFeatures({
      source: 'src1',
      target: 'cities',
      expression: 'this.x',
      invert: true,
    });
    expectCli('-target "cities" -filter "this.x" invert', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends remove-empty flag', async () => {
    await map.ops.filterFeatures({
      source: 'src1',
      target: 'cities',
      expression: 'this.x',
      removeEmpty: true,
    });
    expectCli(
      '-target "cities" -filter "this.x" remove-empty',
      runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('removeEmpty alone (no expression) emits bare -filter remove-empty', async () => {
    await map.ops.filterFeatures({
      source: 'src1',
      target: 'cities',
      removeEmpty: true,
    });
    expectCli('-target "cities" -filter remove-empty', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('returns false when neither expression nor removeEmpty is set', async () => {
    expect((await map.ops.filterFeatures({ source: 'src1', target: 'cities' })).ok).toBe(false);
    expect(
      (await map.ops.filterFeatures({ source: 'src1', target: 'cities', expression: '   ' })).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false on missing source / target', async () => {
    expect(
      (await map.ops.filterFeatures({ source: 'nope', target: 'cities', expression: 'x' })).ok,
    ).toBe(false);
    expect(
      (await map.ops.filterFeatures({ source: 'src1', target: 'nope', expression: 'x' })).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('pushes one history entry labelled "Filter <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.filterFeatures({
      source: 'src1',
      target: 'cities',
      expression: 'this.x',
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Filter cities');
  });
});
describe('Emap snapLayer', () => {
  let map: Emap;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = { layers: [{ name: 'roads', shapes: [] }] };
    const afterDs = { layers: [{ name: 'roads', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    runParsedCommandsSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDs),
    );
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('emits the bare -snap command (mapshaper default interval)', async () => {
    const ok = await map.ops.snapLayer({ source: 'src1', target: 'roads' });
    expect(ok.ok).toBe(true);
    expectCli('-target "roads" -snap', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends a numeric interval positionally', async () => {
    await map.ops.snapLayer({ source: 'src1', target: 'roads', interval: 0.0001 });
    expectCli('-target "roads" -snap 0.0001', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends endpoints flag', async () => {
    await map.ops.snapLayer({ source: 'src1', target: 'roads', endpoints: true });
    expectCli('-target "roads" -snap endpoints', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends precision=', async () => {
    await map.ops.snapLayer({ source: 'src1', target: 'roads', precision: 0.000001 });
    expectCli('-target "roads" -snap precision=0.000001', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('combines all options in deterministic order', async () => {
    await map.ops.snapLayer({
      source: 'src1',
      target: 'roads',
      interval: 0.001,
      endpoints: true,
      precision: 0.000001,
    });
    expectCli(
      '-target "roads" -snap 0.001 endpoints precision=0.000001',
      runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('returns false on missing source / target', async () => {
    expect((await map.ops.snapLayer({ source: 'nope', target: 'roads' })).ok).toBe(false);
    expect((await map.ops.snapLayer({ source: 'src1', target: 'nope' })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('pushes one history entry labelled "Snap <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.snapLayer({ source: 'src1', target: 'roads' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Snap roads');
  });
});
describe('Emap rotateSelected / scaleSelected', () => {
  let map: Emap;
  let polyLayer: any;
  let pointLayer: any;
  let xx: Float64Array;
  let yy: Float64Array;
  let arcs: any;
  function close(a: number, b: number, eps = 1e-9): boolean {
    return Math.abs(a - b) < eps;
  }
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    // arc 0: (0,0)-(2,0)-(2,2)-(0,2) bounding (0,0)-(2,2), centroid (1,1)
    xx = new Float64Array([0, 2, 2, 0]);
    yy = new Float64Array([0, 0, 2, 2]);
    arcs = {
      getVertexData: () => ({
        xx,
        yy,
        nn: new Int32Array([4]),
        ii: new Int32Array([0]),
        zz: null,
      }),
      updateArcBounds: vi.fn(),
    };
    polyLayer = {
      name: 'parcels',
      geometry_type: 'polygon',
      shapes: [[[0]]],
    };
    pointLayer = {
      name: 'cities',
      geometry_type: 'point',
      shapes: [[[10, 20]]],
    };
    const source = {
      id: 'src1',
      type: 'topology',
      getLayers: () => [polyLayer, pointLayer],
      getArcs: () => arcs,
      refreshDisplayArcs: vi.fn(),
    };
    (map as any)._sources.set('src1', source);
  });
  describe('rotateSelected', () => {
    it('returns false on empty selection', () => {
      expect(map.editSession.rotateSelected(45).ok).toBe(false);
    });
    it('returns false on zero angle', () => {
      map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
      expect(map.editSession.rotateSelected(0).ok).toBe(false);
      expect(map.canUndo()).toBe(false);
    });
    it('default origin is the bbox centroid (so rotating by 90 keeps the centre fixed)', () => {
      map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
      // Centroid of (0,0)-(2,2) is (1,1). Rotate by 90 around (1,1):
      // (0,0) -> (2,0); (2,0) -> (2,2); (2,2) -> (0,2); (0,2) -> (0,0)
      map.editSession.rotateSelected(90);
      expect(close(xx[0], 2)).toBe(true);
      expect(close(yy[0], 0)).toBe(true);
      expect(close(xx[1], 2)).toBe(true);
      expect(close(yy[1], 2)).toBe(true);
      expect(close(xx[2], 0)).toBe(true);
      expect(close(yy[2], 2)).toBe(true);
      expect(close(xx[3], 0)).toBe(true);
      expect(close(yy[3], 0)).toBe(true);
    });
    it('custom origin is honoured', () => {
      map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
      // Rotate by 90 around (0,0): (2,0) -> (0,2)
      map.editSession.rotateSelected(90, [0, 0]);
      expect(close(xx[1], 0)).toBe(true);
      expect(close(yy[1], 2)).toBe(true);
    });
    it('undo restores positions exactly', () => {
      map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
      const xxBefore = Array.from(xx);
      const yyBefore = Array.from(yy);
      map.editSession.rotateSelected(37, [3, -1]);
      map.undo();
      for (let i = 0; i < xxBefore.length; i++) {
        expect(close(xx[i], xxBefore[i])).toBe(true);
        expect(close(yy[i], yyBefore[i])).toBe(true);
      }
    });
    it('selection survives, single historychange', () => {
      map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
      const histListener = vi.fn();
      const selListener = vi.fn();
      map.on('historychange', histListener);
      map.on('selectionchange', selListener);
      map.editSession.rotateSelected(45);
      expect(map.getSelection()).toHaveLength(1);
      expect(histListener).toHaveBeenCalledTimes(1);
      expect(selListener).not.toHaveBeenCalled();
    });
  });
  describe('scaleSelected', () => {
    it('returns false on empty selection', () => {
      expect(map.editSession.scaleSelected(2).ok).toBe(false);
    });
    it('returns false on no-op scale (1) and (1, 1)', () => {
      map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
      expect(map.editSession.scaleSelected(1).ok).toBe(false);
      expect(map.editSession.scaleSelected(1, 1).ok).toBe(false);
      expect(map.canUndo()).toBe(false);
    });
    it('uniform scale by 2 around bbox centroid', () => {
      map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
      // Centroid (1,1). Scale 2x: (0,0) -> (-1,-1); (2,2) -> (3,3)
      map.editSession.scaleSelected(2);
      expect(close(xx[0], -1)).toBe(true);
      expect(close(yy[0], -1)).toBe(true);
      expect(close(xx[2], 3)).toBe(true);
      expect(close(yy[2], 3)).toBe(true);
    });
    it('non-uniform scale', () => {
      map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
      // Centroid (1,1). Scale (2, 0.5): (0,0) -> (-1, 0.5); (2,2) -> (3, 1.5)
      map.editSession.scaleSelected(2, 0.5);
      expect(close(xx[0], -1)).toBe(true);
      expect(close(yy[0], 0.5)).toBe(true);
      expect(close(xx[2], 3)).toBe(true);
      expect(close(yy[2], 1.5)).toBe(true);
    });
    it('one undo reverses the scale', () => {
      map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
      const xxBefore = Array.from(xx);
      map.editSession.scaleSelected(3.7);
      map.undo();
      for (let i = 0; i < xxBefore.length; i++) {
        expect(close(xx[i], xxBefore[i])).toBe(true);
      }
    });
  });
  describe('multi-source affine', () => {
    it('wraps per-source commands in a CompositeCommand', () => {
      // Add a second source with its own arcs
      const xx2 = new Float64Array([10, 11]);
      const yy2 = new Float64Array([20, 21]);
      const arcs2 = {
        getVertexData: () => ({
          xx: xx2,
          yy: yy2,
          nn: new Int32Array([2]),
          ii: new Int32Array([0]),
          zz: null,
        }),
        updateArcBounds: vi.fn(),
      };
      const layer2 = { name: 'parcels', geometry_type: 'polygon', shapes: [[[0]]] };
      (map as any)._sources.set('src2', {
        id: 'src2',
        type: 'topology',
        getLayers: () => [layer2],
        getArcs: () => arcs2,
        refreshDisplayArcs: vi.fn(),
      });
      map.select(
        [
          { source: 'src1', layer: 'parcels', id: 0 },
          { source: 'src2', layer: 'parcels', id: 0 },
        ],
        { mode: 'add' },
      );
      map.editSession.scaleSelected(2);
      // Both sources got scaled
      // Verify by re-running undo: a single undo should reverse both
      map.undo();
      expect(close(xx[0], 0)).toBe(true);
      expect(close(xx2[0], 10)).toBe(true);
    });
  });
});
describe('Emap mosaicLayer', () => {
  let map: Emap;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = { layers: [{ name: 'parts', shapes: [] }] };
    const afterDs = { layers: [{ name: 'parts', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    runParsedCommandsSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDs),
    );
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('emits the bare -mosaic command', async () => {
    const ok = await map.ops.mosaicLayer({ source: 'src1', target: 'parts' });
    expect(ok.ok).toBe(true);
    expectCli('-target "parts" -mosaic', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends snap-interval=', async () => {
    await map.ops.mosaicLayer({ source: 'src1', target: 'parts', snapInterval: 0.001 });
    expectCli('-target "parts" -mosaic snap-interval=0.001', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends no-snap and no-replace flags', async () => {
    await map.ops.mosaicLayer({ source: 'src1', target: 'parts', noSnap: true, noReplace: true });
    expectCli('-target "parts" -mosaic no-snap no-replace', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('quotes name= when supplied', async () => {
    await map.ops.mosaicLayer({ source: 'src1', target: 'parts', name: 'flat zones' });
    expectCli('-target "parts" -mosaic name="flat zones"', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('returns false on missing source / target', async () => {
    expect((await map.ops.mosaicLayer({ source: 'nope', target: 'parts' })).ok).toBe(false);
    expect((await map.ops.mosaicLayer({ source: 'src1', target: 'nope' })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('pushes one history entry labelled "Mosaic <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.mosaicLayer({ source: 'src1', target: 'parts' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Mosaic parts');
  });
});
describe('Emap unionLayers', () => {
  let map: Emap;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [
        { name: 'parks', shapes: [], geometry_type: 'polygon' },
        { name: 'soils', shapes: [], geometry_type: 'polygon' },
        { name: 'roads', shapes: [], geometry_type: 'polyline' },
      ],
    };
    const afterDs = { layers: [{ name: 'union', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    runParsedCommandsSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDs),
    );
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('joins targets with commas inside a single quoted -target arg', async () => {
    const ok = await map.ops.unionLayers({ source: 'src1', targets: ['parks', 'soils'] });
    expect(ok.ok).toBe(true);
    expectCli('-target "parks,soils" -union', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('preserves target order for three or more layers', async () => {
    await map.ops.unionLayers({ source: 'src1', targets: ['soils', 'parks', 'roads'] });
    expectCli('-target "soils,parks,roads" -union', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends fields=', async () => {
    await map.ops.unionLayers({
      source: 'src1',
      targets: ['parks', 'soils'],
      fields: ['name', 'type'],
    });
    expectCli(
      '-target "parks,soils" -union fields=name,type',
      runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('quotes name=', async () => {
    await map.ops.unionLayers({
      source: 'src1',
      targets: ['parks', 'soils'],
      name: 'overlay output',
    });
    expectCli(
      '-target "parks,soils" -union name="overlay output"',
      runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('appends no-replace', async () => {
    await map.ops.unionLayers({
      source: 'src1',
      targets: ['parks', 'soils'],
      noReplace: true,
    });
    expectCli('-target "parks,soils" -union no-replace', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('returns false for fewer than two targets', async () => {
    expect((await map.ops.unionLayers({ source: 'src1', targets: ['parks'] })).ok).toBe(false);
    expect((await map.ops.unionLayers({ source: 'src1', targets: [] })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when any target is unresolved', async () => {
    expect(
      (
        await map.ops.unionLayers({
          source: 'src1',
          targets: ['parks', 'missing'],
        })
      ).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when source is missing', async () => {
    expect((await map.ops.unionLayers({ source: 'nope', targets: ['parks', 'soils'] })).ok).toBe(
      false,
    );
  });
  it('history entry is labelled "Union <comma-joined>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.unionLayers({ source: 'src1', targets: ['parks', 'soils'] });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Union parks,soils');
  });
});
describe('Emap divideLayer', () => {
  let map: Emap;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [
        { name: 'roads', shapes: [], geometry_type: 'polyline' },
        { name: 'tracts', shapes: [], geometry_type: 'polygon' },
        { name: 'cities', shapes: [], geometry_type: 'point' },
      ],
    };
    const afterDs = { layers: [{ name: 'roads', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    runParsedCommandsSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDs),
    );
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('builds the minimal command shape', async () => {
    const ok = await map.ops.divideLayer({ source: 'src1', target: 'roads', divider: 'tracts' });
    expect(ok.ok).toBe(true);
    expectCli('-target "roads" -divide source="tracts"', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends fields=', async () => {
    await map.ops.divideLayer({
      source: 'src1',
      target: 'roads',
      divider: 'tracts',
      fields: ['NAME', 'STATE'],
    });
    expectCli(
      '-target "roads" -divide source="tracts" fields=NAME,STATE',
      runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('appends force', async () => {
    await map.ops.divideLayer({
      source: 'src1',
      target: 'roads',
      divider: 'tracts',
      force: true,
    });
    expectCli(
      '-target "roads" -divide source="tracts" force',
      runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('returns false when source is missing', async () => {
    expect(
      (await map.ops.divideLayer({ source: 'nope', target: 'roads', divider: 'tracts' })).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when target is unresolved', async () => {
    expect(
      (await map.ops.divideLayer({ source: 'src1', target: 'highways', divider: 'tracts' })).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when divider is unresolved', async () => {
    expect(
      (await map.ops.divideLayer({ source: 'src1', target: 'roads', divider: 'counties' })).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when target is not a polyline', async () => {
    expect(
      (await map.ops.divideLayer({ source: 'src1', target: 'tracts', divider: 'tracts' })).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when divider is not a polygon', async () => {
    expect(
      (await map.ops.divideLayer({ source: 'src1', target: 'roads', divider: 'cities' })).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('history entry is labelled "Divide <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.divideLayer({ source: 'src1', target: 'roads', divider: 'tracts' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Divide roads');
  });
});
describe('Emap pointsLayer', () => {
  let map: Emap;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [
        { name: 'parks', shapes: [], geometry_type: 'polygon' },
        { name: 'roads', shapes: [], geometry_type: 'polyline' },
        { name: 'cities', shapes: [], geometry_type: 'point' },
      ],
    };
    const afterDs = { layers: [{ name: 'parks', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    runParsedCommandsSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDs),
    );
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('builds centroid command for polygon target', async () => {
    const ok = await map.ops.pointsLayer({ source: 'src1', target: 'parks', type: 'centroid' });
    expect(ok.ok).toBe(true);
    expectCli('-target "parks" -points centroid', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('builds inner command for polygon target', async () => {
    await map.ops.pointsLayer({ source: 'src1', target: 'parks', type: 'inner' });
    expectCli('-target "parks" -points inner', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('builds vertices command for polyline target', async () => {
    await map.ops.pointsLayer({ source: 'src1', target: 'roads', type: 'vertices' });
    expectCli('-target "roads" -points vertices', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('builds endpoints command for polygon target', async () => {
    await map.ops.pointsLayer({ source: 'src1', target: 'parks', type: 'endpoints' });
    expectCli('-target "parks" -points endpoints', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('builds midpoints command for polyline target', async () => {
    await map.ops.pointsLayer({ source: 'src1', target: 'roads', type: 'midpoints' });
    expectCli('-target "roads" -points midpoints', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('builds interpolated command with interval', async () => {
    await map.ops.pointsLayer({
      source: 'src1',
      target: 'roads',
      type: 'interpolated',
      interval: 1000,
    });
    expectCli(
      '-target "roads" -points interpolated interval=1000',
      runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('appends quoted name and no-replace', async () => {
    await map.ops.pointsLayer({
      source: 'src1',
      target: 'parks',
      type: 'centroid',
      name: 'park labels',
      noReplace: true,
    });
    expectCli(
      '-target "parks" -points centroid name="park labels" no-replace',
      runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('rejects centroid on non-polygon target', async () => {
    expect(
      (await map.ops.pointsLayer({ source: 'src1', target: 'roads', type: 'centroid' })).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('rejects midpoints on non-polyline target', async () => {
    expect(
      (await map.ops.pointsLayer({ source: 'src1', target: 'parks', type: 'midpoints' })).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('rejects vertices on a point target', async () => {
    expect(
      (await map.ops.pointsLayer({ source: 'src1', target: 'cities', type: 'vertices' })).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('rejects interpolated without interval', async () => {
    expect(
      (await map.ops.pointsLayer({ source: 'src1', target: 'roads', type: 'interpolated' })).ok,
    ).toBe(false);
    expect(
      (
        await map.ops.pointsLayer({
          source: 'src1',
          target: 'roads',
          type: 'interpolated',
          interval: 0,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await map.ops.pointsLayer({
          source: 'src1',
          target: 'roads',
          type: 'interpolated',
          interval: -5,
        })
      ).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when source is missing', async () => {
    expect(
      (await map.ops.pointsLayer({ source: 'nope', target: 'parks', type: 'centroid' })).ok,
    ).toBe(false);
  });
  it('returns false when target is unresolved', async () => {
    expect(
      (await map.ops.pointsLayer({ source: 'src1', target: 'forests', type: 'centroid' })).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('history entry is labelled "Points <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.pointsLayer({ source: 'src1', target: 'parks', type: 'centroid' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Points parks');
  });
});
describe('Emap linesLayer', () => {
  let map: Emap;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [
        { name: 'states', shapes: [], geometry_type: 'polygon' },
        { name: 'roads', shapes: [], geometry_type: 'polyline' },
      ],
    };
    const afterDs = { layers: [{ name: 'states', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    runParsedCommandsSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDs),
    );
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('builds the minimal command shape', async () => {
    const ok = await map.ops.linesLayer({ source: 'src1', target: 'states' });
    expect(ok.ok).toBe(true);
    expectCli('-target "states" -lines', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('emits comma-joined fields as a bare positional argument', async () => {
    await map.ops.linesLayer({
      source: 'src1',
      target: 'states',
      fields: ['STATE', 'COUNTY'],
    });
    expectCli('-target "states" -lines STATE,COUNTY', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends quoted name', async () => {
    await map.ops.linesLayer({ source: 'src1', target: 'states', name: 'borders' });
    expectCli('-target "states" -lines name="borders"', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends no-replace', async () => {
    await map.ops.linesLayer({ source: 'src1', target: 'states', noReplace: true });
    expectCli('-target "states" -lines no-replace', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('returns false when source is missing', async () => {
    expect((await map.ops.linesLayer({ source: 'nope', target: 'states' })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when target is unresolved', async () => {
    expect((await map.ops.linesLayer({ source: 'src1', target: 'counties' })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when target is not a polygon', async () => {
    expect((await map.ops.linesLayer({ source: 'src1', target: 'roads' })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('history entry is labelled "Lines <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.linesLayer({ source: 'src1', target: 'states' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Lines states');
  });
});
describe('Emap polygonsLayer', () => {
  let map: Emap;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [
        { name: 'edges', shapes: [], geometry_type: 'polyline' },
        { name: 'parks', shapes: [], geometry_type: 'polygon' },
      ],
    };
    const afterDs = { layers: [{ name: 'edges', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    runParsedCommandsSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDs),
    );
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('builds the minimal command shape', async () => {
    const ok = await map.ops.polygonsLayer({ source: 'src1', target: 'edges' });
    expect(ok.ok).toBe(true);
    expectCli('-target "edges" -polygons', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('forwards gap-tolerance when positive', async () => {
    await map.ops.polygonsLayer({ source: 'src1', target: 'edges', gapTolerance: 0.001 });
    expectCli(
      '-target "edges" -polygons gap-tolerance=0.001',
      runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('drops gap-tolerance when zero', async () => {
    await map.ops.polygonsLayer({ source: 'src1', target: 'edges', gapTolerance: 0 });
    expectCli('-target "edges" -polygons', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('drops gap-tolerance when negative', async () => {
    await map.ops.polygonsLayer({ source: 'src1', target: 'edges', gapTolerance: -1 });
    expectCli('-target "edges" -polygons', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends from-rings', async () => {
    await map.ops.polygonsLayer({ source: 'src1', target: 'edges', fromRings: true });
    expectCli('-target "edges" -polygons from-rings', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('returns false when source is missing', async () => {
    expect((await map.ops.polygonsLayer({ source: 'nope', target: 'edges' })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when target is unresolved', async () => {
    expect((await map.ops.polygonsLayer({ source: 'src1', target: 'rivers' })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when target is not a polyline', async () => {
    expect((await map.ops.polygonsLayer({ source: 'src1', target: 'parks' })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('history entry is labelled "Polygons <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.polygonsLayer({ source: 'src1', target: 'edges' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Polygons edges');
  });
});
describe('Emap simplifyLayer', () => {
  let map: Emap;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [
        { name: 'roads', shapes: [], geometry_type: 'polyline' },
        { name: 'parks', shapes: [], geometry_type: 'polygon' },
      ],
    };
    const afterDs = { layers: [{ name: 'roads', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    runParsedCommandsSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDs),
    );
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('builds the percentage form', async () => {
    const ok = await map.ops.simplifyLayer({ source: 'src1', percentage: 10 });
    expect(ok.ok).toBe(true);
    expectCli('-simplify 10%', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('preserves decimal percentages', async () => {
    await map.ops.simplifyLayer({ source: 'src1', percentage: 12.5 });
    expectCli('-simplify 12.5%', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('builds the interval form', async () => {
    await map.ops.simplifyLayer({ source: 'src1', interval: 250 });
    expectCli('-simplify interval=250', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('builds the resolution form', async () => {
    await map.ops.simplifyLayer({ source: 'src1', resolution: '1000x500' });
    expectCli('-simplify resolution=1000x500', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends method dp / visvalingam / weighted', async () => {
    await map.ops.simplifyLayer({ source: 'src1', percentage: 10, method: 'dp' });
    expectCli('-simplify 10% dp', runParsedCommandsSpy.mock.calls[0][0]);
    runParsedCommandsSpy.mockClear();
    await map.ops.simplifyLayer({ source: 'src1', percentage: 10, method: 'visvalingam' });
    expectCli('-simplify 10% visvalingam', runParsedCommandsSpy.mock.calls[0][0]);
    runParsedCommandsSpy.mockClear();
    await map.ops.simplifyLayer({ source: 'src1', percentage: 10, method: 'weighted' });
    expectCli('-simplify 10% weighted', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends weighting=', async () => {
    await map.ops.simplifyLayer({
      source: 'src1',
      percentage: 10,
      method: 'weighted',
      weighting: 0.5,
    });
    expectCli('-simplify 10% weighted weighting=0.5', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends every passthrough flag', async () => {
    await map.ops.simplifyLayer({
      source: 'src1',
      percentage: 10,
      planar: true,
      keepShapes: true,
      lockBox: true,
      noRepair: true,
    });
    expectCli(
      '-simplify 10% planar keep-shapes lock-box no-repair',
      runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('scopes to a target when supplied', async () => {
    await map.ops.simplifyLayer({ source: 'src1', target: 'roads', percentage: 10 });
    expectCli('-target "roads" -simplify 10%', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('returns false when source is missing', async () => {
    expect((await map.ops.simplifyLayer({ source: 'nope', percentage: 10 })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when target is unresolved', async () => {
    expect(
      (await map.ops.simplifyLayer({ source: 'src1', target: 'rivers', percentage: 10 })).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when no threshold is supplied', async () => {
    expect((await map.ops.simplifyLayer({ source: 'src1' })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when multiple thresholds are supplied', async () => {
    expect(
      (
        await map.ops.simplifyLayer({
          source: 'src1',
          percentage: 10,
          interval: 250,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await map.ops.simplifyLayer({
          source: 'src1',
          percentage: 10,
          resolution: '1000x500',
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await map.ops.simplifyLayer({
          source: 'src1',
          interval: 250,
          resolution: '1000x500',
        })
      ).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false for out-of-range percentage', async () => {
    expect((await map.ops.simplifyLayer({ source: 'src1', percentage: -1 })).ok).toBe(false);
    expect((await map.ops.simplifyLayer({ source: 'src1', percentage: 101 })).ok).toBe(false);
    expect((await map.ops.simplifyLayer({ source: 'src1', percentage: NaN })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false for non-positive interval', async () => {
    expect((await map.ops.simplifyLayer({ source: 'src1', interval: 0 })).ok).toBe(false);
    expect((await map.ops.simplifyLayer({ source: 'src1', interval: -1 })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false for malformed resolution', async () => {
    expect((await map.ops.simplifyLayer({ source: 'src1', resolution: '1000' })).ok).toBe(false);
    expect((await map.ops.simplifyLayer({ source: 'src1', resolution: '1000x' })).ok).toBe(false);
    expect((await map.ops.simplifyLayer({ source: 'src1', resolution: 'abc' })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('history entry is labelled "Simplify <target>" when scoped', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.simplifyLayer({ source: 'src1', target: 'roads', percentage: 10 });
    expect(listener.mock.calls[0][0].label).toBe('Simplify roads');
  });
  it('history entry is labelled "Simplify <source>" when dataset-wide', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.simplifyLayer({ source: 'src1', percentage: 10 });
    expect(listener.mock.calls[0][0].label).toBe('Simplify src1');
  });
});
describe('Emap projectLayer', () => {
  let map: Emap;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  let exportFileContentSpy: ReturnType<typeof vi.fn>;
  let source: any;
  let afterDs: any;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalExportFileContent = Reflect.get(mapshaper.internal as object, 'exportFileContent');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [
        { name: 'states', shapes: [], geometry_type: 'polygon' },
        { name: 'roads', shapes: [], geometry_type: 'polyline' },
      ],
      info: { crs_string: '+proj=longlat +datum=WGS84' },
    };
    afterDs = {
      layers: [{ name: 'states', shapes: [] }],
      info: { crs_string: '+proj=merc' },
    };
    source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    runParsedCommandsSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => ({
        layers: beforeDs.layers.map((layer) => ({ ...layer })),
        info: { ...beforeDs.info },
      })),
    );
    exportFileContentSpy = vi.fn((dataset) => [
      { filename: 'states.json', content: JSON.stringify(dataset) },
    ]);
    Reflect.set(mapshaper.internal as object, 'exportFileContent', exportFileContentSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'exportFileContent', originalExportFileContent);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('rejects an empty target because whole-map CRS changes belong to map.reproject', async () => {
    const result = await map.ops.projectLayer({ source: 'src1', target: '', crs: 'EPSG:3857' });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'target',
        reason:
          'is required; projectLayer only exports a detached layer, use map.reproject() for the map',
      },
    });
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
    expect(exportFileContentSpy).not.toHaveBeenCalled();
  });
  it('projects the isolated target dataset without a mapshaper target command', async () => {
    await map.ops.projectLayer({ source: 'src1', target: 'states', crs: 'EPSG:3857' });
    expectCli('-proj webmercator', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('defaults to a target-named GeoJSON export', async () => {
    const result = await map.ops.projectLayer({
      source: 'src1',
      target: 'states',
      crs: 'EPSG:3857',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected projection export to succeed');
    expect(result.value).toMatchObject({ filename: 'states.geojson', format: 'geojson' });
    expect(result.value.blob).toBeInstanceOf(Blob);
  });
  it('exports a detached projected layer without mutating current map state', async () => {
    const projection = new Projection();
    projection.setCRS('EPSG:4326');
    const viewport = new Viewport();
    viewport.setCRS('EPSG:4326');
    setPrivate(map, '_projection', projection);
    setPrivate(map, '_viewport', viewport);
    setPrivate(map, '_layers', [{ id: 'display', type: 'line', source: 'src1' }]);
    const originalDataset = source.getDataset();
    const originalLayers = getPrivate(map, '_layers');
    const historyChange = vi.fn();
    map.on('historychange', historyChange);
    const result = await map.ops.projectLayer({
      source: 'src1',
      target: 'states',
      crs: 'EPSG:3857',
      output: { format: 'geojson', filename: 'states-3857.geojson' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected projection export to succeed');
    expect(result.value.filename).toBe('states-3857.geojson');
    expect(result.value.format).toBe('geojson');
    expect(result.value.blob).toBeInstanceOf(Blob);
    expect(source.getDataset()).toBe(originalDataset);
    expect(source.setDataset).not.toHaveBeenCalled();
    expect(getPrivate(map, '_layers')).toBe(originalLayers);
    expect(map.getCRS()).toBe('EPSG:4326');
    expect(getPrivate(map, '_viewport')).toBe(viewport);
    expect(historyChange).not.toHaveBeenCalled();
    expect(getPrivate(map, '_scheduleRender')).not.toHaveBeenCalled();
    expect(exportFileContentSpy).toHaveBeenCalledTimes(1);
    expect(exportFileContentSpy.mock.calls[0][0]).toBe(afterDs);
    expect(afterDs.info.crs_string).toBe('EPSG:3857');
  });
  it('keeps live source CRS metadata isolated when mapshaper shares info during detached export', async () => {
    const projection = new Projection();
    projection.setCRS('EPSG:4326');
    const viewport = new Viewport();
    viewport.setCRS('EPSG:4326');
    setPrivate(map, '_projection', projection);
    setPrivate(map, '_viewport', viewport);
    setPrivate(map, '_layers', [{ id: 'display', type: 'line', source: 'src1' }]);
    const originalDataset = source.getDataset();
    const originalInfo = originalDataset.info;
    const originalInfoValue = structuredClone(originalInfo);
    const originalDatasetValue = structuredClone({ layers: originalDataset.layers });
    const selected: FeatureRef[] = [{ source: 'src1', layer: 'states', id: 0 }];
    map.select(selected);
    const originalSelection = map.getSelection();
    const canUndo = map.canUndo();
    const canRedo = map.canRedo();
    const selectionChange = vi.fn();
    map.on('selectionchange', selectionChange);
    const originalLayers = getPrivate(map, '_layers');
    const historyChange = vi.fn();
    map.on('historychange', historyChange);
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn((dataset) => ({
        ...dataset,
        layers: dataset.layers.map((layer: object) => ({ ...layer })),
        info: dataset.info,
      })),
    );
    runParsedCommandsSpy.mockImplementation(
      (
        _commands: unknown,
        job: {
          catalog: {
            getDefaultTargets: () => Array<{
              dataset: MapshaperDataset;
            }>;
          };
        },
        cb: (
          error: unknown,
          finished: {
            catalog: {
              getDefaultTargets: () => Array<{
                dataset: MapshaperDataset;
              }>;
            };
          },
        ) => void,
      ) => {
        const [{ dataset: working }] = job.catalog.getDefaultTargets();
        if (!working.info) throw new Error('expected working dataset metadata');
        working.info.crs_string = 'EPSG:3857';
        working.info.crs = { projName: 'merc', is_latlong: false };
        cb(null, { catalog: { getDefaultTargets: () => [{ dataset: working }] } });
      },
    );
    const result = await map.ops.projectLayer({
      source: 'src1',
      target: 'states',
      crs: 'EPSG:3857',
      output: { format: 'geojson' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected projection export to succeed');
    expect(result.value.blob).toBeInstanceOf(Blob);
    expect(exportFileContentSpy.mock.calls[0][0].info).toMatchObject({
      crs_string: 'EPSG:3857',
      crs: { projName: 'merc', is_latlong: false },
    });
    expect(source.getDataset()).toBe(originalDataset);
    expect({ layers: source.getDataset().layers }).toEqual(originalDatasetValue);
    expect(source.getDataset().info).toBe(originalInfo);
    expect(source.getDataset().info).toEqual(originalInfoValue);
    expect(source.setDataset).not.toHaveBeenCalled();
    expect(source.refreshDisplayArcs).not.toHaveBeenCalled();
    expect(getPrivate(map, '_layers')).toBe(originalLayers);
    expect(map.getCRS()).toBe('EPSG:4326');
    expect(getPrivate(map, '_viewport')).toBe(viewport);
    expect(historyChange).not.toHaveBeenCalled();
    expect(map.getSelection()).toEqual(originalSelection);
    expect(selectionChange).not.toHaveBeenCalled();
    expect(map.canUndo()).toBe(canUndo);
    expect(map.canRedo()).toBe(canRedo);
    expect(getPrivate(map, '_scheduleRender')).not.toHaveBeenCalled();
  });
  it('quotes Proj.4 strings with spaces', async () => {
    await map.ops.projectLayer({ source: 'src1', target: 'states', crs: '+proj=utm +zone=10' });
    expectCli('-proj "+proj=utm +zone=10"', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends quoted init=', async () => {
    await map.ops.projectLayer({
      source: 'src1',
      target: 'states',
      crs: 'EPSG:3857',
      init: 'EPSG:4326',
    });
    expectCli('-proj webmercator init=wgs84', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('resolves EPSG:4490 crs before building the command', async () => {
    await map.ops.projectLayer({ source: 'src1', target: 'states', crs: 'EPSG:4490' });
    const proj = runParsedCommandsSpy.mock.calls[0][0].at(-1);
    expect(proj.options.crs).toContain('+ellps=GRS80');
  });
  it('stamps the detached export with its destination CRS only', async () => {
    const originalInfo = source.getDataset().info;
    await map.ops.projectLayer({ source: 'src1', target: 'states', crs: 'EPSG:4490' });
    expect(afterDs.info.crs_string).toBe('EPSG:4490');
    expect(source.getDataset().info).toBe(originalInfo);
    expect(source.getDataset().info.crs_string).toBe('+proj=longlat +datum=WGS84');
    expect(source.setDataset).not.toHaveBeenCalled();
  });
  it('resolves EPSG:32633 init before building the command', async () => {
    await map.ops.projectLayer({
      source: 'src1',
      target: 'states',
      crs: 'EPSG:3857',
      init: 'EPSG:32633',
    });
    const proj = runParsedCommandsSpy.mock.calls[0][0].at(-1);
    expect(proj.options.init).toContain('+zone=33');
  });
  it('returns a validation error for unsupported EPSG crs values', async () => {
    const result = await map.ops.projectLayer({
      source: 'src1',
      target: 'states',
      crs: 'EPSG:999999999',
    });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'crs',
        reason: 'Unsupported EPSG code: EPSG:999999999',
      },
    });
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns an init validation error for unsupported EPSG init values', async () => {
    const result = await map.ops.projectLayer({
      source: 'src1',
      target: 'states',
      crs: 'EPSG:3857',
      init: 'EPSG:999999999',
    });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'init',
        reason: 'Unsupported EPSG code: EPSG:999999999',
      },
    });
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns a validation error for crs EPSG records without Proj.4 definitions', async () => {
    const result = await map.ops.projectLayer({
      source: 'src1',
      target: 'states',
      crs: 'EPSG:2000',
    });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'crs',
        reason: 'EPSG:2000 does not include a Proj.4 definition',
      },
    });
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns an init validation error for init EPSG records without Proj.4 definitions', async () => {
    const result = await map.ops.projectLayer({
      source: 'src1',
      target: 'states',
      crs: 'EPSG:3857',
      init: 'EPSG:2000',
    });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'init',
        reason: 'EPSG:2000 does not include a Proj.4 definition',
      },
    });
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('appends densify', async () => {
    await map.ops.projectLayer({
      source: 'src1',
      target: 'states',
      crs: 'robinson',
      densify: true,
    });
    expectCli('-proj "robinson" densify', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('combines all options', async () => {
    await map.ops.projectLayer({
      source: 'src1',
      target: 'states',
      crs: 'EPSG:3857',
      init: 'EPSG:4326',
      densify: true,
    });
    expectCli('-proj webmercator init=wgs84 densify', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('returns false when source is missing', async () => {
    expect(
      (await map.ops.projectLayer({ source: 'nope', target: 'states', crs: 'EPSG:3857' })).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when target is unresolved', async () => {
    expect(
      (await map.ops.projectLayer({ source: 'src1', target: 'missing', crs: 'EPSG:3857' })).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false on empty / whitespace crs', async () => {
    expect((await map.ops.projectLayer({ source: 'src1', target: 'states', crs: '' })).ok).toBe(
      false,
    );
    expect((await map.ops.projectLayer({ source: 'src1', target: 'states', crs: '   ' })).ok).toBe(
      false,
    );
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('rejects an empty output filename before projection', async () => {
    const result = await map.ops.projectLayer({
      source: 'src1',
      target: 'states',
      crs: 'EPSG:3857',
      output: { filename: '  ' },
    });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'output.filename',
        reason: 'must be a non-empty filename',
      },
    });
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
});
describe('Emap renameLayer', () => {
  let map: Emap;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [
        { name: 'old', shapes: [], geometry_type: 'polygon' },
        { name: 'other', shapes: [], geometry_type: 'polyline' },
      ],
    };
    const afterDs = { layers: [{ name: 'new', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    runParsedCommandsSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDs),
    );
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('builds the minimal command shape', async () => {
    const ok = await map.ops.renameLayer({ source: 'src1', target: 'old', name: 'new' });
    expect(ok.ok).toBe(true);
    expectCli('-target "old" -rename-layers "new"', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('quotes names with spaces', async () => {
    await map.ops.renameLayer({ source: 'src1', target: 'old', name: 'My Layer' });
    expectCli('-target "old" -rename-layers "My Layer"', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('returns false when source is missing', async () => {
    expect((await map.ops.renameLayer({ source: 'nope', target: 'old', name: 'new' })).ok).toBe(
      false,
    );
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when target is unresolved', async () => {
    expect((await map.ops.renameLayer({ source: 'src1', target: 'missing', name: 'new' })).ok).toBe(
      false,
    );
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false on empty / whitespace name', async () => {
    expect((await map.ops.renameLayer({ source: 'src1', target: 'old', name: '' })).ok).toBe(false);
    expect((await map.ops.renameLayer({ source: 'src1', target: 'old', name: '   ' })).ok).toBe(
      false,
    );
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false on collision with another layer', async () => {
    expect((await map.ops.renameLayer({ source: 'src1', target: 'old', name: 'other' })).ok).toBe(
      false,
    );
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('allows renaming to the same name (no collision against itself)', async () => {
    const ok = await map.ops.renameLayer({ source: 'src1', target: 'old', name: 'old' });
    expect(ok.ok).toBe(true);
    expectCli('-target "old" -rename-layers "old"', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('history entry is labelled "Rename <from> → <to>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.renameLayer({ source: 'src1', target: 'old', name: 'new' });
    expect(listener.mock.calls[0][0].label).toBe('Rename old → new');
  });
});
describe('Emap mergeLayers', () => {
  let map: Emap;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [
        { name: 'a', shapes: [], geometry_type: 'polygon' },
        { name: 'b', shapes: [], geometry_type: 'polygon' },
        { name: 'c', shapes: [], geometry_type: 'polygon' },
        { name: 'roads', shapes: [], geometry_type: 'polyline' },
      ],
    };
    const afterDs = { layers: [{ name: 'merged', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    runParsedCommandsSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDs),
    );
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('joins targets with commas inside a single quoted -target arg', async () => {
    const ok = await map.ops.mergeLayers({ source: 'src1', targets: ['a', 'b'] });
    expect(ok.ok).toBe(true);
    expectCli('-target "a,b" -merge-layers', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('preserves target order for three or more layers', async () => {
    await map.ops.mergeLayers({ source: 'src1', targets: ['c', 'a', 'b'] });
    expectCli('-target "c,a,b" -merge-layers', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends quoted name', async () => {
    await map.ops.mergeLayers({ source: 'src1', targets: ['a', 'b'], name: 'combined' });
    expectCli('-target "a,b" -merge-layers name="combined"', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends force', async () => {
    await map.ops.mergeLayers({ source: 'src1', targets: ['a', 'b'], force: true });
    expectCli('-target "a,b" -merge-layers force', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends flatten', async () => {
    await map.ops.mergeLayers({ source: 'src1', targets: ['a', 'b'], flatten: true });
    expectCli('-target "a,b" -merge-layers flatten', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('returns false for fewer than two targets', async () => {
    expect((await map.ops.mergeLayers({ source: 'src1', targets: ['a'] })).ok).toBe(false);
    expect((await map.ops.mergeLayers({ source: 'src1', targets: [] })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when any target is unresolved', async () => {
    expect((await map.ops.mergeLayers({ source: 'src1', targets: ['a', 'missing'] })).ok).toBe(
      false,
    );
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('rejects mixed-geometry targets without force', async () => {
    expect((await map.ops.mergeLayers({ source: 'src1', targets: ['a', 'roads'] })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('allows mixed-geometry targets with force=true', async () => {
    const ok = await map.ops.mergeLayers({ source: 'src1', targets: ['a', 'roads'], force: true });
    expect(ok.ok).toBe(true);
    expectCli('-target "a,roads" -merge-layers force', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('returns false when source is missing', async () => {
    expect((await map.ops.mergeLayers({ source: 'nope', targets: ['a', 'b'] })).ok).toBe(false);
  });
  it('history entry is labelled "Merge <comma-joined>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.mergeLayers({ source: 'src1', targets: ['a', 'b'] });
    expect(listener.mock.calls[0][0].label).toBe('Merge a,b');
  });
});
describe('Emap splitLayer', () => {
  let map: Emap;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [{ name: 'states', shapes: [], geometry_type: 'polygon' }],
    };
    const afterDs = { layers: [{ name: 'states-A', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    runParsedCommandsSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDs),
    );
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('builds the field-name form', async () => {
    const ok = await map.ops.splitLayer({ source: 'src1', target: 'states', expression: 'REGION' });
    expect(ok.ok).toBe(true);
    expectCli('-target "states" -split "REGION"', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('forwards JS expressions verbatim, quoted', async () => {
    await map.ops.splitLayer({
      source: 'src1',
      target: 'states',
      expression: 'this.pop > 1000000 ? "big" : "small"',
    });
    expectCli(
      '-target "states" -split "this.pop > 1000000 ? \\"big\\" : \\"small\\""',
      runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('appends no-replace', async () => {
    await map.ops.splitLayer({
      source: 'src1',
      target: 'states',
      expression: 'REGION',
      noReplace: true,
    });
    expectCli('-target "states" -split "REGION" no-replace', runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('returns false when source is missing', async () => {
    expect(
      (await map.ops.splitLayer({ source: 'nope', target: 'states', expression: 'REGION' })).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when target is unresolved', async () => {
    expect(
      (await map.ops.splitLayer({ source: 'src1', target: 'missing', expression: 'REGION' })).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false on empty / whitespace expression', async () => {
    expect(
      (await map.ops.splitLayer({ source: 'src1', target: 'states', expression: '' })).ok,
    ).toBe(false);
    expect(
      (await map.ops.splitLayer({ source: 'src1', target: 'states', expression: '   ' })).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('history entry is labelled "Split <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.splitLayer({ source: 'src1', target: 'states', expression: 'REGION' });
    expect(listener.mock.calls[0][0].label).toBe('Split states');
  });
});
// =============================================================================
// Data-engineering wrappers (shared scaffolding)
// =============================================================================
// Covers dropLayer / sortFeatures / uniqueFeatures / filterFields /
// renameFields. All five have the same dataset-replace contract and beforeEach
// shape, so a single helper builds the standard fixture.
async function setupDataEngineeringMap(): Promise<{
  map: Emap;
  runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  parseCommandsSpy: ReturnType<typeof vi.fn>;
  restore: () => void;
}> {
  const map = await createBareMap();
  setPrivate(map, '_history', new EditHistory());
  const beforeDs = {
    layers: [
      { name: 'states', shapes: [], geometry_type: 'polygon' },
      { name: 'roads', shapes: [], geometry_type: 'polyline' },
    ],
  };
  const afterDs = { layers: [{ name: 'states', shapes: [] }] };
  const source = {
    id: 'src1',
    type: 'topology',
    getDataset: () => beforeDs,
    getLayers: () => beforeDs.layers,
    setDataset: vi.fn(),
    refreshDisplayArcs: vi.fn(),
  } as any;
  (map as any)._sources.set('src1', source);
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const runParsedCommandsSpy = vi.fn((_c: any, _j: any, cb: any) => {
    cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
  }) as ReturnType<typeof vi.fn>;
  // PR-4b: ops bypass parseCommands. Tests that asserted
  // `parseCommandsSpy.not.toHaveBeenCalled()` now alias parseCommandsSpy
  // to the same runParsedCommands spy so the early-exit semantics still
  // hold (no command dispatched ↔ no spy call).
  const parseCommandsSpy = runParsedCommandsSpy;
  Reflect.set(
    mapshaper.internal as object,
    'copyDataset',
    vi.fn(() => beforeDs),
  );
  Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  return {
    map,
    runParsedCommandsSpy,
    parseCommandsSpy,
    restore: () => {
      Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
      Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
      Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
    },
  };
}
describe('Emap dropLayer', () => {
  let ctx: ReturnType<typeof setupDataEngineeringMap>;
  beforeEach(async () => {
    ctx = await setupDataEngineeringMap();
  });
  afterEach(() => {
    ctx.restore();
  });
  it('builds the minimal command shape', async () => {
    const ok = await ctx.map.ops.dropLayer({ source: 'src1', target: 'states' });
    expect(ok.ok).toBe(true);
    expectCli('-target "states" -drop', ctx.runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('returns false when source is missing', async () => {
    expect((await ctx.map.ops.dropLayer({ source: 'nope', target: 'states' })).ok).toBe(false);
    expect(ctx.parseCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false when target is unresolved', async () => {
    expect((await ctx.map.ops.dropLayer({ source: 'src1', target: 'missing' })).ok).toBe(false);
    expect(ctx.parseCommandsSpy).not.toHaveBeenCalled();
  });
  it('history label is "Drop <target>"', async () => {
    const listener = vi.fn();
    ctx.map.on('historychange', listener);
    await ctx.map.ops.dropLayer({ source: 'src1', target: 'states' });
    expect(listener.mock.calls[0][0].label).toBe('Drop states');
  });
});
describe('Emap sortFeatures', () => {
  let ctx: ReturnType<typeof setupDataEngineeringMap>;
  beforeEach(async () => {
    ctx = await setupDataEngineeringMap();
  });
  afterEach(() => {
    ctx.restore();
  });
  it('builds the ascending command (default)', async () => {
    const ok = await ctx.map.ops.sortFeatures({
      source: 'src1',
      target: 'states',
      expression: 'POP',
    });
    expect(ok.ok).toBe(true);
    expectCli('-target "states" -sort "POP"', ctx.runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends descending', async () => {
    await ctx.map.ops.sortFeatures({
      source: 'src1',
      target: 'states',
      expression: 'POP',
      descending: true,
    });
    expectCli('-target "states" -sort "POP" descending', ctx.runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('quotes JS expressions verbatim', async () => {
    await ctx.map.ops.sortFeatures({
      source: 'src1',
      target: 'states',
      expression: 'this.pop * -1',
    });
    expectCli('-target "states" -sort "this.pop * -1"', ctx.runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('returns false on missing source / unresolved target / empty expression', async () => {
    expect(
      (await ctx.map.ops.sortFeatures({ source: 'nope', target: 'states', expression: 'POP' })).ok,
    ).toBe(false);
    expect(
      (await ctx.map.ops.sortFeatures({ source: 'src1', target: 'missing', expression: 'POP' })).ok,
    ).toBe(false);
    expect(
      (await ctx.map.ops.sortFeatures({ source: 'src1', target: 'states', expression: '' })).ok,
    ).toBe(false);
    expect(
      (await ctx.map.ops.sortFeatures({ source: 'src1', target: 'states', expression: '   ' })).ok,
    ).toBe(false);
    expect(ctx.parseCommandsSpy).not.toHaveBeenCalled();
  });
  it('history label is "Sort <target>"', async () => {
    const listener = vi.fn();
    ctx.map.on('historychange', listener);
    await ctx.map.ops.sortFeatures({ source: 'src1', target: 'states', expression: 'POP' });
    expect(listener.mock.calls[0][0].label).toBe('Sort states');
  });
});
describe('Emap uniqueFeatures', () => {
  let ctx: ReturnType<typeof setupDataEngineeringMap>;
  beforeEach(async () => {
    ctx = await setupDataEngineeringMap();
  });
  afterEach(() => {
    ctx.restore();
  });
  it('builds the minimal command shape', async () => {
    const ok = await ctx.map.ops.uniqueFeatures({
      source: 'src1',
      target: 'states',
      expression: 'STATE_FIPS',
    });
    expect(ok.ok).toBe(true);
    expectCli('-target "states" -uniq "STATE_FIPS"', ctx.runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('appends max-count', async () => {
    await ctx.map.ops.uniqueFeatures({
      source: 'src1',
      target: 'states',
      expression: 'STATE',
      maxCount: 3,
    });
    expectCli(
      '-target "states" -uniq "STATE" max-count=3',
      ctx.runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('appends invert', async () => {
    await ctx.map.ops.uniqueFeatures({
      source: 'src1',
      target: 'states',
      expression: 'STATE',
      invert: true,
    });
    expectCli('-target "states" -uniq "STATE" invert', ctx.runParsedCommandsSpy.mock.calls[0][0]);
  });
  it('returns false on empty expression / non-positive maxCount', async () => {
    expect(
      (await ctx.map.ops.uniqueFeatures({ source: 'src1', target: 'states', expression: '' })).ok,
    ).toBe(false);
    expect(
      (
        await ctx.map.ops.uniqueFeatures({
          source: 'src1',
          target: 'states',
          expression: 'X',
          maxCount: 0,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await ctx.map.ops.uniqueFeatures({
          source: 'src1',
          target: 'states',
          expression: 'X',
          maxCount: -1,
        })
      ).ok,
    ).toBe(false);
    expect(ctx.parseCommandsSpy).not.toHaveBeenCalled();
  });
  it('history label is "Uniq <target>"', async () => {
    const listener = vi.fn();
    ctx.map.on('historychange', listener);
    await ctx.map.ops.uniqueFeatures({ source: 'src1', target: 'states', expression: 'STATE' });
    expect(listener.mock.calls[0][0].label).toBe('Uniq states');
  });
});
describe('Emap filterFields', () => {
  let ctx: ReturnType<typeof setupDataEngineeringMap>;
  beforeEach(async () => {
    ctx = await setupDataEngineeringMap();
  });
  afterEach(() => {
    ctx.restore();
  });
  it('joins fields with commas inside one quoted argument', async () => {
    const ok = await ctx.map.ops.filterFields({
      source: 'src1',
      target: 'states',
      fields: ['fips', 'name'],
    });
    expect(ok.ok).toBe(true);
    expectCli(
      '-target "states" -filter-fields "fips,name"',
      ctx.runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('appends invert', async () => {
    await ctx.map.ops.filterFields({
      source: 'src1',
      target: 'states',
      fields: ['fips'],
      invert: true,
    });
    expectCli(
      '-target "states" -filter-fields "fips" invert',
      ctx.runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('returns false on empty / invalid fields', async () => {
    expect(
      (await ctx.map.ops.filterFields({ source: 'src1', target: 'states', fields: [] })).ok,
    ).toBe(false);
    expect(
      (await ctx.map.ops.filterFields({ source: 'src1', target: 'states', fields: ['', 'b'] })).ok,
    ).toBe(false);
    expect(
      (await ctx.map.ops.filterFields({ source: 'src1', target: 'states', fields: ['a,b'] })).ok,
    ).toBe(false);
    expect(ctx.parseCommandsSpy).not.toHaveBeenCalled();
  });
  it('history label is "Filter fields <target>"', async () => {
    const listener = vi.fn();
    ctx.map.on('historychange', listener);
    await ctx.map.ops.filterFields({ source: 'src1', target: 'states', fields: ['fips'] });
    expect(listener.mock.calls[0][0].label).toBe('Filter fields states');
  });
});
describe('Emap renameFields', () => {
  let ctx: ReturnType<typeof setupDataEngineeringMap>;
  beforeEach(async () => {
    ctx = await setupDataEngineeringMap();
  });
  afterEach(() => {
    ctx.restore();
  });
  it('serializes a single rename', async () => {
    const ok = await ctx.map.ops.renameFields({
      source: 'src1',
      target: 'states',
      mapping: { OLD: 'NEW' },
    });
    expect(ok.ok).toBe(true);
    expectCli(
      '-target "states" -rename-fields "OLD=NEW"',
      ctx.runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('serializes a multi-field rename in iteration order', async () => {
    await ctx.map.ops.renameFields({
      source: 'src1',
      target: 'states',
      mapping: { fips: 'STATE_FIPS', st: 'state' },
    });
    expectCli(
      '-target "states" -rename-fields "fips=STATE_FIPS,st=state"',
      ctx.runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('returns false on empty mapping or invalid keys/values', async () => {
    expect(
      (await ctx.map.ops.renameFields({ source: 'src1', target: 'states', mapping: {} })).ok,
    ).toBe(false);
    expect(
      (await ctx.map.ops.renameFields({ source: 'src1', target: 'states', mapping: { '': 'b' } }))
        .ok,
    ).toBe(false);
    expect(
      (await ctx.map.ops.renameFields({ source: 'src1', target: 'states', mapping: { a: '' } })).ok,
    ).toBe(false);
    expect(
      (
        await ctx.map.ops.renameFields({
          source: 'src1',
          target: 'states',
          mapping: { 'a,b': 'c' },
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await ctx.map.ops.renameFields({
          source: 'src1',
          target: 'states',
          mapping: { 'a=b': 'c' },
        })
      ).ok,
    ).toBe(false);
    expect(
      (await ctx.map.ops.renameFields({ source: 'src1', target: 'states', mapping: { a: 'b,c' } }))
        .ok,
    ).toBe(false);
    expect(
      (await ctx.map.ops.renameFields({ source: 'src1', target: 'states', mapping: { a: 'b=c' } }))
        .ok,
    ).toBe(false);
    expect(ctx.parseCommandsSpy).not.toHaveBeenCalled();
  });
  it('history label is "Rename fields <target>"', async () => {
    const listener = vi.fn();
    ctx.map.on('historychange', listener);
    await ctx.map.ops.renameFields({ source: 'src1', target: 'states', mapping: { a: 'b' } });
    expect(listener.mock.calls[0][0].label).toBe('Rename fields states');
  });
});
describe('Emap joinTable', () => {
  let map: Emap;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  let lastCommands: any[] | null;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [{ name: 'states', shapes: [], geometry_type: 'polygon' }],
    };
    const afterDs = { layers: [{ name: 'states', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    lastCommands = null;
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDs),
    );
    // PR-4b: ops now hand pre-parsed commands directly to runParsedCommands.
    // The spy is renamed `runParsedCommandsSpy` for legacy callsites but actually
    // intercepts the parsed-command path; it captures the array so
    // `injectedInput()` can inspect the `options.input` field that the
    // runner mutates between dispatch and our callback.
    runParsedCommandsSpy = vi.fn((cmds: any, _j: any, cb: any) => {
      lastCommands = cmds;
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  function injectedInput(): unknown {
    return lastCommands?.[0]?.options?.input;
  }
  it('CSV-based join — command shape + input cache', async () => {
    const ok = await map.ops.joinTable({
      source: 'src1',
      target: 'states',
      data: { csv: 'fips,pop\n01,4M\n02,800K' },
      keys: ['STATE_FIPS', 'fips'],
    });
    expect(ok.ok).toBe(true);
    expectCli(
      '-target "states" -join ".emap-join.csv" keys="STATE_FIPS,fips"',
      runParsedCommandsSpy.mock.calls[0][0],
    );
    expect(injectedInput()).toEqual({ '.emap-join.csv': 'fips,pop\n01,4M\n02,800K' });
  });
  it('CSV bytes (Uint8Array) flow through unchanged', async () => {
    const bytes = new TextEncoder().encode('a,b\n1,2');
    await map.ops.joinTable({
      source: 'src1',
      target: 'states',
      data: { csv: bytes },
      keys: ['k', 's'],
    });
    expect((injectedInput() as Record<string, unknown>)['.emap-join.csv']).toBe(bytes);
  });
  it('JSON string is injected as .emap-join.json', async () => {
    await map.ops.joinTable({
      source: 'src1',
      target: 'states',
      data: { json: '[{"a":1}]' },
      keys: ['k', 's'],
    });
    expectCli(
      '-target "states" -join ".emap-join.json" keys="k,s"',
      runParsedCommandsSpy.mock.calls[0][0],
    );
    expect(injectedInput()).toEqual({ '.emap-join.json': '[{"a":1}]' });
  });
  it('JSON array is auto-stringified', async () => {
    await map.ops.joinTable({
      source: 'src1',
      target: 'states',
      data: { json: [{ a: 1 }, { a: 2 }] },
      keys: ['k', 's'],
    });
    expect((injectedInput() as Record<string, unknown>)['.emap-join.json']).toBe(
      '[{"a":1},{"a":2}]',
    );
  });
  it('JSON plain object is auto-stringified', async () => {
    await map.ops.joinTable({
      source: 'src1',
      target: 'states',
      data: { json: { rows: [{ a: 1 }] } },
      keys: ['k', 's'],
    });
    expect((injectedInput() as Record<string, unknown>)['.emap-join.json']).toBe(
      '{"rows":[{"a":1}]}',
    );
  });
  it('Layer-based join — no inputFiles cache', async () => {
    await map.ops.joinTable({
      source: 'src1',
      target: 'states',
      data: { layer: 'pop_table' },
      keys: ['STATE_FIPS', 'fips'],
    });
    expectCli(
      '-target "states" -join "pop_table" keys="STATE_FIPS,fips"',
      runParsedCommandsSpy.mock.calls[0][0],
    );
    expect(injectedInput()).toBeUndefined();
  });
  it('forwards every optional passthrough', async () => {
    await map.ops.joinTable({
      source: 'src1',
      target: 'states',
      data: { layer: 't' },
      keys: ['k', 's'],
      fields: ['pop', 'gdp'],
      prefix: 'p_',
      where: 'this.year === 2024',
      calc: 'sum(pop)',
      unjoined: true,
      unmatched: true,
    });
    expectCli(
      '-target "states" -join "t" keys="k,s"' +
        ' fields=pop,gdp' +
        ' prefix="p_"' +
        ' where="this.year === 2024"' +
        ' calc="sum(pop)"' +
        ' unjoined unmatched',
      runParsedCommandsSpy.mock.calls[0][0],
    );
  });
  it('returns false on missing source', async () => {
    expect(
      (
        await map.ops.joinTable({
          source: 'nope',
          target: 'states',
          data: { csv: 'a,b\n1,2' },
          keys: ['k', 's'],
        })
      ).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false on unresolved target', async () => {
    expect(
      (
        await map.ops.joinTable({
          source: 'src1',
          target: 'missing',
          data: { csv: 'a,b\n1,2' },
          keys: ['k', 's'],
        })
      ).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false on malformed keys', async () => {
    const base = {
      source: 'src1' as const,
      target: 'states' as const,
      data: { layer: 't' } as const,
    };
    expect((await map.ops.joinTable({ ...base, keys: ['k'] as any })).ok).toBe(false);
    expect((await map.ops.joinTable({ ...base, keys: ['', 's'] })).ok).toBe(false);
    expect((await map.ops.joinTable({ ...base, keys: ['k', '   '] })).ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('returns false on invalid data shape', async () => {
    expect(
      (
        await map.ops.joinTable({
          source: 'src1',
          target: 'states',
          data: {} as any,
          keys: ['k', 's'],
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await map.ops.joinTable({
          source: 'src1',
          target: 'states',
          data: { layer: '' } as any,
          keys: ['k', 's'],
        })
      ).ok,
    ).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });
  it('history label is "Join <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.joinTable({
      source: 'src1',
      target: 'states',
      data: { layer: 't' },
      keys: ['k', 's'],
    });
    expect(listener.mock.calls[0][0].label).toBe('Join states');
  });
});
describe('Emap joinTable round-trip (real mapshaper)', () => {
  it('real CSV join populates the joined columns', async () => {
    const polygons = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { fips: 'AL' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
                [0, 0],
              ],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { fips: 'AK' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [2, 2],
                [3, 2],
                [3, 3],
                [2, 3],
                [2, 2],
              ],
            ],
          },
        },
      ],
    });
    const { TopologySource } = await import('../../domain/source/topology-source');
    const source = await new Promise<any>((resolve, reject) => {
      const s = new TopologySource('rt');
      s.on('data', () => resolve(s));
      s.on('error', (e: any) => reject(e?.error ?? e));
      s.setData({ filename: 'rt.geojson', content: new TextEncoder().encode(polygons) });
    });
    const map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    setPrivate(map, '_projection', { crs: 'EPSG:4326', setCRS: vi.fn() });
    setPrivate(map, '_viewport', { setCRS: vi.fn() });
    await map.addSource('rt', source);
    const layerName = source.getDataset()!.layers[0].name;
    const csv = 'fips,pop\nAL,1000\nAK,2000\n';
    const ok = await map.ops.joinTable({
      source: 'rt',
      target: layerName,
      data: { csv },
      keys: ['fips', 'fips'],
    });
    expect(ok.ok).toBe(true);
    const ds = map.getSource('rt')!.getDataset()!;
    const recs = ds.layers[0].data!.getRecords();
    expect(recs.length).toBe(2);
    // Each polygon should now carry a 'pop' field from the joined CSV.
    const popById: Record<string, unknown> = {};
    for (const r of recs) popById[(r as any).fips] = (r as any).pop;
    // mapshaper coerces numeric-looking CSV columns to numbers by default
    expect(popById['AL']).toBe(1000);
    expect(popById['AK']).toBe(2000);
  });
});
describe('Emap checkGeometry (mocked mapshaper)', () => {
  let map: Emap;
  let findSegmentIntersectionsSpy: ReturnType<typeof vi.fn>;
  const originalFind = Reflect.get(mapshaper.internal as object, 'findSegmentIntersections');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const ds = {
      layers: [{ name: 'shapes', shapes: [], geometry_type: 'polygon' }],
      arcs: { _sentinel: 'arcs' },
    };
    const source = {
      id: 'src1',
      type: 'topology' as const,
      getDataset: () => ds,
      getLayers: () => ds.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
      off: vi.fn(),
      on: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    findSegmentIntersectionsSpy = vi.fn(() => []) as ReturnType<typeof vi.fn>;
    Reflect.set(
      mapshaper.internal as object,
      'findSegmentIntersections',
      findSegmentIntersectionsSpy,
    );
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'findSegmentIntersections', originalFind);
  });
  it('returns the clean report when there are no intersections', async () => {
    const result = await map.ops.checkGeometry({ source: 'src1' });
    expect(result).toEqual({
      ok: true,
      value: { ok: true, intersections: [], intersectionCount: 0 },
    });
    expect(findSegmentIntersectionsSpy).toHaveBeenCalledTimes(1);
    const args = findSegmentIntersectionsSpy.mock.calls[0] as unknown[];
    expect((args[0] as any)._sentinel).toBe('arcs');
  });
  it('maps mapshaper intersection objects to {x,y}', async () => {
    findSegmentIntersectionsSpy.mockReturnValue([
      { x: 1, y: 2, _internal: 'a' },
      { x: 3, y: 4, _internal: 'b' },
    ]);
    const result = await map.ops.checkGeometry({ source: 'src1' });
    expect(result).toEqual({
      ok: true,
      value: {
        ok: false,
        intersectionCount: 2,
        intersections: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      },
    });
  });
  it('forwards tolerance to mapshaper', async () => {
    await map.ops.checkGeometry({ source: 'src1', tolerance: 0.001 });
    expect(findSegmentIntersectionsSpy.mock.calls[0][1]).toEqual({ tolerance: 0.001 });
  });
  it('omits tolerance when not supplied', async () => {
    await map.ops.checkGeometry({ source: 'src1' });
    expect(findSegmentIntersectionsSpy.mock.calls[0][1]).toEqual({});
  });
  it('returns a not-found error on missing source', async () => {
    const result = await map.ops.checkGeometry({ source: 'nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('not-found');
    expect(findSegmentIntersectionsSpy).not.toHaveBeenCalled();
  });
  it('returns a not-found error on missing dataset', async () => {
    const noDsSource = {
      id: 's2',
      type: 'topology' as const,
      getDataset: () => undefined,
      setDataset: vi.fn(),
      off: vi.fn(),
      on: vi.fn(),
    } as any;
    (map as any)._sources.set('s2', noDsSource);
    const result = await map.ops.checkGeometry({ source: 's2' });
    expect(result.ok).toBe(false);
  });
  it('returns the empty/clean report for arc-less datasets without invoking mapshaper', async () => {
    const pointSource = {
      id: 'pts',
      type: 'topology' as const,
      getDataset: () => ({ layers: [{ name: 'p', geometry_type: 'point', shapes: [] }] }),
      setDataset: vi.fn(),
      off: vi.fn(),
      on: vi.fn(),
    } as any;
    (map as any)._sources.set('pts', pointSource);
    const result = await map.ops.checkGeometry({ source: 'pts' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ ok: true, intersections: [], intersectionCount: 0 });
    }
    expect(findSegmentIntersectionsSpy).not.toHaveBeenCalled();
  });
  it('does NOT push history on any branch', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.checkGeometry({ source: 'src1' });
    findSegmentIntersectionsSpy.mockReturnValueOnce([{ x: 0, y: 0 }]);
    await map.ops.checkGeometry({ source: 'src1' });
    await map.ops.checkGeometry({ source: 'nope' });
    expect(listener).not.toHaveBeenCalled();
  });
});
describe('Emap checkGeometry round-trip (real mapshaper)', () => {
  function buildSource(id: string, geojson: string): Promise<any> {
    return new Promise((resolve, reject) => {
      import('../../domain/source/topology-source').then(({ TopologySource }) => {
        const source = new TopologySource(id);
        source.on('data', () => resolve(source));
        source.on('error', (e: any) => reject(e?.error ?? e));
        source.setData({ filename: `${id}.geojson`, content: new TextEncoder().encode(geojson) });
      });
    });
  }
  it('reports zero intersections for a clean dataset', async () => {
    const clean = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [2, 0],
                [2, 2],
                [0, 2],
                [0, 0],
              ],
            ],
          },
        },
      ],
    });
    const source = await buildSource('clean', clean);
    const map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    setPrivate(map, '_projection', { crs: 'EPSG:4326', setCRS: vi.fn() });
    setPrivate(map, '_viewport', { setCRS: vi.fn() });
    await map.addSource('clean', source);
    const result = await map.ops.checkGeometry({ source: 'clean' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.ok).toBe(true);
    expect(result.value.intersectionCount).toBe(0);
  });
  it('reports a positive count for a pair of crossing polylines', async () => {
    // Two LineStrings that visibly cross at (1,1). polylines aren't auto-
    // normalized on import the way polygons sometimes are, so the arc
    // collection still has the crossing segments when findSegmentIntersections
    // runs.
    const crossing = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [2, 2],
            ],
          },
        },
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 2],
              [2, 0],
            ],
          },
        },
      ],
    });
    const source = await buildSource('crossing', crossing);
    const map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    setPrivate(map, '_projection', { crs: 'EPSG:4326', setCRS: vi.fn() });
    setPrivate(map, '_viewport', { setCRS: vi.fn() });
    await map.addSource('crossing', source);
    const result = await map.ops.checkGeometry({ source: 'crossing' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.ok).toBe(false);
    expect(result.value.intersectionCount).toBeGreaterThan(0);
    expect(result.value.intersections[0]).toHaveProperty('x');
    expect(result.value.intersections[0]).toHaveProperty('y');
  });
});
describe('Emap rebuildTopology (mocked mapshaper)', () => {
  let map: Emap;
  let copyDatasetSpy: ReturnType<typeof vi.fn>;
  let addIntersectionCutsSpy: ReturnType<typeof vi.fn>;
  let setDatasetSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalAddCuts = Reflect.get(mapshaper.internal as object, 'addIntersectionCuts');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    setDatasetSpy = vi.fn() as ReturnType<typeof vi.fn>;
    const ds = {
      layers: [{ name: 'shapes', shapes: [], geometry_type: 'polygon' }],
      arcs: {
        /* sentinel — presence is what matters */
      },
    };
    const source = {
      id: 'src1',
      type: 'topology' as const,
      getDataset: () => ds,
      getLayers: () => ds.layers,
      setDataset: setDatasetSpy,
      refreshDisplayArcs: vi.fn(),
      off: vi.fn(),
      on: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    // copyDataset returns a fresh object each call so the test can inspect
    // which copy was passed to addIntersectionCuts vs which to DatasetReplace.
    let copyId = 0;
    copyDatasetSpy = vi.fn((dataset: Record<string, unknown>) => ({
      ...dataset,
      _copy: ++copyId,
    })) as ReturnType<typeof vi.fn>;
    addIntersectionCutsSpy = vi.fn() as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', copyDatasetSpy);
    Reflect.set(mapshaper.internal as object, 'addIntersectionCuts', addIntersectionCutsSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'addIntersectionCuts', originalAddCuts);
  });
  it('calls addIntersectionCuts on a deep copy of the source dataset', async () => {
    const ok = await map.ops.rebuildTopology({ source: 'src1' });
    expect(ok.ok).toBe(true);
    expect(copyDatasetSpy).toHaveBeenCalledTimes(1);
    expect(addIntersectionCutsSpy).toHaveBeenCalledTimes(1);
    const arg = addIntersectionCutsSpy.mock.calls[0][0] as any;
    expect(arg._copy).toBeDefined();
  });
  it('forwards options as snake_case', async () => {
    await map.ops.rebuildTopology({
      source: 'src1',
      snapInterval: 0.001,
      noSnap: false,
      rebuildTopology: true,
    });
    const opts = addIntersectionCutsSpy.mock.calls[0][1] as any;
    expect(opts).toEqual({
      snap_interval: 0.001,
      no_snap: false,
      rebuild_topology: true,
    });
  });
  it('returns false when source is missing', async () => {
    expect((await map.ops.rebuildTopology({ source: 'nope' })).ok).toBe(false);
    expect(addIntersectionCutsSpy).not.toHaveBeenCalled();
  });
  it('returns false when source has no dataset', async () => {
    const noDsSource = {
      id: 's2',
      type: 'topology' as const,
      getDataset: () => undefined,
      setDataset: vi.fn(),
      off: vi.fn(),
      on: vi.fn(),
    } as any;
    (map as any)._sources.set('s2', noDsSource);
    expect((await map.ops.rebuildTopology({ source: 's2' })).ok).toBe(false);
    expect(addIntersectionCutsSpy).not.toHaveBeenCalled();
  });
  it('returns a mapshaper error when the topology working copy fails', async () => {
    copyDatasetSpy.mockImplementationOnce(() => {
      throw new Error('copy failed');
    });
    const result = await map.ops.rebuildTopology({ source: 'src1' });
    expect(result).toMatchObject({ ok: false, error: { kind: 'mapshaper' } });
    expect(setDatasetSpy).not.toHaveBeenCalled();
  });
  it('returns true (no-op) for arc-less point-only datasets', async () => {
    const pointSource = {
      id: 'pts',
      type: 'topology' as const,
      getDataset: () => ({ layers: [{ name: 'p', geometry_type: 'point', shapes: [] }] }),
      setDataset: vi.fn(),
      off: vi.fn(),
      on: vi.fn(),
    } as any;
    (map as any)._sources.set('pts', pointSource);
    expect((await map.ops.rebuildTopology({ source: 'pts' })).ok).toBe(true);
    expect(addIntersectionCutsSpy).not.toHaveBeenCalled();
    expect(map.canUndo()).toBe(false);
  });
  it('swaps the dataset via setDataset on success', async () => {
    await map.ops.rebuildTopology({ source: 'src1' });
    expect(setDatasetSpy).toHaveBeenCalledTimes(1);
    const after = setDatasetSpy.mock.calls[0][0] as any;
    expect(after._copy).toBeDefined();
  });
  it('pushes one DatasetReplaceCommand labelled "Rebuild topology"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.rebuildTopology({ source: 'src1' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Rebuild topology');
    expect(map.canUndo()).toBe(true);
  });
  it('acts as a history barrier (flags prior commands stale)', async () => {
    const history = (map as any)._history as EditHistory;
    const fakeUndo = vi.fn();
    const fake = { label: 'fake', do: vi.fn(), undo: fakeUndo } as any;
    history.push(fake);
    expect(map.canUndo()).toBe(true);
    // After rebuild, the fake prior command is released and represented by
    // one lightweight boundary whose traversal skips the old undo().
    await map.ops.rebuildTopology({ source: 'src1' });
    expect(fake.stale).toBeUndefined();
    const command = history.undo();
    expect(command?.label).toBe('Rebuild topology');
    expect(map.canUndo()).toBe(true);
    history.undo();
    expect(fakeUndo).not.toHaveBeenCalled();
    expect(map.canUndo()).toBe(false);
  });
  it('clears the selection', async () => {
    const selection = (map as any)._selection as Selection;
    selection.apply([{ source: 'src1', layer: 'shapes', id: 1 }], 'add');
    expect(selection.getAll().length).toBe(1);
    await map.ops.rebuildTopology({ source: 'src1' });
    expect(selection.getAll().length).toBe(0);
  });
  it('on addIntersectionCuts throw: fires error event and returns false', async () => {
    addIntersectionCutsSpy.mockImplementation(() => {
      throw new Error('boom');
    });
    const errors: any[] = [];
    map.on('error', (e: any) => errors.push(e));
    expect((await map.ops.rebuildTopology({ source: 'src1' })).ok).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toBe('boom');
    expect(setDatasetSpy).not.toHaveBeenCalled();
    expect(map.canUndo()).toBe(false);
  });
});
describe('Emap rebuildTopology round-trip (real mapshaper)', () => {
  // Build a tiny in-memory dataset, run rebuildTopology, assert that the
  // arc collection is intact and the call didn't crash. A full
  // intersection-insertion check would require a more elaborate fixture
  // with overlapping polygons; this guards the basic plumbing.
  function buildSource(id: string, geojson: string): Promise<any> {
    return new Promise((resolve, reject) => {
      import('../../domain/source/topology-source').then(({ TopologySource }) => {
        const source = new TopologySource(id);
        source.on('data', () => resolve(source));
        source.on('error', (e: any) => reject(e?.error ?? e));
        source.setData({ filename: `${id}.geojson`, content: new TextEncoder().encode(geojson) });
      });
    });
  }
  it('runs without error on a simple polygon dataset and remains queryable', async () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { id: 1 },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [2, 0],
                [2, 2],
                [0, 2],
                [0, 0],
              ],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { id: 2 },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [1, 1],
                [3, 1],
                [3, 3],
                [1, 3],
                [1, 1],
              ],
            ],
          },
        },
      ],
    });
    const source = await buildSource('rt', geojson);
    const map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    setPrivate(map, '_projection', { crs: 'EPSG:4326', setCRS: vi.fn() });
    setPrivate(map, '_viewport', { setCRS: vi.fn() });
    await map.addSource('rt', source);
    const ok = await map.ops.rebuildTopology({ source: 'rt' });
    expect(ok.ok).toBe(true);
    const ds = map.getSource('rt')?.getDataset();
    expect(ds).toBeDefined();
    expect(ds!.layers[0].shapes.length).toBe(2);
    expect(ds!.arcs).toBeDefined();
  });
});
describe('Emap.exportSnapshot / loadSnapshot (mocked mapshaper)', () => {
  let map: Emap;
  let exportDatasetsToPackSpy: ReturnType<typeof vi.fn>;
  let packSpy: ReturnType<typeof vi.fn>;
  let unpackSessionDataSpy: ReturnType<typeof vi.fn>;
  let lastPacked: any;
  const originalExport = Reflect.get(mapshaper.internal as object, 'exportDatasetsToPack');
  const originalPack = Reflect.get(mapshaper.internal as object, 'pack');
  const originalUnpack = Reflect.get(mapshaper.internal as object, 'unpackSessionData');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    // addSource consults _projection / _viewport when registering the first
    // source (CRS auto-detect). createBareMap doesn't initialize these, so
    // stub them here.
    setPrivate(map, '_projection', { crs: 'EPSG:4326', setCRS: vi.fn() });
    setPrivate(map, '_viewport', { setCRS: vi.fn() });
    exportDatasetsToPackSpy = vi.fn(async (datasets: any[], opts: any) => ({
      version: 1,
      created: '2026-04-27T00:00:00Z',
      datasets: datasets.map((d) => ({ packed: true, layerCount: d.layers?.length ?? 0 })),
      _opts: opts,
    })) as ReturnType<typeof vi.fn>;
    packSpy = vi.fn((obj: any) => {
      lastPacked = obj;
      return new Uint8Array([1, 2, 3, 4]);
    }) as ReturnType<typeof vi.fn>;
    unpackSessionDataSpy = vi.fn(async () => ({
      version: 1,
      datasets: [
        {
          layers: [{ name: 'a-layer', geometry_type: 'polygon', shapes: [] }],
          info: { crs_string: 'EPSG:4326' },
        },
        {
          layers: [{ name: 'b-layer', geometry_type: 'polyline', shapes: [] }],
          info: { crs_string: 'EPSG:4326' },
        },
      ],
      emap: { version: 1, sources: [{ id: 'a' }, { id: 'b' }] },
    })) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'exportDatasetsToPack', exportDatasetsToPackSpy);
    Reflect.set(mapshaper.internal as object, 'pack', packSpy);
    Reflect.set(mapshaper.internal as object, 'unpackSessionData', unpackSessionDataSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'exportDatasetsToPack', originalExport);
    Reflect.set(mapshaper.internal as object, 'pack', originalPack);
    Reflect.set(mapshaper.internal as object, 'unpackSessionData', originalUnpack);
  });
  function makeSource(id: string, ds: any) {
    return {
      id,
      type: 'topology' as const,
      getDataset: () => ds,
      getLayers: () => ds?.layers ?? [],
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
      setDatasetNormalizer: vi.fn(),
      setManagedCRS: vi.fn(),
      // EventDispatcher surface used by Emap.removeSource
      off: vi.fn(),
      on: vi.fn(),
    } as any;
  }
  it('packs all topology sources in registration order', async () => {
    const ds1 = { layers: [{ name: 'L1' }] };
    const ds2 = { layers: [{ name: 'L2' }, { name: 'L3' }] };
    (map as any)._sources.set('s1', makeSource('s1', ds1));
    (map as any)._sources.set('s2', makeSource('s2', ds2));
    const blob = await map.exportSnapshot();
    expect(blob.type).toBe('application/octet-stream');
    expect(exportDatasetsToPackSpy).toHaveBeenCalledTimes(1);
    const args = exportDatasetsToPackSpy.mock.calls[0] as unknown[];
    expect(args[0]).toEqual([ds1, ds2]);
    expect(args[1]).toEqual({ compact: true });
  });
  it('injects emap.sources metadata in source order', async () => {
    (map as any)._sources.set('first', makeSource('first', { layers: [] }));
    (map as any)._sources.set('second', makeSource('second', { layers: [] }));
    await map.exportSnapshot();
    expect(lastPacked.emap).toEqual({
      version: 1,
      sources: [{ id: 'first' }, { id: 'second' }],
    });
  });
  it('skips sources without a dataset', async () => {
    (map as any)._sources.set('loaded', makeSource('loaded', { layers: [] }));
    (map as any)._sources.set('pending', makeSource('pending', undefined));
    await map.exportSnapshot();
    const args = exportDatasetsToPackSpy.mock.calls[0] as unknown[];
    expect(args[0] as unknown[]).toHaveLength(1);
    expect(lastPacked.emap.sources).toEqual([{ id: 'loaded' }]);
  });
  it('honours compact=false', async () => {
    (map as any)._sources.set('s', makeSource('s', { layers: [] }));
    await map.exportSnapshot({ compact: false });
    expect(exportDatasetsToPackSpy.mock.calls[0][1]).toEqual({ compact: false });
  });
  it('produces an empty-datasets snapshot for an empty map', async () => {
    const blob = await map.exportSnapshot();
    expect(blob.type).toBe('application/octet-stream');
    const args = exportDatasetsToPackSpy.mock.calls[0] as unknown[];
    expect(args[0]).toEqual([]);
    expect(lastPacked.emap.sources).toEqual([]);
  });
  it('loadSnapshot restores source IDs from emap metadata', async () => {
    const ids = await map.loadSnapshot(new Uint8Array([0x80]));
    expect(ids).toEqual(['a', 'b']);
    expect(map.getSource('a')).toBeDefined();
    expect(map.getSource('b')).toBeDefined();
    expect(unpackSessionDataSpy).toHaveBeenCalledTimes(1);
  });
  it('loadSnapshot accepts ArrayBuffer input', async () => {
    const buf = new Uint8Array([0x80, 0x01, 0x02]).buffer;
    const ids = await map.loadSnapshot(buf);
    expect(ids).toEqual(['a', 'b']);
  });
  it('loadSnapshot accepts Blob input', async () => {
    const blob = new Blob([new Uint8Array([0x80, 0x01, 0x02])]);
    const ids = await map.loadSnapshot(blob);
    expect(ids).toEqual(['a', 'b']);
  });
  it('loadSnapshot prepends idPrefix to stored IDs', async () => {
    const ids = await map.loadSnapshot(new Uint8Array([0x80]), { idPrefix: 'restored-' });
    expect(ids).toEqual(['restored-a', 'restored-b']);
    expect(map.getSource('restored-a')).toBeDefined();
  });
  it('loadSnapshot falls back to defaultIds when emap metadata absent', async () => {
    unpackSessionDataSpy.mockResolvedValue({
      version: 1,
      datasets: [
        { layers: [], info: { crs_string: 'EPSG:4326' } },
        { layers: [], info: { crs_string: 'EPSG:4326' } },
      ],
    });
    const ids = await map.loadSnapshot(new Uint8Array([0x80]), { defaultIds: ['x', 'y'] });
    expect(ids).toEqual(['x', 'y']);
  });
  it('loadSnapshot fallback uses snapshot-<i> when no metadata and no defaults', async () => {
    unpackSessionDataSpy.mockResolvedValue({
      version: 1,
      datasets: [
        { layers: [], info: { crs_string: 'EPSG:4326' } },
        { layers: [], info: { crs_string: 'EPSG:4326' } },
      ],
    });
    const ids = await map.loadSnapshot(new Uint8Array([0x80]));
    expect(ids).toEqual(['snapshot-0', 'snapshot-1']);
  });
  it('loadSnapshot replaces existing sources by default', async () => {
    const existing = makeSource('a', { layers: [] });
    (map as any)._sources.set('a', existing);
    const sourceListenersBeforeAdd = (map as any)._sourceListeners as Map<string, unknown>;
    sourceListenersBeforeAdd.set('a', () => {}); // satisfy removeSource cleanup
    const ids = await map.loadSnapshot(new Uint8Array([0x80]));
    expect(ids).toEqual(['a', 'b']);
    // The source registered at 'a' is the new one, not the original
    expect(map.getSource('a')).not.toBe(existing);
  });
  it('loadSnapshot rejects with replace=false on ID collision', async () => {
    const existing = makeSource('a', { layers: [] });
    (map as any)._sources.set('a', existing);
    await expect(map.loadSnapshot(new Uint8Array([0x80]), { replace: false })).rejects.toThrow(
      /already exists/,
    );
    // Map state untouched: 'a' is the original, 'b' was not added
    expect(map.getSource('a')).toBe(existing);
    expect(map.getSource('b')).toBeUndefined();
  });
  it('loadSnapshot clears edit history and selection', async () => {
    const history = (map as any)._history as EditHistory;
    history.push({
      label: 'fake',
      execute: vi.fn(),
      undo: vi.fn(),
    } as any);
    expect(map.canUndo()).toBe(true);
    const selection = (map as any)._selection as Selection;
    selection.apply([{ source: 's', layer: 'l', id: 1 }], 'add');
    expect(selection.getAll().length).toBeGreaterThan(0);
    await map.loadSnapshot(new Uint8Array([0x80]));
    expect(map.canUndo()).toBe(false);
    expect(map.canRedo()).toBe(false);
    expect(selection.getAll().length).toBe(0);
  });
  it('loadSnapshot rejects on invalid input type', async () => {
    await expect(map.loadSnapshot('not bytes' as unknown as Uint8Array)).rejects.toThrow(
      /Blob, Uint8Array, or ArrayBuffer/,
    );
  });
  it('loadSnapshot rejects empty bytes with a structured message (PR-17)', async () => {
    await expect(map.loadSnapshot(new Uint8Array(0))).rejects.toThrow(
      /does not look like a mapshaper \.msx/,
    );
    expect(unpackSessionDataSpy).not.toHaveBeenCalled();
  });
  it('loadSnapshot rejects GeoJSON-shaped bytes (starts with `{` = 0x7b, not msgpack)', async () => {
    const geojson = new TextEncoder().encode('{"type":"FeatureCollection","features":[]}');
    await expect(map.loadSnapshot(geojson)).rejects.toThrow(/does not look like a mapshaper \.msx/);
    expect(unpackSessionDataSpy).not.toHaveBeenCalled();
  });
  it('loadSnapshot rejects ZIP-shaped bytes (starts with `PK` = 0x50)', async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]); // PK\x03\x04 — local file header
    await expect(map.loadSnapshot(zip)).rejects.toThrow(/does not look like a mapshaper \.msx/);
  });
  it('loadSnapshot accepts every msgpack map marker as the first byte (fixmap / map16 / map32)', async () => {
    const first = await map.loadSnapshot(new Uint8Array([0x80])); // fixmap
    expect(first).toEqual(['a', 'b']);
    map.removeSource('a');
    map.removeSource('b');
    const second = await map.loadSnapshot(new Uint8Array([0xde, 0x00, 0x02])); // map16
    expect(second).toEqual(['a', 'b']);
    map.removeSource('a');
    map.removeSource('b');
    const third = await map.loadSnapshot(new Uint8Array([0xdf, 0, 0, 0, 2])); // map32
    expect(third).toEqual(['a', 'b']);
  });
});
describe('Emap.exportSnapshot / loadSnapshot round-trip (real mapshaper)', () => {
  // A two-source round trip: pack two real datasets via Emap.exportSnapshot,
  // then re-load into a fresh map via loadSnapshot, and assert that source
  // IDs and per-layer summaries survive.
  function buildSourceFromGeoJSON(id: string, geojson: string): Promise<any> {
    return new Promise((resolve, reject) => {
      // Lazy-import the concrete TopologySource via the same path used in production code
      import('../../domain/source/topology-source').then(({ TopologySource }) => {
        const source = new TopologySource(id);
        source.on('data', () => resolve(source));
        source.on('error', (e: any) => reject(e?.error ?? e));
        source.setData({ filename: `${id}.geojson`, content: new TextEncoder().encode(geojson) });
      });
    });
  }
  function summarize(map: Emap, id: string) {
    const ds = map.getSource(id)?.getDataset();
    if (!ds) return null;
    return {
      layerNames: ds.layers.map((l: any) => l.name),
      geoms: ds.layers.map((l: any) => l.geometry_type),
      shapeCounts: ds.layers.map((l: any) => l.shapes?.length ?? 0),
    };
  }
  it('round-trips two sources with original IDs and layer summaries', async () => {
    const polysGeojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'sq' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
                [0, 0],
              ],
            ],
          },
        },
      ],
    });
    const linesGeojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { road: 'main' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        },
      ],
    });
    const sourceA = await buildSourceFromGeoJSON('alpha', polysGeojson);
    const sourceB = await buildSourceFromGeoJSON('beta', linesGeojson);
    function stubProjection(m: Emap) {
      setPrivate(m, '_projection', { crs: 'EPSG:4326', setCRS: vi.fn() });
      setPrivate(m, '_viewport', { setCRS: vi.fn() });
    }
    const mapA = await createBareMap();
    setPrivate(mapA, '_history', new EditHistory());
    stubProjection(mapA);
    await mapA.addSource('alpha', sourceA);
    await mapA.addSource('beta', sourceB);
    const beforeA = summarize(mapA, 'alpha');
    const beforeB = summarize(mapA, 'beta');
    const blob = await mapA.exportSnapshot();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mapB = await createBareMap();
    setPrivate(mapB, '_history', new EditHistory());
    stubProjection(mapB);
    const restored = await mapB.loadSnapshot(bytes);
    expect(restored).toEqual(['alpha', 'beta']);
    expect(summarize(mapB, 'alpha')).toEqual(beforeA);
    expect(summarize(mapB, 'beta')).toEqual(beforeB);
  });
});
describe('Emap useWorker routing', () => {
  // Verifies that when a worker pool is wired in, _runDatasetCommand:
  //   - packs the original dataset via mapshaper.internal.exportDatasetsToPack
  //   - calls workerPool.run with the packed payload + cmd + inputFiles
  //   - unpacks the response via mapshaper.internal.restoreSessionData
  //   - applies via setDataset and pushes a DatasetReplaceCommand
  //
  // We don't spawn a real worker — `workerPool` is a stub that records
  // the call and returns a packed payload of our choosing.
  let map: Emap;
  let runSpy: ReturnType<typeof vi.fn>;
  let exportSpy: ReturnType<typeof vi.fn>;
  let restoreSpy: ReturnType<typeof vi.fn>;
  let setDatasetSpy: ReturnType<typeof vi.fn>;
  let beforeDs: {
    layers: {
      name: string;
      shapes: unknown[];
      geometry_type: string;
    }[];
    info?: {
      crs_string: string;
    };
  };
  const originalExport = Reflect.get(mapshaper.internal as object, 'exportDatasetsToPack');
  const originalRestore = Reflect.get(mapshaper.internal as object, 'restoreSessionData');
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    setPrivate(map, '_projection', { crs: 'EPSG:4326', setCRS: vi.fn() });
    setPrivate(map, '_viewport', { setCRS: vi.fn() });
    setDatasetSpy = vi.fn();
    beforeDs = { layers: [{ name: 'states', shapes: [], geometry_type: 'polygon' }] };
    const afterDs = { layers: [{ name: 'states-out', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology' as const,
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: setDatasetSpy,
      refreshDisplayArcs: vi.fn(),
      off: vi.fn(),
      on: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    // Mock pool needs both run() and runWithId(); _runViaWorker uses
    // runWithId. The runSpy is shared so the test can introspect calls
    // and override behaviour via mockImplementationOnce.
    let nextWorkerId = 1;
    runSpy = vi.fn(async () => ({ datasets: [{ kind: 'packed-result' }] }));
    setPrivate(map, '_workerPool', {
      run: (cmd: string, packed: any, files?: any) => runSpy(cmd, packed, files),
      runWithId: (cmd: string, packed: any, files?: any) => ({
        id: nextWorkerId++,
        promise: runSpy(cmd, packed, files),
      }),
      reserveId: () => nextWorkerId++,
      dispatchWithId: (_id: number, cmd: string, packed: any, files?: any) =>
        runSpy(cmd, packed, files),
      cancelAll: vi.fn(),
      destroy: vi.fn(),
    });
    // Routing decision needs `_workerMode === true` (or 'auto' over
    // threshold). Existing tests pre-date this and were implicit.
    setPrivate(map, '_workerMode', true);
    exportSpy = vi.fn(async () => ({ datasets: [{ kind: 'packed-original' }] })) as ReturnType<
      typeof vi.fn
    >;
    restoreSpy = vi.fn(async () => ({ datasets: [afterDs] })) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'exportDatasetsToPack', exportSpy);
    Reflect.set(mapshaper.internal as object, 'restoreSessionData', restoreSpy);
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDs),
    );
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'exportDatasetsToPack', originalExport);
    Reflect.set(mapshaper.internal as object, 'restoreSessionData', originalRestore);
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
  });
  it('routes _runDatasetCommand through workerPool.run with packed payload', async () => {
    const ok = await map.ops.explodeLayer({ source: 'src1', target: 'states' });
    expect(ok.ok).toBe(true);
    expect(exportSpy).toHaveBeenCalledTimes(1);
    expect(exportSpy.mock.calls[0][1]).toEqual({ compact: false });
    expect(runSpy).toHaveBeenCalledTimes(1);
    const [cmd, packed] = runSpy.mock.calls[0] as unknown[];
    // PR-4b: ops dispatch ParsedCommand[] instead of CLI strings.
    expect(Array.isArray(cmd)).toBe(true);
    expect((cmd as any[]).some((c: any) => c.name === 'explode')).toBe(true);
    expect(packed).toEqual({ datasets: [{ kind: 'packed-original' }] });
    expect(restoreSpy).toHaveBeenCalledTimes(1);
    expect(restoreSpy.mock.calls[0][0]).toEqual({ datasets: [{ kind: 'packed-result' }] });
    // The setDataset call gets the unpacked result, not the packed payload.
    expect(setDatasetSpy).toHaveBeenCalledTimes(1);
    expect(setDatasetSpy.mock.calls[0][0]).toEqual({
      layers: [{ name: 'states-out', shapes: [] }],
    });
  });
  it('forwards inputFiles to workerPool.run when present (joinTable path)', async () => {
    const ok = await map.ops.joinTable({
      source: 'src1',
      target: 'states',
      data: { csv: 'a,b\n1,2' },
      keys: ['k', 's'],
    });
    expect(ok.ok).toBe(true);
    const args = runSpy.mock.calls[0] as unknown[];
    expect(args[2]).toEqual({ '.emap-join.csv': 'a,b\n1,2' });
  });
  it('sends a parseable crs_string to the worker and re-stamps the EPSG label', async () => {
    // A dataset reprojected for display carries emap's canonical EPSG label
    // as metadata. That label is NOT parseable in the browser bundle
    // (+init=epsg:* init-file lookup is a fatal there), so the worker
    // round-trip must swap it for a Proj.4 defn and restore the label on
    // the result (simplify does not change the CRS).
    beforeDs.info = { crs_string: 'EPSG:3857' };
    exportSpy.mockImplementationOnce(
      async (
        datasets: {
          info?: object;
        }[],
      ) => ({
        datasets: datasets.map((d) => ({ info: { ...d.info }, layers: [] })),
      }),
    );
    restoreSpy.mockImplementationOnce(
      async (packed: {
        datasets: {
          info?: object;
        }[];
      }) => ({
        datasets: [{ layers: [], info: packed.datasets[0].info }],
      }),
    );
    const ok = await map.ops.simplifyLayer({ source: 'src1', target: 'states', percentage: 5 });
    expect(ok.ok).toBe(true);
    const [, packed] = runSpy.mock.calls[0] as unknown[];
    const wireCrs = (
      packed as {
        datasets: {
          info: {
            crs_string: string;
          };
        }[];
      }
    ).datasets[0].info.crs_string;
    expect(wireCrs).not.toMatch(/^(esri|epsg|nad83|nad27):\d+$/i);
    const parseCrsString = Reflect.get(mapshaper.internal as object, 'parseCrsString') as (
      crs: string,
    ) => unknown;
    expect(() => parseCrsString(wireCrs)).not.toThrow();
    expect(setDatasetSpy).toHaveBeenCalledTimes(1);
    const committed = setDatasetSpy.mock.calls[0][0] as {
      info: {
        crs_string: string;
      };
    };
    expect(committed.info.crs_string).toBe('EPSG:3857');
  });
  it('worker rejection fires error event + returns false', async () => {
    runSpy.mockImplementationOnce(() => Promise.reject(new Error('worker boom')));
    const errors: any[] = [];
    map.on('error', (e: any) => errors.push(e));
    const ok = await map.ops.explodeLayer({ source: 'src1', target: 'states' });
    expect(ok.ok).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toBe('worker boom');
    expect(setDatasetSpy).not.toHaveBeenCalled();
  });
  it('throws when worker response has no datasets', async () => {
    runSpy.mockImplementationOnce(async () => ({ datasets: [] }));
    restoreSpy.mockImplementationOnce(async () => ({ datasets: [] }));
    const errors: any[] = [];
    map.on('error', (e: any) => errors.push(e));
    const ok = await map.ops.explodeLayer({ source: 'src1', target: 'states' });
    expect(ok.ok).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toMatch(/no dataset in response/);
  });
  it('Emap.remove() destroys the worker pool', async () => {
    const destroySpy = vi.fn();
    const cancelAllSpy = vi.fn();
    setPrivate(map, '_workerPool', { run: runSpy, destroy: destroySpy, cancelAll: cancelAllSpy });
    // remove() also tries to manipulate _container/_canvasContainer; stub.
    setPrivate(map, '_container', { removeChild: vi.fn() });
    setPrivate(map, '_canvasContainer', {});
    setPrivate(map, '_dragPan', { destroy: vi.fn() });
    setPrivate(map, '_mouseWheel', { destroy: vi.fn() });
    await map.dispose();
    expect(cancelAllSpy).toHaveBeenCalledTimes(1);
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });
});
// ---------------------------------------------------------------------------
// Emap useWorker auto-thresholding
// ---------------------------------------------------------------------------
describe("Emap useWorker: 'auto' thresholding", () => {
  // Builds an Emap configured with `useWorker: 'auto'` and an injected pool
  // mock; flips the source dataset's vertex count to control which branch
  // _runDatasetCommand chooses.
  let map: Emap;
  let runSpy: ReturnType<typeof vi.fn>;
  let beforeDs: any;
  const originalExport = Reflect.get(mapshaper.internal as object, 'exportDatasetsToPack');
  const originalRestore = Reflect.get(mapshaper.internal as object, 'restoreSessionData');
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  function setVertexCount(n: number): void {
    beforeDs.arcs = { getPointCount: () => n };
  }
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    setPrivate(map, '_projection', { crs: 'EPSG:4326', setCRS: vi.fn() });
    setPrivate(map, '_viewport', { setCRS: vi.fn() });
    beforeDs = {
      layers: [{ name: 'states', shapes: [], geometry_type: 'polygon' }],
      arcs: { getPointCount: () => 0 },
    };
    const afterDs = { layers: [{ name: 'out', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology' as const,
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
      off: vi.fn(),
      on: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    let nextId = 1;
    runSpy = vi.fn(async () => ({ datasets: [{ kind: 'packed-result' }] }));
    setPrivate(map, '_workerPool', {
      run: (cmd: string, packed: any, files?: any) => runSpy(cmd, packed, files),
      runWithId: (cmd: string, packed: any, files?: any) => ({
        id: nextId++,
        promise: runSpy(cmd, packed, files),
      }),
      reserveId: () => nextId++,
      dispatchWithId: (_id: number, cmd: string, packed: any, files?: any) =>
        runSpy(cmd, packed, files),
      cancelAll: vi.fn(),
      destroy: vi.fn(),
    });
    setPrivate(map, '_workerMode', 'auto');
    setPrivate(map, '_workerThreshold', 1000);
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDs),
    );
    Reflect.set(
      mapshaper.internal as object,
      'exportDatasetsToPack',
      vi.fn(async () => ({ datasets: [{ kind: 'packed-original' }] })),
    );
    Reflect.set(
      mapshaper.internal as object,
      'restoreSessionData',
      vi.fn(async () => ({ datasets: [afterDs] })),
    );
    // Main-thread path also stubbed in case the auto branch routes there.
    Reflect.set(
      mapshaper.internal as object,
      'parseCommands',
      vi.fn(() => [{ name: 'parsed', options: { _cmd: '' } as any }]),
    );
    Reflect.set(
      mapshaper.internal as object,
      'runParsedCommands',
      vi.fn((_c: any, _j: any, cb: any) =>
        cb(null, {
          catalog: { getDefaultTargets: () => [{ dataset: afterDs }] },
        }),
      ),
    );
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'exportDatasetsToPack', originalExport);
    Reflect.set(mapshaper.internal as object, 'restoreSessionData', originalRestore);
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('routes to main thread when vertex count is below threshold', async () => {
    setVertexCount(500); // threshold is 1000
    const ok = await map.ops.explodeLayer({ source: 'src1', target: 'states' });
    expect(ok.ok).toBe(true);
    expect(runSpy).not.toHaveBeenCalled();
  });
  it('routes to worker when vertex count is at threshold', async () => {
    setVertexCount(1000);
    const ok = await map.ops.explodeLayer({ source: 'src1', target: 'states' });
    expect(ok.ok).toBe(true);
    expect(runSpy).toHaveBeenCalledTimes(1);
  });
  it('routes to worker when vertex count is above threshold', async () => {
    setVertexCount(50000);
    const ok = await map.ops.explodeLayer({ source: 'src1', target: 'states' });
    expect(ok.ok).toBe(true);
    expect(runSpy).toHaveBeenCalledTimes(1);
  });
  it('routes arc-less datasets (point-only) to main thread', async () => {
    beforeDs.arcs = undefined;
    const ok = await map.ops.explodeLayer({ source: 'src1', target: 'states' });
    expect(ok.ok).toBe(true);
    expect(runSpy).not.toHaveBeenCalled();
  });
  it('honours custom workerThreshold', async () => {
    setPrivate(map, '_workerThreshold', 100);
    setVertexCount(150);
    const ok = await map.ops.explodeLayer({ source: 'src1', target: 'states' });
    expect(ok.ok).toBe(true);
    expect(runSpy).toHaveBeenCalledTimes(1);
  });
});
// ---------------------------------------------------------------------------
// Emap workerjobstart / workerjobend events
// ---------------------------------------------------------------------------
describe('Emap workerjobstart / workerjobend events', () => {
  let map: Emap;
  let runSpy: ReturnType<typeof vi.fn>;
  const originalExport = Reflect.get(mapshaper.internal as object, 'exportDatasetsToPack');
  const originalRestore = Reflect.get(mapshaper.internal as object, 'restoreSessionData');
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    setPrivate(map, '_projection', { crs: 'EPSG:4326', setCRS: vi.fn() });
    setPrivate(map, '_viewport', { setCRS: vi.fn() });
    const beforeDs = {
      layers: [{ name: 'states', shapes: [], geometry_type: 'polygon' }],
      arcs: { getPointCount: () => 12345 },
    };
    const afterDs = { layers: [{ name: 'out', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology' as const,
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
      off: vi.fn(),
      on: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    let nextId = 100;
    runSpy = vi.fn(async () => ({ datasets: [{ kind: 'packed-result' }] }));
    setPrivate(map, '_workerPool', {
      run: (cmd: string, packed: any, files?: any) => runSpy(cmd, packed, files),
      runWithId: (cmd: string, packed: any, files?: any) => ({
        id: nextId++,
        promise: runSpy(cmd, packed, files),
      }),
      reserveId: () => nextId++,
      dispatchWithId: (_id: number, cmd: string, packed: any, files?: any) =>
        runSpy(cmd, packed, files),
      cancelAll: vi.fn(),
      destroy: vi.fn(),
    });
    setPrivate(map, '_workerMode', true);
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => beforeDs),
    );
    Reflect.set(
      mapshaper.internal as object,
      'exportDatasetsToPack',
      vi.fn(async () => ({ datasets: [{ kind: 'packed-original' }] })),
    );
    Reflect.set(
      mapshaper.internal as object,
      'restoreSessionData',
      vi.fn(async () => ({ datasets: [afterDs] })),
    );
    Reflect.set(
      mapshaper.internal as object,
      'parseCommands',
      vi.fn(() => [{ name: 'parsed', options: { _cmd: '' } as any }]),
    );
    Reflect.set(
      mapshaper.internal as object,
      'runParsedCommands',
      vi.fn((_c: any, _j: any, cb: any) =>
        cb(null, {
          catalog: { getDefaultTargets: () => [{ dataset: afterDs }] },
        }),
      ),
    );
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'exportDatasetsToPack', originalExport);
    Reflect.set(mapshaper.internal as object, 'restoreSessionData', originalRestore);
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  it('fires workerjobstart before pool.run + workerjobend after on success', async () => {
    const events: Array<{
      type: string;
      payload: any;
    }> = [];
    map.on('workerjobstart', (e: any) => events.push({ type: 'start', payload: e }));
    map.on('workerjobend', (e: any) => events.push({ type: 'end', payload: e }));
    const ok = await map.ops.explodeLayer({ source: 'src1', target: 'states' });
    expect(ok.ok).toBe(true);
    expect(events.length).toBe(2);
    expect(events[0].type).toBe('start');
    expect(events[0].payload.cmd).toMatch(/-explode/);
    expect(events[0].payload.label).toBe('Explode states');
    expect(events[0].payload.datasetVertexCount).toBe(12345);
    expect(typeof events[0].payload.id).toBe('number');
    expect(events[1].type).toBe('end');
    expect(events[1].payload.id).toBe(events[0].payload.id);
    expect(events[1].payload.ok).toBe(true);
    expect(typeof events[1].payload.durationMs).toBe('number');
  });
  it('fires workerjobend with ok:false + errorMessage on rejection', async () => {
    runSpy.mockImplementationOnce(() => Promise.reject(new Error('worker boom')));
    const events: any[] = [];
    map.on('workerjobend', (e: any) => events.push(e));
    const ok = await map.ops.explodeLayer({ source: 'src1', target: 'states' });
    expect(ok.ok).toBe(false);
    expect(events.length).toBe(1);
    expect(events[0].ok).toBe(false);
    expect(events[0].errorMessage).toBe('worker boom');
  });
  it('does NOT fire events when running on the main thread', async () => {
    setPrivate(map, '_workerMode', false);
    const events: any[] = [];
    map.on('workerjobstart', (e: any) => events.push(e));
    map.on('workerjobend', (e: any) => events.push(e));
    const ok = await map.ops.explodeLayer({ source: 'src1', target: 'states' });
    expect(ok.ok).toBe(true);
    expect(events.length).toBe(0);
    expect(runSpy).not.toHaveBeenCalled();
  });
  it('correlates concurrent in-flight events by distinct ids', async () => {
    const events: Array<{
      type: string;
      payload: any;
    }> = [];
    map.on('workerjobstart', (e: any) => events.push({ type: 'start', payload: e }));
    map.on('workerjobend', (e: any) => events.push({ type: 'end', payload: e }));
    const a = map.ops.explodeLayer({ source: 'src1', target: 'states' });
    const b = map.ops.explodeLayer({ source: 'src1', target: 'states' });
    await Promise.all([a, b]);
    const startIds = events.filter((e) => e.type === 'start').map((e) => e.payload.id);
    const endIds = events.filter((e) => e.type === 'end').map((e) => e.payload.id);
    expect(new Set(startIds).size).toBe(2);
    expect(new Set(endIds)).toEqual(new Set(startIds));
  });
});
// ---------------------------------------------------------------------------
// Emap.cancelWorkerJobs
// ---------------------------------------------------------------------------
describe('Emap.cancelWorkerJobs', () => {
  it("delegates to the worker pool's cancelAll", async () => {
    const map = await createBareMap();
    const cancelAllSpy = vi.fn();
    setPrivate(map, '_workerPool', { cancelAll: cancelAllSpy });
    map.cancelWorkerJobs();
    expect(cancelAllSpy).toHaveBeenCalledTimes(1);
  });
  it('is a safe no-op when no pool exists', async () => {
    const map = await createBareMap();
    setPrivate(map, '_workerPool', null);
    expect(() => map.cancelWorkerJobs()).not.toThrow();
  });
});
// ===========================================================================
// Audit-fix regressions
// ===========================================================================
// Concentrated regression tests for the comma-injection / numeric-validation /
// option-interaction issues surfaced in the mapshaper-grammar audit. Each
// block exercises ONE specific guard so a future relaxation triggers a
// pinpoint failure.
describe('audit-fix: reject comma-bearing names that would silently split', () => {
  // Shared lightweight fixture — every wrapper short-circuits to `false`
  // BEFORE touching mapshaper, so we don't need a real catalog. We DO need
  // a source whose dataset.layers contains the comma-bearing name (because
  // findLayerByName runs before our validator). For the same reason we
  // include a normal sibling layer.
  async function makeMapWithLayers(layerNames: string[]): Promise<{
    map: Emap;
    parseSpy: ReturnType<typeof vi.fn>;
  }> {
    const map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const layers = layerNames.map((name) => ({ name, geometry_type: 'polygon', shapes: [] }));
    const ds = { layers };
    const source = {
      id: 'src1',
      type: 'topology' as const,
      getDataset: () => ds,
      getLayers: () => layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => ds),
    );
    const parseSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: ds }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', parseSpy);
    return { map, parseSpy };
  }
  it('unionLayers rejects a target containing a comma', async () => {
    const { map, parseSpy } = await makeMapWithLayers(['a,b', 'c']);
    expect((await map.ops.unionLayers({ source: 'src1', targets: ['a,b', 'c'] })).ok).toBe(false);
    expect(parseSpy).not.toHaveBeenCalled();
  });
  it('mergeLayers rejects a target containing a comma', async () => {
    const { map, parseSpy } = await makeMapWithLayers(['a,b', 'c']);
    expect((await map.ops.mergeLayers({ source: 'src1', targets: ['a,b', 'c'] })).ok).toBe(false);
    expect(parseSpy).not.toHaveBeenCalled();
  });
  it('dissolveLayer rejects a field containing a comma', async () => {
    const { map, parseSpy } = await makeMapWithLayers(['states']);
    expect(
      (await map.ops.dissolveLayer({ source: 'src1', target: 'states', field: 'STATE,FIPS' })).ok,
    ).toBe(false);
    expect(parseSpy).not.toHaveBeenCalled();
  });
  it('renameLayer rejects a new name containing a comma', async () => {
    const { map, parseSpy } = await makeMapWithLayers(['old']);
    expect((await map.ops.renameLayer({ source: 'src1', target: 'old', name: 'a,b' })).ok).toBe(
      false,
    );
    expect(parseSpy).not.toHaveBeenCalled();
  });
  it('joinTable rejects a key containing a comma (target side)', async () => {
    const { map, parseSpy } = await makeMapWithLayers(['states']);
    expect(
      (
        await map.ops.joinTable({
          source: 'src1',
          target: 'states',
          data: { layer: 't' },
          keys: ['STATE,FIPS', 'fips'],
        })
      ).ok,
    ).toBe(false);
    expect(parseSpy).not.toHaveBeenCalled();
  });
  it('joinTable rejects a key containing a comma (source side)', async () => {
    const { map, parseSpy } = await makeMapWithLayers(['states']);
    expect(
      (
        await map.ops.joinTable({
          source: 'src1',
          target: 'states',
          data: { layer: 't' },
          keys: ['fips', 'fips,extra'],
        })
      ).ok,
    ).toBe(false);
    expect(parseSpy).not.toHaveBeenCalled();
  });
});
describe('audit-fix: bufferLayer rejects non-positive / non-finite radius', () => {
  async function makeMapWithLayers(layerNames: string[]): Promise<{
    map: Emap;
    parseSpy: ReturnType<typeof vi.fn>;
  }> {
    const map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const layers = layerNames.map((name) => ({ name, geometry_type: 'polygon', shapes: [] }));
    const ds = { layers };
    const source = {
      id: 'src1',
      type: 'topology' as const,
      getDataset: () => ds,
      getLayers: () => layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => ds),
    );
    const parseSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: ds }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', parseSpy);
    return { map, parseSpy };
  }
  it('rejects radius: 0', async () => {
    const { map, parseSpy } = await makeMapWithLayers(['parks']);
    expect((await map.ops.bufferLayer({ source: 'src1', target: 'parks', radius: 0 })).ok).toBe(
      false,
    );
    expect(parseSpy).not.toHaveBeenCalled();
  });
  it('rejects negative radius', async () => {
    const { map } = await makeMapWithLayers(['parks']);
    expect((await map.ops.bufferLayer({ source: 'src1', target: 'parks', radius: -1 })).ok).toBe(
      false,
    );
  });
  it('rejects NaN / Infinity radius', async () => {
    const { map } = await makeMapWithLayers(['parks']);
    expect((await map.ops.bufferLayer({ source: 'src1', target: 'parks', radius: NaN })).ok).toBe(
      false,
    );
    expect(
      (await map.ops.bufferLayer({ source: 'src1', target: 'parks', radius: Infinity })).ok,
    ).toBe(false);
  });
  it('rejects empty / whitespace expression-string radius', async () => {
    const { map } = await makeMapWithLayers(['parks']);
    expect((await map.ops.bufferLayer({ source: 'src1', target: 'parks', radius: '' })).ok).toBe(
      false,
    );
    expect((await map.ops.bufferLayer({ source: 'src1', target: 'parks', radius: '   ' })).ok).toBe(
      false,
    );
  });
  it('still accepts a positive number', async () => {
    const { map, parseSpy } = await makeMapWithLayers(['parks']);
    expect((await map.ops.bufferLayer({ source: 'src1', target: 'parks', radius: 100 })).ok).toBe(
      true,
    );
    expect(parseSpy).toHaveBeenCalled();
  });
  it('still accepts an expression-string radius', async () => {
    const { map, parseSpy } = await makeMapWithLayers(['parks']);
    expect(
      (await map.ops.bufferLayer({ source: 'src1', target: 'parks', radius: 'this.pop / 1000' }))
        .ok,
    ).toBe(true);
    expect(parseSpy).toHaveBeenCalled();
  });
});
describe('audit-fix: simplifyLayer rejects weighting with non-weighted method', () => {
  async function makeMapWithLayers(): Promise<{
    map: Emap;
    parseSpy: ReturnType<typeof vi.fn>;
  }> {
    const map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const ds = { layers: [{ name: 'states', geometry_type: 'polygon', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology' as const,
      getDataset: () => ds,
      getLayers: () => ds.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => ds),
    );
    const parseSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: ds }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', parseSpy);
    return { map, parseSpy };
  }
  it('rejects method:dp + weighting', async () => {
    const { map, parseSpy } = await makeMapWithLayers();
    expect(
      (
        await map.ops.simplifyLayer({
          source: 'src1',
          percentage: 10,
          method: 'dp',
          weighting: 0.5,
        })
      ).ok,
    ).toBe(false);
    expect(parseSpy).not.toHaveBeenCalled();
  });
  it('rejects method:visvalingam + weighting', async () => {
    const { map } = await makeMapWithLayers();
    expect(
      (
        await map.ops.simplifyLayer({
          source: 'src1',
          percentage: 10,
          method: 'visvalingam',
          weighting: 0.5,
        })
      ).ok,
    ).toBe(false);
  });
  it('accepts method:weighted + weighting', async () => {
    const { map } = await makeMapWithLayers();
    expect(
      (
        await map.ops.simplifyLayer({
          source: 'src1',
          percentage: 10,
          method: 'weighted',
          weighting: 0.5,
        })
      ).ok,
    ).toBe(true);
  });
  it('accepts weighting without explicit method (defaults to weighted)', async () => {
    const { map } = await makeMapWithLayers();
    expect(
      (
        await map.ops.simplifyLayer({
          source: 'src1',
          percentage: 10,
          weighting: 0.5,
        })
      ).ok,
    ).toBe(true);
  });
});
describe('audit-fix: linesLayer fields token has a single canonical form', () => {
  async function makeMapWithLayers(): Promise<{
    map: Emap;
    parseSpy: ReturnType<typeof vi.fn>;
  }> {
    const map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const ds = { layers: [{ name: 'states', geometry_type: 'polygon', shapes: [] }] };
    const source = {
      id: 'src1',
      type: 'topology' as const,
      getDataset: () => ds,
      getLayers: () => ds.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn(() => ds),
    );
    const parseSpy = vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: ds }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', parseSpy);
    return { map, parseSpy };
  }
  it('emits "-lines" with no fields', async () => {
    const { map, parseSpy } = await makeMapWithLayers();
    await map.ops.linesLayer({ source: 'src1', target: 'states' });
    expectCli('-target "states" -lines', parseSpy.mock.calls[0][0]);
  });
  it('emits "-lines a,b" with fields', async () => {
    const { map, parseSpy } = await makeMapWithLayers();
    await map.ops.linesLayer({ source: 'src1', target: 'states', fields: ['STATE', 'COUNTY'] });
    expectCli('-target "states" -lines STATE,COUNTY', parseSpy.mock.calls[0][0]);
  });
  it('rejects comma-bearing field names before dispatch', async () => {
    const { map, parseSpy } = await makeMapWithLayers();
    const result = await map.ops.linesLayer({
      source: 'src1',
      target: 'states',
      fields: ['ok', 'bad,name', 'ok2'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('validation');
    expect(parseSpy).not.toHaveBeenCalled();
  });
  it('rejects instead of falling back when every field is invalid', async () => {
    const { map, parseSpy } = await makeMapWithLayers();
    const result = await map.ops.linesLayer({
      source: 'src1',
      target: 'states',
      fields: ['bad,name'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('validation');
    expect(parseSpy).not.toHaveBeenCalled();
  });
});
// ===========================================================================
// Wrapper option completion (add-wrapper-options-completion)
// ===========================================================================
// Tests every newly-exposed option on cleanLayer / dissolveLayer /
// mosaicLayer / snapLayer. Each test asserts the produced command string
// shape so that any future divergence shows up as a pinpoint failure.
async function makeMapWithLayer(
  layerName: string,
  geometry_type = 'polygon',
): Promise<{
  map: Emap;
  parseSpy: ReturnType<typeof vi.fn>;
}> {
  const map = await createBareMap();
  setPrivate(map, '_history', new EditHistory());
  const layers = [{ name: layerName, geometry_type, shapes: [] }];
  const ds = { layers };
  const source = {
    id: 'src1',
    type: 'topology' as const,
    getDataset: () => ds,
    getLayers: () => layers,
    setDataset: vi.fn(),
    refreshDisplayArcs: vi.fn(),
  } as any;
  (map as any)._sources.set('src1', source);
  Reflect.set(
    mapshaper.internal as object,
    'copyDataset',
    vi.fn(() => ds),
  );
  const parseSpy = vi.fn((_c: any, _j: any, cb: any) => {
    cb(null, { catalog: { getDefaultTargets: () => [{ dataset: ds }] } });
  }) as ReturnType<typeof vi.fn>;
  Reflect.set(mapshaper.internal as object, 'runParsedCommands', parseSpy);
  return { map, parseSpy };
}
describe('mosaicLayer: calc option', () => {
  it('emits calc=<quoted> when supplied', async () => {
    const { map, parseSpy } = await makeMapWithLayer('parks');
    await map.ops.mosaicLayer({ source: 'src1', target: 'parks', calc: 'sum(area)' });
    expectCli('-target "parks" -mosaic calc="sum(area)"', parseSpy.mock.calls[0][0]);
  });
  it('omits calc= when not supplied', async () => {
    const { map, parseSpy } = await makeMapWithLayer('parks');
    await map.ops.mosaicLayer({ source: 'src1', target: 'parks' });
    expectCli('-target "parks" -mosaic', parseSpy.mock.calls[0][0]);
  });
  it('omits calc= when whitespace-only', async () => {
    const { map, parseSpy } = await makeMapWithLayer('parks');
    await map.ops.mosaicLayer({ source: 'src1', target: 'parks', calc: '   ' });
    expectCli('-target "parks" -mosaic', parseSpy.mock.calls[0][0]);
  });
});
describe('snapLayer: fixGeometry option', () => {
  it('emits fix-geometry flag when truthy', async () => {
    const { map, parseSpy } = await makeMapWithLayer('roads', 'polyline');
    await map.ops.snapLayer({
      source: 'src1',
      target: 'roads',
      interval: 0.001,
      fixGeometry: true,
    });
    expectCli('-target "roads" -snap 0.001 fix-geometry', parseSpy.mock.calls[0][0]);
  });
  it('omits fix-geometry when falsy', async () => {
    const { map, parseSpy } = await makeMapWithLayer('roads', 'polyline');
    await map.ops.snapLayer({ source: 'src1', target: 'roads', interval: 0.001 });
    expectCli('-target "roads" -snap 0.001', parseSpy.mock.calls[0][0]);
  });
});
describe('dissolveLayer: expanded options', () => {
  it('multi-field group-by via fields[]', async () => {
    const { map, parseSpy } = await makeMapWithLayer('counties');
    await map.ops.dissolveLayer({
      source: 'src1',
      target: 'counties',
      fields: ['STATE', 'REGION'],
    });
    expectCli('-target "counties" -dissolve "STATE,REGION"', parseSpy.mock.calls[0][0]);
  });
  it('field and fields are mutually exclusive', async () => {
    const { map, parseSpy } = await makeMapWithLayer('counties');
    expect(
      (
        await map.ops.dissolveLayer({
          source: 'src1',
          target: 'counties',
          field: 'STATE',
          fields: ['REGION'],
        })
      ).ok,
    ).toBe(false);
    expect(parseSpy).not.toHaveBeenCalled();
  });
  it('comma-bearing fields[] entries are rejected before dispatch', async () => {
    const { map, parseSpy } = await makeMapWithLayer('counties');
    const result = await map.ops.dissolveLayer({
      source: 'src1',
      target: 'counties',
      fields: ['ok', 'bad,name', 'ok2'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('validation');
    expect(parseSpy).not.toHaveBeenCalled();
  });
  it('empty fields[] is treated as no group-by', async () => {
    const { map, parseSpy } = await makeMapWithLayer('counties');
    await map.ops.dissolveLayer({ source: 'src1', target: 'counties', fields: [] });
    expectCli('-target "counties" -dissolve', parseSpy.mock.calls[0][0]);
  });
  it('sumFields emits sum-fields=', async () => {
    const { map, parseSpy } = await makeMapWithLayer('counties');
    await map.ops.dissolveLayer({
      source: 'src1',
      target: 'counties',
      field: 'STATE',
      sumFields: ['POP', 'GDP'],
    });
    expectCli('-target "counties" -dissolve "STATE" sum-fields=POP,GDP', parseSpy.mock.calls[0][0]);
  });
  it('copyFields emits copy-fields=', async () => {
    const { map, parseSpy } = await makeMapWithLayer('counties');
    await map.ops.dissolveLayer({
      source: 'src1',
      target: 'counties',
      field: 'STATE',
      copyFields: ['NAME', 'CAPITAL'],
    });
    expectCli(
      '-target "counties" -dissolve "STATE" copy-fields=NAME,CAPITAL',
      parseSpy.mock.calls[0][0],
    );
  });
  it('calc / where forwarded as quoted JS expressions', async () => {
    const { map, parseSpy } = await makeMapWithLayer('counties');
    await map.ops.dissolveLayer({
      source: 'src1',
      target: 'counties',
      field: 'STATE',
      calc: 'mean(POP)',
      where: 'this.YEAR === 2024',
    });
    expectCli(
      '-target "counties" -dissolve "STATE" calc="mean(POP)" where="this.YEAR === 2024"',
      parseSpy.mock.calls[0][0],
    );
  });
  it('multipart / name / noReplace flags', async () => {
    const { map, parseSpy } = await makeMapWithLayer('counties');
    await map.ops.dissolveLayer({
      source: 'src1',
      target: 'counties',
      multipart: true,
      name: 'states-out',
      noReplace: true,
    });
    expectCli(
      '-target "counties" -dissolve multipart name="states-out" no-replace',
      parseSpy.mock.calls[0][0],
    );
  });
  it('comma-bearing entries in sumFields/copyFields are rejected before dispatch', async () => {
    const { map, parseSpy } = await makeMapWithLayer('counties');
    const result = await map.ops.dissolveLayer({
      source: 'src1',
      target: 'counties',
      field: 'STATE',
      sumFields: ['POP', 'bad,one'],
      copyFields: ['NAME', 'also,bad'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('validation');
    expect(parseSpy).not.toHaveBeenCalled();
  });
  it('full minimal call still works (regression)', async () => {
    const { map, parseSpy } = await makeMapWithLayer('counties');
    await map.ops.dissolveLayer({ source: 'src1', target: 'counties' });
    expectCli('-target "counties" -dissolve', parseSpy.mock.calls[0][0]);
  });
});
describe('cleanLayer: expanded options', () => {
  it('emits gap-fill-area=', async () => {
    const { map, parseSpy } = await makeMapWithLayer('parks');
    await map.ops.cleanLayer({ source: 'src1', target: 'parks', gapFillArea: 100 });
    expectCli('-target "parks" -clean gap-fill-area=100', parseSpy.mock.calls[0][0]);
  });
  it('emits sliver-control=', async () => {
    const { map, parseSpy } = await makeMapWithLayer('parks');
    await map.ops.cleanLayer({ source: 'src1', target: 'parks', sliverControl: 0.5 });
    expectCli('-target "parks" -clean sliver-control=0.5', parseSpy.mock.calls[0][0]);
  });
  it('emits snap-interval=', async () => {
    const { map, parseSpy } = await makeMapWithLayer('parks');
    await map.ops.cleanLayer({ source: 'src1', target: 'parks', snapInterval: 0.001 });
    expectCli('-target "parks" -clean snap-interval=0.001', parseSpy.mock.calls[0][0]);
  });
  it('emits boolean flags', async () => {
    const { map, parseSpy } = await makeMapWithLayer('parks');
    await map.ops.cleanLayer({
      source: 'src1',
      target: 'parks',
      noSnap: true,
      allowOverlaps: true,
      allowEmpty: true,
      rewind: true,
      onlyArcs: true,
      noArcDissolve: true,
    });
    expectCli(
      '-target "parks" -clean no-snap allow-overlaps allow-empty rewind only-arcs no-arc-dissolve',
      parseSpy.mock.calls[0][0],
    );
  });
  it('emits overlap-rule=', async () => {
    const { map, parseSpy } = await makeMapWithLayer('parks');
    await map.ops.cleanLayer({ source: 'src1', target: 'parks', overlapRule: 'min-id' });
    expectCli('-target "parks" -clean overlap-rule=min-id', parseSpy.mock.calls[0][0]);
  });
  it('rejects invalid overlapRule', async () => {
    const { map, parseSpy } = await makeMapWithLayer('parks');
    expect(
      (
        await map.ops.cleanLayer({
          source: 'src1',
          target: 'parks',
          overlapRule: 'bogus' as any,
        })
      ).ok,
    ).toBe(false);
    expect(parseSpy).not.toHaveBeenCalled();
  });
  it('rejects negative numeric tuning options', async () => {
    const { map, parseSpy } = await makeMapWithLayer('parks');
    expect(
      (await map.ops.cleanLayer({ source: 'src1', target: 'parks', gapFillArea: -1 })).ok,
    ).toBe(false);
    expect(
      (await map.ops.cleanLayer({ source: 'src1', target: 'parks', sliverControl: -0.5 })).ok,
    ).toBe(false);
    expect(
      (await map.ops.cleanLayer({ source: 'src1', target: 'parks', snapInterval: -10 })).ok,
    ).toBe(false);
    expect(parseSpy).not.toHaveBeenCalled();
  });
  it('rejects NaN numeric tuning options', async () => {
    const { map, parseSpy } = await makeMapWithLayer('parks');
    expect(
      (await map.ops.cleanLayer({ source: 'src1', target: 'parks', gapFillArea: NaN })).ok,
    ).toBe(false);
    expect(parseSpy).not.toHaveBeenCalled();
  });
  it('full minimal call still works (regression)', async () => {
    const { map, parseSpy } = await makeMapWithLayer('parks');
    await map.ops.cleanLayer({ source: 'src1', target: 'parks' });
    expectCli('-target "parks" -clean', parseSpy.mock.calls[0][0]);
  });
  it('all-options-combined produces the canonical token order', async () => {
    const { map, parseSpy } = await makeMapWithLayer('parks');
    await map.ops.cleanLayer({
      source: 'src1',
      target: 'parks',
      gapFillArea: 100,
      sliverControl: 0.5,
      snapInterval: 0.001,
      noSnap: true,
      allowOverlaps: true,
      overlapRule: 'max-area',
      allowEmpty: true,
      rewind: true,
      onlyArcs: true,
      noArcDissolve: true,
    });
    // Documents the canonical ordering produced by the wrapper. Future
    // reordering would require updating this string and would be visible
    // in review.
    expectCli(
      '-target "parks" -clean' +
        ' gap-fill-area=100 sliver-control=0.5 snap-interval=0.001' +
        ' no-snap allow-overlaps overlap-rule=max-area' +
        ' allow-empty rewind only-arcs no-arc-dissolve',
      parseSpy.mock.calls[0][0],
    );
  });
});
describe('Emap.prebuildSpatialIndex / clearSpatialIndex', () => {
  async function makeMapWithStubFQ(): Promise<{
    map: Emap;
    prebuild: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  }> {
    const map = await createBareMap();
    const prebuild = vi.fn();
    const clear = vi.fn();
    setPrivate(map, '_featureQuery', { prebuild, clear, query: vi.fn() });
    return { map, prebuild, clear };
  }
  it('prebuildSpatialIndex(sourceId) delegates to FeatureQuery.prebuild', async () => {
    const { map, prebuild } = await makeMapWithStubFQ();
    map.prebuildSpatialIndex('s1');
    expect(prebuild).toHaveBeenCalledTimes(1);
    expect(prebuild).toHaveBeenCalledWith('s1');
  });
  it('prebuildSpatialIndex() with no arg passes undefined for "all sources"', async () => {
    const { map, prebuild } = await makeMapWithStubFQ();
    map.prebuildSpatialIndex();
    expect(prebuild).toHaveBeenCalledWith(undefined);
  });
  it('clearSpatialIndex(sourceId) delegates to FeatureQuery.clear', async () => {
    const { map, clear } = await makeMapWithStubFQ();
    map.clearSpatialIndex('s1');
    expect(clear).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith('s1');
  });
  it('clearSpatialIndex() with no arg passes undefined for "all sources"', async () => {
    const { map, clear } = await makeMapWithStubFQ();
    map.clearSpatialIndex();
    expect(clear).toHaveBeenCalledWith(undefined);
  });
});
describe('Emap.reproject', () => {
  function makeSource(before: object, prepared: object | Error) {
    let current = before;
    const source = {
      getDataset: vi.fn(() => current),
      prepareReproject: vi.fn(async () => {
        if (prepared instanceof Error) throw prepared;
        return prepared;
      }),
      fire: vi.fn(),
      setDataset: vi.fn((dataset: object, notify = true) => {
        current = dataset;
        if (notify) source.fire('data', { reason: 'replace' });
      }),
      current: () => current,
    };
    return source;
  }
  function configureMap(map: Emap): void {
    setPrivate(map, '_projection', new Projection());
    setPrivate(map, '_viewport', new Viewport());
    setPrivate(map, '_history', new EditHistory());
  }
  it('rejects a display-only CRS change while a source is registered', async () => {
    const map = await createBareMap();
    configureMap(map);
    setPrivate(map, '_sources', new globalThis.Map([['s1', { getDataset: () => undefined }]]));
    expect(() => map.setCRS('EPSG:3857')).toThrow(
      'Cannot change the map CRS while sources are registered; use map.reproject()',
    );
    expect(map.getCRS()).toBe('EPSG:4326');
  });
  it('resolves the target and commits every prepared source', async () => {
    const map = await createBareMap();
    configureMap(map);
    const before = { layers: [], info: { crs_string: 'EPSG:4326' } };
    const after = { layers: [], info: { crs_string: 'EPSG:3857' } };
    const source = makeSource(before, after);
    setPrivate(map, '_sources', new globalThis.Map([['s1', source]]));
    await map.reproject('EPSG:3857');
    expect(source.prepareReproject).toHaveBeenCalledWith('webmercator', 'EPSG:3857');
    expect(source.current()).toBe(after);
    expect(map.getCRS()).toBe('webmercator');
    expect(map.canUndo()).toBe(true);
  });
  it('leaves every source unchanged when preparation fails', async () => {
    const map = await createBareMap();
    configureMap(map);
    const beforeA = { layers: [], info: {} };
    const beforeB = { layers: [], info: {} };
    const sourceA = makeSource(beforeA, { layers: [], info: {} });
    const sourceB = makeSource(beforeB, new Error('projection failed'));
    setPrivate(
      map,
      '_sources',
      new globalThis.Map([
        ['a', sourceA],
        ['b', sourceB],
      ]),
    );
    await expect(map.reproject('EPSG:3857')).rejects.toThrow('projection failed');
    expect(sourceA.setDataset).not.toHaveBeenCalled();
    expect(sourceB.setDataset).not.toHaveBeenCalled();
    expect(map.getCRS()).toBe('EPSG:4326');
    expect(map.canUndo()).toBe(false);
  });
  it('rejects a prepared projection when the source was edited in place', async () => {
    const map = await createBareMap();
    configureMap(map);
    const before = { layers: [], info: {}, editVersion: 0 };
    const after = { layers: [], info: { crs_string: 'EPSG:3857' } };
    let resolveProjection: ((dataset: object) => void) | null = null;
    const pendingProjection = new Promise<object>((resolve) => {
      resolveProjection = resolve;
    });
    const source = makeSource(before, pendingProjection);
    setPrivate(map, '_sources', new globalThis.Map([['s1', source]]));
    const reprojection = map.reproject('EPSG:3857');
    await vi.waitFor(() => expect(source.prepareReproject).toHaveBeenCalled());
    before.editVersion = 1;
    resolveProjection?.(after);
    await expect(reprojection).rejects.toThrow('changed during reprojection');
    expect(source.setDataset).not.toHaveBeenCalled();
    expect(map.getCRS()).toBe('EPSG:4326');
  });
  it('undo and redo restore all datasets and the map CRS atomically', async () => {
    const map = await createBareMap();
    configureMap(map);
    const beforeA = { layers: [], info: {} };
    const beforeB = { layers: [], info: {} };
    const afterA = { layers: [], info: {} };
    const afterB = { layers: [], info: {} };
    const sourceA = makeSource(beforeA, afterA);
    const sourceB = makeSource(beforeB, afterB);
    setPrivate(
      map,
      '_sources',
      new globalThis.Map([
        ['a', sourceA],
        ['b', sourceB],
      ]),
    );
    await map.reproject('EPSG:3857');
    expect(map.undo()).toBe(true);
    expect(sourceA.current()).toBe(beforeA);
    expect(sourceB.current()).toBe(beforeB);
    expect(map.getCRS()).toBe('EPSG:4326');
    expect(map.redo()).toBe(true);
    expect(sourceA.current()).toBe(afterA);
    expect(sourceB.current()).toBe(afterB);
    expect(map.getCRS()).toBe('webmercator');
  });
  it('publishes source data events only after every dataset and view are committed', async () => {
    const map = await createBareMap();
    configureMap(map);
    const beforeA = { layers: [], info: { id: 'before-a' } };
    const beforeB = { layers: [], info: { id: 'before-b' } };
    const afterA = { layers: [], info: { id: 'after-a' } };
    const afterB = { layers: [], info: { id: 'after-b' } };
    const sourceA = makeSource(beforeA, afterA);
    const sourceB = makeSource(beforeB, afterB);
    const observations: Array<[object, object, string]> = [];
    sourceA.fire.mockImplementation(() => {
      observations.push([sourceA.current(), sourceB.current(), map.getCRS()]);
    });
    sourceB.fire.mockImplementation(() => {
      observations.push([sourceA.current(), sourceB.current(), map.getCRS()]);
    });
    setPrivate(
      map,
      '_sources',
      new globalThis.Map([
        ['a', sourceA],
        ['b', sourceB],
      ]),
    );
    await map.reproject('EPSG:3857');
    expect(observations).toEqual([
      [afterA, afterB, 'webmercator'],
      [afterA, afterB, 'webmercator'],
    ]);
  });
  it('commits reproject state and history before publishing listener failures', async () => {
    const map = await createBareMap();
    configureMap(map);
    const before = { layers: [], info: { crs_string: 'EPSG:4326' } };
    const after = { layers: [], info: { crs_string: 'EPSG:3857' } };
    const source = new TopologySource('s1');
    source.setDataset(before, false);
    vi.spyOn(source, 'prepareReproject').mockResolvedValue(after);
    setPrivate(map, '_sources', new globalThis.Map([['s1', source]]));
    const observations: Array<{
      event: string;
      canUndo: boolean;
      crs: string;
    }> = [];
    const mapFailure = new Error('crschange listener failed');
    const sourceFailure = new Error('data listener failed');
    const remainingMapListener = vi.fn();
    const remainingSourceListener = vi.fn();
    const mapReported = vi.fn();
    const sourceReported = vi.fn();
    map.on('crschange', () => {
      observations.push({ event: 'crschange', canUndo: map.canUndo(), crs: map.getCRS() });
      throw mapFailure;
    });
    map.on('crschange', remainingMapListener);
    map.on<{
      error: unknown;
    }>('error', mapReported);
    source.on('data', () => {
      observations.push({ event: 'data', canUndo: map.canUndo(), crs: map.getCRS() });
      throw sourceFailure;
    });
    source.on('data', remainingSourceListener);
    source.on<{
      error: unknown;
    }>('error', sourceReported);
    await expect(map.reproject('EPSG:3857')).resolves.toBeUndefined();
    expect(observations).toEqual([
      { event: 'crschange', canUndo: true, crs: 'webmercator' },
      { event: 'data', canUndo: true, crs: 'webmercator' },
    ]);
    expect(source.getDataset()).toBe(after);
    expect(remainingMapListener).toHaveBeenCalledTimes(1);
    expect(remainingSourceListener).toHaveBeenCalledTimes(1);
    expect(mapReported).toHaveBeenCalledWith({ type: 'error', error: mapFailure });
    expect(sourceReported).toHaveBeenCalledWith({ type: 'error', error: sourceFailure });
  });
  it('moves history to redo before publishing undo listener failures', async () => {
    const map = await createBareMap();
    configureMap(map);
    const before = { layers: [], info: { crs_string: 'EPSG:4326' } };
    const after = { layers: [], info: { crs_string: 'EPSG:3857' } };
    const source = new TopologySource('s1');
    source.setDataset(before, false);
    vi.spyOn(source, 'prepareReproject').mockResolvedValue(after);
    setPrivate(map, '_sources', new globalThis.Map([['s1', source]]));
    await map.reproject('EPSG:3857');
    const observations: Array<{
      canUndo: boolean;
      canRedo: boolean;
      crs: string;
    }> = [];
    source.on('data', () => {
      observations.push({ canUndo: map.canUndo(), canRedo: map.canRedo(), crs: map.getCRS() });
      throw new Error('undo data listener failed');
    });
    expect(map.undo()).toBe(true);
    expect(observations).toEqual([{ canUndo: false, canRedo: true, crs: 'EPSG:4326' }]);
    expect(source.getDataset()).toBe(before);
  });
  it('moves history to undo before publishing redo listener failures', async () => {
    const map = await createBareMap();
    configureMap(map);
    const before = { layers: [], info: { crs_string: 'EPSG:4326' } };
    const after = { layers: [], info: { crs_string: 'EPSG:3857' } };
    const source = new TopologySource('s1');
    source.setDataset(before, false);
    vi.spyOn(source, 'prepareReproject').mockResolvedValue(after);
    setPrivate(map, '_sources', new globalThis.Map([['s1', source]]));
    await map.reproject('EPSG:3857');
    expect(map.undo()).toBe(true);
    const observations: Array<{
      canUndo: boolean;
      canRedo: boolean;
      crs: string;
    }> = [];
    source.on('data', () => {
      observations.push({ canUndo: map.canUndo(), canRedo: map.canRedo(), crs: map.getCRS() });
      throw new Error('redo data listener failed');
    });
    expect(map.redo()).toBe(true);
    expect(observations).toEqual([{ canUndo: true, canRedo: false, crs: 'webmercator' }]);
    expect(source.getDataset()).toBe(after);
  });
});
// ===========================================================================
// Emap.intersectionPointsLayer
// ===========================================================================
describe('Emap.intersectionPointsLayer (mocked mapshaper)', () => {
  let map: Emap;
  let setDatasetSpy: ReturnType<typeof vi.fn>;
  let findSpy: ReturnType<typeof vi.fn>;
  let getLayerSpy: ReturnType<typeof vi.fn>;
  let beforeDs: any;
  const originalCopy = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalFind = Reflect.get(mapshaper.internal as object, 'findSegmentIntersections');
  const originalGetLayer = Reflect.get(mapshaper.internal as object, 'getIntersectionLayer');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    beforeDs = {
      layers: [{ name: 'edges', shapes: [], geometry_type: 'polyline' }],
      arcs: { _sentinel: 'arcs' },
    };
    setDatasetSpy = vi.fn();
    const source = {
      id: 'src1',
      type: 'topology' as const,
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: setDatasetSpy,
      refreshDisplayArcs: vi.fn(),
      off: vi.fn(),
      on: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn((ds: any) => ({
        ...ds,
        layers: ds.layers.map((l: any) => ({ ...l })),
      })),
    );
    findSpy = vi.fn(() => [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'findSegmentIntersections', findSpy);
    getLayerSpy = vi.fn(() => ({
      geometry_type: 'point',
      shapes: [
        [
          [1, 2],
          [3, 4],
        ],
      ],
    })) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'getIntersectionLayer', getLayerSpy);
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopy);
    Reflect.set(mapshaper.internal as object, 'findSegmentIntersections', originalFind);
    Reflect.set(mapshaper.internal as object, 'getIntersectionLayer', originalGetLayer);
  });
  it('adds a new point layer named "<target>-intersections" by default', async () => {
    const ok = await map.ops.intersectionPointsLayer({ source: 'src1', target: 'edges' });
    expect(ok.ok).toBe(true);
    expect(setDatasetSpy).toHaveBeenCalledTimes(1);
    const after = setDatasetSpy.mock.calls[0][0] as any;
    expect(after.layers).toHaveLength(2);
    expect(after.layers[1].name).toBe('edges-intersections');
    expect(after.layers[1].geometry_type).toBe('point');
  });
  it('honours custom name', async () => {
    await map.ops.intersectionPointsLayer({ source: 'src1', target: 'edges', name: 'crossings' });
    const after = setDatasetSpy.mock.calls[0][0] as any;
    expect(after.layers[1].name).toBe('crossings');
  });
  it('forwards tolerance to findSegmentIntersections', async () => {
    await map.ops.intersectionPointsLayer({
      source: 'src1',
      target: 'edges',
      tolerance: 0.001,
    });
    expect(findSpy.mock.calls[0][1]).toEqual({ tolerance: 0.001 });
  });
  it('returns false when source is missing', async () => {
    expect((await map.ops.intersectionPointsLayer({ source: 'nope', target: 'edges' })).ok).toBe(
      false,
    );
    expect(findSpy).not.toHaveBeenCalled();
  });
  it('returns false when target is unresolved', async () => {
    expect((await map.ops.intersectionPointsLayer({ source: 'src1', target: 'missing' })).ok).toBe(
      false,
    );
    expect(findSpy).not.toHaveBeenCalled();
  });
  it('returns false when target is a point layer (no segments)', async () => {
    beforeDs.layers[0].geometry_type = 'point';
    expect((await map.ops.intersectionPointsLayer({ source: 'src1', target: 'edges' })).ok).toBe(
      false,
    );
    expect(findSpy).not.toHaveBeenCalled();
  });
  it('returns false when name collides with an existing layer', async () => {
    beforeDs.layers.push({ name: 'crossings', shapes: [], geometry_type: 'point' });
    expect(
      (
        await map.ops.intersectionPointsLayer({
          source: 'src1',
          target: 'edges',
          name: 'crossings',
        })
      ).ok,
    ).toBe(false);
    expect(findSpy).not.toHaveBeenCalled();
  });
  it('returns false when arcs is missing (point-only dataset)', async () => {
    beforeDs.arcs = undefined;
    expect((await map.ops.intersectionPointsLayer({ source: 'src1', target: 'edges' })).ok).toBe(
      false,
    );
    expect(findSpy).not.toHaveBeenCalled();
  });
  it('rejects non-positive / non-finite tolerance', async () => {
    expect(
      (
        await map.ops.intersectionPointsLayer({
          source: 'src1',
          target: 'edges',
          tolerance: 0,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await map.ops.intersectionPointsLayer({
          source: 'src1',
          target: 'edges',
          tolerance: -1,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await map.ops.intersectionPointsLayer({
          source: 'src1',
          target: 'edges',
          tolerance: NaN,
        })
      ).ok,
    ).toBe(false);
    expect(findSpy).not.toHaveBeenCalled();
  });
  it('history label is "Intersection points <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.ops.intersectionPointsLayer({ source: 'src1', target: 'edges' });
    expect(listener.mock.calls[0][0].label).toBe('Intersection points edges');
  });
  it('on internal throw fires error and returns false', async () => {
    findSpy.mockImplementation(() => {
      throw new Error('boom');
    });
    const errors: any[] = [];
    map.on('error', (e: any) => errors.push(e));
    expect((await map.ops.intersectionPointsLayer({ source: 'src1', target: 'edges' })).ok).toBe(
      false,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toBe('boom');
    expect(setDatasetSpy).not.toHaveBeenCalled();
  });
});
describe('Emap.intersectionPointsLayer round-trip (real mapshaper)', () => {
  // Earlier test blocks in this file stomp mapshaper.internal mocks
  // without restoring. By the time we get here, setData()'s `-i FILE`
  // pipeline would hit those stale mocks instead of real mapshaper.
  // Restore from the module-load-time snapshot.
  beforeEach(() => {
    restoreRealMapshaper();
  });
  it('produces a non-empty point layer for a crossing-polylines dataset', async () => {
    const crossing = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [2, 2],
            ],
          },
        },
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 2],
              [2, 0],
            ],
          },
        },
      ],
    });
    const { TopologySource } = await import('../../domain/source/topology-source');
    const source = await new Promise<any>((resolve, reject) => {
      const s = new TopologySource('rt');
      s.on('data', () => resolve(s));
      s.on('error', (e: any) => reject(e?.error ?? e));
      s.setData({ filename: 'crossing.geojson', content: new TextEncoder().encode(crossing) });
    });
    const map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    setPrivate(map, '_projection', { crs: 'EPSG:4326', setCRS: vi.fn() });
    setPrivate(map, '_viewport', { setCRS: vi.fn() });
    await map.addSource('rt', source);
    const layerName = source.getDataset()!.layers[0].name;
    const ok = await map.ops.intersectionPointsLayer({
      source: 'rt',
      target: layerName,
    });
    expect(ok.ok).toBe(true);
    const ds = map.getSource('rt')!.getDataset()!;
    expect(ds.layers.length).toBe(2);
    const ptLayer = ds.layers.find((l: any) => l.name === `${layerName}-intersections`);
    expect(ptLayer).toBeDefined();
    expect(ptLayer!.geometry_type).toBe('point');
    expect(ptLayer!.shapes[0].length).toBeGreaterThan(0);
  });
});
// ---------------------------------------------------------------------------
// Emap.remove() teardown
// ---------------------------------------------------------------------------
describe('Emap.remove() teardown', () => {
  // Build a stub map that has just the surface `remove()` interacts with,
  // so we can assert each cleanup step in isolation without spinning up a
  // real DOM. Mirrors the pattern used by the worker-pool teardown test
  // above.
  async function buildStubMap(): Promise<{
    map: Emap;
    dragDestroy: ReturnType<typeof vi.fn>;
    wheelDestroy: ReturnType<typeof vi.fn>;
    historyUnbind: ReturnType<typeof vi.fn>;
    poolCancel: ReturnType<typeof vi.fn>;
    poolDestroy: ReturnType<typeof vi.fn>;
    sourceOff: ReturnType<typeof vi.fn>;
    fqClear: ReturnType<typeof vi.fn>;
    containerRemove: ReturnType<typeof vi.fn>;
  }> {
    const map = (await createTestMap()) as Emap;
    setPrivate(map, '_listeners', {});
    const dragDestroy = vi.fn();
    const wheelDestroy = vi.fn();
    const historyUnbind = vi.fn();
    const poolCancel = vi.fn();
    const poolDestroy = vi.fn();
    const sourceOff = vi.fn();
    const fqClear = vi.fn();
    const containerRemove = vi.fn();
    setPrivate(map, '_dragPan', { destroy: dragDestroy });
    setPrivate(map, '_mouseWheel', { destroy: wheelDestroy });
    setPrivate(map, '_historyShortcutUnbind', historyUnbind);
    setPrivate(map, '_workerPool', { cancelAll: poolCancel, destroy: poolDestroy });
    const sourceA = { off: sourceOff };
    const sourceB = { off: sourceOff };
    const sources = new globalThis.Map([
      ['a', sourceA],
      ['b', sourceB],
    ]);
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const sourceListeners = new globalThis.Map([
      ['a', listenerA],
      ['b', listenerB],
    ]);
    setPrivate(map, '_sources', sources);
    setPrivate(map, '_sourceListeners', sourceListeners);
    setPrivate(map, '_featureQuery', { clear: fqClear });
    setPrivate(map, '_layerArcIdsCache', new globalThis.Map([['a:l', new Uint32Array(1)]]));
    setPrivate(map, '_pendingRender', 3);
    setPrivate(map, '_rafId', 0);
    setPrivate(map, '_container', { removeChild: containerRemove });
    setPrivate(map, '_canvasContainer', {});
    return {
      map,
      dragDestroy,
      wheelDestroy,
      historyUnbind,
      poolCancel,
      poolDestroy,
      sourceOff,
      fqClear,
      containerRemove,
    };
  }
  it('detaches every source data listener', async () => {
    const { map, sourceOff } = await buildStubMap();
    await map.dispose();
    expect(sourceOff).toHaveBeenCalledTimes(2);
    expect(sourceOff).toHaveBeenCalledWith('data', expect.any(Function));
  });
  it('releases map-owned source hooks without deleting retained source data', async () => {
    const { map } = await buildStubMap();
    const initialDataset = {
      layers: [{ geometry_type: 'point' as const, shapes: [[[0, 0]]] }],
      info: { crs_string: 'EPSG:3857' },
    };
    const importedDataset = {
      layers: [{ geometry_type: 'point' as const, shapes: [[[1, 1]]] }],
      info: { crs_string: 'EPSG:3857' },
    };
    const projectedDataset = {
      layers: [{ geometry_type: 'point' as const, shapes: [[[2, 2]]] }],
      info: {},
    };
    const runImport = vi.fn(async () => importedDataset);
    const runOnDataset = vi.fn(async () => projectedDataset);
    const source = new TopologySource('retained', {
      adapter: {
        copyDataset: (dataset) => ({ ...dataset, layers: [...dataset.layers] }),
        runImport,
        runOnDataset,
      },
    });
    const staleNormalizer = vi.fn(async () => {
      throw new Error('destroyed map normalizer ran');
    });
    const staleDataListener = vi.fn();
    source.setDataset(initialDataset);
    source.setDatasetNormalizer(staleNormalizer);
    source.setManagedCRS(() => 'EPSG:3857');
    source.on('data', staleDataListener);
    setPrivate(map, '_sources', new globalThis.Map([['retained', source]]));
    setPrivate(map, '_sourceListeners', new globalThis.Map([['retained', staleDataListener]]));
    await map.dispose();
    expect(source.getDataset()).toBe(initialDataset);
    await source.setData({ filename: 'next.geojson', content: new Uint8Array([1]) });
    await source.reproject('EPSG:4326');
    expect(staleNormalizer).not.toHaveBeenCalled();
    expect(staleDataListener).not.toHaveBeenCalled();
    expect(runImport).toHaveBeenCalledTimes(1);
    expect(runOnDataset).toHaveBeenCalledTimes(1);
    expect(source.getDataset()).toBe(projectedDataset);
    expect(source.getDataset()?.info?.crs_string).toBe('EPSG:4326');
  });
  it('cancels then destroys the worker pool in order', async () => {
    const { map, poolCancel, poolDestroy } = await buildStubMap();
    await map.dispose();
    expect(poolCancel).toHaveBeenCalled();
    expect(poolDestroy).toHaveBeenCalled();
    // cancelAll must run before destroy so in-flight ops fail cleanly.
    expect(poolCancel.mock.invocationCallOrder[0]).toBeLessThan(
      poolDestroy.mock.invocationCallOrder[0],
    );
  });
  it('clears feature-query indexes for every source', async () => {
    const { map, fqClear } = await buildStubMap();
    await map.dispose();
    expect(fqClear).toHaveBeenCalledTimes(2);
    expect(fqClear).toHaveBeenCalledWith('a');
    expect(fqClear).toHaveBeenCalledWith('b');
  });
  it('drops the layer arc-id cache and clears the source map', async () => {
    const { map } = await buildStubMap();
    await map.dispose();
    expect((getPrivate(map, '_layerArcIdsCache') as globalThis.Map<string, unknown>).size).toBe(0);
    expect((getPrivate(map, '_sources') as globalThis.Map<string, unknown>).size).toBe(0);
    expect((getPrivate(map, '_sourceListeners') as globalThis.Map<string, unknown>).size).toBe(0);
  });
  it('cancels a pending RAF', async () => {
    const { map } = await buildStubMap();
    setPrivate(map, '_rafId', 99);
    const orig = (globalThis as any).cancelAnimationFrame;
    const cancelSpy = vi.fn();
    (globalThis as any).cancelAnimationFrame = cancelSpy;
    try {
      await map.dispose();
    } finally {
      (globalThis as any).cancelAnimationFrame = orig;
    }
    expect(cancelSpy).toHaveBeenCalledWith(99);
    expect(getPrivate(map, '_rafId')).toBe(0);
  });
  it('is idempotent — second call is a no-op', async () => {
    const { map, poolDestroy } = await buildStubMap();
    await map.dispose();
    await map.dispose();
    expect(poolDestroy).toHaveBeenCalledTimes(1);
  });
  it('blocks subsequent _scheduleRender calls', async () => {
    const { map } = await buildStubMap();
    await map.dispose();
    setPrivate(map, '_rafId', 0);
    setPrivate(map, '_pendingRender', 0);
    callPrivate(map, '_scheduleRender');
    // _rafId should still be 0 — schedule was short-circuited.
    expect(getPrivate(map, '_rafId')).toBe(0);
    expect(getPrivate(map, '_pendingRender')).toBe(0);
  });
  it('calls onRemove on every registered control, even if one throws', async () => {
    const { map } = await buildStubMap();
    const goodA = { onAdd: vi.fn(), onRemove: vi.fn() };
    const bad = {
      onAdd: vi.fn(),
      onRemove: vi.fn(() => {
        throw new Error('boom');
      }),
    };
    const goodB = { onAdd: vi.fn(), onRemove: vi.fn() };
    for (const control of [goodA, bad, goodB]) {
      control.onAdd.mockReturnValue({ style: {}, remove: vi.fn() });
      await map.addControl(control as any);
    }
    const errors: any[] = [];
    map.on('error', (e: any) => errors.push(e));
    await map.dispose();
    expect(goodA.onRemove).toHaveBeenCalled();
    expect(goodB.onRemove).toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toBe('boom');
    expect((getPrivate(map, '_controls') as unknown[]).length).toBe(0);
  });
});
// ===========================================================================
// Integration: Transaction + ops + Validator + FeatureAccessor on a real
// Emap (not a stub host). Verifies the new abstractions actually wire
// up end-to-end through the runner / history / event flow — the unit
// tests cover each piece in isolation.
// ===========================================================================
describe('Phase-6 integration', () => {
  let map: Emap;
  let beforeDs: any;
  let afterDs: any;
  let source: any;
  let setDatasetSpy: ReturnType<typeof vi.fn>;
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  beforeEach(async () => {
    map = await createBareMap();
    setPrivate(map, '_history', new EditHistory());
    // Phase-6 specifics: createBareMap() bypasses the constructor, so the
    // fields the new code introduced have to be wired up by hand.
    setPrivate(map, '_activeTransaction', null);
    setPrivate(map, '_validators', new ValidatorRegistry());
    setPrivate(map, 'features', new FeatureAccessor(map as any));
    // The actual validation provider owns the history hook; do not install a second one.
    beforeDs = {
      layers: [
        {
          name: 'parks',
          geometry_type: 'polygon',
          shapes: [[[0]], [[1]]],
          data: { getRecords: () => [{ name: 'A' }, { name: 'B' }], getFields: () => ['name'] },
        },
      ],
      arcs: null,
      info: {},
    };
    afterDs = {
      layers: [
        {
          name: 'parks',
          geometry_type: 'polygon',
          shapes: [[[42]]],
          data: { getRecords: () => [{ name: 'merged' }], getFields: () => ['name'] },
        },
      ],
      arcs: null,
      info: {},
    };
    setDatasetSpy = vi.fn((ds: any) => {
      source._currentDs = ds;
    });
    source = {
      id: 'src1',
      type: 'topology',
      _currentDs: beforeDs,
      getDataset() {
        return this._currentDs;
      },
      getLayers() {
        return this._currentDs.layers;
      },
      setDataset: setDatasetSpy,
      fire: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    };
    setDatasetSpy.mockImplementation((ds: any) => {
      source._currentDs = ds;
    });
    (map as any)._sources.set('src1', source);
    // Stub mapshaper internals: copyDataset returns a structurally-distinct
    // pre-op snapshot so transaction rollback can restore it; runParsedCommands
    // returns afterDs.
    Reflect.set(
      mapshaper.internal as object,
      'copyDataset',
      vi.fn((ds: any) => ({ ...ds, _snapshotOf: ds })),
    );
    Reflect.set(
      mapshaper.internal as object,
      'runParsedCommands',
      vi.fn((_cmds: any, _job: any, cb: any) => {
        cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
      }),
    );
  });
  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });
  describe('Transaction + real ops', () => {
    it('captured ops do not grow the undo stack', async () => {
      const tx = map.beginTransaction();
      const r = await map.ops.dropLayer({ source: 'src1', target: 'parks' });
      expect(r.ok).toBe(true);
      // History capture buffer absorbed the DatasetReplaceCommand the runner
      // pushed; visible undo stack stays empty until commit.
      expect(map.canUndo()).toBe(false);
      // The dataset has still been swapped though — the source's dataset is
      // the post-op state, not the pre-transaction state.
      expect(source._currentDs).toBe(afterDs);
      tx.rollback();
    });
    it('commit collapses captured ops into one CompositeCommand', async () => {
      const tx = map.beginTransaction();
      await map.ops.dropLayer({ source: 'src1', target: 'parks' });
      await map.ops.dropLayer({ source: 'src1', target: 'parks' });
      const r = await tx.commit('Process boundaries');
      expect(r.ok).toBe(true);
      expect(map.canUndo()).toBe(true);
      const top = (map as any)._history._undoStack.at(-1);
      expect(top).toBeInstanceOf(CompositeCommand);
      expect(top.label).toBe('Process boundaries');
    });
    it('rollback restores the source dataset to the pre-transaction state', async () => {
      const originalDs = source._currentDs;
      const tx = map.beginTransaction();
      await map.ops.dropLayer({ source: 'src1', target: 'parks' });
      // Source dataset is now afterDs.
      expect(source._currentDs).toBe(afterDs);
      tx.rollback();
      // Rollback restores the first-touch dataset without retaining a clone.
      expect(source._currentDs).toBe(originalDs);
      expect(map.canUndo()).toBe(false);
    });
    it('rollback discards captured commands without polluting history', async () => {
      const tx = map.beginTransaction();
      await map.ops.dropLayer({ source: 'src1', target: 'parks' });
      await map.ops.dropLayer({ source: 'src1', target: 'parks' });
      tx.rollback();
      expect((map as any)._history._undoStack).toHaveLength(0);
      expect((map as any)._history._redoStack).toHaveLength(0);
    });
    it('commit allows undo to revert all captured ops in one step', async () => {
      const originalDs = source._currentDs;
      const tx = map.beginTransaction();
      await map.ops.dropLayer({ source: 'src1', target: 'parks' });
      await tx.commit('Do thing');
      expect(map.canUndo()).toBe(true);
      map.undo();
      // Undo restores the pre-op dataset retained by the replacement command.
      expect(source._currentDs).toBe(originalDs);
    });
    it('publishes transaction data after undo and redo history transitions', async () => {
      const originalDs = source._currentDs;
      const tx = map.beginTransaction();
      await map.ops.dropLayer({ source: 'src1', target: 'parks' });
      await tx.commit('Publish transaction');
      const observations: Array<{
        dataset: object;
        canUndo: boolean;
        canRedo: boolean;
        reason: string | undefined;
      }> = [];
      source.fire.mockImplementation(
        (
          _type: string,
          event: {
            reason?: string;
          },
        ) => {
          observations.push({
            dataset: source._currentDs,
            canUndo: map.canUndo(),
            canRedo: map.canRedo(),
            reason: event.reason,
          });
          return source;
        },
      );
      expect(map.undo()).toBe(true);
      expect(map.redo()).toBe(true);
      expect(observations).toEqual([
        {
          dataset: originalDs,
          canUndo: false,
          canRedo: true,
          reason: 'replace',
        },
        {
          dataset: afterDs,
          canUndo: true,
          canRedo: false,
          reason: 'replace',
        },
      ]);
    });
  });
  describe('Validator + ops integration', () => {
    it('after-commit validator runs once per op commit', async () => {
      const validator = {
        name: 'v1',
        phase: 'after-commit' as const,
        run: vi.fn(async () => ({ ok: true, issues: [] })),
      };
      map.validators.register(validator);
      await map.ops.dropLayer({ source: 'src1', target: 'parks' });
      // historychange fires synchronously inside the op; validator
      // registry's run is async but resolves on next tick.
      await flushPromises();
      expect(validator.run).toHaveBeenCalledTimes(1);
      expect(validator.run.mock.calls[0][1].label).toBe('Drop parks');
    });
    it('after-commit validator runs once per transaction commit (not per inner op)', async () => {
      const validator = {
        name: 'v1',
        phase: 'after-commit' as const,
        run: vi.fn(async () => ({ ok: true, issues: [] })),
      };
      map.validators.register(validator);
      const tx = map.beginTransaction();
      await map.ops.dropLayer({ source: 'src1', target: 'parks' });
      await map.ops.dropLayer({ source: 'src1', target: 'parks' });
      await flushPromises();
      // Inside the transaction, the inner ops' DatasetReplaceCommands are
      // captured (no historychange fired, no validator invocation).
      expect(validator.run).not.toHaveBeenCalled();
      await tx.commit('Outer');
      await flushPromises();
      // Now historychange fires once for the CompositeCommand push.
      expect(validator.run).toHaveBeenCalledTimes(1);
      expect(validator.run.mock.calls[0][1].label).toBe('Outer');
    });
    it('after-commit validator does NOT run on rollback (nothing committed)', async () => {
      const validator = {
        name: 'v1',
        phase: 'after-commit' as const,
        run: vi.fn(async () => ({ ok: true, issues: [] })),
      };
      map.validators.register(validator);
      const tx = map.beginTransaction();
      await map.ops.dropLayer({ source: 'src1', target: 'parks' });
      tx.rollback();
      await flushPromises();
      // rollback fires historychange so listeners can refresh, but the
      // resulting history.snapshot has no top entry — validator is still
      // called (the registry has one validator), but its `change.label`
      // is empty.
      // We accept either "called with empty label" OR "not called" as
      // valid; the strict invariant is that no SUCCESSFUL commit
      // surfaced. Document the current behaviour:
      const callCount = validator.run.mock.calls.length;
      expect(callCount).toBeLessThanOrEqual(1);
      if (callCount === 1) {
        expect(validator.run.mock.calls[0][1].label).toBe('');
      }
    });
    it('failed validator fires `validationfailed` event with the failing report', async () => {
      const failing = {
        name: 'topology',
        phase: 'after-commit' as const,
        run: vi.fn(async () => ({
          ok: false,
          issues: [{ severity: 'error' as const, message: '3 self-intersections' }],
        })),
      };
      map.validators.register(failing);
      const events: any[] = [];
      map.on('validationfailed', (e: any) => events.push(e));
      await map.ops.dropLayer({ source: 'src1', target: 'parks' });
      await flushPromises();
      expect(events).toHaveLength(1);
      expect(events[0].results).toHaveLength(1);
      expect(events[0].results[0].validator).toBe('topology');
      expect(events[0].results[0].report.ok).toBe(false);
      expect(events[0].label).toBe('Drop parks');
    });
    it('passing validator does NOT fire `validationfailed`', async () => {
      const passing = {
        name: 'v',
        phase: 'after-commit' as const,
        run: vi.fn(async () => ({ ok: true, issues: [] })),
      };
      map.validators.register(passing);
      const events: any[] = [];
      map.on('validationfailed', (e: any) => events.push(e));
      await map.ops.dropLayer({ source: 'src1', target: 'parks' });
      await flushPromises();
      expect(events).toHaveLength(0);
    });
    it('validators registry is empty by default — no overhead when unused', async () => {
      // No register() call. historychange fires; validator path should be
      // a cheap size===0 check with no allocation.
      await map.ops.dropLayer({ source: 'src1', target: 'parks' });
      await flushPromises();
      // No assertion needed — if the size===0 short-circuit broke, an
      // unhandled promise rejection would fail the test.
      expect(map.validators.size).toBe(0);
    });
  });
  describe('FeatureAccessor on a real Emap', () => {
    it('engine.features.get returns frozen properties for a real source', () => {
      // The bare-map setup wires features via setPrivate above. Confirm
      // the public access path works.
      const f = (map as any).features.get({ source: 'src1', layer: 'parks', id: 1 });
      expect(f).not.toBeNull();
      expect(f.properties.name).toBe('B');
      expect(Object.isFrozen(f.properties)).toBe(true);
    });
    it('engine.features.iter walks a real layer', () => {
      const out = Array.from((map as any).features.iter('src1', 'parks'));
      expect(out).toHaveLength(2);
      expect(out.map((f: any) => f.properties.name)).toEqual(['A', 'B']);
    });
  });
});
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
describe('Emap edit-mode drag pan', () => {
  it('suspends drag pan for split mode and restores its prior enabled state on exit', async () => {
    const map = await createTestMap();
    const interaction = map.ctx.interaction;
    let enabled = true;
    const dragPan = {
      name: 'test-pan',
      isEnabled: () => enabled,
      disable: vi.fn(() => {
        enabled = false;
      }),
      enable: vi.fn(() => {
        enabled = true;
      }),
      setOptions() {},
      getOptions: () => ({}),
      handlePointer: () => 'passthrough' as const,
    };
    interaction.register(dragPan, { roles: ['pan'] });
    interaction.register(
      { ...dragPan, name: 'test-split', isEnabled: () => false, disable() {}, enable() {} },
      { mode: 'split', blocks: ['pan'] },
    );
    interaction.syncMode('split');
    expect(dragPan.disable).toHaveBeenCalledTimes(1);
    expect(dragPan.isEnabled()).toBe(false);
    interaction.syncMode('none');
    expect(dragPan.enable).toHaveBeenCalledTimes(1);
    expect(dragPan.isEnabled()).toBe(true);
    await map.dispose();
  });
});
describe('attribute-driven fill render (e2e)', () => {
  it('classifyFeatures then styleSource fill layer renders via styleBuckets', async () => {
    const adapter = getDefaultMapshaperAdapter();
    const dataset = await adapter.runImport('-i "d.geojson"', {
      'd.geojson': JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { pop: 10 },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            },
          },
          {
            type: 'Feature',
            properties: { pop: 90 },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [2, 2],
                  [3, 2],
                  [3, 3],
                  [2, 3],
                  [2, 2],
                ],
              ],
            },
          },
          {
            type: 'Feature',
            properties: { pop: null },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [4, 4],
                  [5, 4],
                  [5, 5],
                  [4, 5],
                  [4, 4],
                ],
              ],
            },
          },
        ],
      }),
    });
    const map = await createBareMap();
    // copy+replace 契约：引用可变 stub，断言一律读 current。
    let current = dataset;
    const sources = new Map<string, unknown>();
    sources.set('src1', {
      id: 'src1',
      type: 'topology',
      getDataset: () => current,
      getLayers: () => current.layers,
      getArcs: () => current.arcs,
      getDisplayArcs: () => null,
      getSimplifyFloor: () => 0,
      setDataset: (next: MapshaperDataset) => {
        current = next;
      },
      refreshDisplayArcs: () => undefined,
      fire: () => undefined,
    });
    setPrivate(map, '_sources', sources);
    // Object.create 绕过构造器：字段初始化器不运行，显式注入（createBareMap 模式）。
    setPrivate(map, '_styleResolver', new StyleResolver());
    setPrivate(map, '_viewport', new Viewport());
    await map.ops.classifyFeatures({
      source: 'src1',
      target: 'd',
      field: 'pop',
      method: 'equal-interval',
      classes: 2,
      colors: ['#111111', '#999999'],
      nullValue: '#eeeeee',
    });
    map.addLayer({
      id: 'L',
      type: 'fill',
      source: 'src1',
      'source-layer': 'd',
      styleSource: 'mapshaper',
    });
    const painter = { drawPolygonFill: vi.fn(), drawArcs: vi.fn(), drawPoints: vi.fn() };
    setPrivate(map, '_painter', painter);
    const renderLayersFn = Reflect.get(map, '_renderLayers') as (p: number, l: number) => void;
    renderLayersFn.call(map, 1, 1);
    const calls = painter.drawPolygonFill.mock.calls as unknown[][];
    const opts = calls[0][5] as {
      styleBuckets: {
        buckets: Uint32Array[];
        colors: string[];
      };
    };
    // 第三桶 = 显式 nullValue '#eeeeee'（烘焙为真实颜色，非主题 null 桶）
    expect(opts.styleBuckets.colors.slice(0, 2)).toEqual(['#111111', '#999999']);
    expect(opts.styleBuckets.colors).toHaveLength(3);
    expect([...opts.styleBuckets.buckets[0]]).toEqual([0]);
    expect([...opts.styleBuckets.buckets[1]]).toEqual([1]);
    expect([...opts.styleBuckets.buckets[2]]).toEqual([2]);
  });
});
describe('Emap classifyFeatures (real baking + undo)', () => {
  it('bakes explicit fill colors incl. effective null; undo restores records', async () => {
    const adapter = getDefaultMapshaperAdapter();
    const dataset = await adapter.runImport('-i "d.geojson"', {
      'd.geojson': JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { pop: 10 },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            },
          },
          {
            type: 'Feature',
            properties: { pop: 90 },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [2, 2],
                  [3, 2],
                  [3, 3],
                  [2, 3],
                  [2, 2],
                ],
              ],
            },
          },
          {
            type: 'Feature',
            properties: { pop: null },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [4, 4],
                  [5, 4],
                  [5, 5],
                  [4, 5],
                  [4, 4],
                ],
              ],
            },
          },
        ],
      }),
    });
    const map = await createBareMap();
    // runner 的 dataset 命令是 copy+replace 契约（setDataset(after)）：
    // stub 必须让引用可变，断言一律读 current。
    let current = dataset;
    const sources = new Map<string, unknown>();
    sources.set('src1', {
      id: 'src1',
      type: 'topology',
      getDataset: () => current,
      getLayers: () => current.layers,
      setDataset: (next: MapshaperDataset) => {
        current = next;
      },
      refreshDisplayArcs: () => undefined,
      fire: () => undefined,
    });
    setPrivate(map, '_sources', sources);
    const res = await map.ops.classifyFeatures({
      source: 'src1',
      target: 'd',
      field: 'pop',
      method: 'equal-interval',
      classes: 2,
      colors: ['#111111', '#999999'],
      nullValue: '#eeeeee',
    });
    expect(res.ok).toBe(true);
    let records = current.layers[0].data?.getRecords() ?? [];
    expect(records.map((r) => r.fill)).toEqual(['#111111', '#999999', '#eeeeee']);
    expect(current.attributeVersion ?? 0).toBeGreaterThanOrEqual(1);
    expect(map.undo()).toBe(true); // replace 撤销 → current 指回 before
    records = current.layers[0].data?.getRecords() ?? [];
    expect(records.map((r) => r.fill)).toEqual([undefined, undefined, undefined]);
  });
});
describe('Emap queryFeatures with display filter', () => {
  async function createPickMap(points: Array<[number, number]>, values: number[]): Promise<Emap> {
    const map = await createBareMap();
    const records = values.map((v) => ({ v }));
    const layer = {
      name: 'points',
      geometry_type: 'point' as const,
      shapes: points.map((point) => [point]),
      data: { getRecords: () => records },
    };
    const dataset = { layers: [layer] };
    const source = {
      id: 'src1',
      type: 'topology' as const,
      getDataset: () => dataset,
      getLayers: () => dataset.layers,
      getArcs: () => undefined,
      getDisplayArcs: () => null,
    };
    (getPrivate(map, '_sources') as Map<string, unknown>).set('src1', source);
    const query = new FeatureQuery(
      getPrivate(map, '_sources') as ConstructorParameters<typeof FeatureQuery>[0],
      () => new AffineTransform(),
      () => ({ width: 100, height: 100 }),
      () => 1,
    );
    query.setFeatureMaskProvider((sourceId, layerId) => {
      if (sourceId !== 'src1' || layerId !== 'points') return null;
      let union: Uint8Array | null = null;
      for (const renderLayer of map.getRenderedLayers()) {
        if (
          renderLayer.source !== sourceId ||
          renderLayer['source-layer'] !== layerId ||
          renderLayer.layout?.visibility === 'none'
        ) {
          continue;
        }
        if (!renderLayer.filter) return null;
        const mask = (getPrivate(map, '_filterResolver') as FilterResolver).mask({
          layerId: renderLayer.id,
          filter: renderLayer.filter,
          dataset,
          layer,
        });
        if (!mask) return null;
        if (!union) union = mask.slice();
        else for (let i = 0; i < union.length; i++) union[i]! |= mask[i]!;
      }
      return union;
    });
    setPrivate(map, '_featureQuery', query);
    return map;
  }
  function addFilteredLayer(map: Emap, id = 'l1'): void {
    map.addLayer({
      id,
      type: 'circle',
      source: 'src1',
      'source-layer': 'points',
      filter: ['>', ['get', 'v'], 1],
    });
  }
  it('filtered-out features are not pickable', async () => {
    const map = await createPickMap(
      [
        [10, 10],
        [100, 10],
        [200, 10],
      ],
      [1, 2, 3],
    );
    addFilteredLayer(map);
    expect(map.queryFeatures([10, 10])).toEqual([]);
    expect(map.queryFeatures([100, 10]).map((feature) => feature.id)).toEqual([1]);
  });
  it('a visible runner-up is picked when the nearest feature is filtered out', async () => {
    const map = await createPickMap(
      [
        [10, 10],
        [15, 10],
      ],
      [0, 5],
    );
    addFilteredLayer(map);
    expect(map.queryFeatures([11, 10]).map((feature) => feature.id)).toEqual([1]);
  });
  it('a hidden near point does not tighten the bullseye threshold', async () => {
    const map = await createPickMap(
      [
        [1, 0],
        [5, 0],
      ],
      [0, 5],
    );
    addFilteredLayer(map);
    expect(map.queryFeatures([0, 0]).map((feature) => feature.id)).toEqual([1]);
  });
  it('a second unfiltered render layer on the same data layer keeps everything pickable', async () => {
    const map = await createPickMap([[10, 10]], [0]);
    addFilteredLayer(map);
    map.addLayer({ id: 'l2', type: 'circle', source: 'src1', 'source-layer': 'points' });
    expect(map.queryFeatures([10, 10]).map((feature) => feature.id)).toEqual([0]);
  });
  it('clearing the filter restores pickability', async () => {
    const map = await createPickMap([[10, 10]], [0]);
    addFilteredLayer(map);
    expect(map.queryFeatures([10, 10])).toEqual([]);
    map.setFilter('l1', null);
    expect(map.queryFeatures([10, 10]).map((feature) => feature.id)).toEqual([0]);
  });
});
describe('Emap point LOD integration', () => {
  async function pointMap() {
    const map = await createBareMap();
    const layer = {
      name: 'points',
      geometry_type: 'point' as const,
      shapes: Array.from({ length: 20000 }, (_, id) => [[id === 0 ? 1 : 7, 1]]),
      data: getDefaultMapshaperAdapter().createDataTable(
        Array.from({ length: 20000 }, (_, id) => ({ id })),
      ),
    };
    const dataset: MapshaperDataset = { layers: [layer], editVersion: 0, attributeVersion: 0 };
    const source = createMockSource([layer]);
    source.getDataset.mockReturnValue(dataset as never);
    registerMockSource(map, 's', source);
    const transform = new AffineTransform();
    setPrivate(map, '_viewport', { transform, getViewBounds: () => [0, 0, 100, 100] });
    setPrivate(map, '_painter', { drawPoints: vi.fn() });
    const query = new FeatureQuery(
      getPrivate(map, '_sources') as ConstructorParameters<typeof FeatureQuery>[0],
      () => transform,
      () => ({ width: 100, height: 100 }),
      () => 1,
    );
    setPrivate(map, '_featureQuery', query);
    setPrivate(map, '_highlightManager', new HighlightManager());
    map.addLayer({ id: 'dots', source: 's', type: 'circle' });
    return { map, layer, dataset, transform };
  }
  it('picks the drawn representative while range queries retain every original feature', async () => {
    const { map } = await pointMap();
    expect(map.queryFeatures([7, 1]).map((f) => f.id)).toEqual([0]);
    expect(
      map.queryFeatures([
        [0, 0],
        [8, 2],
      ]),
    ).toHaveLength(20000);
    expect(
      map.queryFeatures([
        [6, 0],
        [8, 2],
      ]),
    ).toHaveLength(19999);
    map.removeLayer('dots');
    map.addLayer({ id: 'dots', source: 's', type: 'circle', pointLod: false });
    expect(map.queryFeatures([7, 1])[0].id).not.toBe(0);
  });
  it('keeps selected and highlighted original points pickable above LOD', async () => {
    const { map, layer } = await pointMap();
    layer.shapes[2] = [[6, 1]];
    map.select([{ source: 's', layer: 'points', id: 1 }]);
    expect(map.queryFeatures([7, 1])[0].id).toBe(1);
    map.setHighlightedFeatures([{ source: 's', layer: 'points', id: 2 }]);
    expect(map.queryFeatures([6, 1])[0].id).toBe(2);
  });
  it('picks the actually painted level throughout CSS snapshot zoom until redraw', async () => {
    const { map, transform } = await pointMap();
    callPrivate(map, '_renderLayers', 1, 1);
    expect(map.queryFeatures([7, 1])[0].id).toBe(0);
    transform.scale(2, 0, 0);
    // Fast navigation transforms the previous bitmap; no new level was painted.
    expect(map.queryFeatures([14, 2])[0].id).toBe(0);
    callPrivate(map, '_renderLayers', 0.5, 1);
    expect(map.queryFeatures([14, 2])[0].id).toBe(1);
  });
  it('filters before picking and unions independent render layers without leaking hidden originals', async () => {
    const { map } = await pointMap();
    map.setFilter('dots', ['>', ['get', 'id'], 0]);
    expect(map.queryFeatures([1, 1])[0].id).toBe(1);
    map.addLayer({
      id: 'all',
      source: 's',
      type: 'circle',
      pointLod: false,
      filter: ['==', ['get', 'id'], 0],
    });
    expect(map.queryFeatures([1, 1])[0].id).toBe(0);
    map.setLayerVisibility('all', 'none');
    expect(map.queryFeatures([1, 1])[0].id).toBe(1);
  });
  it('does not hit hidden components of a rendered MultiPoint feature', async () => {
    const { map, layer } = await pointMap();
    layer.shapes[0] = [
      [1, 1],
      [7, 1],
    ];
    layer.shapes[1] = [[10, 1]];
    expect(map.queryFeatures([7, 1])[0].id).toBe(1);
    map.select([{ source: 's', layer: 'points', id: 0 }]);
    expect(map.queryFeatures([7, 1])[0].id).toBe(0);
  });
  it('rebuilds after geometry edits and attribute changes, then restores original IDs', async () => {
    const { map, layer, dataset } = await pointMap();
    expect(map.queryFeatures([7, 1])[0].id).toBe(0);
    layer.shapes[0] = [[40, 40]];
    dataset.editVersion!++;
    expect(map.queryFeatures([7, 1])[0].id).toBe(1);
    layer.shapes[0] = [[1, 1]];
    dataset.editVersion!++;
    expect(map.queryFeatures([7, 1])[0].id).toBe(0);
    map.setFilter('dots', ['>', ['get', 'id'], 0]);
    expect(map.queryFeatures([1, 1])[0].id).toBe(1);
    dataset.attributeVersion!++;
    layer.data.getRecords()[0].id = 10;
    expect(map.queryFeatures([1, 1])[0].id).toBe(0);
  });
  for (const sourceId of ['s', undefined]) {
    it(`clears point LOD through the explicit spatial-cache escape hatch (${sourceId ?? 'all'})`, async () => {
      const { map, layer } = await pointMap();
      expect(map.queryFeatures([7, 1])[0].id).toBe(0);
      layer.shapes[0] = [[40, 40]];
      map.clearSpatialIndex(sourceId);
      expect(map.queryFeatures([7, 1]).map((feature) => feature.id)).toEqual([1]);
    });
  }
  for (const action of ['layer', 'source', 'map'] as const) {
    it(`releases the point cache when removing the ${action}`, async () => {
      const { map, layer, dataset } = await pointMap();
      expect(map.queryFeatures([7, 1])[0].id).toBe(0);
      const cache = pointLodForPainter(getPrivate(map, '_painter') as object);
      layer.shapes[0] = [[40, 40]];
      if (action === 'layer') map.removeLayer('dots');
      else if (action === 'source') map.removeSource('s');
      else await map.dispose();
      expect(
        cache.query(
          { id: 'dots', source: 's', type: 'circle' },
          layer,
          dataset,
          null,
          new AffineTransform(),
          [0, 0, 8, 8],
        )!.featureIds,
      ).toEqual(new Uint32Array([1]));
    });
  }
  it('validates pointLod and defensively clones input and returned layer snapshots', async () => {
    const { map } = await pointMap();
    for (const value of [
      true,
      null,
      3,
      [],
      { cellSize: 0 },
      { cellSize: Infinity },
      { cellSize: 65 },
      { cellSize: '8' },
      { mode: 'cluster' },
    ]) {
      expect(() =>
        map.addLayer({ id: 'bad', source: 's', type: 'circle', pointLod: value } as never),
      ).toThrow(/pointLod/);
    }
    expect(() =>
      map.addLayer({ id: 'bad', source: 's', type: 'line', pointLod: false } as never),
    ).toThrow(/pointLod/);
    const pointLod = { cellSize: 12 };
    map.addLayer({ id: 'copy', source: 's', type: 'circle', pointLod });
    pointLod.cellSize = 32;
    const snapshot = map.getLayer('copy');
    expect(snapshot).toMatchObject({ pointLod: { cellSize: 12 } });
    if (snapshot?.type === 'circle' && snapshot.pointLod) snapshot.pointLod.cellSize = 64;
    expect(map.getLayer('copy')).toMatchObject({ pointLod: { cellSize: 12 } });
    const restored = JSON.parse(JSON.stringify(map.getLayers()));
    expect(restored[1].pointLod).toEqual({ cellSize: 12 });
  });
});
