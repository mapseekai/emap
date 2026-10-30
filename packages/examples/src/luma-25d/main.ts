import {
  getExampleGpuBackend,
  getExamplePixelRatio,
  getExamplePointLodEnabled,
  getExampleFastNavigationEnabled,
  installExampleRendererToolbar,
  navigateExampleRenderer,
} from '../renderer-choice';
import type { SymbolStyle, SymbolLayout, SymbolPaint } from '../../../../src/engine/map/symbol';
import { installIconControls } from '../symbol-controls/icon-controls';
import type { IconOptions } from '../../../../src/engine/map/icon';
import { installLabelControls } from '../symbol-controls/label-controls';
import type { LabelOptions } from '../../../../src/engine/map/label';
import { loadExampleRuntime } from '../example-runtime';
import { AffineTransform } from '../../../../src/domain/geo/transform';
import { Bounds } from '../../../../src/domain/geo/bounds';
import {
  PerspectiveTransform,
  type PerspectiveOptions,
} from '../../../../src/domain/geo/perspective-transform';
import { openGeoTIFF } from '../../../../src/integrations/geotiff/source';
import type { RasterSource, RasterStyle } from '../../../../src/domain/raster/types';
import {
  NumericRasterRenderer,
  supportsNumericRaster,
} from '../../../../src/integrations/luma/raster-renderer';
import type { GpuMesh } from '../../../../src/integrations/luma/gpu-renderer';
import { NativeRasterLayer } from '../luma-raster/native-layer';
import { rasterFileSelections, type RasterFileSelection } from '../luma-raster/files';
import { BenchmarkRenderers } from '../luma-benchmark/renderers';
import { importBenchmarkFile } from '../luma-benchmark/import-file';
import { vectorScene, type Scene } from '../luma-benchmark/scene';
import { calibrationRaster, calibrationScene } from './demo';
import { installNavigation } from './navigation';
import './style.css';

let labelControls: ReturnType<typeof installLabelControls> | null = null;
let iconControls: ReturnType<typeof installIconControls> | null = null;

