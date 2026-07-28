import {
  resolveRuntimeAssets,
  type RuntimeAssetOptions,
  type RuntimeAssetSet,
} from './runtime-assets';

export type {
  RuntimeAssetIntegrity,
  RuntimeAssetMode,
  RuntimeAssetOptions,
  RuntimeAssetSet,
} from './runtime-assets';
export { resolveRuntimeAssets } from './runtime-assets';

declare global {
  var emap: typeof import('@zwishing/emap');
}

type RuntimeAssetName = 'vendor' | 'core' | 'css';

function applyIntegrity(
  element: HTMLScriptElement | HTMLLinkElement,
  integrity: string | undefined,
): void {
  if (!integrity) return;
  element.crossOrigin = 'anonymous';
  element.integrity = integrity;
}

function appendScript(url: string, integrity?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    applyIntegrity(script, integrity);
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load script: ${url}`)), {
      once: true,
    });
    document.head.append(script);
  });
}

function appendStylesheet(url: string, integrity?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = url;
    applyIntegrity(stylesheet, integrity);
    stylesheet.addEventListener('load', () => resolve(), { once: true });
    stylesheet.addEventListener(
      'error',
      () => reject(new Error(`Failed to load stylesheet: ${url}`)),
      { once: true },
    );
    document.head.append(stylesheet);
  });
}

async function loadWithFallback(
  name: RuntimeAssetName,
  primaryUrl: string,
  fallbackUrl: string | undefined,
  integrity: string | undefined,
  load: (url: string, integrity?: string) => Promise<void>,
): Promise<void> {
  try {
    await load(primaryUrl, integrity);
  } catch (error) {
    if (!fallbackUrl) throw error;
    console.warn(`Failed to load ${name} runtime asset from CDN; using local fallback.`);
    await load(fallbackUrl);
  }
}

function fallbackFor(assets: RuntimeAssetSet, name: RuntimeAssetName): string | undefined {
  switch (name) {
    case 'vendor':
      return assets.fallbackVendor;
    case 'core':
      return assets.fallbackCore;
    case 'css':
      return assets.fallbackCss;
  }
}

export async function loadExampleRuntime(
  options: RuntimeAssetOptions = {},
): Promise<typeof globalThis.emap> {
  const assets = resolveRuntimeAssets(options);
  const stylesheet = loadWithFallback(
    'css',
    assets.css,
    fallbackFor(assets, 'css'),
    assets.integrity.css,
    appendStylesheet,
  );
  const scripts = (async () => {
    await loadWithFallback(
      'vendor',
      assets.vendor,
      fallbackFor(assets, 'vendor'),
      assets.integrity.vendor,
      appendScript,
    );
    await loadWithFallback(
      'core',
      assets.core,
      fallbackFor(assets, 'core'),
      assets.integrity.core,
      appendScript,
    );
  })();

  await Promise.all([stylesheet, scripts]);
  if (!globalThis.emap) {
    throw new Error('The emap runtime loaded without exposing globalThis.emap');
  }
  return globalThis.emap;
}

export async function loadExampleFormats(): Promise<typeof import('@zwishing/emap/formats')> {
  return import('@zwishing/emap/formats');
}

export function exampleWorkerUrl(): string {
  return resolveRuntimeAssets().worker;
}
