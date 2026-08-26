// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureRef } from '../../src/map/types';

interface SelectionEvent {
  selected: FeatureRef[];
}

async function executeSplitFeaturesExample() {
  const html = await readFile(
    resolve('packages/examples/examples/split-features/index.html'),
    'utf8',
  );
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const moduleScript = parsed.querySelector<HTMLScriptElement>('script[type="module"]');
  if (!moduleScript?.textContent) throw new Error('split-features module script is missing');
  const script = moduleScript.textContent.replace(
    /^\s*import\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];\s*$/gm,
    '',
  );
  const originalHead = document.head.innerHTML;
  const originalBody = document.body.innerHTML;
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;

  let selection: FeatureRef[] = [];
  const selectionListeners: Array<(event: SelectionEvent) => void> = [];
  const errorListeners: Array<(event: { error: Error }) => void> = [];
  const sources = new Map<string, { getLayers: () => unknown[] }>();
  const splitFeature = {
    setOptions: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
  };
  const map = {
    splitFeature,
    clickSelect: {
      enable: vi.fn(),
      setOptions: vi.fn(),
    },
    addControl: vi.fn(),
    addLayer: vi.fn(),
    addSource: vi.fn(async (id: string, source: { getLayers: () => unknown[] }) => {
      if (sources.has(id)) throw new Error(`duplicate source ${id}`);
      sources.set(id, source);
    }),
    bindHistoryShortcuts: vi.fn(),
    clearHighlightedFeatures: vi.fn(),
    clearSelection: vi.fn(),
    drawFeature: vi.fn(),
    features: undefined,
    getCanvasContainer: () => document.getElementById('map')!,
    getSelection: () => selection,
    getSource: (id: string) =>
      sources.get(id) ?? {
        getLayers: () => [
          {
            name: '',
            id: 'roads',
            geometry_type: 'polyline',
            shapes: [[0]],
          },
          {
            name: 'other',
            geometry_type: 'point',
            shapes: [[0]],
          },
          {
            id: 'parcels',
            geometry_type: 'polygon',
            shapes: [[[2, 3, 4]]],
          },
          {
            geometry_type: 'polyline',
            shapes: [[5, 6]],
          },
        ],
      },
    queryFeatures: vi.fn(() => []),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    select: vi.fn(),
    setExtent: vi.fn(),
    setHighlightedFeatures: vi.fn(),
    on: (type: string, listener: (event: SelectionEvent | { error: Error }) => void) => {
      if (type === 'selectionchange')
        selectionListeners.push(listener as (event: SelectionEvent) => void);
      if (type === 'error') errorListeners.push(listener as (event: { error: Error }) => void);
    },
  };
  const runtime = {
    Emap: class {
      constructor() {
        return map;
      }
    },
    TopologySource: class {
      constructor(id: string) {
        return {
          getExtent: () => ({}),
          getLayers: () => [],
          id,
          setData: vi.fn(async () => {}),
        };
      }
    },
    NavigationControl: class {},
    HistoryControl: class {},
  };
  const installExampleMapUi = vi.fn();
  const autoLoadExampleFixtures = vi.fn(async () => {});
  const loadExampleRuntime = vi.fn(async () => runtime);

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction(
      'installExampleMapUi',
      'autoLoadExampleFixtures',
      'loadExampleRuntime',
      'document',
      'window',
      'FileReader',
      script,
    )(
      installExampleMapUi,
      autoLoadExampleFixtures,
      loadExampleRuntime,
      document,
      window,
      FileReader,
    );
  } catch (error) {
    document.head.innerHTML = originalHead;
    document.body.innerHTML = originalBody;
    throw error;
  }

  return {
    map,
    splitFeature,
    emitError(error: Error | { kind: string; reason?: string; message?: string }) {
      for (const listener of errorListeners) listener({ error: error as Error });
    },
    emitSelection(next: FeatureRef[]) {
      selection = next;
      for (const listener of selectionListeners) listener({ selected: next });
    },
    async replaceFiles(files: Array<{ name: string; arrayBuffer: () => Promise<ArrayBuffer> }>) {
      const input = document.querySelector<HTMLInputElement>('#file-input')!;
      const previouslyAdded = map.addSource.mock.calls.length;
      Object.defineProperty(input, 'files', { configurable: true, value: files });
      input.dispatchEvent(new Event('change'));
      await vi.waitFor(() =>
        expect(map.addSource).toHaveBeenCalledTimes(previouslyAdded + files.length),
      );
    },
    dispose() {
      document.head.innerHTML = originalHead;
      document.body.innerHTML = originalBody;
    },
  };
}

