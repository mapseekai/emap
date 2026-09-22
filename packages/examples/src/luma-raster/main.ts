import { rasterFileSelections, type RasterFileSelection } from './files';
import { loadExampleRuntime } from '../example-runtime';
import { openGeoTIFF } from '../../../../src/integrations/geotiff/source';
import { rasterPlugin } from '../../../../src/runtime/plugins/raster/plugin';
import { resolveProjectCrs } from '../../../../src/domain/geo/crs-resolver';
import { Bounds } from '../../../../src/domain/geo/bounds';
import type {
  RasterMetadata,
  RasterStyle,
  RasterSource,
} from '../../../../src/domain/raster/types';
import { validateRasterStyle } from '../../../../src/engine/rendering/raster/tile';
import {
  NumericRasterRenderer,
  supportsNumericRaster,
} from '../../../../src/integrations/luma/raster-renderer';
import { NativeRasterLayer } from './native-layer';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const host = $('map'),
  backendInput = $<HTMLSelectElement>('backend');
const initial = new URLSearchParams(location.search).get('gpu');
backendInput.value = initial === 'webgpu' ? 'webgpu' : initial === 'canvas' ? 'canvas' : 'webgl';
const emap = await loadExampleRuntime({ mode: 'local' });
const map = await emap.Emap.create({ container: 'map', preset: 'viewer' });
const fiber = map.ctx.plugin(rasterPlugin({ cacheBytes: 32 * 1024 ** 2, concurrency: 2 }));
await fiber.await();
let file: File | undefined,
  overview: File | undefined,
  source: RasterSource | null = null,
  metadata: RasterMetadata | null = null;
let native: NativeRasterLayer | null = null,
  canvas: HTMLCanvasElement | null = null,
  backend = '';
let style: RasterStyle = { stretch: 'auto', resampling: 'nearest', opacity: 1 };
let phase = 'idle',
  generation = 0,
  controller: AbortController | undefined,
  scheduled = 0,
  disposed = false;
let lastStatsAt = 0,
  lastStatsPhase = '';
let loadingStarted = 0,
  metadataMs = 0,
  firstReadyMs = 0,
  openMs = 0,
  gpuInitializationMs = 0,
  fitScale = 1,
  initialCenter: [number, number] = [0, 0],
  timer: ReturnType<typeof setTimeout> | undefined;
