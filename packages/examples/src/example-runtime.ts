import { installExampleRendererToolbar } from './renderer-choice';
import { monitorExampleMap } from './performance-render-source';
import { mapLibrePlugin } from '@mapseekai/emap/maplibre';
import * as Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import {
  resolveRuntimeAssets,
  type RuntimeAssetOptions,
  type RuntimeAssetSet,
} from './runtime-assets';
import { examples } from '../../../docs-meta/examples';
import { fixtureManifest, fixtureUrl } from './fixture-manifest';
import type { Control, Emap } from '@mapseekai/emap';
export type { RuntimeAssetOptions } from './runtime-assets';
export { resolveRuntimeAssets } from './runtime-assets';
export { fixtureManifest, fixtureUrl } from './fixture-manifest';
declare global {
  var emap: typeof import('@mapseekai/emap');
}
type RuntimeAssetName = 'vendor' | 'core' | 'css';
type ExampleUiRuntime = Pick<
  typeof globalThis.emap,
  'BasemapControl' | 'ScaleControl' | 'StatusControl'
>;
const mapsWithExampleUi = new WeakSet<Emap>();
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
  installExampleRendererToolbar();
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
function canonicalExampleCRS(crs: string): string {
  const normalized = crs.trim().toLowerCase();
  if (normalized === 'epsg:3857' || normalized === 'webmercator') return 'EPSG:3857';
  if (normalized === 'epsg:4326' || normalized === 'wgs84') return 'EPSG:4326';
  return crs;
}
function selectCurrentCRS(select: HTMLSelectElement, crs: string): void {
  const canonical = canonicalExampleCRS(crs);
  const existing = Array.from(select.options).find((option) => option.value === canonical);
  const custom = select.querySelector<HTMLOptionElement>('option[data-current-crs]');
  if (existing) {
    custom?.remove();
  } else if (custom) {
    custom.value = canonical;
    custom.textContent = canonical;
  } else {
    const option = document.createElement('option');
    option.dataset.currentCrs = '';
    option.value = canonical;
    option.textContent = canonical;
    select.prepend(option);
  }
  select.value = canonical;
}
function embeddedExampleSource(root: Document): string | null {
  const sourceElement = root.querySelector<HTMLScriptElement>('#emap-example-source');
  if (!sourceElement?.textContent) return null;
  try {
    const source: unknown = JSON.parse(sourceElement.textContent);
    return typeof source === 'string' ? source : null;
  } catch {
    return null;
  }
}
function openExampleSourceDialog(sourceText: string, root: Document): void {
  root.querySelector('.emap-example-source-dialog')?.remove();
  const dialog = root.createElement('dialog');
  dialog.className = 'emap-example-source-dialog';
  dialog.setAttribute('aria-labelledby', 'emap-example-source-title');
  const dialogHeader = root.createElement('div');
  dialogHeader.className = 'emap-example-source-header';
  const title = root.createElement('strong');
  title.id = 'emap-example-source-title';
  title.textContent = '示例源码';
  const closeButton = root.createElement('button');
  closeButton.className = 'emap-example-source-close';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '关闭源码');
  closeButton.textContent = '关闭';
  dialogHeader.append(title, closeButton);
  const source = root.createElement('pre');
  const code = root.createElement('code');
  code.className = 'language-html';
  code.innerHTML = Prism.highlight(sourceText, Prism.languages.markup, 'html');
  source.append(code);
  dialog.append(dialogHeader, source);
  root.body.append(dialog);
  closeButton.addEventListener('click', () => dialog.remove());
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}
function installExampleIntro(root: Document): void {
  if (root.body.classList.contains('example-detail')) return;
  const body = root.querySelector('.emap-example-workbench-body');
  if (!body || body.querySelector('.emap-example-lede')) return;
  const path = root.location?.pathname ?? '';
  const marker = '/examples/';
  const index = path.lastIndexOf(marker);
  if (index === -1) return;
  const id = decodeURIComponent(path.slice(index + marker.length).replace(/\/+$/, ''));
  const example = examples.find((item) => item.id === id);
  if (!example) return;
  const lede = root.createElement('p');
  lede.className = 'emap-example-lede';
  lede.textContent = example.description.zh;
  const meta = root.createElement('p');
  meta.className = 'emap-example-doc-link';
  const api = root.createElement('code');
  api.textContent = example.api[0] ?? '';
  meta.append(api);
  const doc = example.docs[0];
  if (doc) {
    meta.append(' · ');
    const link = root.createElement('a');
    link.href = `/mapseekai/emap${doc.replace(/^\/docs/, '')}`;
    link.textContent = '查看文档';
    meta.append(link);
  }
  body.prepend(lede, meta);
}

