import {
  resolveRuntimeAssets,
  type RuntimeAssetOptions,
  type RuntimeAssetSet,
} from './runtime-assets';
import { fixtureManifest, fixtureUrl } from './fixture-manifest';

export type {
  RuntimeAssetIntegrity,
  RuntimeAssetMode,
  RuntimeAssetOptions,
  RuntimeAssetSet,
} from './runtime-assets';
export { resolveRuntimeAssets } from './runtime-assets';
export { fixtureManifest, fixtureUrl, type FixtureBinding } from './fixture-manifest';

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

function fixtureMimeType(path: string): string {
  if (path.endsWith('.geojson') || path.endsWith('.json')) return 'application/geo+json';
  if (path.endsWith('.csv')) return 'text/csv';
  if (path.endsWith('.parquet') || path.endsWith('.geoparquet')) {
    return 'application/vnd.apache.parquet';
  }
  return 'application/octet-stream';
}

function fixtureName(path: string): string {
  return path.split('/').pop() || path;
}

async function fetchFixtureFile(path: string): Promise<File> {
  const response = await fetch(fixtureUrl(path));
  if (!response.ok) {
    throw new Error(`Unable to load fixture ${path} (${response.status})`);
  }
  return new File([await response.arrayBuffer()], fixtureName(path), {
    type: fixtureMimeType(path),
  });
}

async function fillJoinDefaults(root: Document): Promise<void> {
  const csv = root.querySelector<HTMLTextAreaElement>('#csv');
  const targetKey = root.querySelector<HTMLInputElement>('#target-key');
  const sourceKey = root.querySelector<HTMLInputElement>('#source-key');
  if (!csv || !targetKey || !sourceKey) {
    throw new Error('Unable to load starter data: join controls were not found');
  }
  const response = await fetch(fixtureUrl('fixtures/task-6-join.csv'));
  if (!response.ok) {
    throw new Error(`Unable to load fixture fixtures/task-6-join.csv (${response.status})`);
  }
  csv.value = await response.text();
  if (!targetKey.value) targetKey.value = 'id';
  if (!sourceKey.value) sourceKey.value = 'id';
}

function reportStarterError(root: Document, error: unknown): Error {
  const cause = error instanceof Error ? error : new Error(String(error));
  const status = root.querySelector('#status');
  if (status) status.textContent = `Unable to load starter data: ${cause.message}`;
  return cause;
}

export async function autoLoadExampleFixtures(id: string, root: Document = document): Promise<void> {
  try {
    const bindings = fixtureManifest[id];
    if (!bindings) throw new Error(`Unknown example fixture manifest entry: ${id}`);
    if (id === 'join') await fillJoinDefaults(root);

    for (const binding of bindings) {
      const input = root.querySelector<HTMLInputElement>(binding.selector);
      if (!input || input.type !== 'file') {
        throw new Error(`File input ${binding.selector} was not found for ${id}`);
      }
      const transfer = new DataTransfer();
      const files = await Promise.all(binding.paths.map(fetchFixtureFile));
      for (const file of files) transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } catch (error) {
    throw reportStarterError(root, error);
  }
}
