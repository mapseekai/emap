import type { Emap, LayerSpecification } from '@mapseekai/emap';
import { autoLoadExampleFixtures } from '../example-runtime';
import { installIconControls, presets } from './icon-controls';
import { installLabelControls } from './label-controls';
import type { SymbolControlTarget } from './target';

const status = document.getElementById('status')!;
function setStatus(message: string, state: string): void {
  status.textContent = message;
  status.dataset.state = state;
}

export async function mountSymbolStyleExample(
  map: Emap,
  runtime: typeof globalThis.emap,
): Promise<void> {
  const { TopologySource } = runtime;
  const example = document.body.dataset.symbolExample!;
  const labels = example === 'labels';
  const fields = new Map<string, string[]>();
  let revision = 0;
  let generation = 0;
  let sourceId: string | null = null;
  let disposed = false;
  const target: SymbolControlTarget = {
    getLayers: () => map.getLayers(),
    getLabelFields: (id) => fields.get(id) ?? [],
    get labelControlRevision() {
      return String(revision);
    },
    setLayerSymbol(id, symbol) {
      map.setLayerSymbol(id, symbol);
      revision++;
    },
    setLayerVisibility(id, visibility) {
      map.setLayerVisibility(id, visibility);
      revision++;
    },
  };
  const controls = (labels ? installLabelControls : installIconControls)(
    document.getElementById('symbol-controls')!,
    target,
    () => controls.refresh(),
  );
  document.querySelector<HTMLDetailsElement>('.emap-symbol-settings')!.open = true;

  const lifetime = new AbortController();
  async function load(file: File): Promise<void> {
    const current = ++generation;
    const id = `symbols-${current}`;
    let added = false;
    setStatus(`正在加载 ${file.name}…`, 'loading');
    try {
      const source = new TopologySource(id);
      await source.setData({
        filename: file.name,
        content: new Uint8Array(await file.arrayBuffer()),
      });
      if (disposed || current !== generation) return;
      await map.addSource(id, source);
      added = true;
      const names = source.getLayers().map((layer, index) => layer.name ?? `layer-${index}`);
      // Mixed GeoJSON geometries can share a name; source-layer must be unambiguous.
      if (new Set(names).size !== names.length) {
        for (const [index, name] of [...new Set(names)].entries()) {
          const result = await map.ops.renameLayer({
            source: id,
            target: name,
            name: `${id}-${index}`,
          });
          if (!result.ok) throw new Error(`无法为图层 ${name} 设置唯一名称。`);
        }
      }
      if (disposed || current !== generation) {
        if (!disposed) map.removeSource(id);
        return;
      }
      const layers: LayerSpecification[] = [];
      const nextFields = new Map<string, string[]>();
      source.getLayers().forEach((layer, index) => {
        const geometry = layer.geometry_type;
        if (!geometry || (!labels && geometry !== 'point')) return;
        const layerId = `${id}-${index}`;
        const names = layer.data?.getFields?.() ?? [];
        const field = names.find((name) => /^(name|名称|名字|label)$/i.test(name)) ?? names[0];
        nextFields.set(layerId, [...names]);
        layers.push({
          id: layerId,
          source: id,
          'source-layer': layer.name,
          type: geometry === 'point' ? 'circle' : geometry === 'polygon' ? 'fill' : 'line',
          paint:
            geometry === 'point'
              ? { 'circle-radius': 6, 'circle-color': '#2563eb' }
              : geometry === 'polygon'
                ? { 'fill-color': '#4c956c', 'fill-opacity': 0.3 }
                : { 'line-color': '#2563eb', 'line-width': 2 },
          symbol: labels
            ? {
                layout: field ? { 'text-field': ['get', field], 'text-size': 16 } : {},
                paint: {
                  'text-color': '#243447',
                  'text-halo-color': '#ffffff',
                  'text-halo-width': 1.5,
                },
              }
            : {
                images: { marker: { url: presets.pin, size: 32 } },
                layout: { 'icon-image': 'marker', 'icon-size': 1, 'icon-anchor': 'bottom' },
              },
        } as LayerSpecification);
      });
      if (!layers.length)
        throw new Error(
          labels ? '文件中没有可显示的点、线或面。' : '文件中没有点图层，请选择包含点要素的文件。',
        );
      for (const layer of layers) map.addLayer(layer);
      if (sourceId) map.removeSource(sourceId);
      sourceId = id;
      fields.clear();
      for (const [key, value] of nextFields) fields.set(key, value);
      map.reset();
      revision++;
      controls.refresh();
      setStatus(
        `${file.name} · ${layers.length} 个图层 · 可实时调整${labels ? '注记' : '图标'}样式`,
        'ready',
      );
    } catch (error) {
      if (!disposed && added && sourceId !== id) map.removeSource(id);
      if (!disposed && current === generation)
        setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  }
  document.getElementById('file-input')!.addEventListener(
    'change',
    (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) void load(file);
    },
    { signal: lifetime.signal },
  );
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
      generation++;
      lifetime.abort();
      controls.dispose();
      map.remove();
    },
    { once: true },
  );
  await autoLoadExampleFixtures(example);
}