export async function installExampleMapUi(
  map: Emap,
  runtime: ExampleUiRuntime = globalThis.emap,
  root: Document = document,
): Promise<void> {
  if (mapsWithExampleUi.has(map)) return;
  if (!!!map.ctx.get('mapLibre')) await map.ctx.plugin(mapLibrePlugin);
  const header = root.querySelector<HTMLElement>('#header');
  if (!header) throw new Error('Example pages must provide a #header banner');
  installExampleIntro(root);
  mapsWithExampleUi.add(map);
  monitorExampleMap(map, root);
  const shell = installExampleRendererToolbar(root)!;
  shell.querySelector('.emap-example-context-tools')?.remove();
  const tools = root.createElement('div');
  tools.className = 'emap-example-context-tools';
  tools.setAttribute('role', 'group');
  tools.setAttribute('aria-label', 'Example source, map coordinate system, and basemap');
  const sourceText = embeddedExampleSource(root);
  if (sourceText) {
    const sourceButton = root.createElement('button');
    sourceButton.className = 'emap-example-source-button';
    sourceButton.type = 'button';
    sourceButton.setAttribute('aria-haspopup', 'dialog');
    sourceButton.textContent = '查看源码';
    sourceButton.addEventListener('click', () => openExampleSourceDialog(sourceText, root));
    tools.append(sourceButton);
  }
  const crsLabel = root.createElement('label');
  crsLabel.className = 'emap-example-crs-field';
  const crsText = root.createElement('span');
  crsText.textContent = '坐标系';
  const crsSelect = root.createElement('select');
  crsSelect.className = 'emap-example-crs-select';
  crsSelect.setAttribute('aria-label', '切换坐标系');
  crsSelect.append(new Option('EPSG:3857', 'EPSG:3857'), new Option('EPSG:4326', 'EPSG:4326'));
  crsLabel.append(crsText, crsSelect);
  const basemapState = root.createElement('span');
  basemapState.className = 'emap-example-basemap-state';
  basemapState.setAttribute('aria-live', 'polite');
  tools.append(crsLabel, basemapState);
  shell.append(tools);
  await map.addControl(
    new runtime.StatusControl({ alignment: 'right', showMousePos: true, showEPSG: true }),
    'bottom-right',
  );
  await map.addControl(new runtime.ScaleControl(), 'bottom-left');
  let basemapControl: Control | null = null;
  const syncUi = async (): Promise<void> => {
    const currentCRS = canonicalExampleCRS(map.getCRS());
    selectCurrentCRS(crsSelect, currentCRS);
    const supportsBasemap = currentCRS === 'EPSG:3857';
    if (supportsBasemap && !basemapControl) {
      basemapControl = new runtime.BasemapControl();
      await map.addControl(basemapControl, 'top-right');
    } else if (!supportsBasemap && basemapControl) {
      await map.removeControl(basemapControl);
      basemapControl = null;
    }
    basemapState.textContent = supportsBasemap ? '底图：右上角可选' : '底图：仅 EPSG:3857 可用';
  };
  map.on('crschange', () => {
    void syncUi().catch((error: unknown) => console.error(error));
  });
  crsSelect.addEventListener('change', () => {
    void (async () => {
      const targetCRS = crsSelect.value;
      crsSelect.disabled = true;
      basemapState.textContent = `正在切换到 ${targetCRS}…`;
      try {
        await map.reproject(targetCRS);
        await syncUi();
      } catch (error) {
        await syncUi();
        const message = error instanceof Error ? error.message : String(error);
        basemapState.textContent = `坐标系切换失败：${message}`;
        console.error(error);
      } finally {
        crsSelect.disabled = false;
      }
    })().catch((error: unknown) => console.error(error));
  });
  await syncUi();
}
export async function loadExampleArrow(): Promise<typeof import('@mapseekai/emap/arrow')> {
  return import('@mapseekai/emap/arrow');
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
export async function autoLoadExampleFixtures(
  id: string,
  root: Document = document,
): Promise<void> {
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
