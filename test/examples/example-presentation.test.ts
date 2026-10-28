// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installExamplePresentation } from '../../packages/examples/src/example-presentation';

let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const text = '<html><body>Example source</body></html>\n';
      const value = url.endsWith('/manifest.json')
        ? {
            files: [
              {
                id: 'index.html',
                name: '完整 HTML',
                path: 'examples/getting-started/lines/index.html',
                origin: 'packages/examples/examples/getting-started/lines/index.html',
                language: 'html',
                lineCount: 1,
                url: '/source.json',
              },
            ],
            defaultFile: 'index.html',
          }
        : {
            text,
            html: `<pre><code>${text.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</code></pre>`,
            language: 'html',
            lineCount: 1,
          };
      return { ok: true, json: async () => value };
    }),
  );
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.body.className = '';
  window.history.replaceState(null, '', '/');
});
function mount() {
  window.history.replaceState(null, '', '/mapseekai/emap/examples/getting-started/lines/');
  document.body.innerHTML = `<div id="header"><strong>Lines</strong></div><div id="map"></div>
    <details class="emap-example-workbench" open><summary><h1>Lines</h1></summary>
    <div class="emap-example-workbench-body"><label for="line-width">线宽</label>
    <input id="line-width" type="range" min="1" max="12" step="0.5" value="4"></div></details>
    <script id="emap-example-source" type="application/json">${JSON.stringify('<html><body>Example source</body></html>')}</script>`;
}
describe('example presentation', () => {
  it('opens operations on the map and preserves controls through collapse and keyboard recovery', () => {
    mount();
    dispose = installExamplePresentation();
    const dialog = document.querySelector<HTMLDialogElement>('.example-parameters')!;
    const control = document.querySelector<HTMLInputElement>('#line-width')!;
    const toggle = document.querySelector<HTMLButtonElement>('.example-parameters-toggle')!;
    expect(dialog.open).toBe(true);
    expect(dialog.closest('.example-application')).toBeTruthy();
    expect(document.querySelector('.example-detail-heading .example-parameters-toggle')).toBeNull();
    control.value = '7';
    document.querySelector<HTMLButtonElement>('.example-parameters-close')!.click();
    expect(dialog.open).toBe(false);
    expect(toggle.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    expect(new URL(window.location.href).searchParams.get('parameters')).toBe('closed');
    toggle.click();
    expect(dialog.open).toBe(true);
    expect(document.querySelector('#line-width')).toBe(control);
    expect(control.value).toBe('7');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(toggle);
  });
  it('restores collapsed operations from a shared URL', () => {
    mount();
    window.history.replaceState(null, '', `${window.location.pathname}?parameters=closed`);
    dispose = installExamplePresentation();
    expect(document.querySelector<HTMLDialogElement>('.example-parameters')!.open).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('.example-parameters-toggle')!.hidden).toBe(
      false,
    );
  });
  it('keeps success text out of the map and exposes loading and errors from the original status node', async () => {
    mount();
    const status = document.createElement('p');
    status.id = 'status';
    status.textContent = '正在显示线图层';
    document.body.append(status);
    dispose = installExamplePresentation();
    expect(document.querySelector('.example-application > #status')).toBe(status);
    expect(status.dataset.exampleFeedback).toBe('');
    status.textContent = '正在加载 test.geojson...';
    await Promise.resolve();
    expect(status.dataset.exampleFeedback).toBe('loading');
    status.textContent = '错误: 无法读取文件';
    await Promise.resolve();
    expect(status.dataset.exampleFeedback).toBe('error');
    status.textContent = '已加载 test.geojson';
    await Promise.resolve();
    expect(status.dataset.exampleFeedback).toBe('');
    status.dataset.state = 'error';
    await Promise.resolve();
    expect(status.dataset.exampleFeedback).toBe('error');
    status.dataset.state = 'ready';
    await Promise.resolve();
    expect(status.dataset.exampleFeedback).toBe('');
    // Legacy examples can retain "ready" when reporting a later file error.
    status.textContent = 'Error: invalid GeoJSON';
    await Promise.resolve();
    expect(status.dataset.exampleFeedback).toBe('error');
  });
  it('keeps source in its own view and retains the running map across switches', async () => {
    mount();
    const map = document.querySelector('#map');
    dispose = installExamplePresentation();
    const source = document.querySelector<HTMLElement>('#example-source')!;
    expect(source.hidden).toBe(true);
    expect(document.querySelector('#example-live #example-source')).toBeNull();
    document.querySelector<HTMLButtonElement>('[data-example-tab="source"]')!.click();
    expect(source.hidden).toBe(false);
    await vi.waitFor(() =>
      expect(source.querySelector('code')?.textContent).toContain('Example source'),
    );
    expect(source.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      '完整 HTML',
    );
    document.querySelector<HTMLButtonElement>('[data-example-tab="live"]')!.click();
    expect(source.hidden).toBe(true);
    expect(document.querySelector('.example-demo-area #map')).toBe(map);
  });
  it('preserves native control identities and their listeners without adding guidance', () => {
    mount();
    const control = document.querySelector<HTMLInputElement>('#line-width')!;
    let changes = 0;
    control.addEventListener('input', () => changes++);
    dispose = installExamplePresentation();
    expect(document.querySelector('.example-parameters #line-width')).toBe(control);
    expect(document.querySelector('h1')?.textContent).toBe('线图层样式');
    expect(document.querySelector('.example-navigation [aria-current="page"]')?.textContent).toBe(
      '线图层样式',
    );
    expect(document.querySelector('.example-control-help, .example-parameter-table')).toBeNull();
    control.value = '6';
    control.dispatchEvent(new Event('input'));
    expect(changes).toBe(1);
  });
  it('removes the guide, repeated description and reload/expanded chrome', () => {
    mount();
    window.history.replaceState(
      null,
      '',
      '/mapseekai/emap/examples/getting-started/lines/?tab=guide',
    );
    dispose = installExamplePresentation();
    expect([...document.querySelectorAll('.example-tab')].map((node) => node.textContent)).toEqual([
      '地图',
      '源码',
    ]);
    expect(
      document.querySelector(
        '#example-guide, .example-detail-description, .example-breadcrumb, .example-rerun',
      ),
    ).toBeNull();
    expect(document.querySelector<HTMLElement>('#example-live')!.hidden).toBe(false);
    expect(new URL(window.location.href).searchParams.has('tab')).toBe(false);
  });
  it('supports keyboard view changes and only installs once', async () => {
    mount();
    dispose = installExamplePresentation();
    installExamplePresentation();
    expect(document.querySelectorAll('.example-detail-layout')).toHaveLength(1);
    const tab = document.querySelector<HTMLButtonElement>('[data-example-tab="live"]')!;
    tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(
      document.querySelector('[data-example-tab="source"]')?.getAttribute('aria-selected'),
    ).toBe('true');
    await vi.waitFor(() =>
      expect(document.querySelector('#example-source code')?.textContent).toContain(
        'Example source',
      ),
    );
  });
  it('preserves the luma host used by dynamically installed symbol controls', () => {
    window.history.replaceState(null, '', '/mapseekai/emap/examples/luma-25d/');
    document.body.innerHTML =
      '<header id="header"></header><main class="layout"><aside><h1>2.5D</h1><p id="status">Loading</p><label>倾角<input id="pitch" type="range" value="50"></label></aside><section id="map"></section></main>';
    const host = document.querySelector('.layout > aside')!;
    dispose = installExamplePresentation();
    expect(document.querySelector('.example-parameters .layout > aside')).toBe(host);
    expect(document.querySelector('.example-runtime-status')?.textContent).toBe('Loading');
    host.insertAdjacentHTML('beforeend', '<input id="label-size" type="range" value="12">');
    expect(document.querySelector('.example-parameters #label-size')).toBeTruthy();
  });
  it('separates the native benchmark stage from its controls without replacing either', () => {
    window.history.replaceState(null, '', '/mapseekai/emap/examples/luma-benchmark/');
    document.body.innerHTML =
      '<header id="header"></header><main id="benchmark"><button id="load-file">加载</button><p id="status">Ready</p><section><div id="stage"><canvas id="webgl"></canvas></div></section></main>';
    const host = document.getElementById('benchmark');
    const stage = document.getElementById('stage');
    dispose = installExamplePresentation();
    expect(document.querySelector('.example-demo-area > #stage')).toBe(stage);
    expect(document.querySelector('.example-parameters #benchmark')).toBe(host);
    expect(document.querySelector('.example-parameters #load-file')).toBeTruthy();
    expect(document.querySelector('.example-runtime-status')?.textContent).toBe('Ready');
  });
  it('retains the native editor host and selection UI while moving its map', () => {
    window.history.replaceState(null, '', '/mapseekai/emap/examples/luma-vertex-editing/');
    document.body.innerHTML =
      '<header id="header"></header><main id="editor"><button id="load">加载</button><div class="workspace"><section id="map"><div id="stage"><canvas></canvas></div></section><aside id="selection-info">Selection</aside></div></main>';
    const host = document.getElementById('editor');
    const map = document.getElementById('map');
    dispose = installExamplePresentation();
    expect(document.querySelector('.example-demo-area > #map')).toBe(map);
    expect(document.querySelector('.example-parameters #editor')).toBe(host);
    expect(document.querySelector('.example-parameters #selection-info')?.textContent).toBe(
      'Selection',
    );
  });
});