const errors: string[] = [];
let lastGpuStats: unknown = null;
const gestures = new Set<string>();
function interaction(key: string, active: boolean) {
  if (active) gestures.add(key);
  else gestures.delete(key);
  native?.setInteracting(gestures.size > 0);
  request();
}
function setState(value: string, text: string) {
  phase = value;
  $('status').textContent = text;
  $('status').dataset.state = value;
}
function error(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  errors.push(message);
  native?.setInteracting(true);
  setState('error', message);
}
function dimensions() {
  const r = host.getBoundingClientRect();
  return { width: r.width, height: r.height, dpr: Math.min(2, devicePixelRatio || 1) };
}
function request() {
  if (disposed || scheduled) return;
  scheduled = requestAnimationFrame(() => {
    scheduled = 0;
    draw();
  });
}
function draw() {
  if (!metadata || disposed || phase === 'loading' || phase === 'error') return;
  try {
    if (native) {
      const d = dimensions(),
        v = map.ctx.view.getTransform();
      native.update(v, d.width, d.height, d.dpr);
      native.draw(v, d.width, d.height, d.dpr, style);
    }
    const c = map.ctx.raster.getStats();
    const ready = native
      ? native.ready
      : Boolean(c.planning) &&
        !c.interacting &&
        !c.activeReads &&
        !c.queuedReads &&
        !c.pendingFrames;
    if (ready && !firstReadyMs) firstReadyMs = performance.now() - loadingStarted;
    if (phase !== 'error')
      setState(
        ready ? 'ready' : 'rendering',
        ready
          ? '当前视口高清已就绪；放大将读取更精细层级，超过原图分辨率后不再增加真实细节。'
          : '正在按新视口读取数据；已有影像保留，等待高清纹理…',
      );
    if (performance.now() - lastStatsAt >= 250 || lastStatsPhase !== phase) {
      lastStatsAt = performance.now();
      lastStatsPhase = phase;
      const stats = snapshot();
      $('stats').textContent = JSON.stringify(stats, null, 2);
      const m = stats.memory,
        mb = (v: number) => (v / 1024 ** 2).toFixed(1);
      $('memory-summary').textContent =
        `已跟踪资源（非浏览器总内存）：解码缓存 ${mb(m.sourceBlockCacheBytes)} / ${mb(m.sourceBlockCacheBudgetBytes)} MiB · GPU纹理 ${mb(m.gpuTextureBytes)} MiB · 待上传 ${mb(m.queuedSamplesBytes)} MiB · 打包暂存 ${mb(m.packingScratchBytes)} MiB`;
    }
  } catch (e) {
    error(e);
  }
}
function memorySnapshot() {
  const p = source?.getProcessingStats?.();
  return {
    scope: 'tracked-resources-not-browser-footprint',
    sourceBlockCacheBytes: p?.blockCacheBytes ?? 0,
    sourceBlockCacheBudgetBytes: p?.blockCacheLimitBytes ?? 0,
    decodeReservationBytes: p?.reservedBytes ?? 0,
    gpuTextureBytes: native?.gpu.stats.liveTextureBytes ?? 0,
    gpuTextureSoftBudgetBytes: native?.stats.cacheBudgetBytes ?? 0,
    queuedSamplesBytes: native?.stats.queuedBytes ?? 0,
    peakQueuedSamplesBytes: native?.stats.peakQueuedBytes ?? 0,
    packingScratchBytes: native?.gpu.stats.packingScratchBytes ?? 0,
    canvasRgbaPlaneEstimateBytes: [...host.querySelectorAll('canvas')].reduce(
      (n, c) => n + c.width * c.height * 4,
      0,
    ),
  };
}
function snapshot() {
  return {
    memory: memorySnapshot(),
    backend,
    crs: metadata?.crs,
    phase,
    metadataMs,
    openMs,
    gpuInitializationMs,
    firstReadyMs,
    elapsedMs: performance.now() - loadingStarted,
    level:
      native?.stats.level ?? map.ctx.get('raster')?.getStats().planning?.layers[0]?.selectedLevel,
    native: native ? { ...native.stats } : null,
    gpu: native ? { ...native.gpu.stats } : lastGpuStats,
    canvas: backend === 'canvas' ? (map.ctx.get('raster')?.getStats() ?? null) : null,
    processing: backend === 'canvas' && source ? source.getProcessingStats?.() : null,
    dimensions: dimensions(),
    sourceOpen: Boolean(source),
    errors: [...errors],
  };
}
function unload() {
  clearTimeout(timer);
  gestures.clear();
  native?.dispose();
  if (native) lastGpuStats = { ...native.gpu.stats };
  native = null;
  if (map.ctx.raster.getLayers().some((l) => l.id === 'raster')) map.ctx.raster.remove('raster');
  else source?.dispose();
  source = null;
  canvas?.remove();
  canvas = null;
  metadata = null;
}
async function load(nextFile: File, nextOverview?: File, fit = true): Promise<void> {
  controller?.abort();
  const signal = (controller = new AbortController()).signal;
  const run = ++generation;
  const camera = {
    center: map.ctx.view.getCenter(),
    scale: Math.abs(map.ctx.view.getTransform().mx),
  };
  unload();
  setState('loading', '读取 TIFF 目录、overview 和全源统计…');
  errors.length = 0;
  file = nextFile;
  overview = nextOverview;
  backend = backendInput.value;
  loadingStarted = performance.now();
  firstReadyMs = 0;
  openMs = 0;
  gpuInitializationMs = 0;
  let opening: RasterSource | null = null,
    gpu: NumericRasterRenderer | null = null;
  try {
    opening = await openGeoTIFF(nextFile, {
      overviewFile: nextOverview,
      signal,
      workerCount: 2,
      blockCacheBytes: 32 * 1024 ** 2,
      workerUrl: new URL(`${import.meta.env.BASE_URL}emap-geotiff-worker.js`, location.href),
    });
    signal.throwIfAborted();
    if (run !== generation) throw new DOMException('Stale source', 'AbortError');
    openMs = performance.now() - loadingStarted;
    const m = opening.metadata;
    if (fit) style = { ...style, bands: undefined, ranges: undefined };
    // This first data-texture path deliberately preserves the source CRS. It does
    // not fake reprojection by drawing a geographic bounding rectangle.
    await resolveProjectCrs(m.crs);
    signal.throwIfAborted();
    map.setCRS(m.crs);
    if (backend !== 'canvas') {
      if (!supportsNumericRaster(m))
        throw new Error(
          'GPU 实验路径需要 UInt8/UInt16、1–4 波段、非调色板 TIFF。请选择 Canvas 正式流程加载其他类型。',
        );
      const target = document.createElement('canvas');
      target.className = 'numeric-raster';
      host.append(target);
      canvas = target;
      const gpuStart = performance.now();
      gpu = await NumericRasterRenderer.create(target, backend as 'webgl' | 'webgpu', error);
      gpuInitializationMs = performance.now() - gpuStart;
      signal.throwIfAborted();
      if (run !== generation) throw new DOMException('Stale source', 'AbortError');
      native = new NativeRasterLayer(
        opening,
        gpu,
        request,
        error,
        new URLSearchParams(location.search).get('pipeline') === 'legacy' ? 'legacy' : 'core',
      );
      gpu = null;
    } else map.ctx.raster.addSource('raster', opening, style);
    source = opening;
    opening = null;
    metadata = m;
    metadataMs = performance.now() - loadingStarted;
    $('metadata').textContent = JSON.stringify(
      {
        filename: m.filename,
        sizeMiB: m.fileSize / 1024 ** 2,
        crs: m.crs,
        bits: m.levels[0].bits,
        noData: m.noData,
        levels: m.levels.map((l) => ({
          id: l.id,
          size: [l.width, l.height],
          blocks: [l.tileWidth, l.tileHeight],
        })),
      },
      null,
      2,
    );
    for (const id of ['red', 'green', 'blue']) {
      const select = $<HTMLSelectElement>(id);
      select.replaceChildren(
        ...Array.from(
          { length: m.levels[0].samples },
          (_, i) => new Option(String(i + 1), String(i)),
        ),
      );
    }
    $<HTMLSelectElement>('red').value = String(style.bands?.[0] ?? 0);
    $<HTMLSelectElement>('green').value = String(
      style.bands?.[1] ?? Math.min(1, m.levels[0].samples - 1),
    );
    $<HTMLSelectElement>('blue').value = String(
      style.bands?.[2] ?? Math.min(2, m.levels[0].samples - 1),
    );
    if (fit) {
      map.fitBounds(new Bounds(...m.bounds), { padding: 40, duration: 0 });
      fitScale = Math.abs(map.ctx.view.getTransform().mx);
      initialCenter = map.ctx.view.getCenter();
    } else map.ctx.view.jumpTo(camera);
    setState('rendering', '目录已打开，正在读取可见源块…');
    request();
  } catch (e) {
    opening?.dispose();
    gpu?.dispose();
    if (run === generation) {
      unload();
      if (signal.aborted) setState('idle', '加载已取消；没有修改磁盘原文件。');
      else error(e);
    }
  }
}
function setStyle(patch: RasterStyle) {
  if (!metadata) return;
  const next = { ...style, ...patch };
  validateRasterStyle(metadata, next);
  style = next;
  $<HTMLSelectElement>('stretch').value = style.stretch ?? 'auto';
  $<HTMLSelectElement>('resampling').value = style.resampling ?? 'nearest';
  $<HTMLInputElement>('opacity').value = String(style.opacity ?? 1);
  ['red', 'green', 'blue'].forEach((id, i) => {
    $<HTMLSelectElement>(id).value = String(
      style.bands?.[style.bands.length === 1 ? 0 : i] ??
        Math.min(i, metadata!.levels[0].samples - 1),
    );
  });
  if (backend === 'canvas') map.ctx.raster.setStyle('raster', style);
  request();
}
function fit() {
  if (metadata) {
    map.fitBounds(new Bounds(...metadata.bounds), { padding: 40, duration: 0 });
    request();
  }
}
const callbacks: Record<string, () => void> = {
  move: request,
  resize: request,
  interactionstart: () => {
    clearTimeout(timer);
    interaction('pointer', true);
  },
  interactionend: () => {
    clearTimeout(timer);
    timer = setTimeout(() => interaction('pointer', false), 80);
  },
  movestart: () => interaction('camera', true),
  moveend: () => interaction('camera', false),
  rastererror: () => error(new Error('Canvas 栅格处理失败，请查看浏览器控制台。')),
};
for (const [name, fn] of Object.entries(callbacks)) map.ctx.mapEvents.on(name, fn);
const interval = setInterval(() => {
  if (phase === 'rendering' || (backend === 'canvas' && source)) request();
}, 100);
let selections: readonly RasterFileSelection[] = [];
function selectFiles(files: readonly File[]) {
  try {
    selections = rasterFileSelections(files);
    $<HTMLSelectElement>('file-select').replaceChildren(
      ...selections.map((s, i) => new Option(`${s.path}${s.overview ? ' + OVR' : ''}`, String(i))),
    );
  } catch (e) {
    error(e);
  }
}
const filesInput = $<HTMLInputElement>('file-input'),
  folderInput = $<HTMLInputElement>('folder-input');
