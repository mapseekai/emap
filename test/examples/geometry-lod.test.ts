// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mountGeometryLodExample } from '../../packages/examples/src/geometry-lod';
import { importGeoPackageInWorker } from '@mapseekai/emap/geopackage';

vi.mock('@mapseekai/emap/geopackage', () => ({ importGeoPackageInWorker: vi.fn() }));
vi.mock('../../packages/examples/src/example-runtime', () => ({
  autoLoadExampleFixtures: vi.fn(),
}));

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.clearAllMocks();
});

describe('geometry LOD local GeoPackage import', () => {
  async function setup(
    options: {
      enabled?: boolean;
      thresholds?: boolean;
      prepare?: () => Promise<{ ok: boolean }>;
    } = {},
  ) {
    document.body.innerHTML = readFileSync(
      'packages/examples/examples/geometry-lod/index.html',
      'utf8',
    );
    document.querySelector<HTMLInputElement>('#gpkg-layers')!.value = ' roads, landuse , ';
    const map = {
      addSource: vi.fn(),
      addLayer: vi.fn(),
      removeSource: vi.fn(),
      reset: vi.fn(),
      setGeometryLod: vi.fn(),
      setScreenPathFiltering: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      remove: vi.fn(),
      getTransform: () => ({ mx: 1 }),
      ops: {
        simplifyLayer: vi.fn(async ({ source: id }: { source: string }) => {
          const result = await (options.prepare?.() ?? Promise.resolve({ ok: true }));
          if (result.ok)
            for (const source of sources) if (source.id === id) source.thresholds = true;
          return result;
        }),
      },
    };
    const sources: Source[] = [];
    class Source {
      thresholds = options.thresholds ?? true;
      constructor(public id: string) {
        sources.push(this);
      }
      setDataset = vi.fn();
      getLayers = () => [{ name: 'roads', geometry_type: 'polyline' }];
      getArcs = () => ({
        getVertexData: () => ({
          xx: new Float64Array([0, 1, 2]),
          zz: this.thresholds ? [Infinity, 1, Infinity] : undefined,
        }),
        getPointCount: () => 3,
      });
      getDisplayArcs = () => null;
      getSimplifyFloor = () => 0;
      on = vi.fn();
      off = vi.fn();
    }
    const enabled = document.querySelector<HTMLInputElement>('#geometry-lod')!;
    enabled.checked = options.enabled ?? enabled.checked;
    await mountGeometryLodExample(map as never, { TopologySource: Source } as never);
    const input = document.querySelector<HTMLInputElement>('#file-input')!;
    const select = () => {
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [{ name: 'berlin.gpkg', arrayBuffer: async () => new ArrayBuffer(8) }],
      });
      input.dispatchEvent(new Event('change'));
    };
    return { map, select, enabled, sources };
  }

  it('starts with geometry simplification and screen filtering disabled in the actual example', async () => {
    const { map, enabled } = await setup();
    expect(enabled.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('#screen-path-filtering')!.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('#pixel-tolerance')!.disabled).toBe(true);
    expect(map.setGeometryLod).toHaveBeenLastCalledWith(false);
    expect(map.setScreenPathFiltering).toHaveBeenLastCalledWith(false);
    expect(map.ops.simplifyLayer).not.toHaveBeenCalled();
  });

  it('restores disabled defaults after both controls are enabled', async () => {
    const { map, enabled } = await setup({ enabled: true });
    const screen = document.querySelector<HTMLInputElement>('#screen-path-filtering')!;
    screen.checked = true;
    screen.dispatchEvent(new Event('change'));
    expect(map.setScreenPathFiltering).toHaveBeenLastCalledWith(true);
    document.getElementById('reset-detail')!.click();
    await vi.waitFor(() => expect(map.setGeometryLod).toHaveBeenLastCalledWith(false));
    expect(enabled.checked).toBe(false);
    expect(screen.checked).toBe(false);
    expect(map.setScreenPathFiltering).toHaveBeenLastCalledWith(false);
    expect(document.querySelector<HTMLInputElement>('#pixel-tolerance')!.value).toBe('0.5');
    expect(document.querySelector<HTMLInputElement>('#pixel-tolerance')!.disabled).toBe(true);
  });

  it('passes selected tables to the native worker and displays the returned source', async () => {
    vi.mocked(importGeoPackageInWorker).mockResolvedValue({} as never);
    const { map, select } = await setup();
    select();
    await vi.waitFor(() => expect(map.addSource).toHaveBeenCalledOnce());
    expect(importGeoPackageInWorker).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.objectContaining({
        layers: ['roads', 'landuse'],
        transferInput: true,
        workerUrl: '/mapseekai/emap/examples/emap-geopackage-worker.js',
        wasmUrl: '/mapseekai/emap/examples/sql-wasm.wasm',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ type: 'line' }));
    expect(document.getElementById('status')!.dataset.state).toBe('ready');
  });

  it('aborts a superseded worker import and ignores its late result', async () => {
    let complete!: (value: never) => void;
    vi.mocked(importGeoPackageInWorker)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValueOnce({} as never);
    const { map, select } = await setup();
    select();
    await vi.waitFor(() => expect(importGeoPackageInWorker).toHaveBeenCalledOnce());
    const signal = vi.mocked(importGeoPackageInWorker).mock.calls[0][1].signal!;
    select();
    await vi.waitFor(() => expect(map.addSource).toHaveBeenCalledOnce());
    expect(signal.aborted).toBe(true);
    complete({} as never);
    await Promise.resolve();
    expect(map.addSource).toHaveBeenCalledOnce();
    expect(map.addSource.mock.calls[0][0]).toBe('geometry-2');
  });

  it('loads full-detail geometry without preparing unused thresholds, then prepares once on enable', async () => {
    vi.mocked(importGeoPackageInWorker).mockResolvedValue({} as never);
    const { map, select, enabled } = await setup({ enabled: false, thresholds: false });
    select();
    await vi.waitFor(() => expect(document.getElementById('status')!.dataset.state).toBe('ready'));
    expect(map.ops.simplifyLayer).not.toHaveBeenCalled();
    expect(map.setGeometryLod).toHaveBeenLastCalledWith(false);
    enabled.checked = true;
    enabled.dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(map.setGeometryLod).toHaveBeenLastCalledWith({ pixelTolerance: 0.5 }),
    );
    expect(map.ops.simplifyLayer).toHaveBeenCalledOnce();
    enabled.checked = false;
    enabled.dispatchEvent(new Event('change'));
    enabled.checked = true;
    enabled.dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(map.setGeometryLod).toHaveBeenLastCalledWith({ pixelTolerance: 0.5 }),
    );
    expect(map.ops.simplifyLayer).toHaveBeenCalledOnce();
  });

  it('shares pending threshold work and keeps disabled geometry at full detail when it completes', async () => {
    vi.mocked(importGeoPackageInWorker).mockResolvedValue({} as never);
    let complete!: (value: { ok: boolean }) => void;
    const { map, select, enabled } = await setup({
      enabled: false,
      thresholds: false,
      prepare: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    });
    select();
    await vi.waitFor(() => expect(document.getElementById('status')!.dataset.state).toBe('ready'));
    enabled.checked = true;
    enabled.dispatchEvent(new Event('change'));
    enabled.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(map.ops.simplifyLayer).toHaveBeenCalledOnce());
    enabled.checked = false;
    enabled.dispatchEvent(new Event('change'));
    complete({ ok: true });
    await vi.waitFor(() => expect(document.getElementById('status')!.dataset.state).toBe('ready'));
    expect(map.setGeometryLod).toHaveBeenLastCalledWith(false);
    expect(map.ops.simplifyLayer).toHaveBeenCalledOnce();
  });

  it('reports a shared preparation failure once and permits a later retry without losing the layer', async () => {
    vi.mocked(importGeoPackageInWorker).mockResolvedValue({} as never);
    let complete!: (value: { ok: boolean }) => void;
    let attempt = 0;
    const { map, select, enabled, sources } = await setup({
      enabled: false,
      thresholds: false,
      prepare: () =>
        ++attempt === 1
          ? new Promise((resolve) => {
              complete = resolve;
            })
          : Promise.resolve({ ok: true }),
    });
    select();
    await vi.waitFor(() => expect(document.getElementById('status')!.dataset.state).toBe('ready'));
    enabled.checked = true;
    enabled.dispatchEvent(new Event('change'));
    enabled.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(map.ops.simplifyLayer).toHaveBeenCalledOnce());
    complete({ ok: false });
    await vi.waitFor(() => expect(document.getElementById('status')!.dataset.state).toBe('error'));
    expect(enabled.checked).toBe(false);
    expect(map.setGeometryLod).toHaveBeenLastCalledWith(false);
    expect(map.removeSource).not.toHaveBeenCalled();
    enabled.checked = true;
    enabled.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(document.getElementById('status')!.dataset.state).toBe('ready'));
    expect(map.setGeometryLod).toHaveBeenLastCalledWith({ pixelTolerance: 0.5 });
    expect(sources[0].getArcs().getPointCount()).toBe(3);
    expect(map.ops.simplifyLayer).toHaveBeenCalledTimes(2);
  });

  it('ignores threshold completion for a replaced source while the new source is preparing', async () => {
    vi.mocked(importGeoPackageInWorker).mockResolvedValue({} as never);
    const complete: ((value: { ok: boolean }) => void)[] = [];
    const { map, select, enabled, sources } = await setup({
      enabled: false,
      thresholds: false,
      prepare: () =>
        new Promise((resolve) => {
          complete.push(resolve);
        }),
    });
    select();
    await vi.waitFor(() => expect(document.getElementById('status')!.dataset.state).toBe('ready'));
    enabled.checked = true;
    enabled.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(complete).toHaveLength(1));
    select();
    await vi.waitFor(() => expect(complete).toHaveLength(2));
    complete[0]({ ok: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById('status')!.dataset.state).toBe('loading');
    expect(sources[1].thresholds).toBe(false);
    complete[1]({ ok: true });
    await vi.waitFor(() => expect(document.getElementById('status')!.dataset.state).toBe('ready'));
    expect(map.setGeometryLod).toHaveBeenLastCalledWith({ pixelTolerance: 0.5 });
    expect(sources[1].thresholds).toBe(true);
  });

  it('does not update a removed map when initial threshold preparation completes', async () => {
    vi.mocked(importGeoPackageInWorker).mockResolvedValue({} as never);
    let complete!: (value: { ok: boolean }) => void;
    const { map, select } = await setup({
      enabled: true,
      thresholds: false,
      prepare: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    });
    select();
    await vi.waitFor(() => expect(map.ops.simplifyLayer).toHaveBeenCalledOnce());
    window.dispatchEvent(new Event('pagehide'));
    map.setScreenPathFiltering.mockClear();
    complete({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(map.remove).toHaveBeenCalledOnce();
    expect(map.setScreenPathFiltering).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true,
  ])('applies retained-source intent after a failed import (prepared before failure: %s)', async (preparedBeforeFailure) => {
    let failImport!: (reason: Error) => void;
    vi.mocked(importGeoPackageInWorker)
      .mockResolvedValueOnce({} as never)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failImport = reject;
          }),
      );
    let complete!: (value: { ok: boolean }) => void;
    const { map, select, enabled } = await setup({
      enabled: false,
      thresholds: false,
      prepare: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    });
    select();
    await vi.waitFor(() => expect(document.getElementById('status')!.dataset.state).toBe('ready'));
    enabled.checked = true;
    enabled.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(map.ops.simplifyLayer).toHaveBeenCalledOnce());
    select();
    await vi.waitFor(() => expect(importGeoPackageInWorker).toHaveBeenCalledTimes(2));
    if (preparedBeforeFailure) {
      complete({ ok: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    failImport(new Error('B import failed'));
    await vi.waitFor(() => expect(document.getElementById('status')!.dataset.state).toBe('error'));
    if (!preparedBeforeFailure) complete({ ok: true });
    await vi.waitFor(() =>
      expect(map.setGeometryLod).toHaveBeenLastCalledWith({ pixelTolerance: 0.5 }),
    );
    expect(document.getElementById('status')!.textContent).toBe('B import failed');
    expect(map.removeSource).not.toHaveBeenCalled();
  });
});
