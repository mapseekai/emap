import type { Emap, LayerSpecification, TopologySource } from '@mapseekai/emap';
import { importGeoPackageInWorker } from '@mapseekai/emap/geopackage';
import { autoLoadExampleFixtures } from './example-runtime';

export async function mountGeometryLodExample(
  map: Emap,
  runtime: typeof globalThis.emap,
): Promise<void> {
  const enabled = document.querySelector<HTMLInputElement>('#geometry-lod')!;
  const screenFiltering = document.querySelector<HTMLInputElement>('#screen-path-filtering')!;
  const tolerance = document.querySelector<HTMLInputElement>('#pixel-tolerance')!;
  const status = document.getElementById('status')!;
  const stats = document.getElementById('geometry-stats')!;
  const lifetime = new AbortController();
  let source: TopologySource | null = null;
  let sourceName = '';
  let generation = 0;
  let applyGeneration = 0;
  let disposed = false;
  let loading = false;
  let loadController: AbortController | undefined;
  let appliedTolerance = 0.5;
  let statsTimer: number | undefined;
  let thresholdTask: { source: TopologySource; promise: Promise<void> } | undefined;

  function updateStats(): void {
    if (!source || disposed || loading) return;
    const raw = source.getArcs();
    const pixelSize = 1 / Math.abs(map.getTransform().mx);
    const arcs = source.getDisplayArcs()?.getScaledArcs(pixelSize, appliedTolerance) ?? raw;
    const data = arcs?.getVertexData?.();
    let displayed = data?.xx.length ?? 0;
    const interval = Math.max(source.getSimplifyFloor(), pixelSize * appliedTolerance);
    if (data?.zz && interval > 0) {
      displayed = 0;
      for (let i = 0; i < data.zz.length; i++) if (data.zz[i] >= interval) displayed++;
    }
    const original = raw?.getPointCount?.() ?? 0;
    stats.textContent = `原始顶点 ${original.toLocaleString()} · 几何精度顶点 ${displayed.toLocaleString()}（不含屏幕去重）`;
    stats.dataset.original = String(original);
    stats.dataset.displayed = String(displayed);
  }

  function queueStats(): void {
    if (statsTimer !== undefined || disposed) return;
    statsTimer = window.setTimeout(() => {
      statsTimer = undefined;
      updateStats();
    }, 150);
  }

  async function prepareThresholds(next: TopologySource): Promise<void> {
    if (next.getArcs()?.getVertexData?.().zz) return;
    if (thresholdTask?.source !== next) {
      const promise = map.ops
        .simplifyLayer({
          source: next.id,
          percentage: 100,
          planar: true,
          keepShapes: true,
          noRepair: true,
        })
        .then((result) => {
          if (!result.ok) throw new Error('无法准备显示简化阈值。');
        });
      thresholdTask = { source: next, promise };
    }
    const task = thresholdTask;
    try {
      await task.promise;
    } finally {
      if (thresholdTask === task) thresholdTask = undefined;
    }
  }

  async function apply(updateStatus = true): Promise<void> {
    const revision = ++applyGeneration;
    if (disposed || loading) return;
    if (enabled.checked && !tolerance.reportValidity()) return;
    const target = source;
    const current = generation;
    if (enabled.checked && target && !target.getArcs()?.getVertexData?.().zz) {
      if (updateStatus) {
        status.textContent = '正在准备显示简化阈值…';
        status.dataset.state = 'loading';
      }
      try {
        await prepareThresholds(target);
      } catch (error) {
        if (disposed || current !== generation || revision !== applyGeneration || target !== source)
          return;
        if (enabled.checked) {
          enabled.checked = false;
          map.setGeometryLod(false);
          appliedTolerance = 0;
          tolerance.disabled = true;
          if (updateStatus) {
            status.textContent = error instanceof Error ? error.message : String(error);
            status.dataset.state = 'error';
          }
          queueStats();
          return;
        }
      }
      if (disposed || current !== generation || revision !== applyGeneration || target !== source)
        return;
    }
    if (enabled.checked && !tolerance.reportValidity()) return;
    const next = enabled.checked ? Number(tolerance.value) : 0;
    map.setGeometryLod(next ? { pixelTolerance: next } : false);
    appliedTolerance = next;
    tolerance.disabled = !enabled.checked;
    queueStats();
    if (target && updateStatus) {
      status.textContent = `${sourceName} · 可独立调整几何简化与屏幕去重`;
      status.dataset.state = 'ready';
    }
  }

  function applyScreenFiltering(): void {
    map.setScreenPathFiltering(screenFiltering.checked);
  }

  async function load(file: File): Promise<void> {
    const current = ++generation;
    loadController?.abort();
    const controller = (loadController = new AbortController());
    const id = `geometry-${current}`;
    let added = false;
    loading = true;
    status.textContent = `正在加载 ${file.name}…`;
    status.dataset.state = 'loading';
    try {
      let next: TopologySource;
      const bytes = await file.arrayBuffer();
      if (/\.gpkg$/i.test(file.name)) {
        const layers = document
          .querySelector<HTMLInputElement>('#gpkg-layers')!
          .value.split(',')
          .map((name) => name.trim())
          .filter(Boolean);
        const base = '/mapseekai/emap/examples/';
        const dataset = await importGeoPackageInWorker(bytes, {
          workerUrl: base + 'emap-geopackage-worker.js',
          wasmUrl: base + 'sql-wasm.wasm',
          layers: layers.length ? layers : undefined,
          transferInput: true,
          signal: controller.signal,
          onProgress: (progress) => {
            if (!disposed && current === generation)
              status.textContent = `${file.name} · ${progress.phase} · ${progress.table ?? ''} · ${progress.rows.toLocaleString()} 条`;
          },
        });
        next = new runtime.TopologySource(id);
        next.setDataset(dataset, false);
      } else {
        next = await runtime.TopologySource.fromBytes(id, bytes, { filename: file.name });
      }
      if (disposed || current !== generation) return;
      if (
        !next
          .getLayers()
          .some((layer) => layer.geometry_type === 'polyline' || layer.geometry_type === 'polygon')
      )
        throw new Error('请选择包含线或面的文件。');
      await map.addSource(id, next);
      added = true;
      const names = next.getLayers().map((layer, index) => layer.name ?? `layer-${index}`);
      if (new Set(names).size !== names.length) {
        for (const [index, name] of [...new Set(names)].entries()) {
          const result = await map.ops.renameLayer({
            source: id,
            target: name,
            name: `${id}-${index}`,
          });
          if (!result.ok) throw new Error('无法设置唯一图层名称。');
        }
      }
      if (disposed || current !== generation) {
        if (!disposed) map.removeSource(id);
        return;
      }
      for (const [index, layer] of next.getLayers().entries()) {
        if (layer.geometry_type !== 'polyline' && layer.geometry_type !== 'polygon') continue;
        map.addLayer({
          id: `${id}-${index}`,
          source: id,
          'source-layer': layer.name,
          type: layer.geometry_type === 'polygon' ? 'fill' : 'line',
          paint:
            layer.geometry_type === 'polygon'
              ? {
                  'fill-color': '#4c956c',
                  'fill-opacity': 0.25,
                  'line-color': '#28704a',
                  'line-width': 1.5,
                }
              : { 'line-color': '#2563eb', 'line-width': 2 },
        } as LayerSpecification);
      }
      if (source) {
        source.off('display', queueStats);
        map.removeSource(source.id);
      }
      source = next;
      sourceName = file.name;
      source.on('display', queueStats);
      map.reset();
      loading = false;
      await apply();
      if (disposed || current !== generation) return;
      applyScreenFiltering();
    } catch (error) {
      if (!disposed && added && source?.id !== id) map.removeSource(id);
      if (!disposed && current === generation) {
        status.textContent = error instanceof Error ? error.message : String(error);
        status.dataset.state = 'error';
        loading = false;
        if (source) await apply(false);
      }
    } finally {
      if (current === generation) {
        loading = false;
        queueStats();
      }
    }
  }

  for (const input of [enabled, tolerance])
    input.addEventListener('change', () => void apply(), { signal: lifetime.signal });
  screenFiltering.addEventListener('change', applyScreenFiltering, { signal: lifetime.signal });
  document.getElementById('reset-detail')!.addEventListener(
    'click',
    () => {
      enabled.checked = true;
      screenFiltering.checked = true;
      tolerance.value = '0.5';
      void apply();
      applyScreenFiltering();
    },
    { signal: lifetime.signal },
  );
  document
    .getElementById('fit')!
    .addEventListener('click', () => map.reset(), { signal: lifetime.signal });
  document.getElementById('file-input')!.addEventListener(
    'change',
    (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) void load(file);
    },
    { signal: lifetime.signal },
  );
  for (const event of ['move', 'moveend', 'resize', 'data'] as const) map.on(event, queueStats);
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
      generation++;
      loadController?.abort();
      lifetime.abort();
      if (statsTimer !== undefined) clearTimeout(statsTimer);
      source?.off('display', queueStats);
      for (const event of ['move', 'moveend', 'resize', 'data'] as const)
        map.off(event, queueStats);
      map.remove();
    },
    { once: true },
  );
  await autoLoadExampleFixtures('geometry-lod');
}