function ref(id: number, layer: string, source = 'source'): FeatureRef {
  return { source, layer, id };
}

function fixtureFile(name: string) {
  return { arrayBuffer: async () => new ArrayBuffer(0), name };
}

describe('split-features example', () => {
  it('uses source layer metadata for handler gating and surfaces errors', async () => {
    const result = await executeSplitFeaturesExample();
    try {
      const pointButton = document.querySelector<HTMLButtonElement>('#point-mode')!;
      const lineButton = document.querySelector<HTMLButtonElement>('#line-mode')!;
      const enableButton = document.querySelector<HTMLButtonElement>('#enable-split')!;
      const clearButton = document.querySelector<HTMLButtonElement>('#clear-selection')!;
      const cancelButton = document.querySelector<HTMLButtonElement>('#cancel-split')!;
      const status = document.querySelector<HTMLElement>('#status')!;

      expect(enableButton.disabled).toBe(true);
      expect(result.map.clickSelect.enable).toHaveBeenCalledTimes(1);
      pointButton.click();
      expect(result.splitFeature.setOptions).toHaveBeenLastCalledWith({ cutterType: 'point' });
      lineButton.click();
      expect(result.splitFeature.setOptions).toHaveBeenLastCalledWith({ cutterType: 'polyline' });

      result.emitSelection([ref(4, 'roads')]);
      expect(enableButton.disabled).toBe(false);
      enableButton.click();
      expect(result.splitFeature.enable).toHaveBeenCalledTimes(1);

      clearButton.click();
      expect(result.map.clearSelection).toHaveBeenCalledTimes(1);
      expect(result.splitFeature.disable).toHaveBeenCalledTimes(1);
      cancelButton.click();
      expect(result.splitFeature.disable).toHaveBeenCalledTimes(2);

      result.emitSelection([ref(5, 'parcels')]);
      expect(pointButton.disabled).toBe(true);
      expect(lineButton.disabled).toBe(false);
      expect(enableButton.disabled).toBe(false);

      result.emitSelection([ref(6, 'layer-3')]);
      expect(enableButton.disabled).toBe(false);
      result.emitSelection([ref(4, 'roads'), ref(5, 'parcels')]);
      expect(enableButton.disabled).toBe(true);
      expect(status.textContent).toContain('同一数据源、同一图层');

      result.emitSelection([ref(6, 'roads'), ref(7, 'roads')]);
      expect(status.textContent).toContain('已选中 2 个拆分结果');
      result.emitError(new Error('split failed'));
      expect(status.textContent).toContain('split failed');
      result.emitError({ kind: 'validation', reason: 'Point cutter is not on a selected path' });
      expect(status.textContent).toContain('Point cutter is not on a selected path');
      expect(status.textContent).not.toContain('[object Object]');
      expect(result.map.clearHighlightedFeatures).toHaveBeenCalled();

      result.splitFeature.enable.mockImplementationOnce(() => {
        throw new Error('cannot start');
      });
      enableButton.click();
      expect(status.textContent).toContain('cannot start');
      expect(result.map.drawFeature).not.toHaveBeenCalled();
      expect(result.map.addLayer).not.toHaveBeenCalled();
    } finally {
      result.dispose();
    }
  });

  it('replaces owned fixture sources before loading another file selection', async () => {
    const result = await executeSplitFeaturesExample();
    try {
      await result.replaceFiles([fixtureFile('roads.geojson'), fixtureFile('parcels.geojson')]);
      await result.replaceFiles([fixtureFile('roads-next.geojson')]);
      expect(result.map.removeSource).toHaveBeenCalledWith('split-source-0');
      expect(result.map.removeSource).toHaveBeenCalledWith('split-source-1');
      expect(result.map.addSource).toHaveBeenCalledTimes(3);
    } finally {
      result.dispose();
    }
  });
});