const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element ${id}`);
  return node as T;
};
const stage = el('stage'),
  glCanvas = el<HTMLCanvasElement>('webgl');
installExampleRendererToolbar();
const backend = getExampleGpuBackend();
el<HTMLSelectElement>('backend').value = backend;
const lifetime = new AbortController(),
  events = { signal: lifetime.signal };
const errors: string[] = [];
let width = Math.max(1, stage.clientWidth),
  height = Math.max(1, stage.clientHeight),
  dpr = getExamplePixelRatio();
let view = new PerspectiveTransform(
  new AffineTransform(1, -1, width / 2, height / 2),
  width,
  height,
  { pitch: 50, bearing: -25 },
);
let scene: Scene | null = null,
  native: NativeRasterLayer | null = null,
  rasterCanvas: HTMLCanvasElement | null = null;
let sceneCrs = '',
  crs = '',
  probe: GpuMesh | null = null,
  probePosition: [number, number] | null = null;
let scheduled = 0,
  disposed = false,
  busy = false,
  phase = 'loading',
  fatal = false;
let loading: AbortController | null = null;
let selections: readonly RasterFileSelection[] = [];
let importMs = 0,
  loadMs = 0;
let lastRasterStats: unknown = null;
let style: RasterStyle = { stretch: 'auto', resampling: 'nearest', opacity: 1 };
function status(state: string, text: string): void {
  phase = state;
  el('status').dataset.state = state;
  el('status').textContent = text;
}
function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  errors.push(message);
  fatal = true;
  status('error', message);
  native?.setInteracting(true);
}
function request(): void {
  if (disposed || scheduled) return;
  scheduled = requestAnimationFrame(() => {
    scheduled = 0;
    draw();
  });
}
await loadExampleRuntime({ mode: 'local' }).catch((error) => {
  fail(error);
  throw error;
});
const renderers = await BenchmarkRenderers.create(
  el<HTMLCanvasElement>('canvas2d'),
  glCanvas,
  () => fail(new Error('GPU 上下文已恢复，请重新加载数据。')),
  fail,
  request,
  backend,
);
if (!renderers.gpu) throw new Error(renderers.unavailableReason ?? 'GPU initialization failed');
renderers.setScreenFilters(false, false);
el<HTMLInputElement>('point-lod-enabled').checked = getExamplePointLodEnabled();
renderers.setPointLod(getExamplePointLodEnabled());
el<HTMLInputElement>('fast-nav').checked = getExampleFastNavigationEnabled();
renderers.navigation.setEnabled(getExampleFastNavigationEnabled());
renderers.setPointStyle(3, 1);
renderers.show('luma');
labelControls = installLabelControls(
  document.querySelector<HTMLElement>('.layout > aside')!,
  renderers,
  request,
);
iconControls = installIconControls(
  document.querySelector<HTMLElement>('.layout > aside')!,
  renderers,
  request,
);
renderers.resize(width, height, dpr);
function syncControls(): void {
  el<HTMLInputElement>('pitch').value = String(view.pitch);
  el('pitch-value').textContent = `${view.pitch.toFixed(0)}°`;
  el<HTMLInputElement>('bearing').value = String(view.bearing);
  el('bearing-value').textContent = `${view.bearing.toFixed(0)}°`;
}
function snapshot() {
  return {
    phase,
    backend,
    crs,
    pitch: view.pitch,
    bearing: view.bearing,
    center: view.center,
    scale: view.mx,
    width,
    height,
    dpr,
    vector: renderers.lodStats,
    pointLod: renderers.pointLodStats,
    screen: renderers.screenFilterStats,
    navigation: renderers.navigation.stats,
    preparation: {
      importMs,
      loadMs,
      geometryMs: renderers.buildMs,
      uploadSubmitMs: renderers.uploadSubmitMs,
    },
    gpu: renderers.gpu?.stats,
    native: native?.stats ?? null,
    rasterGpu: native?.gpu.stats ?? lastRasterStats,
    source: native?.source.metadata.filename ?? scene?.name ?? null,
    errors: [...errors],
  };
}
function draw(exact = false): void {
  labelControls?.refresh();
  iconControls?.refresh();
  if (disposed || fatal) return;
  try {
    if (native) {
      native.update(view, width, height, dpr);
      native.draw(view, width, height, dpr, style);
    }
    const overlay = () => {
      if (probe) renderers.gpu!.drawMesh(probe, { color: [0.88, 0.14, 0.12, 1], radius: 7 });
    };
    if (scene) renderers.drawInteractive('luma', view, overlay, !exact);
    else if (renderers.gpu!.begin(view)) {
      overlay();
      renderers.gpu!.end();
    }
    const pendingVector =
      renderers.lodStats.pending ||
      renderers.lodStats.missingChunks ||
      renderers.screenFilterStats.pending ||
      renderers.pointLodStats.pending;
    if (!busy)
      status(
        (native && !native.ready) || pendingVector ? 'rendering' : 'ready',
        (native && !native.ready) || pendingVector
          ? '按当前视口更新矢量显示缓存与影像瓦片…'
          : `${crs || '未加载数据'} · ${scene?.name ?? ''}${native ? ' · ' + native.source.metadata.filename : ''}`,
      );
    el('crs').textContent = crs || '未加载数据';
    if (el('stats').parentElement?.hasAttribute('open'))
      el('stats').textContent = JSON.stringify(snapshot(), null, 2);
  } catch (error) {
    fail(error);
  }
}
function clearProbe(): void {
  if (probe) renderers.gpu!.destroyMesh(probe);
  probe = null;
  probePosition = null;
}
function clearVector(): void {
  renderers.clear();
  scene?.dispose();
  scene = null;
  sceneCrs = '';
  clearProbe();
}
function clearRaster(): void {
  if (native) {
    native.dispose();
    lastRasterStats = { ...native.gpu.stats };
  }
  native = null;
  rasterCanvas?.remove();
  rasterCanvas = null;
}
function clearSources(): void {
  clearVector();
  clearRaster();
  crs = '';
}
function fit(bounds?: Bounds): void {
  let b = bounds?.clone();
  if (!b) {
    b = new Bounds();
    if (scene) b.merge(scene.bounds);
    if (native) b.merge(new Bounds(...native.source.metadata.bounds));
  }
  if (!b.hasBounds()) return;
  if (!b.width || !b.height) {
    const pad = Math.max(b.width, b.height, 1) * 0.05;
    b = new Bounds(b.xmin - pad, b.ymin - pad, b.xmax + pad, b.ymax + pad);
  }
  const flat = AffineTransform.fromBounds(
    b.clone().fillOut(width / height),
    new Bounds(24, 24, width - 24, height - 24),
    true,
  );
  view = new PerspectiveTransform(flat, width, height, {
    pitch: view.pitch,
    bearing: view.bearing,
  });
  for (let i = 0; i < 40; i++) {
    const corners = [
      [b.xmin, b.ymin],
      [b.xmin, b.ymax],
      [b.xmax, b.ymin],
      [b.xmax, b.ymax],
    ].map(([x, y]) => view.project(x, y));
    if (
      corners.every(
        ([x, y]) =>
          Number.isFinite(x + y) && x >= 20 && x <= width - 20 && y >= 20 && y <= height - 20,
      )
    )
      break;
    view.scale(0.88, width / 2, height / 2);
  }
  request();
}
function applyPose(options: PerspectiveOptions): void {
  view.setOrientation(options);
  syncControls();
  request();
}
function checkCrs(next: string, keep: boolean): void {
  if (keep && crs && next.trim().toUpperCase() !== crs.trim().toUpperCase())
    throw new Error(`无法叠加 ${next} 与 ${crs}：此路径不自动重投影，请取消“叠加”或先转换坐标系。`);
}
async function runLoad(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
  loading?.abort();
  const controller = new AbortController();
  loading = controller;
  busy = true;
  fatal = false;
  status('loading', '准备数据…');
  for (const id of ['demo', 'file-input', 'load-raster', 'keep'])
    el<HTMLButtonElement>(id).disabled = true;
  try {
    await operation(controller.signal);
    controller.signal.throwIfAborted();
  } catch (error) {
    if (!controller.signal.aborted) fail(error);
  } finally {
    if (loading === controller) {
      busy = false;
      loading = null;
      native?.setInteracting(false);
      for (const id of ['demo', 'file-input', 'load-raster', 'keep'])
        el<HTMLButtonElement>(id).disabled = false;
      request();
    }
  }
}
async function createRaster(
  source: RasterSource,
  signal: AbortSignal,
): Promise<{ layer: NativeRasterLayer; canvas: HTMLCanvasElement }> {
  let gpu: NumericRasterRenderer | null = null;
  const canvas = document.createElement('canvas');
  canvas.className = 'numeric-raster';
  stage.insertBefore(canvas, glCanvas);
  try {
    if (!supportsNumericRaster(source.metadata))
      throw new Error('2.5D 栅格暂支持 UInt8/UInt16、1–4 波段、非调色板 TIFF。');
    gpu = await NumericRasterRenderer.create(canvas, backend, fail);
    signal.throwIfAborted();
    return { layer: new NativeRasterLayer(source, gpu, request, fail), canvas };
  } catch (error) {
    gpu?.dispose();
    canvas.remove();
    throw error;
  }
}
async function loadDemo(): Promise<void> {
  await runLoad(async (signal) => {
    const next = await calibrationScene(signal);
    signal.throwIfAborted();
    const source = calibrationRaster();
    const prepared = await createRaster(source, signal).catch((error) => {
      source.dispose();
      throw error;
    });
    try {
      clearSources();
      scene = next;
      sceneCrs = crs = 'EPSG:3857';
      native = prepared.layer;
      rasterCanvas = prepared.canvas;
      style = { stretch: 'auto', resampling: 'nearest', opacity: 1 };
      el<HTMLInputElement>('bilinear').checked = false;
      fit();
      await renderers.prepare(next, signal, view);
      signal.throwIfAborted();
    } catch (error) {
      if (scene === next) clearVector();
      if (native === prepared.layer) clearRaster();
      else {
        prepared.layer.dispose();
        prepared.canvas.remove();
      }
      crs = native?.source.metadata.crs ?? sceneCrs;
      throw error;
    }
  });
}
async function loadVector(file: File): Promise<void> {
  await runLoad(async (signal) => {
    const started = performance.now(),
      keep = el<HTMLInputElement>('keep').checked;
    // Match the benchmark's replacement ownership: do not retain two large datasets.
    if (!keep) clearSources();
    else {
      clearVector();
      crs = native?.source.metadata.crs ?? '';
    }
    importMs = loadMs = 0;
    let imported: Awaited<ReturnType<typeof importBenchmarkFile>> | null = null;
    try {
      imported = await importBenchmarkFile(file, signal, (text) => status('loading', text));
      signal.throwIfAborted();
      importMs = performance.now() - started;
      const next = vectorScene(imported.dataset, file.name),
        worker = imported.source;
      const nextCrs = imported.dataset.info?.crs_string ?? 'EPSG:4326';
      checkCrs(nextCrs, keep);
      next.lodSource = worker;
      next.dispose = () => worker.close();
      worker.setBounds([next.bounds.xmin, next.bounds.ymin, next.bounds.xmax, next.bounds.ymax]);
      scene = next;
      sceneCrs = crs = nextCrs;
      fit();
      const cancelPreparation = () => worker.close(signal.reason);
      signal.addEventListener('abort', cancelPreparation, { once: true });
      try {
        await renderers.prepare(next, signal, view, (text) => status('loading', text), {
          preload: 'visible',
        });
      } finally {
        signal.removeEventListener('abort', cancelPreparation);
      }
      loadMs = performance.now() - started;
      signal.throwIfAborted();
      imported = null;
    } finally {
      if (imported) {
        if (scene?.lodSource === imported.source) clearVector();
        imported.source.close();
        crs = native?.source.metadata.crs ?? sceneCrs;
      }
    }
  });
}
async function loadRaster(selection: RasterFileSelection): Promise<void> {
  await runLoad(async (signal) => {
    let source: RasterSource | null = null,
      prepared: Awaited<ReturnType<typeof createRaster>> | null = null;
    try {
      source = await openGeoTIFF(selection.file, {
        overviewFile: selection.overview,
        signal,
        workerCount: 2,
        blockCacheBytes: 32 * 1024 ** 2,
        workerUrl: new URL(`${import.meta.env.BASE_URL}emap-geotiff-worker.js`, location.href),
      });
      signal.throwIfAborted();
      const nextCrs = source.metadata.crs,
        keep = el<HTMLInputElement>('keep').checked;
      checkCrs(nextCrs, keep);
      prepared = await createRaster(source, signal);
      source = null;
      if (!keep) clearSources();
      else clearRaster();
      native = prepared.layer;
      rasterCanvas = prepared.canvas;
      prepared = null;
      crs = nextCrs;
      style = {
        stretch: 'auto',
        resampling: el<HTMLInputElement>('bilinear').checked ? 'bilinear' : 'nearest',
        opacity: 1,
      };
      fit();
    } finally {
      source?.dispose();
      if (prepared) {
        prepared.layer.dispose();
        prepared.canvas.remove();
      }
    }
  });
}
function pick(x: number, y: number): void {
  const p = view.unproject(x, y);
  if (!p.every(Number.isFinite)) return;
  clearProbe();
  probePosition = p;
  const hx = Math.fround(p[0]),
    hy = Math.fround(p[1]);
  probe = renderers.gpu!.createMesh({
    kind: 'point',
    count: 1,
    vertices: Float32Array.from([hx, hy, p[0] - hx, p[1] - hy]),
  });
  el('coordinates').textContent = `${crs || '源坐标'}\nX ${p[0].toFixed(8)}\nY ${p[1].toFixed(8)}`;
  request();
}
const removeNavigation = installNavigation(
  stage,
  () => view,
  () => {
    syncControls();
    request();
  },
  (active) => {
    native?.setInteracting(active);
    renderers.setInteracting(active);
    request();
  },
  pick,
);
function resize(): void {
  const w = Math.max(1, stage.clientWidth),
    h = Math.max(1, stage.clientHeight),
    pr = getExamplePixelRatio();
  if (w === width && h === height && pr === dpr) return;
  width = w;
  height = h;
  dpr = pr;
  view.resize(w, h);
  renderers.resize(w, h, pr);
  request();
}
const observer = new ResizeObserver(resize);
observer.observe(stage);
window.addEventListener('resize', resize, events);
el('stats').parentElement?.addEventListener('toggle', request, events);
el('point-lod-enabled').addEventListener(
  'change',
  () => {
    renderers.setPointLod(el<HTMLInputElement>('point-lod-enabled').checked);
    renderers.navigation.reset();
    request();
  },
  events,
);
el('screen-filters').addEventListener(
  'change',
  () => {
    const enabled = el<HTMLInputElement>('screen-filters').checked;
    renderers.setScreenFilters(enabled, enabled);
    request();
  },
  events,
);
el('fast-nav').addEventListener(
  'change',
  () => {
    renderers.navigation.setEnabled(el<HTMLInputElement>('fast-nav').checked);
    request();
  },
  events,
);

el('pitch').addEventListener(
  'input',
  () => applyPose({ pitch: Number(el<HTMLInputElement>('pitch').value) }),
  events,
);
el('bearing').addEventListener(
  'input',
  () => applyPose({ bearing: Number(el<HTMLInputElement>('bearing').value) }),
  events,
);
el('flat').addEventListener('click', () => applyPose({ pitch: 0, bearing: 0 }), events);
el('perspective').addEventListener('click', () => applyPose({ pitch: 50, bearing: -25 }), events);
el('fit').addEventListener('click', () => fit(), events);
el('demo').addEventListener('click', () => void loadDemo(), events);
el('bilinear').addEventListener(
  'change',
  () => {
    style = {
      ...style,
      resampling: el<HTMLInputElement>('bilinear').checked ? 'bilinear' : 'nearest',
    };
    request();
  },
  events,
);
el('file-input').addEventListener(
  'change',
  () => {
    const file = el<HTMLInputElement>('file-input').files?.[0];
    if (file) void loadVector(file);
  },
  events,
);
function selectRasters(id: string): void {
  try {
    selections = rasterFileSelections(Array.from(el<HTMLInputElement>(id).files ?? []));
    el<HTMLSelectElement>('raster-select').replaceChildren(
      ...selections.map((s, i) => new Option(s.path, String(i))),
    );
    if (!selections.length) status('ready', '文件夹中没有可加载的 TIFF。');
  } catch (error) {
    fail(error);
  }
}
for (const id of ['raster-file', 'raster-folder'])
  el(id).addEventListener('change', () => selectRasters(id), events);
el('load-raster').addEventListener(
  'click',
  () => {
    const selected = selections[Number(el<HTMLSelectElement>('raster-select').value)];
    if (selected) void loadRaster(selected);
  },
  events,
);
el('cancel').addEventListener(
  'click',
  () => {
    loading?.abort();
    status('ready', '已取消加载。');
  },
  events,
);
el('clear').addEventListener(
  'click',
  () => {
    loading?.abort();
    clearSources();
    fatal = false;
    request();
  },
  events,
);
el('backend').addEventListener(
  'change',
  () => {
    navigateExampleRenderer(
      el<HTMLSelectElement>('backend').value === 'webgpu' ? 'webgpu' : 'webgl2',
    );
  },
  events,
);
const bitmap = document.createElement('canvas');
bitmap.width = bitmap.height = 64;
const bitmapContext = bitmap.getContext('2d')!;
for (const [x, y, color] of [
  [0, 0, '#f04040'],
  [32, 0, '#40c060'],
  [0, 32, '#4080e0'],
  [32, 32, '#e0b040'],
] as const) {
  bitmapContext.fillStyle = color;
  bitmapContext.fillRect(x, y, 32, 32);
}
function dispose(): void {
  labelControls?.dispose();
  labelControls = null;
  iconControls?.dispose();
  iconControls = null;
  if (disposed) return;
  disposed = true;
  loading?.abort();
  lifetime.abort();
  observer.disconnect();
  removeNavigation();
  cancelAnimationFrame(scheduled);
  scheduled = 0;
  clearProbe();
  clearRaster();
  scene?.dispose();
  scene = null;
  renderers.dispose();
  bitmap.width = bitmap.height = 0;
}
window.addEventListener('pagehide', dispose, { once: true });
// Diagnostics for browser regression tests and interactive inspection, not the production Emap API.
Object.assign(window, {
  luma25d: {
    get labelStats() {
      return renderers.labelStats;
    },
    get labelPlacements() {
      return renderers.labelPlacements;
    },
    get layers() {
      return renderers.getLayers();
    },
    setLayerSymbol: (id: string, symbol: SymbolStyle | null) =>
      renderers.setLayerSymbol(id, symbol),
    setSymbolLayoutProperty: <K extends keyof SymbolLayout>(
      id: string,
      name: K,
      value: SymbolLayout[K] | null,
    ) => renderers.setSymbolLayoutProperty(id, name, value),
    setSymbolPaintProperty: <K extends keyof SymbolPaint>(
      id: string,
      name: K,
      value: SymbolPaint[K] | null,
    ) => renderers.setSymbolPaintProperty(id, name, value),
    setLayerLabel: (id: string, options: LabelOptions | null) =>
      renderers.setLayerLabel(id, options),
    setLayerIcon: (id: string, options: IconOptions | null) => renderers.setLayerIcon(id, options),
    get iconStats() {
      return renderers.iconStats;
    },
    settleIcons: () => renderers.settleIcons(),
    setLayerVisibility: (id: string, value: 'visible' | 'none') =>
      renderers.setLayerVisibility(id, value),
    settleLabels: () => renderers.settleLabels(),

    get state() {
      return phase;
    },
    get snapshot() {
      return snapshot();
    },
    get sceneCrs() {
      return sceneCrs;
    },
    get probe() {
      return probePosition;
    },
    project: (x: number, y: number) => view.project(x, y),
    unproject: (x: number, y: number) => view.unproject(x, y),
    setPose: applyPose,
    pan: (dx: number, dy: number, x?: number, y?: number) => {
      view.pan(dx, dy, x, y);
      request();
    },
    zoom: (k: number, x = width / 2, y = height / 2) => {
      view.scale(k, x, y);
      request();
    },
    fit,
    draw: () => draw(true),
    loadDemo,
    dispose,
    drawCalibrationImage: (clip?: readonly [number, number, number, number]) => {
      const gpu = renderers.gpu!;
      renderers.navigation.reset();
      gpu.begin(view);
      gpu.drawImage(bitmap, [13000000, 4000000, 13010000, 4010000], 1, false, clip, true);
      gpu.end();
    },
    setOpacity: (opacity: number) => {
      if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
        throw new Error('Invalid opacity');
      style = { ...style, opacity };
      request();
    },
    setVectorVisible: (visible: boolean) => {
      glCanvas.hidden = !visible;
    },
  },
});
syncControls();
await loadDemo();
