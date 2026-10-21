import {
  getExampleRenderer,
  getExampleGpuBackend,
  installExampleRendererToolbar,
  navigateExampleRenderer,
  syncExampleRendererToolbar,
} from '../renderer-choice';
import type { SymbolStyle, SymbolLayout, SymbolPaint } from '../../../../src/engine/map/symbol';
import type { IconOptions } from '../../../../src/engine/map/icon';
import type { LabelOptions } from '../../../../src/engine/map/label';
import { loadExampleRuntime } from '../example-runtime';
import { AffineTransform } from '../../../../src/domain/geo/transform';
import { Bounds } from '../../../../src/domain/geo/bounds';
import type { MapshaperDataset } from '../../../../src/shared/types/mapshaper-types';
import { rasterScene, vectorScene, type Scene } from './scene';
import { importBenchmarkFile } from './import-file';
import { BenchmarkRenderers, type Backend } from './renderers';
import { animationTick, navigationFrame, summarize, type Samples } from './metrics';
import './style.css';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing benchmark element: ${id}`);
  return node as T;
};
const status = el('status');
const stage = el('stage');
const selector = el<HTMLSelectElement>('backend');
const cancel = el<HTMLButtonElement>('cancel');
let scene: Scene | null = null;
let transform = new AffineTransform();
let width = 1,
  height = 1,
  dpr = 1,
  scheduled = 0;
let loading: AbortController | null = null;
let running: AbortController | null = null;
let disposed = false;
let report: Record<string, unknown> | null = null;
let previousLoad: Promise<void> = Promise.resolve();
let preparation: Record<string, unknown> = {};
installExampleRendererToolbar();
let backend: Backend = getExampleRenderer() === 'canvas2d' ? 'canvas' : 'luma';
function setStatus(message: string, state: string) {
  status.textContent = message;
  status.dataset.state = state;
}
function lock(busy: boolean) {
  for (const input of document.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLSelectElement
  >('[data-lock]'))
    input.disabled = busy;
  if (!renderers.gpu) {
    el<HTMLButtonElement>('compare').disabled = true;
    el<HTMLButtonElement>('compare-screen').disabled = true;
    selector.querySelector<HTMLOptionElement>('option[value="luma"]')!.disabled = true;
  }
  cancel.disabled = !busy;
}
let invalidatePreviewOnError: () => void = () => {};
function fail(error: unknown) {
  invalidatePreviewOnError();
  running?.abort();
  setStatus(error instanceof Error ? error.message : String(error), 'error');
}
let screenFilterUpdating = false;
const requestedGpu = getExampleGpuBackend();
const renderers = await BenchmarkRenderers.create(
  el<HTMLCanvasElement>('canvas2d'),
  el<HTMLCanvasElement>('webgl'),
  () => {
    running?.abort();
    const current = scene;
    if (!current || disposed) return;
    const controller = new AbortController();
    loading?.abort();
    loading = controller;
    lock(true);
    void renderers
      .prepare(current, controller.signal, transform)
      .then(() => {
        if (loading !== controller || disposed) return;
        loading = null;
        lock(false);
        draw();
        setStatus('WebGL 上下文已恢复，缓存已重建；请重新压测。', 'ready');
      })
      .catch((error) => {
        if (!controller.signal.aborted) fail(error);
      });
  },
  fail,
  () => requestDraw(),
  requestedGpu,
);
if (!renderers.gpu) {
  backend = 'canvas';
  syncExampleRendererToolbar('canvas2d');
  el('gpu-warning').textContent =
    `所选 GPU 后端不可用：${renderers.unavailableReason}。未伪装回退为 luma。`;
}

invalidatePreviewOnError = () => {
  renderers.navigation.reset();
  renderers.setInteracting(false);
};
const fastNavToggle = el<HTMLInputElement>('fast-nav'),
  pathCullingToggle = el<HTMLInputElement>('path-culling');
renderers.navigation.setEnabled(new URLSearchParams(location.search).get('nav') !== 'off');
renderers.pathCullingEnabled = new URLSearchParams(location.search).get('cull') !== 'off';
fastNavToggle.checked = renderers.navigation.enabled;
pathCullingToggle.checked = renderers.pathCullingEnabled;
function refreshNavigation(): void {
  const n = renderers.navigation.stats,
    g = renderers.lodStats;
  el('navigation-info').textContent =
    `${n.active ? '快照导航 / 等待新画面' : n.pending ? '等待几何重绘画面' : renderers.screenFilterApplied ? '几何重绘 / Canvas 描边过滤' : '原始几何画面'} · 快照帧 ${n.previewFrames} · 完整更新 ${n.fullRedraws} · 最近提交 ${n.lastSubmitMs.toFixed(1)} ms / 更新就绪 ${n.lastRefreshMs.toFixed(1)} ms · 路径候选 ${g.candidateSegments.toLocaleString()} / 提交 ${g.submittedSegments.toLocaleString()} / 屏幕外过滤 ${g.culledSegments.toLocaleString()} 条线段${n.captureErrors ? ' · 快照不可用，已停止快照复用' : ''}`;
}
renderers.navigation.onChange = refreshNavigation;
fastNavToggle.addEventListener('change', () => {
  renderers.navigation.setEnabled(fastNavToggle.checked);
  requestDraw();
});
pathCullingToggle.addEventListener('change', () => {
  renderers.pathCullingEnabled = pathCullingToggle.checked;
  renderers.navigation.reset();
  requestDraw();
});

const smallArcToggle = el<HTMLInputElement>('small-arc-filter'),
  halfPixelToggle = el<HTMLInputElement>('half-pixel-filter');
const filterParams = new URLSearchParams(location.search);
renderers.setScreenFilters(
  filterParams.get('screenFilter') !== 'off' && filterParams.get('smallArcs') !== 'off',
  filterParams.get('screenFilter') !== 'off' && filterParams.get('halfPixel') !== 'off',
);
smallArcToggle.checked = renderers.smallArcFilterEnabled;
halfPixelToggle.checked = renderers.halfPixelFilterEnabled;
async function setScreenFilters(smallArcs: boolean, halfPixel: boolean): Promise<void> {
  if (loading || running || screenFilterUpdating || pointLodUpdating)
    throw new Error('请等待当前任务结束。');
  renderers.setScreenFilters(smallArcs, halfPixel);
  smallArcToggle.checked = smallArcs;
  halfPixelToggle.checked = halfPixel;
  report = null;
  el('results').replaceChildren();
  if (!scene) {
    refreshCounters();
    return;
  }
  screenFilterUpdating = true;
  lock(true);
  const current = scene;
  try {
    await renderers.warmScreenPaths(transform, new AbortController().signal);
    if (!disposed && scene === current) draw();
  } finally {
    screenFilterUpdating = false;
    if (!disposed && !loading) lock(false);
  }
}
for (const control of [smallArcToggle, halfPixelToggle])
  control.addEventListener('change', () => {
    void setScreenFilters(smallArcToggle.checked, halfPixelToggle.checked).catch(fail);
  });
const gpuSelector = el<HTMLSelectElement>('gpu-backend');
gpuSelector.value = requestedGpu;
gpuSelector.addEventListener('change', () =>
  navigateExampleRenderer(gpuSelector.value === 'webgpu' ? 'webgpu' : 'webgl2'),
);
const passSelector = el<HTMLSelectElement>('pass-mode');
passSelector.addEventListener('change', () => {
  renderers.passMode = passSelector.value as import('./renderers').PassMode;
  requestDraw();
});
selector.querySelector<HTMLOptionElement>('option[value="luma"]')!.textContent =
  requestedGpu === 'webgpu' ? 'luma / WebGPU' : 'luma / WebGL2';
selector.value = backend;
renderers.show(backend);
el('device').textContent = renderers.gpu
  ? JSON.stringify(renderers.gpu.deviceInfo)
  : 'Canvas2D only';
function fit() {
  if (!scene) return;
  const bounds = scene.bounds.clone().fillOut(width / height);
  const padding = Math.min(24, width * 0.05, height * 0.05);
  transform = AffineTransform.fromBounds(
    bounds,
    new Bounds(padding, padding, width - padding, height - padding),
    true,
  );
}
function refreshCounters() {
  const stats = renderers.gpu?.stats;
  el('resources').textContent = stats
    ? `几何 Buffer ${(stats.liveBufferBytes / 1024 ** 2).toFixed(2)} MiB · 图像 Texture ${(stats.liveTextureBytes / 1024 ** 2).toFixed(2)} MiB / ${stats.liveTextures} 张 · 累计几何上传 ${stats.uploads} 次 · 纹理上传 ${stats.textureUploads} 次 · Draw calls ${stats.drawCalls}`
    : 'GPU 不可用';
  const screen = renderers.screenFilterStats;
  el('screen-filter-info').textContent =
    `描边屏幕过滤 ${screen.smallArcs || screen.halfPixel ? '开启' : '关闭'} / 当前帧 ${screen.applied ? '已应用' : '原始 GPU 几何'} · 微小 arc ${screen.tinyArcs.toLocaleString()} · 连续重复顶点 ${screen.duplicateVertices.toLocaleString()} · 塌缩短线 ${screen.collapsedArcs.toLocaleString()} · 过滤后线段 ${screen.outputSegments.toLocaleString()} · 待准备 ${screen.pending} · 准备 ${screen.buildWallMs.toFixed(1)} ms · 缓存 ${(screen.cacheBytes / 1024 ** 2).toFixed(1)} MiB · 原始回退块 ${screen.rawFallbackChunks}`;
  const lod = renderers.lodStats;
  const pointLod = renderers.pointLodStats;
  el('geometry-mode').textContent =
    screen.smallArcs || screen.halfPixel
      ? '原始数据 / 描边 Canvas 屏幕过滤'
      : pointLod.enabled
        ? `点 LOD · ${pointLod.cellSize} CSS px / 线面全精度`
        : 'FULL · 点线面均为原始几何';
  el('lod-info').textContent =
    `${screen.applied ? '描边已做 Canvas 屏幕过滤 / 填充保持原始' : lod.geometryMode === 'point-lod' ? '点网格代表 / 线面原始' : '当前原始几何'} · 点聚合 ${pointLod.enabled ? pointLod.cellSize + ' CSS px' : '关闭'} · 聚合待更新 ${pointLod.pending} · 聚合缓存 ${(pointLod.cacheBytes / 1024 ** 2).toFixed(2)} MiB · 可见分块 ${lod.visibleChunks}/${lod.totalChunks} · 可见块顶点 ${lod.displayVertices.toLocaleString()} · 原始顶点 ${lod.sourceVertices.toLocaleString()} · 缺失块 ${lod.missingChunks} · 待加载 ${lod.pending} · CPU+GPU 几何估算 ${(lod.cacheBytes / 1024 ** 2).toFixed(1)} MiB · 线模式 ${renderers.gpu?.pathMode ?? 'canvas'}（MSAA ${renderers.gpu?.pathRendering.samples ?? 0}） · 当前帧 draw calls ${lod.frameDrawCalls}`;
}

function draw() {
  if (!scene || disposed) return;
  try {
    const ms = renderers.drawInteractive(backend, transform);
    el('active-renderer').textContent =
      backend === 'luma' ? (renderers.gpu?.label ?? 'GPU 不可用') : 'Canvas2D / 原始 CanvasPainter';
    el('last-frame').textContent = renderers.navigation.stats.active
      ? '快照变换 · 本帧未提交原始几何'
      : `${ms.toFixed(2)} ms · 主线程绘制/提交（非 GPU 执行时间）`;
    refreshCounters();
    refreshNavigation();
  } catch (error) {
    fail(error);
  }
}
function requestDraw() {
  if (scheduled || running || loading || disposed) return;
  scheduled = requestAnimationFrame(() => {
    scheduled = 0;
    draw();
  });
}
function resize() {
  const rect = stage.getBoundingClientRect();
  const nextDpr = window.devicePixelRatio || 1;
  const nextWidth = Math.max(1, Math.floor(rect.width));
  const nextHeight = Math.max(1, Math.floor(rect.height));
  if (nextWidth === width && nextHeight === height && nextDpr === dpr) return;
  running?.abort(new Error('窗口尺寸变化，压测已取消。'));
  width = nextWidth;
  height = nextHeight;
  dpr = nextDpr;
  renderers.resize(width, height, dpr);
  fit();
  requestDraw();
}
const observer = new ResizeObserver(resize);
observer.observe(stage);
window.addEventListener('resize', resize);
resize();
async function load(create: (signal: AbortSignal) => Promise<Scene>) {
  running?.abort();
  loading?.abort();
  const controller = new AbortController();
  loading = controller;
  lock(true);
  setStatus('正在准备同一份数据和 GPU 缓存…', 'loading');
  report = null;
  el('results').replaceChildren();
  // Do not retain two huge native datasets while importing the next local file.
  renderers.clear();
  scene?.dispose();
  scene = null;
  const previous = previousLoad;
  let release!: () => void;
  previousLoad = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  let next: Scene | null = null;
  try {
    controller.signal.throwIfAborted();
    next = await create(controller.signal);
    controller.signal.throwIfAborted();
    scene = next;
    fit();
    const abortPreparation = () => next?.lodSource?.close(controller.signal.reason);
    controller.signal.addEventListener('abort', abortPreparation, { once: true });
    try {
      await renderers.prepare(next, controller.signal, transform, (message) =>
        setStatus(message, 'loading'),
      );
    } finally {
      controller.signal.removeEventListener('abort', abortPreparation);
    }
    controller.signal.throwIfAborted();
    renderers.show('canvas');
    const firstCanvas = renderers.draw('canvas', transform);
    let firstLuma: number | null = null;
    if (renderers.gpu) {
      renderers.show('luma');
      firstLuma = renderers.draw('luma', transform);
    }
    preparation = {
      datasetPreparationMs: next.preparationMs,
      geometryPreparationWallMs: renderers.buildMs,
      workerGeometryBuildMs: next.lodSource?.workerBuildMs ?? null,
      bufferUploadSubmitMs: renderers.uploadSubmitMs,
      firstCanvasDrawCpuMs: firstCanvas,
      firstLumaDrawSubmitMs: firstLuma,
      backendInitializationMs: renderers.initializationMs,
    };
    el('scene-info').textContent =
      `${next.name} · ${next.featureCount.toLocaleString()} features · ${next.vertexCount.toLocaleString()} vertices · ${next.tiles.length} raster tiles`;
    el('preparation').textContent =
      `数据准备 ${next.preparationMs.toFixed(1)} ms · 几何准备墙钟 ${renderers.buildMs.toFixed(1)} ms · Buffer 上传提交 ${renderers.uploadSubmitMs.toFixed(1)} ms · 首次绘制 Canvas ${firstCanvas.toFixed(1)} / luma ${firstLuma?.toFixed(1) ?? '不可用'} ms`;
    renderers.show(backend);
    draw();
    setStatus(
      renderers.gpu
        ? '就绪：可拖动、滚轮缩放、切换后端或开始 A/B 压测。'
        : 'Canvas 已就绪，所选 GPU 后端不可用。',
      'ready',
    );
  } catch (error) {
    if (next && next !== scene) next.dispose();
    if (next && next === scene) {
      renderers.clear();
      next.dispose();
      scene = null;
    }
    if (!controller.signal.aborted) fail(error);
  } finally {
    if (loading === controller) {
      loading = null;
      lock(false);
      if (controller.signal.aborted)
        setStatus(
          scene ? '已取消，保留现有场景。' : '已取消，请重新生成或加载。',
          scene ? 'ready' : 'idle',
        );
    }
    release();
  }
}
const pathStrategy = el<HTMLSelectElement>('path-strategy');
function setPathMode(value: 'auto' | 'reference' | 'legacy'): void {
  if (!['auto', 'reference', 'legacy'].includes(value)) throw new Error('Invalid path strategy');
  if (renderers.gpu) renderers.gpu.pathMode = value;
  pathStrategy.value = value;
  report = null;
  el('results').replaceChildren();
  requestDraw();
}
pathStrategy.addEventListener('change', () =>
  setPathMode(pathStrategy.value as 'auto' | 'reference' | 'legacy'),
);
const requestedPath = new URLSearchParams(location.search).get('path');
if (requestedPath === 'legacy' || requestedPath === 'reference') setPathMode(requestedPath);
const pointStrategy = el<HTMLSelectElement>('point-strategy');
const pointRadius = el<HTMLInputElement>('point-radius');
const pointOpacity = el<HTMLInputElement>('point-opacity');
const pointLodToggle = el<HTMLInputElement>('point-lod-enabled');
const pointLodCell = el<HTMLInputElement>('point-lod-cell');
let pointLodUpdating = false;
async function setPointLod(enabled: boolean, cellSize = 3): Promise<void> {
  if (loading || running || screenFilterUpdating || pointLodUpdating)
    throw new Error('请等待当前任务结束再调整点 LOD。');
  renderers.setPointLod(enabled, cellSize);
  pointLodToggle.checked = enabled;
  pointLodCell.value = String(cellSize);
  report = null;
  el('results').replaceChildren();
  if (!scene) {
    refreshCounters();
    return;
  }
  pointLodUpdating = true;
  lock(true);
  setStatus('更新点聚合显示缓存…', 'updating');
  const current = scene;
  try {
    await renderers.warmViews([transform], new AbortController().signal);
    if (disposed || scene !== current) return;
    draw();
    setStatus('点显示设置已更新；原始数据及线面精度不变。', 'ready');
  } catch (error) {
    if (!disposed && scene === current) throw error;
  } finally {
    pointLodUpdating = false;
    if (!disposed && !loading) lock(false);
  }
}
for (const control of [pointLodToggle, pointLodCell])
  control.addEventListener('change', () => {
    void setPointLod(pointLodToggle.checked, Number(pointLodCell.value)).catch(fail);
  });
if (new URLSearchParams(location.search).get('pointLod') === 'off') {
  renderers.setPointLod(false, 3);
  pointLodToggle.checked = false;
}

function updatePointStyle() {
  renderers.setPointStyle(Number(pointRadius.value), Number(pointOpacity.value));
  if (renderers.gpu) renderers.gpu.circleOptimizationEnabled = pointStrategy.value === 'auto';
  report = null;
  el('results').replaceChildren();
  requestDraw();
}
for (const control of [pointStrategy, pointRadius, pointOpacity])
  control.addEventListener('change', () => {
    try {
      updatePointStyle();
    } catch (error) {
      fail(error);
    }
  });
selector.addEventListener('change', () => {
  backend = selector.value as Backend;
  renderers.show(backend);
  requestDraw();
  syncExampleRendererToolbar(
    backend === 'canvas' ? 'canvas2d' : requestedGpu === 'webgpu' ? 'webgpu' : 'webgl2',
  );
});
el('fit').addEventListener('click', () => {
  fit();
  requestDraw();
});
cancel.addEventListener('click', () => {
  loading?.abort();
  running?.abort();
  setStatus('已取消。', scene ? 'ready' : 'idle');
});
let drag: { id: number; x: number; y: number } | null = null;
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || running || loading || drag) return;
  clearTimeout(wheelSettle);
  wheelSettle = undefined;
  renderers.setInteracting(true);
  stage.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
stage.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  transform.translate(e.clientX - drag.x, e.clientY - drag.y);
  drag.x = e.clientX;
  drag.y = e.clientY;
  requestDraw();
});
function endDrag(e?: PointerEvent) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  drag = null;
  renderers.setInteracting(false);
  requestDraw();
}
stage.addEventListener('lostpointercapture', endDrag);
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
function blurNavigation() {
  clearTimeout(wheelSettle);
  wheelSettle = undefined;
  endDrag();
  renderers.setInteracting(false);
  requestDraw();
}
window.addEventListener('blur', blurNavigation);
let wheelSettle: ReturnType<typeof setTimeout> | undefined;
stage.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (running || loading) return;
    renderers.setInteracting(true);
    clearTimeout(wheelSettle);
    wheelSettle = setTimeout(() => {
      wheelSettle = undefined;
      if (!drag) {
        renderers.setInteracting(false);
        requestDraw();
      }
    }, 120);
    const rect = stage.getBoundingClientRect();
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1);
    transform.scale(
      Math.exp(Math.max(-0.4, Math.min(0.4, -delta * 0.002))),
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
    requestDraw();
  },
  { passive: false },
);
function showResults(results: Record<Backend, ReturnType<typeof summarize>>) {
  el('results').replaceChildren(
    ...(['canvas', 'luma'] as const).map((name) => {
      const result = results[name];
      const row = document.createElement('tr');
      const number = (v: number | null) => (v === null ? '—' : v.toFixed(2));
      for (const value of [
        name === 'canvas' ? 'Canvas2D' : (renderers.gpu?.label ?? 'GPU 不可用'),
        String(result.samples),
        number(result.fps),
        number(result.frameMeanMs),
        number(result.frameP95Ms),
        number(result.cpuMeanMs),
        number(result.cpuP95Ms),
        String(result.framesOver33ms),
      ]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }),
  );
}
async function compare(framesPerTrial = 60, screenMode = false) {
  if (
    !scene ||
    !renderers.gpu ||
    loading ||
    running ||
    pointLodUpdating ||
    screenFilterUpdating ||
    disposed
  )
    return null;
  if (!Number.isInteger(framesPerTrial) || framesPerTrial < 1 || framesPerTrial > 600)
    throw new Error('Invalid sample count.');
  const controller = new AbortController();
  running = controller;
  lock(true);
  drag = null;
  if (scheduled) {
    cancelAnimationFrame(scheduled);
    scheduled = 0;
  }
  renderers.navigation.reset();
  renderers.setInteracting(false);
  const startView = transform.clone();
  const trialDraw = (name: Backend, i: number, n: number) =>
    screenMode
      ? renderers.drawScreenFrame(name, startView)
      : renderers.draw(name, navigationFrame(startView, i, n, width, height));
  const samples: Record<Backend, Samples> = {
    canvas: { cpuMs: [], frameMs: [] },
    luma: { cpuMs: [], frameMs: [] },
  };
  let before = { ...renderers.gpu.stats };
  const order: Backend[] = ['canvas', 'luma', 'luma', 'canvas'];
  const trialResults: unknown[] = [];
  const geometryByBackend: Partial<Record<Backend, typeof renderers.lodStats>> = {};
  report = null;
  try {
    setStatus(
      screenMode
        ? '准备当前固定视图的屏幕过滤缓存（不计入暖帧率）…'
        : '预热同一组可见分块与点显示缓存…',
      'running',
    );
    const views = [
      startView,
      ...Array.from({ length: framesPerTrial }, (_, i) =>
        navigationFrame(startView, i, framesPerTrial, width, height),
      ),
      ...Array.from({ length: 12 }, (_, i) => navigationFrame(startView, i, 12, width, height)),
    ];
    await renderers.warmViews(screenMode ? [startView] : views, controller.signal);
    if (screenMode) await renderers.warmScreenPaths(startView, controller.signal);
    before = { ...renderers.gpu.stats };
    for (let trial = 0; trial < order.length; trial++) {
      const name = order[trial];
      renderers.show(name);
      el('active-renderer').textContent =
        name === 'luma' ? (renderers.gpu?.label ?? 'GPU 不可用') : 'Canvas2D / 原始 CanvasPainter';
      setStatus(
        `A/B ${trial + 1}/4 · ${name} · 每轮 ${framesPerTrial} 帧（先预热 12 帧）`,
        'running',
      );
      for (let i = 0; i < 12; i++) {
        await animationTick(controller.signal);
        trialDraw(name, i, 12);
      }
      const measurements: Samples = { cpuMs: [], frameMs: [] };
      let previous = await animationTick(controller.signal);
      for (let i = 0; i < framesPerTrial; i++) {
        controller.signal.throwIfAborted();
        measurements.cpuMs.push(trialDraw(name, i, framesPerTrial));
        const end = await animationTick(controller.signal);
        measurements.frameMs.push(end - previous);
        previous = end;
      }
      samples[name].cpuMs.push(...measurements.cpuMs);
      samples[name].frameMs.push(...measurements.frameMs);
      geometryByBackend[name] = { ...renderers.lodStats };
      trialResults.push({
        backend: name,
        ...summarize(measurements),
        geometry: geometryByBackend[name],
      });
    }
    const results = { canvas: summarize(samples.canvas), luma: summarize(samples.luma) };
    const after = { ...renderers.gpu.stats };
    report = {
      schemaVersion: 5,
      benchmarkMode: screenMode ? 'screen-filtered-fixed-view' : 'original-geometry-navigation',
      pointLod: renderers.pointLodStats,
      pointRendering: {
        strategy: pointStrategy.value,
        radiusCssPx: renderers.pointPaint.radius,
        opacity: renderers.pointPaint.color[3],
      },
      pathRendering: renderers.gpu.pathRendering,
      measuredAt: new Date().toISOString(),
      scope: screenMode
        ? 'Fixed-view Canvas-filtered background strokes; original fills and data; no snapshots'
        : 'Original GPU geometry navigation; Canvas retains its intrinsic snapping; no screen cache or snapshots',
      method: screenMode
        ? 'ABBA same fixed view; 12 warmup frames; screen preparation separate; no snapshots'
        : 'ABBA frame-indexed pan/zoom; 12 warmup frames; no snapshots',
      gpuExecutionMs: null,
      navigationMode: 'full-redraw',
      screenFiltering: screenMode
        ? { ...renderers.screenFilterStats }
        : { applied: false, reason: 'original GPU Buffer navigation; screen preparation excluded' },
      pathCulling: renderers.pathCullingEnabled,
      geometryMode: renderers.lodStats.geometryMode,
      passMode: renderers.passMode,
      backend: requestedGpu,
      environment: {
        userAgent: navigator.userAgent,
        logicalCores: navigator.hardwareConcurrency,
        cssViewport: [width, height],
        dpr,
        deviceViewport: [renderers.glCanvas.width, renderers.glCanvas.height],
        lumaVersion: '10.0.0-alpha.4',
        gpu: renderers.gpu.deviceInfo,
      },
      scene: {
        name: scene.name,
        features: scene.featureCount,
        vertices: scene.vertexCount,
        tiles: scene.tiles.length,
        rasterMode: scene.tiles.length
          ? 'fixed decoded working set; no navigation I/O or new overviews'
          : null,
      },
      geometry: geometryByBackend.luma,
      geometryByBackend,
      preparation,
      rasterProcessing: scene.rasterStats,
      results,
      trialResults,
      rawFrames: samples,
      gpuResources: after,
      lod: { ...renderers.lodStats },
      view: { mx: startView.mx, my: startView.my, bx: startView.bx, by: startView.by },
      warmNavigation: {
        geometryUploads: after.uploads - before.uploads,
        textureUploads: after.textureUploads - before.textureUploads,
        drawCalls: after.drawCalls - before.drawCalls,
      },
    };
    showResults(results);
    el('results-caption').textContent = screenMode
      ? `当前结果：过滤后固定视图暖重绘，不使用快照；屏幕准备 ${renderers.screenFilterStats.buildWallMs.toFixed(1)} ms 另计。`
      : '当前结果：原始 GPU 几何平移缩放 A/B；不使用屏幕过滤缓存和快照。Canvas 保留自身的绘制吸附。';
    setStatus(
      'A/B 完成。FPS 看显示节奏，CPU ms 看主线程开销；切勿把两者混为 GPU 执行时间。',
      'ready',
    );
    return report;
  } catch (error) {
    report = null;
    if (controller.signal.aborted)
      setStatus('压测已取消；未生成不完整结果。', scene ? 'ready' : 'idle');
    else fail(error);
    return null;
  } finally {
    running = null;
    if (!loading && !disposed) {
      lock(false);
      transform = startView;
      renderers.show(backend);
      draw();
    }
  }
}
el('compare').addEventListener('click', () => {
  void compare();
});
el('compare-screen').addEventListener('click', () => {
  void compare(60, true);
});
el('export').addEventListener('click', () => {
  if (!report) {
    setStatus('请先完成一次 A/B 压测。', 'ready');
    return;
  }
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'emap-luma-benchmark.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
function hidden() {
  if (document.hidden) {
    running?.abort(new Error('Tab hidden'));
    blurNavigation();
  }
}
document.addEventListener('visibilitychange', hidden);
function dispose() {
  if (disposed) return;
  disposed = true;
  loading?.abort();
  running?.abort();
  cancelAnimationFrame(scheduled);
  clearTimeout(wheelSettle);
  observer.disconnect();
  window.removeEventListener('resize', resize);
  document.removeEventListener('visibilitychange', hidden);
  window.removeEventListener('blur', blurNavigation);
  renderers.dispose();
  scene?.dispose();
  scene = null;
}
window.addEventListener('pagehide', dispose, { once: true });
async function start() {
  const runtime = await loadExampleRuntime({ mode: 'local' });
  const loadFile = (file: File, overview?: File) =>
    load(async (signal) => {
      if (/\.tiff?$/i.test(file.name)) return rasterScene(file, overview, signal);
      const t = performance.now();
      let dataset: MapshaperDataset | undefined;
      let lodSource: import('./import-file').BenchmarkFileWorker | undefined;
      if (/\.(geojson|json)$/i.test(file.name)) {
        const imported = await importBenchmarkFile(file, signal, (message) =>
          setStatus(message, 'loading'),
        );
        dataset = imported.dataset;
        lodSource = imported.source;
      } else {
        const source = await runtime.TopologySource.fromBytes(
          'benchmark',
          await file.arrayBuffer(),
          { filename: file.name },
        );
        dataset = source.getDataset() as MapshaperDataset | undefined;
      }
      signal.throwIfAborted();
      if (!dataset) throw new Error('Vector import produced no dataset.');
      let result: Scene;
      try {
        result = vectorScene(dataset, file.name);
      } catch (error) {
        lodSource?.close();
        throw error;
      }
      if (lodSource) {
        result.lodSource = lodSource;
        lodSource.setBounds([
          result.bounds.xmin,
          result.bounds.ymin,
          result.bounds.xmax,
          result.bounds.ymax,
        ]);
        result.dispose = () => lodSource.close();
      }
      result.preparationMs = performance.now() - t;
      return result;
    });
  const filesInput = el<HTMLInputElement>('file-input');
  const fileSelector = el<HTMLSelectElement>('selected-file');
  filesInput.addEventListener('change', () => {
    fileSelector.replaceChildren(
      ...Array.from(filesInput.files ?? [])
        .filter((f) => !f.name.toLowerCase().endsWith('.ovr'))
        .map((f) => new Option(`${f.name} (${(f.size / 1024 ** 2).toFixed(1)} MiB)`, f.name)),
    );
  });
  el('load-file').addEventListener('click', () => {
    const files = Array.from(filesInput.files ?? []);
    const file = files.find((f) => f.name === fileSelector.value);
    if (!file) {
      fail(new Error('请选择一个本地数据文件。'));
      return;
    }
    const overview = files.find((f) => f.name.toLowerCase() === `${file.name}.ovr`.toLowerCase());
    void loadFile(file, overview);
  });
  Object.assign(window, {
    lumaBenchmark: {
      run: compare,
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
      setLayerIcon: (id: string, options: IconOptions | null) =>
        renderers.setLayerIcon(id, options),
      get iconStats() {
        return renderers.iconStats;
      },
      settleIcons: () => renderers.settleIcons(),
      setLayerVisibility: (id: string, value: 'visible' | 'none') =>
        renderers.setLayerVisibility(id, value),
      settleLabels: () => renderers.settleLabels(),
      runScreen: (frames = 60) => compare(frames, true),
      loadFile,
      dispose,
      setPointLod,
      get screenFilterStats() {
        return renderers.screenFilterStats;
      },
      get cacheDiagnostics() {
        return renderers.cacheDiagnostics;
      },
      setScreenFilters,
      get navigationStats() {
        return renderers.navigation.stats;
      },
      setFastNav(enabled: boolean) {
        renderers.navigation.setEnabled(enabled);
        fastNavToggle.checked = enabled;
        requestDraw();
      },
      setPathCulling(enabled: boolean) {
        renderers.pathCullingEnabled = enabled;
        pathCullingToggle.checked = enabled;
        renderers.navigation.reset();
      },
      setPathMode,
      get pathRendering() {
        return renderers.gpu?.pathRendering ?? null;
      },
      get pointLodStats() {
        return renderers.pointLodStats;
      },
      get report() {
        return report;
      },
      get preparation() {
        return preparation;
      },
      setPointOptimization(enabled: boolean) {
        pointStrategy.value = enabled ? 'auto' : 'standard';
        if (renderers.gpu) renderers.gpu.circleOptimizationEnabled = enabled;
        draw();
      },
      get gpuStats() {
        return renderers.gpu ? { ...renderers.gpu.stats } : null;
      },
      get lodStats() {
        return { ...renderers.lodStats };
      },
      get scene() {
        return scene;
      },
      get state() {
        return status.dataset.state;
      },
      get view() {
        return { mx: transform.mx, my: transform.my, bx: transform.bx, by: transform.by };
      },
      async setView(scaleFromFit: number, pan: [number, number] = [0, 0]) {
        if (!Number.isFinite(scaleFromFit) || scaleFromFit <= 0)
          throw new Error('Invalid view scale');
        // Explicit harness view changes complete a real frame; interactive gestures use previews.
        renderers.navigation.reset();
        fit();
        transform.scale(scaleFromFit, width / 2, height / 2);
        transform.translate(...pan);
        const signal = new AbortController().signal;
        await renderers.warmViews([transform], signal);
        await renderers.warmScreenPaths(transform, signal);
        renderers.requestView(transform);
        draw();
      },
      async settle() {
        clearTimeout(wheelSettle);
        wheelSettle = undefined;
        drag = null;
        renderers.setInteracting(false);
        renderers.navigation.reset();
        await renderers.warmViews([transform], new AbortController().signal);
        await renderers.warmScreenPaths(transform, new AbortController().signal);
        draw();
      },
      setPass(mode: import('./renderers').PassMode) {
        renderers.passMode = mode;
        passSelector.value = mode;
        draw();
      },
      async warmScreen() {
        await renderers.warmScreenPaths(transform, new AbortController().signal);
      },
      drawScreen(name: Backend = 'luma') {
        renderers.show(name);
        return renderers.drawScreenFrame(name, transform);
      },
      async captureScreenPixels(name: Backend = 'luma') {
        renderers.navigation.reset();
        renderers.show(name);
        renderers.drawScreenFrame(name, transform);
        const source = name === 'luma' ? renderers.glCanvas : renderers.canvas;
        const snapshot = createImageBitmap(source);
        await renderers.gpu?.waitForIdle();
        const bitmap = await snapshot;
        const copy = document.createElement('canvas');
        copy.width = bitmap.width;
        copy.height = bitmap.height;
        const ctx = copy.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
        let painted = 0,
          hash = 2166136261;
        for (let i = 0; i < pixels.length; i++) {
          hash = Math.imul(hash ^ pixels[i], 16777619);
          if (i % 4 === 3 && pixels[i]) painted++;
        }
        return {
          painted,
          hash: hash >>> 0,
          width: copy.width,
          height: copy.height,
          filters: renderers.screenFilterStats,
        };
      },
      async capturePixels() {
        renderers.navigation.reset();
        renderers.show('luma');
        renderers.draw('luma', transform);
        const snapshot = createImageBitmap(renderers.glCanvas);
        await renderers.gpu?.waitForIdle();
        const bitmap = await snapshot;
        const copy = document.createElement('canvas');
        copy.width = bitmap.width;
        copy.height = bitmap.height;
        const ctx = copy.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
        let paintedPixels = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) paintedPixels++;
        let hash = 2166136261;
        for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619);
        return {
          paintedPixels,
          pixelHash: hash >>> 0,
          size: [copy.width, copy.height],
          backend: requestedGpu,
        };
      },
      async profileGpu(frames = 8) {
        const gpu = renderers.gpu;
        if (!gpu) return null;
        gpu.enableTiming(true);
        for (let i = 0; i < frames; i++) {
          renderers.draw('luma', transform);
          await animationTick(new AbortController().signal);
        }
        await gpu.waitForIdle();
        await new Promise((r) => setTimeout(r, 100));
        const result = {
          supported: gpu.timestampSupported,
          samplesMs: [...gpu.gpuTimings],
          pass: renderers.passMode,
        };
        gpu.enableTiming(false);
        return result;
      },
      draw(name: Backend) {
        if (renderers.navigation.stats.ready || renderers.navigation.stats.pending)
          renderers.navigation.reset();
        renderers.show(name);
        return renderers.draw(name, transform);
      },
    },
  });
  refreshCounters();
  setStatus(
    '请选择真实本地数据：big、building、lucc、points 或 pppp。不会自动生成测试数据。',
    'idle',
  );
  lock(false);
}
void start().catch(fail);
