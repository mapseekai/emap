// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureRef } from '../../src/map/types';

interface SelectionEvent {
  selected: FeatureRef[];
}

async function executeMergeSelectedExample() {
  const html = await readFile(
    resolve('packages/examples/examples/merge-selected/index.html'),
    'utf8',
  );
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const moduleScript = parsed.querySelector<HTMLScriptElement>('script[type="module"]');
  if (!moduleScript?.textContent) throw new Error('merge-selected module script is missing');
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
  const properties: Record<number, Record<string, unknown>> = {
    0: { name: 'A' },
    1: { fullname: '河北省' },
    2: {},
  };
  const mergeSelected = vi.fn(async () => ({ ok: true as const, value: undefined }));
  const map = {
    ops: { mergeSelected },
    features: {
      get: (ref: FeatureRef) => ({ ref, geometry: null, properties: properties[ref.id] ?? {} }),
    },
    addControl: vi.fn(),
    bindHistoryShortcuts: vi.fn(),
    getCanvasContainer: () => document.getElementById('map')!,
    getSelection: () => selection,
    getSource: vi.fn(),
    removeSource: vi.fn(),
    addSource: vi.fn(async () => {}),
    setExtent: vi.fn(),
    queryFeatures: vi.fn(() => []),
    select: vi.fn(),
    clearSelection: vi.fn(),
    clearHighlightedFeatures: vi.fn(),
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
    TopologySource: class {},
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
    mergeSelected,
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

function ref(id: number, source = 'source', layer = 'parcels'): FeatureRef {
  return { source, layer, id };
}

describe('merge-selected example attribute source', () => {
  it('lists same-layer selections and forwards the chosen FeatureRef', async () => {
    const result = await executeMergeSelectedExample();
    try {
      const select = document.querySelector<HTMLSelectElement>('#attribute-source');
      const mergeButton = document.querySelector<HTMLButtonElement>('#merge-btn');
      expect(select).not.toBeNull();
      expect(select?.disabled).toBe(true);
      expect(mergeButton?.disabled).toBe(true);

      result.emitSelection([ref(0), ref(1)]);
      expect(Array.from(select!.options, (option) => option.textContent)).toEqual([
        '要素 0 — A',
        '要素 1 — 河北省',
      ]);
      expect(select?.disabled).toBe(false);
      expect(mergeButton?.disabled).toBe(false);

      select!.value = select!.options[1].value;
      mergeButton!.click();
      await vi.waitFor(() =>
        expect(result.mergeSelected).toHaveBeenCalledWith({ attributeSource: ref(1) }),
      );
      expect(document.querySelector('#status')?.textContent).toContain('要素 1 — 河北省');
    } finally {
      result.dispose();
    }
  });

  it('preserves a selected source and disables mixed-layer merges', async () => {
    const result = await executeMergeSelectedExample();
    try {
      const select = document.querySelector<HTMLSelectElement>('#attribute-source')!;
      const mergeButton = document.querySelector<HTMLButtonElement>('#merge-btn')!;
      result.emitSelection([ref(0), ref(1)]);
      select.value = select.options[1].value;

      result.emitSelection([ref(1), ref(2)]);
      expect(select.value).toBe(select.options[0].value);
      expect(select.options[0].textContent).toBe('要素 1 — 河北省');

      result.emitSelection([ref(1), ref(2, 'source', 'other')]);
      expect(select.disabled).toBe(true);
      expect(mergeButton.disabled).toBe(true);
      expect(document.querySelector('#status')?.textContent).toContain('同一图层');
    } finally {
      result.dispose();
    }
  });
});
