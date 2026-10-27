// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installExamplePresentation } from '../../packages/examples/src/example-presentation';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
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
  it('keeps source in its own view and retains the running map across switches', () => {
    mount();
    const map = document.querySelector('#map');
    dispose = installExamplePresentation();
    const source = document.querySelector<HTMLElement>('#example-source')!;
    expect(source.hidden).toBe(true);
    expect(document.querySelector('#example-live #example-source')).toBeNull();
    document.querySelector<HTMLButtonElement>('[data-example-tab="source"]')!.click();
    expect(source.hidden).toBe(false);
    expect(source.querySelector('code')?.textContent).toContain('Example source');
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
  it('supports keyboard view changes and only installs once', () => {
    mount();
    dispose = installExamplePresentation();
    installExamplePresentation();
    expect(document.querySelectorAll('.example-detail-layout')).toHaveLength(1);
    const tab = document.querySelector<HTMLButtonElement>('[data-example-tab="live"]')!;
    tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(
      document.querySelector('[data-example-tab="source"]')?.getAttribute('aria-selected'),
    ).toBe('true');
    expect(document.querySelector('#example-source code')?.textContent).toContain('Example source');
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
