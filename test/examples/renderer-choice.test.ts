// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveExampleRenderer,
  exampleRendererUrl,
  installExampleRendererToolbar,
  getExampleRenderer,
  getExampleGpuBackend,
  syncExampleRendererToolbar,
} from '../../packages/examples/src/renderer-choice';

const base = 'http://localhost/mapseekai/emap/examples/';
afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('shared example renderer selection', () => {
  it.each([
    ['/mapseekai/emap/getting-started/quick-start', '返回文档'],
    ['/mapseekai/emap/en/getting-started/quick-start', 'Return to docs'],
    ['https://example.com/mapseekai/emap/en/', '返回文档'],
    ['/mapseekai/emap/examples/buffer/', '返回文档'],
    ['javascript:alert(1)', '返回文档'],
    ['//example.com/', '返回文档'],
  ])('keeps the docs return destination local: %s', (returnTo, label) => {
    window.history.replaceState(
      {},
      '',
      '/mapseekai/emap/examples/buffer/?returnTo=' + encodeURIComponent(returnTo),
    );
    document.body.innerHTML = '<header id="header">Example</header>';
    installExampleRendererToolbar();
    installExampleRendererToolbar();
    const links = document.querySelectorAll<HTMLAnchorElement>('.emap-example-docs-link');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe(label);
    const valid = returnTo.startsWith('/mapseekai/emap/') && !returnTo.includes('/examples/');
    expect(links[0].getAttribute('href')).toBe(valid ? returnTo : '/mapseekai/emap/');
    expect(new URL(exampleRendererUrl('webgpu')).searchParams.get('returnTo')).toBe(returnTo);
  });

  it('defers observed header layout changes until the next frame and cancels them on pagehide', () => {
    document.body.innerHTML = '<header id="header">Example</header>';
    let notify!: () => void;
    let frame!: FrameRequestCallback;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const schedule = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frame = callback;
      return 1;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const write = vi.spyOn(document.documentElement.style, 'setProperty');
    installExampleRendererToolbar();
    notify();
    notify();
    expect(write).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledTimes(1);
    frame(0);
    expect(write).toHaveBeenCalledWith('--emap-example-header-height', '0px');
    notify();
    window.dispatchEvent(new Event('pagehide'));
    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith(1);
  });
  it('preserves the selected comparison GPU when the benchmark displays Canvas2D', () => {
    window.history.replaceState(
      {},
      '',
      '/mapseekai/emap/examples/luma-benchmark/?renderer=canvas&gpu=webgpu',
    );
    expect(getExampleRenderer()).toBe('canvas2d');
    expect(getExampleGpuBackend()).toBe('webgpu');
    const next = new URL(
      exampleRendererUrl('canvas2d', new URL(base + 'luma-benchmark/?gpu=webgpu')),
    );
    expect(next.searchParams.get('renderer')).toBe('canvas2d');
    expect(next.searchParams.get('gpu')).toBe('webgpu');
  });

  it('defaults to WebGL2 and honors every explicit formal backend', () => {
    expect(resolveExampleRenderer(new URL(base + 'buffer/'))).toBe('webgl2');
    for (const renderer of ['canvas2d', 'webgl2', 'webgpu'] as const)
      expect(resolveExampleRenderer(new URL(base + 'buffer/?renderer=' + renderer))).toBe(renderer);
    expect(() => resolveExampleRenderer(new URL(base + 'buffer/?renderer=canvas'))).toThrow(
      'renderer',
    );
    expect(() => resolveExampleRenderer(new URL(base + 'buffer/?renderer=typo'))).toThrow(
      'renderer',
    );
  });
  it('honors canonical selection before legacy experimental GPU and Canvas URLs', () => {
    expect(
      resolveExampleRenderer(new URL(base + 'luma-benchmark/?renderer=canvas&gpu=webgpu')),
    ).toBe('canvas2d');
    expect(resolveExampleRenderer(new URL(base + 'luma-raster/?gpu=canvas'))).toBe('canvas2d');
    expect(resolveExampleRenderer(new URL(base + 'luma-25d/?gpu=webgpu'))).toBe('webgpu');
    expect(
      resolveExampleRenderer(new URL(base + 'luma-benchmark/?renderer=webgl2&gpu=webgpu')),
    ).toBe('webgl2');
    expect(resolveExampleRenderer(new URL(base + 'buffer/?gpu=webgpu'))).toBe('webgl2');
  });
  it('switches on the same route and preserves other query parameters and fragments', () => {
    const before = new URL(base + 'luma-25d/?gpu=webgl&nav=off&file=demo#stats');
    const next = new URL(exampleRendererUrl('webgpu', before));
    expect(next.pathname).toBe(before.pathname);
    expect(next.hash).toBe('#stats');
    expect(next.searchParams.get('renderer')).toBe('webgpu');
    expect(next.searchParams.get('gpu')).toBe('webgpu');
    expect(next.searchParams.get('nav')).toBe('off');
    expect(next.searchParams.get('file')).toBe('demo');
    expect(before.searchParams.get('renderer')).toBeNull();
  });
  it('mounts accessible buttons before device creation and does not duplicate them', () => {
    document.body.innerHTML = '<header id="header"><strong>Example</strong></header>';
    window.history.replaceState({}, '', '/mapseekai/emap/examples/point-lod/?renderer=canvas2d');
    installExampleRendererToolbar();
    installExampleRendererToolbar();
    expect(document.querySelectorAll('.emap-example-renderer-tools')).toHaveLength(1);
    expect(document.querySelectorAll('[data-example-renderer]')).toHaveLength(3);
    expect(
      document.querySelector('[data-example-renderer="canvas2d"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(document.querySelector('#emap-example-renderer-hint')?.textContent).toContain(
      '重新加载',
    );
    expect(getExampleRenderer()).toBe('canvas2d');
    syncExampleRendererToolbar('webgpu');
    expect(
      document.querySelector('[data-example-renderer="webgpu"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
  });
  it('does not claim Canvas2D support for a GPU-only experiment', () => {
    document.body.innerHTML = '<header id="header"></header>';
    window.history.replaceState({}, '', '/mapseekai/emap/examples/luma-25d/?renderer=canvas2d');
    installExampleRendererToolbar();
    expect(
      document.querySelector<HTMLButtonElement>('[data-example-renderer="canvas2d"]')?.disabled,
    ).toBe(true);
    expect(document.querySelector('.emap-example-renderer-limit')?.textContent).toContain('仅 GPU');
    expect(() => getExampleRenderer()).toThrow('Canvas2D');
    window.history.replaceState(
      {},
      '',
      '/mapseekai/emap/examples/luma-vertex-editing/?renderer=webgpu',
    );
    expect(getExampleGpuBackend()).toBe('webgpu');
  });
  it('leaves engine buttons available after an invalid URL and on pages without a map', () => {
    expect(installExampleRendererToolbar()).toBeNull();
    document.body.innerHTML = '<header id="header"></header>';
    window.history.replaceState({}, '', '/mapseekai/emap/examples/buffer/?renderer=typo');
    expect(() => installExampleRendererToolbar()).not.toThrow();
    expect(document.querySelectorAll('[data-example-renderer]:enabled')).toHaveLength(3);
    expect(() => getExampleRenderer()).toThrow('renderer');
  });
});
