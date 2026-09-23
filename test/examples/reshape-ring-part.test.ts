import { getExampleRenderer } from '../../packages/examples/src/renderer-choice';
// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
interface EditModeEvent {
  mode: string;
}
function handler() {
  let enabled = false;
  let options: {
    mode?: 'add' | 'delete';
  } = {};
  return {
    enable: vi.fn(() => {
      enabled = true;
    }),
    disable: vi.fn(() => {
      enabled = false;
    }),
    isEnabled: vi.fn(() => enabled),
    setOptions: vi.fn((next: { mode?: 'add' | 'delete' }) => {
      options = { ...options, ...next };
    }),
    getOptions: vi.fn(() => options),
  };
}
async function executeExample() {
  const html = await readFile(
    resolve('packages/examples/examples/reshape-ring-part/index.html'),
    'utf8',
  );
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const moduleScript = parsed.querySelector<HTMLScriptElement>('script[type="module"]');
  if (!moduleScript?.textContent) throw new Error('reshape-ring-part module script is missing');
  const script = moduleScript.textContent.replace(
    /^\s*import\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];\s*$/gm,
    '',
  );
  const originalHead = document.head.innerHTML;
  const originalBody = document.body.innerHTML;
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  const editModeListeners: Array<(event: EditModeEvent) => void> = [];
  const errorListeners: Array<(event: { error: Error }) => void> = [];
  const reshapeFeature = handler();
  const ringEdit = handler();
  const partEdit = handler();
  const map = {
    reshapeFeature,
    ringEdit,
    partEdit,
    clickSelect: handler(),
    addControl: vi.fn(),
    bindHistoryShortcuts: vi.fn(),
    on: (
      type: string,
      listener: (
        event:
          | EditModeEvent
          | {
              error: Error;
            },
      ) => void,
    ) => {
      if (type === 'editmodechange')
        editModeListeners.push(listener as (event: EditModeEvent) => void);
      if (type === 'error') errorListeners.push(listener as (event: { error: Error }) => void);
    },
  };
  const runtime = {
    Emap: class {
      static async create(...args: any[]) {
        return new this(...args);
      }
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
      'getExampleRenderer',
      'installExampleMapUi',
      'autoLoadExampleFixtures',
      'loadExampleRuntime',
      'document',
      script,
    )(
      getExampleRenderer,
      installExampleMapUi,
      autoLoadExampleFixtures,
      loadExampleRuntime,
      document,
    );
  } catch (error) {
    document.head.innerHTML = originalHead;
    document.body.innerHTML = originalBody;
    throw error;
  }
  return {
    reshapeFeature,
    ringEdit,
    partEdit,
    autoLoadExampleFixtures,
    emitEditMode(mode: string) {
      for (const listener of editModeListeners) listener({ mode });
    },
    emitError(error: Error) {
      for (const listener of errorListeners) listener({ error });
    },
    dispose() {
      document.head.innerHTML = originalHead;
      document.body.innerHTML = originalBody;
    },
  };
}
describe('reshape-ring-part example', () => {
  it('toggles advanced handlers, switches shared modes, and surfaces errors', async () => {
    const result = await executeExample();
    try {
      const reshape = document.querySelector<HTMLButtonElement>('#reshape')!;
      const addRing = document.querySelector<HTMLButtonElement>('#add-ring')!;
      const deleteRing = document.querySelector<HTMLButtonElement>('#delete-ring')!;
      const addPart = document.querySelector<HTMLButtonElement>('#add-part')!;
      const deletePart = document.querySelector<HTMLButtonElement>('#delete-part')!;
      const status = document.querySelector<HTMLElement>('#status')!;
      expect(result.autoLoadExampleFixtures).toHaveBeenCalledWith('reshape-ring-part');
      reshape.click();
      expect(result.reshapeFeature.enable).toHaveBeenCalledTimes(1);
      reshape.click();
      expect(result.reshapeFeature.disable).toHaveBeenCalledTimes(1);
      addRing.click();
      expect(result.ringEdit.setOptions).toHaveBeenLastCalledWith({ mode: 'add' });
      expect(result.ringEdit.enable).toHaveBeenCalledTimes(1);
      deleteRing.click();
      expect(result.ringEdit.setOptions).toHaveBeenLastCalledWith({ mode: 'delete' });
      expect(result.ringEdit.disable).toHaveBeenCalledTimes(1);
      expect(result.ringEdit.enable).toHaveBeenCalledTimes(2);
      addPart.click();
      expect(result.partEdit.setOptions).toHaveBeenLastCalledWith({ mode: 'add' });
      deletePart.click();
      expect(result.partEdit.setOptions).toHaveBeenLastCalledWith({ mode: 'delete' });
      addRing.click();
      result.emitEditMode('ring');
      expect(addRing.classList).toContain('emap-example-primary-button');
      expect(deleteRing.classList).not.toContain('emap-example-primary-button');
      result.emitEditMode('none');
      expect(addRing.classList).not.toContain('emap-example-primary-button');
      result.emitError(new Error('operation failed'));
      expect(status.textContent).toContain('operation failed');
    } finally {
      result.dispose();
    }
  });
});
