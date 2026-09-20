import { loadExampleRuntime } from '../example-runtime';
import { importBenchmarkFile } from '../luma-benchmark/import-file';
import { BenchmarkRenderers } from '../luma-benchmark/renderers';
import { vectorScene, type Scene } from '../luma-benchmark/scene';
import { LumaEditSession } from '../../../../src/engine/rendering/luma/edit-session';
import type { CoordinatePatch } from '../../../../src/engine/rendering/luma/edit-patch';
import { AffineTransform } from '../../../../src/domain/geo/transform';
import { Bounds } from '../../../../src/domain/geo/bounds';
import { EditorOverlay } from './overlay';
import './style.css';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing editor element: ${id}`);
  return result as T;
};
const stage = el('stage'),
  status = el('status'),
  mode = el<HTMLSelectElement>('mode');
let scene: Scene | null = null,
  session: LumaEditSession | null = null;
let view = new AffineTransform(),
  width = 1,
  height = 1,
  dpr = 1,
  scheduled = 0;
let phase = 'idle',
  disposed = false,
  generation = 0,
  wheelTimer: ReturnType<typeof setTimeout> | undefined;
let loading: AbortController | null = null;
let drag: {
  id: number;
  kind: 'pan' | 'vertex';
  start: [number, number];
  last: [number, number];
  moved: boolean;
} | null = null;
let overlay: EditorOverlay | null = null;
let lastPatch: CoordinatePatch | null = null,
  lastChunks: number[] = [];
function state(message: string, next = phase): void {
  phase = next;
  status.textContent = message;
  status.dataset.state = next;
  controls();
}
function controls(): void {
  const ready = !!session && phase === 'ready',
    selected = ready && !!session?.selected;
  document
    .querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>('[data-ready]')
    .forEach((e) => (e.disabled = !ready));
  document
    .querySelectorAll<HTMLButtonElement>('[data-selected]')
    .forEach((e) => (e.disabled = !selected));
  el<HTMLButtonElement>('undo').disabled = !ready || !session?.history.canUndo();
  el<HTMLButtonElement>('redo').disabled = !ready || !session?.history.canRedo();
  el<HTMLButtonElement>('load').disabled =
    phase === 'updating' || phase === 'loading' || !renderers.gpu;
  el<HTMLButtonElement>('cancel-load').disabled = phase !== 'loading';
}
function fail(error: unknown): void {
  session?.cancel();
  drag = null;
  state(error instanceof Error ? error.message : String(error), 'error');
}
const requestedGpu = new URLSearchParams(location.search).get('gpu') === 'webgpu' ? 'webgpu' : 'webgl';
const renderers = await BenchmarkRenderers.create(
  el<HTMLCanvasElement>('canvas2d'),
  el<HTMLCanvasElement>('webgl'),
  () => {
    void restore();
  },
  fail,
  requestDraw,
  requestedGpu,
);
if (renderers.gpu) overlay = new EditorOverlay(renderers.gpu);
el('renderer').textContent=renderers.gpu?.label ?? '所选 GPU 后端不可用';
const gpuSelector=el<HTMLSelectElement>('gpu-backend');gpuSelector.value=requestedGpu;
gpuSelector.addEventListener('change',()=>{const url=new URL(location.href);url.searchParams.set('gpu',gpuSelector.value);location.assign(url.href);});
const pointLodToggle=el<HTMLInputElement>('point-lod-enabled');
const pointLodCell=el<HTMLInputElement>('point-lod-cell');
async function setPointLod(enabled:boolean,cellSize=3):Promise<void>{
  if(phase==='loading'||phase==='updating')throw new Error('请等待当前任务结束。');
  renderers.setPointLod(enabled,cellSize);pointLodToggle.checked=enabled;pointLodCell.value=String(cellSize);
  if(!scene)return;
  const epoch=generation;state('更新点聚合显示缓存…','updating');
  try{await renderers.warmViews([view],new AbortController().signal);if(disposed||epoch!==generation)return;draw();state('点聚合已更新；选择与编辑仍使用原始坐标。','ready');}
  catch(error){if(!disposed&&epoch===generation)fail(error);}
}
for(const control of [pointLodToggle,pointLodCell])control.addEventListener('change',()=>{
  void setPointLod(pointLodToggle.checked,Number(pointLodCell.value)).catch(fail);
});
renderers.show('luma');
function updateSelection(): void {
  const ref = session?.selected;
  el('selection-info').textContent = ref
    ? `${ref.layer} · 行号 ${ref.id} · ${session!.vertexHandles.length.toLocaleString()} 个原始顶点`
    : '未选择要素';
  el('attributes').textContent = JSON.stringify(session?.properties ?? {}, null, 2);
  el('edit-info').textContent =
    `数据版本 ${session?.dataset.editVersion ?? 0} · 可撤销 ${session?.history.size() ?? 0} 次 · 最近更新 ${lastChunks.length} 个显示分块`;
  if (ref) el<HTMLInputElement>('feature-id').value = String(ref.id);
  controls();
  requestDraw();
}
function requestDraw(): void {
  if (scheduled || disposed) return;
  scheduled = requestAnimationFrame(() => {
    scheduled = 0;
    draw();
  });
}
function draw(): void {
  if (!scene || !session || disposed) return;
  try {
    session.setView(view, width, height);
    overlay?.update(session, view, width, height, mode.value === 'vertex');
    const ms = renderers.draw('luma', view, () =>
      overlay?.draw(mode.value === 'vertex', session?.layer?.geometry_type === 'point'),
    );
    const s = renderers.lodStats;
    el('render-time').textContent = `${ms.toFixed(2)} ms JS 提交 · ${requestedGpu}`;
    el('lod-info').textContent =
      `${s.geometryMode === 'point-lod' ? '点聚合背景' : '全精度背景'} · 点网格 ${renderers.pointLodEnabled ? renderers.pointLodCellSize + ' CSS px' : '关闭'} · 聚合待更新 ${renderers.pointLodStats.pending} · 可见分块 ${s.visibleChunks}/${s.totalChunks} · 显示顶点 ${s.displayVertices.toLocaleString()} · 原始编辑顶点 ${overlay?.visibleHandles ?? 0} · 等待细节 ${s.pending}`;
  } catch (error) {
    fail(error);
  }
}
function setView(bounds: Bounds): void {
  if (!bounds.hasBounds()) return;
  const b = bounds.clone();
  if (!b.width || !b.height) {
    const pad = 80 / Math.max(Math.abs(view.mx), 1e-12);
    b.xmin -= pad;
    b.ymin -= pad;
    b.xmax += pad;
    b.ymax += pad;
  }
  b.fillOut(width / height);
  view = AffineTransform.fromBounds(b, new Bounds(30, 30, width - 30, height - 30), true);
  session?.setView(view, width, height, view.mx);
  renderers.requestView(view);
  requestDraw();
}
function resize(): void {
  const r = stage.getBoundingClientRect(),
    w = Math.max(80, Math.floor(r.width)),
    h = Math.max(80, Math.floor(r.height)),
    pr = devicePixelRatio || 1;
  if (w === width && h === height && pr === dpr) return;
  view.translate((w - width) / 2, (h - height) / 2);
  width = w;
  height = h;
  dpr = pr;
  renderers.resize(w, h, pr);
  session?.setView(view, w, h);
  renderers.requestView(view);
  requestDraw();
}
const observer = new ResizeObserver(resize);
observer.observe(stage);
resize();
function clearScene(): void {
  overlay?.clear();
  session?.dispose();
  session = null;
  renderers.clear();
  scene?.dispose();
  scene = null;
  lastPatch = null;
  lastChunks = [];
}
async function loadFile(file: File): Promise<void> {
  if (disposed) return;
  loading?.abort();
  const controller = new AbortController();
  loading = controller;
  const current = ++generation;
  clearTimeout(wheelTimer);
  drag = null;
  renderers.setInteracting(true);
  clearScene();
  state(`正在读取 ${file.name}…`, 'loading');
  let imported: Awaited<ReturnType<typeof importBenchmarkFile>> | null = null;
  try {
    imported = await importBenchmarkFile(file, controller.signal, (message) => {
      if (current === generation) state(message, 'loading');
    });
    controller.signal.throwIfAborted();
    const next = vectorScene(imported.dataset, file.name);
    const worker = imported.source;
    next.lodSource = worker;
    next.dispose = () => worker.close();
    scene = next;
    worker.setBounds([next.bounds.xmin, next.bounds.ymin, next.bounds.xmax, next.bounds.ymax]);
    session = new LumaEditSession(next.dataset);
    session.on('selectionchange', updateSelection);
    state('建立原始几何选择索引…', 'loading');
    await new Promise<void>((r) => setTimeout(r, 0));
    controller.signal.throwIfAborted();
    session.initialize();
    setView(next.bounds);
    await renderers.prepare(next, controller.signal, view, (message) => {
      if (current === generation) state(message, 'loading');
    });
    controller.signal.throwIfAborted();
    if (current !== generation) return;
    el<HTMLSelectElement>('layer').replaceChildren(
      ...next.dataset.layers.map((l, i) => new Option(l.name ?? `layer-${i}`, String(i))),
    );
    renderers.setInteracting(false);
    state(
      `${file.name}：${next.featureCount.toLocaleString()} 个要素。单击选择，再切换顶点编辑。`,
      'ready',
    );
    updateSelection();
  } catch (error) {
    imported?.source.close();
    if (current === generation) {
      clearScene();
      if (controller.signal.aborted) state('加载已取消。', 'idle');
      else fail(error);
    }
  } finally {
    if (loading === controller) loading = null;
    controls();
  }
}
async function synchronize(patch: CoordinatePatch | null): Promise<void> {
  if (!patch || !session || !scene) return;
  const current = generation,
    controller = new AbortController();
  lastPatch = patch;
  const coordinate = patch.vertices[0] ?? patch.points[0];
  el('coordinates').textContent = coordinate
    ? `当前原始坐标 ${coordinate.x}, ${coordinate.y}\n已提交版本 ${patch.revision}，可撤销或重做`
    : '';
  renderers.setInteracting(true);
  state('原始几何已更新，正在刷新受影响的全精度分块…', 'updating');
  updateSelection();
  requestDraw();
  try {
    lastChunks = await renderers.applyEdit(patch, view, controller.signal);
    if (disposed || current !== generation) return;
    if (scene && session) scene.bounds = session.source.getExtent();
    state(`编辑完成：版本 ${patch.revision}，更新 ${lastChunks.length} 个分块。`, 'ready');
  } catch (error) {
    if (current === generation && !disposed)
      fail(new Error(`显示缓存更新失败，请重新加载文件：${String(error)}`));
  } finally {
    if (current === generation && !disposed) {
      renderers.setInteracting(false);
      updateSelection();
    }
  }
}
function coordinate(e: PointerEvent | WheelEvent): [number, number] {
  const r = stage.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
function cancelDrag(): void {
  if (session?.draft) el('coordinates').textContent = '预览已取消；原始坐标和历史未改变。';
  session?.cancel();
  if (drag && stage.hasPointerCapture(drag.id)) stage.releasePointerCapture(drag.id);
  drag = null;
  delete stage.dataset.dragging;
  renderers.setInteracting(false);
  requestDraw();
}
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || phase !== 'ready' || !session) return;
  stage.focus();
  const p = coordinate(e);
  session.setView(view, width, height);
  const draft = mode.value === 'vertex' ? session.begin(p) : null;
  drag = { id: e.pointerId, kind: draft ? 'vertex' : 'pan', start: p, last: p, moved: false };
  stage.setPointerCapture(e.pointerId);
  stage.dataset.dragging = 'true';
  renderers.setInteracting(true);
  if (draft)
    el('coordinates').textContent = `原始坐标 ${draft.from.join(', ')}
