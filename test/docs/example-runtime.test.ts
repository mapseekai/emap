// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadExampleRuntime,
  resolveRuntimeAssets,
} from '../../packages/examples/src/example-runtime';

const integrity = {
  vendor: 'sha384-dmVuZG9y',
  core: 'sha384-Y29yZQ==',
  css: 'sha384-Y3Nz',
};

const cdnOptions = {
  mode: 'cdn' as const,
  baseUrl: '/emap/examples/',
  version: '0.5.0',
  integrity,
};

function scriptAt(index: number): HTMLScriptElement {
  const script = document.head.querySelectorAll<HTMLScriptElement>('script')[index];
  if (!script) throw new Error(`Missing script at index ${index}`);
  return script;
}

function stylesheetAt(index: number): HTMLLinkElement {
  const stylesheet =
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')[index];
  if (!stylesheet) throw new Error(`Missing stylesheet at index ${index}`);
  return stylesheet;
}

async function settleDomEvents(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  document.head.replaceChildren();
  delete (globalThis as { emap?: unknown }).emap;
});

describe('example runtime assets', () => {
  it('resolves local runtime and worker assets from the Vite base URL', () => {
    expect(resolveRuntimeAssets({ mode: 'local', baseUrl: '/emap/examples/' })).toEqual({
      vendor: '/emap/examples/vendor/mapshaper-vendor.js',
      core: '/emap/examples/vendor/emap.js',
      css: '/emap/examples/vendor/emap.css',
      worker: '/emap/examples/emap-worker.js',
      integrity: {},
    });
  });

  it('pins CDN assets to an exact version while keeping local fallbacks and worker', () => {
    expect(resolveRuntimeAssets(cdnOptions)).toEqual({
      vendor: 'https://cdn.jsdelivr.net/npm/@zwishing/emap@0.5.0/dist/mapshaper-vendor.js',
      core: 'https://cdn.jsdelivr.net/npm/@zwishing/emap@0.5.0/dist/emap.js',
      css: 'https://cdn.jsdelivr.net/npm/@zwishing/emap@0.5.0/dist/emap.css',
      worker: '/emap/examples/emap-worker.js',
      fallbackVendor: '/emap/examples/vendor/mapshaper-vendor.js',
      fallbackCore: '/emap/examples/vendor/emap.js',
      fallbackCss: '/emap/examples/vendor/emap.css',
      integrity,
    });
  });

  it('rejects floating CDN versions and missing integrity metadata', () => {
    expect(() =>
      resolveRuntimeAssets({
        ...cdnOptions,
        version: 'latest',
      }),
    ).toThrow(/exact package version/i);

    expect(() =>
      resolveRuntimeAssets({
        mode: 'cdn',
        baseUrl: '/emap/examples/',
        version: '0.5.0',
      }),
    ).toThrow(/integrity/i);
  });

  it('falls back once per CDN asset and inserts core only after vendor succeeds', async () => {
    const runtimePromise = loadExampleRuntime(cdnOptions);

    expect(document.head.querySelectorAll('script')).toHaveLength(1);
    expect(scriptAt(0).getAttribute('src')).toBe(
      'https://cdn.jsdelivr.net/npm/@zwishing/emap@0.5.0/dist/mapshaper-vendor.js',
    );
    expect(scriptAt(0).crossOrigin).toBe('anonymous');
    expect(scriptAt(0).integrity).toBe(integrity.vendor);
    expect(stylesheetAt(0).getAttribute('href')).toBe(
      'https://cdn.jsdelivr.net/npm/@zwishing/emap@0.5.0/dist/emap.css',
    );

    scriptAt(0).dispatchEvent(new Event('error'));
    await settleDomEvents();
    expect(document.head.querySelectorAll('script')).toHaveLength(2);
    expect(scriptAt(1).getAttribute('src')).toBe('/emap/examples/vendor/mapshaper-vendor.js');
    expect(scriptAt(1).hasAttribute('integrity')).toBe(false);

    scriptAt(1).dispatchEvent(new Event('load'));
    await settleDomEvents();
    expect(document.head.querySelectorAll('script')).toHaveLength(3);
    expect(scriptAt(2).getAttribute('src')).toBe(
      'https://cdn.jsdelivr.net/npm/@zwishing/emap@0.5.0/dist/emap.js',
    );

    stylesheetAt(0).dispatchEvent(new Event('error'));
    await settleDomEvents();
    expect(document.head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(2);
    expect(stylesheetAt(1).getAttribute('href')).toBe('/emap/examples/vendor/emap.css');
    stylesheetAt(1).dispatchEvent(new Event('load'));

    scriptAt(2).dispatchEvent(new Event('error'));
    await settleDomEvents();
    expect(document.head.querySelectorAll('script')).toHaveLength(4);
    expect(scriptAt(3).getAttribute('src')).toBe('/emap/examples/vendor/emap.js');

    const emap = { version: 'test' };
    (globalThis as { emap?: unknown }).emap = emap;
    scriptAt(3).dispatchEvent(new Event('load'));

    await expect(runtimePromise).resolves.toBe(emap);
    expect(document.head.querySelectorAll('script')).toHaveLength(4);
    expect(document.head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(2);
  });
});
