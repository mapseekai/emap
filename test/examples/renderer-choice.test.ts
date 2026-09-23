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
});
describe('shared example renderer selection', () => {
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