联动顶点 ${draft.target.vertices.length || 1} 个`;
  requestDraw();
});
stage.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const p = coordinate(e);
  drag.moved ||= Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) > 3;
  if (drag.kind === 'vertex') {
    session?.move(p);
    el('coordinates').textContent = `原始 ${session?.draft?.from.join(', ')}
预览 ${session?.draft?.to.join(', ')}
松开提交，Esc 取消`;
  } else if (drag.moved) view.translate(p[0] - drag.last[0], p[1] - drag.last[1]);
  drag.last = p;
  renderers.requestView(view);
  requestDraw();
});
stage.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const finished = drag;
  drag = null;
  delete stage.dataset.dragging;
  if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  if (finished.kind === 'vertex') {
    if (finished.moved) session?.move(coordinate(e));
    else session?.cancel();
    const patch = session?.commit() ?? null;
    if (patch) void synchronize(patch);
    else renderers.setInteracting(false);
  } else {
    renderers.setInteracting(false);
    if (!finished.moved && mode.value !== 'pan') session?.pick(coordinate(e));
  }
  requestDraw();
});
stage.addEventListener('pointercancel', cancelDrag);
stage.addEventListener('lostpointercapture', () => {
  if (drag) cancelDrag();
});
stage.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (!scene || phase !== 'ready' || drag?.kind === 'vertex') return;
    const p = coordinate(e);
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1);
    renderers.setInteracting(true);
    view.scale(Math.exp(Math.max(-0.4, Math.min(0.4, -delta * 0.002))), ...p);
    renderers.requestView(view);
    requestDraw();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => renderers.setInteracting(false), 140);
  },
  { passive: false },
);
mode.addEventListener('change', () => {
  cancelDrag();
  requestDraw();
});
el('fit').addEventListener('click', () => {
  if (scene) setView(scene.bounds);
});
el('fit-selected').addEventListener('click', () => {
  if (session?.selected) setView(session.selectionBounds());
});
el('clear').addEventListener('click', () => session?.select(null));
el('select-id').addEventListener('click', () => {
  try {
    session?.selectId(
      Number(el<HTMLSelectElement>('layer').value),
      Number(el<HTMLInputElement>('feature-id').value),
    );
  } catch (error) {
    state(String(error), 'ready');
  }
});
el('undo').addEventListener('click', () => {
  cancelDrag();
  void synchronize(session?.undo() ?? null);
});
el('redo').addEventListener('click', () => {
  cancelDrag();
  void synchronize(session?.redo() ?? null);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (drag) cancelDrag();
    else if (phase === 'ready') session?.select(null);
    return;
  }
  if ((e.target as HTMLElement)?.closest('input,textarea,select') || phase !== 'ready') return;
  if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    cancelDrag();
    void synchronize(
      e.key.toLowerCase() === 'y' || e.shiftKey
        ? (session?.redo() ?? null)
        : (session?.undo() ?? null),
    );
  }
});
el('export').addEventListener('click', () => {
  try {
    if (!session?.selected) return;
    const text = session.exportSelected();
    const url = URL.createObjectURL(new Blob([text], { type: 'application/geo+json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${scene?.name.replace(/\.geojson$/i, '') ?? 'data'}-feature-${session.selected.id}-edited.geojson`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    state(String(error), 'ready');
  }
});
el<HTMLInputElement>('file-input').addEventListener('change', () => {
  el<HTMLSelectElement>('file-select').replaceChildren(
    ...Array.from(el<HTMLInputElement>('file-input').files ?? []).map(
      (file, i) =>
        new Option(`${file.name} (${(file.size / 1024 ** 2).toFixed(1)} MiB)`, String(i)),
    ),
  );
});
el('load').addEventListener('click', () => {
  const file =
    el<HTMLInputElement>('file-input').files?.[Number(el<HTMLSelectElement>('file-select').value)];
  if (file) void loadFile(file);
  else state('请选择本地 GeoJSON 文件。');
});
el('cancel-load').addEventListener('click', () => loading?.abort());
async function restore(): Promise<void> {
  if (!scene || disposed) return;
  cancelDrag();
  overlay?.clear();
  const controller = new AbortController();
  loading?.abort();
  loading = controller;
  state('WebGL 已恢复，重建显示缓存…', 'loading');
  try {
    await renderers.prepare(scene, controller.signal, view);
    state('显示缓存已恢复；原始编辑和历史仍保留。', 'ready');
    updateSelection();
  } catch (error) {
    if (!disposed) fail(error);
  } finally {
    if (loading === controller) loading = null;
  }
}
function dispose(): void {
  if (disposed) return;
  disposed = true;
  generation++;
  loading?.abort();
  clearTimeout(wheelTimer);
  cancelAnimationFrame(scheduled);
  observer.disconnect();
  clearScene();
  renderers.dispose();
}
window.addEventListener('pagehide', dispose, { once: true });
async function start(): Promise<void> {
  await loadExampleRuntime({ mode: 'local' });
  Object.assign(window, {
    lumaEditor: {
      load: loadFile,
      setPointLod,
      get pointLodStats(){return renderers.pointLodStats;},
      async settle(){await renderers.warmViews([view],new AbortController().signal);draw();},
      dispose,
      get session() {
        return session;
      },
      get scene() {
        return scene;
      },
      get state() {
        return phase;
      },
      get lastPatch() {
        return lastPatch;
      },
      get lastChunks() {
        return lastChunks;
      },
      get view() {
        return view.clone();
      },
      get gpuStats() {
        return renderers.gpu ? { ...renderers.gpu.stats } : null;
      },
      get lod() {
        return { ...renderers.lodStats };
      },
      async capturePixels() {
        draw();const snapshot=createImageBitmap(renderers.glCanvas);await renderers.gpu?.waitForIdle();
        const bitmap=await snapshot;
        const copy=document.createElement('canvas');copy.width=bitmap.width;copy.height=bitmap.height;
        const ctx=copy.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();
        const p=ctx.getImageData(0,0,copy.width,copy.height).data;let painted=0;
        for(let i=3;i<p.length;i+=4)if(p[i])painted++;
        return {painted,backend:requestedGpu};
      },
      project(x: number, y: number) {
        return view.project(x, y);
      },
      fitSelected() {
        if (session) setView(session.selectionBounds());
      },
    },
  });
  if (!renderers.gpu) {
    el('renderer').textContent = '所选 GPU 后端不可用（未回退到 Canvas）';
    state(renderers.unavailableReason ?? 'WebGL2 unavailable', 'error');
  } else state('选择本地文件开始；不会自动生成测试数据。', 'idle');
}
void start().catch(fail);