filesInput.addEventListener('change', () => selectFiles([...(filesInput.files ?? [])]));
folderInput.addEventListener('change', () => selectFiles([...(folderInput.files ?? [])]));
$('choose-folder').onclick = () => folderInput.click();
$('load').onclick = () => {
  const selected = selections[Number($<HTMLSelectElement>('file-select').value)];
  if (selected) void load(selected.file, selected.overview);
};
$('cancel').onclick = () => controller?.abort();
$('fit').onclick = fit;
$('native').onclick = () => {
  if (metadata)
    map.ctx.view.jumpTo({
      center: map.ctx.view.getCenter(),
      scale: 1 / Math.abs(metadata.resolution[0]) / dimensions().dpr,
    });
};
backendInput.onchange = () => {
  if (file) void load(file, overview, false);
};
$<HTMLSelectElement>('stretch').onchange = () =>
  setStyle({
    stretch: $<HTMLSelectElement>('stretch').value as RasterStyle['stretch'],
    ranges: undefined,
  });
$<HTMLSelectElement>('resampling').onchange = () =>
  setStyle({ resampling: $<HTMLSelectElement>('resampling').value as RasterStyle['resampling'] });
$<HTMLInputElement>('opacity').oninput = () =>
  setStyle({ opacity: Number($<HTMLInputElement>('opacity').value) });
