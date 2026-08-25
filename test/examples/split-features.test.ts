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
  const splitFeature = {
    setOptions: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
  };
  const map = {
    splitFeature,
    addControl: vi.fn(),
    addLayer: vi.fn(),
    bindHistoryShortcuts: vi.fn(),
    clearHighlightedFeatures: vi.fn(),
    clearSelection: vi.fn(),
    drawFeature: vi.fn(),
    features: {
      get: (selected: FeatureRef) => ({
        geometry: { type: selected.layer === 'parcels' ? 'Polygon' : 'LineString' },
      }),
    },
    getCanvasContainer: () => document.getElementById('map')!,
    getSelection: () => selection,
    getSource: vi.fn(),
    queryFeatures: vi.fn(() => []),
    select: vi.fn(),
    setHighlightedFeatures: vi.fn(),
    on: (type: string, listener: (event: SelectionEvent) => void) => {
      if (type === 'selectionchange') selectionListeners.push(listener);
    },
  };
  const runtime = {
    Emap: class {
      constructor() {
        return map;
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
    emitSelection(next: FeatureRef[]) {
      selection = next;
      for (const listener of selectionListeners) listener({ selected: next });
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

describe('split-features example', () => {
  it('configures public split handler modes, gates valid selections, and reports final selection', async () => {
    const result = await executeSplitFeaturesExample();
    try {
      const pointButton = document.querySelector<HTMLButtonElement>('#point-mode')!;
      const lineButton = document.querySelector<HTMLButtonElement>('#line-mode')!;
      const enableButton = document.querySelector<HTMLButtonElement>('#enable-split')!;
      const clearButton = document.querySelector<HTMLButtonElement>('#clear-selection')!;
      const cancelButton = document.querySelector<HTMLButtonElement>('#cancel-split')!;
      const status = document.querySelector<HTMLElement>('#status')!;

      expect(enableButton.disabled).toBe(true);
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

      result.emitSelection([ref(4, 'roads'), ref(5, 'parcels')]);
      expect(enableButton.disabled).toBe(true);
      expect(status.textContent).toContain('同一数据源、同一图层');

      result.emitSelection([ref(6, 'roads'), ref(7, 'roads')]);
      expect(status.textContent).toContain('已选中 2 个拆分结果');
      expect(result.map.drawFeature).not.toHaveBeenCalled();
      expect(result.map.addLayer).not.toHaveBeenCalled();
    } finally {
      result.dispose();
    }
  });
});