for (const id of ['red', 'green', 'blue'])
  $<HTMLSelectElement>(id).onchange = () =>
    setStyle({
      bands: ['red', 'green', 'blue'].map((id) => Number($<HTMLSelectElement>(id).value)),
      ranges: undefined,
    });
async function settle() {
  request();
  const started = performance.now();
  let stable = 0,
    lastView = '';
  while (performance.now() - started < 120000) {
    await new Promise((r) => requestAnimationFrame(r));
    if (phase === 'error') throw new Error(errors.at(-1));
    const c = map.ctx.raster.getStats();
    const ready =
      phase !== 'loading' &&
      !gestures.size &&
      source &&
      (native
        ? native.ready
        : Boolean(c.planning) &&
          !c.activeReads &&
          !c.queuedReads &&
          !c.pendingFrames &&
          !c.interacting);
    const v = map.ctx.view.getTransform(),
      key = [v.mx, v.my, v.bx, v.by].join(':');
    stable = ready && key === lastView ? stable + 1 : 0;
    lastView = key;
    if (stable >= 8) {
      request();
      await native?.gpu.waitForIdle();
      return snapshot();
    }
  }
  throw new Error('Dynamic raster did not settle.');
}
async function capture() {
  draw();
  const target = canvas ?? host.querySelector('canvas');
  if (!target) throw new Error('No raster canvas');
  const pending = createImageBitmap(target);
  await native?.gpu.waitForIdle();
  const bitmap = await pending;
  const copy = document.createElement('canvas');
  copy.width = bitmap.width;
  copy.height = bitmap.height;
  const ctx = copy.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
  return { width: copy.width, height: copy.height, pixels };
}
function dispose() {
  if (disposed) return;
  disposed = true;
  generation++;
  controller?.abort();
  cancelAnimationFrame(scheduled);
  clearTimeout(timer);
  clearInterval(interval);
  for (const [name, fn] of Object.entries(callbacks)) map.ctx.mapEvents.off(name, fn);
  unload();
  void map.dispose();
}
window.addEventListener('pagehide', dispose, { once: true });
Object.assign(window, {
  lumaRaster: {
    load,
    settle,
    capture,
    dispose,
    setStyle,
    stats: snapshot,
    map,
    get selections() {
      return selections;
    },
    get native() {
      return native;
    },
    get source() {
      return source;
    },
    get metadata() {
      return metadata;
    },
    get state() {
      return phase;
    },
    async setBackend(value: string) {
      if (!['canvas', 'webgl', 'webgpu'].includes(value)) throw new Error('Invalid backend');
      backendInput.value = value;
      if (file) await load(file, overview, false);
    },
    setView(zoom: number, pan: [number, number] = [0, 0]) {
      map.ctx.view.jumpTo({ center: initialCenter, scale: fitScale * zoom });
      if (pan[0] || pan[1]) map.panBy(pan, { duration: 0 });
      request();
    },
  },
});
setState('idle', '选择本地 TIFF；Canvas 使用正式栅格流程，GPU 使用动态 UInt16 数据纹理。');
