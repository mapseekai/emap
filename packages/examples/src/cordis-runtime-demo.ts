import { getExampleRenderer } from './renderer-choice';
import { monitorExampleMap } from './performance-render-source';
import { Context, type Plugin } from 'cordis';
import cordisPackage from 'cordis/package.json';
import { inspectContext, inspectServices, settleContext } from '@mapseekai/emap/context';
import { invokeAgentTool } from '@mapseekai/emap/ai';
import { editorPreset } from '@mapseekai/emap/presets';
import { loadExampleRuntime, fixtureUrl } from './example-runtime';

/** Visual diagnostics read the actual Cordis registry; this module owns only UI state. */
export async function mountCordisRuntimeDemo(): Promise<void> {
  const element = <T extends HTMLElement>(id: string): T => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Missing demo element: ${id}`);
    return node as T;
  };
  const emap = await loadExampleRuntime();
  const map = await emap.Emap.create({ renderer: getExampleRenderer(), container: 'map', preset: 'editor' });
  monitorExampleMap(map, document);
  await map.addControl(new emap.NavigationControl(), 'top-left');
  const definitions = new Map<string, Plugin>(editorPreset.filter(plugin => plugin.name).map(plugin => [plugin.name!, plugin]));
  const fibers = () => [...map.ctx.registry.values()].flatMap(runtime => [...runtime.fibers]);
  const action = element('action-state');
  const pluginSearch = element<HTMLInputElement>('plugin-search');
  const capabilitySearch = element<HTMLInputElement>('capability-search');
  let selectedName = 'feature.interaction.drag-pan';
  let busy = false;
  let closed = false;
  let loadVersion = 0;
  const safe = (name: string) => name.startsWith('feature.interaction.') ||
    ['provider.maplibre', 'feature.format.arrow', 'provider.duckdb'].includes(name);

  function report(message: string, error = false): void {
    action.dataset.state = error ? 'error' : 'ready';
    action.textContent = message;
  }

  function capabilities(): void {
    const target = element('capability-list');
    const results = map.capabilities.search(capabilitySearch.value);
    target.replaceChildren();
    for (const item of results.slice(0, 50)) {
      const row = document.createElement('div'); row.className = 'runtime-row';
      const name = document.createElement('code'); name.textContent = item.id;
      const effects = document.createElement('span'); effects.textContent = item.effects.join(', ');
      row.append(name, effects); target.append(row);
    }
    if (!results.length) target.textContent = '没有匹配的能力';
  }

  function refresh(): void {
    if (closed) return;
    const records = inspectContext(map.ctx);
    const services = inspectServices(map.ctx);
    element('metric-plugins').textContent = String(records.length);
    element('metric-active').textContent = String(records.filter(item => item.state === 'ACTIVE').length);
    element('metric-capabilities').textContent = String(map.capabilities.list().length);
    element('metric-formats').textContent = String(map.formats.list().length);
    const database = map.ctx.get('duckDb');
    element('service-state').textContent = [
      `MapLibre：${map.ctx.get('mapLibre') ? '已安装' : '未安装'}`,
      `DuckDB：${database ? database.peek() ? '已初始化' : '已安装，尚未初始化' : '未安装'}`,
      `服务：${services.filter(item => item.state === 'ACTIVE').length}`,
    ].join(' · ');
    const list = element('plugin-list'); list.replaceChildren();
    const query = pluginSearch.value.toLowerCase();
    for (const item of records.filter(item => item.name.toLowerCase().includes(query))) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'runtime-row';
      row.dataset.selected = String(item.name === selectedName); row.dataset.pluginName = item.name;
      const name = document.createElement('code'); name.textContent = item.name;
      const state = document.createElement('span'); state.textContent = item.state;
      row.append(name, state); row.addEventListener('click', () => { selectedName = item.name; refresh(); });
      list.append(row);
    }
    const selected = records.find(item => item.name === selectedName);
    element('selected-id').textContent = selectedName;
    element('selected-status').textContent = selected ? `#${selected.uid} · ${selected.state}` : '未安装（Fiber 已 Dispose）';
    element('selected-requires').textContent = selected?.inject.map(name => {
      const provider = services.find(service => service.name === name);
      return `${name} → ${provider?.owner ?? '等待 Provider'}`;
    }).join('\n') || '—';
    element('selected-provides').textContent = selected?.provides.join('\n') || '—';
    element('selected-effects').textContent = selected ? JSON.stringify(selected.effects, null, 2) : '—';
    element<HTMLButtonElement>('dispose-plugin').disabled = busy || !selected || !safe(selectedName);
    element<HTMLButtonElement>('restart-plugin').disabled = busy || !selected || !safe(selectedName);
    element<HTMLButtonElement>('reinstall-plugin').disabled = busy || !!selected || !definitions.has(selectedName) || !safe(selectedName);
    for (const [button, name] of [['install-maplibre', 'provider.maplibre'], ['install-arrow', 'feature.format.arrow'], ['install-duckdb', 'provider.duckdb']]) {
      element<HTMLButtonElement>(button).disabled = busy || records.some(item => item.name === name);
    }
    element<HTMLButtonElement>('invoke-read').disabled = busy;
    capabilities();
  }

  function run(id: string, task: () => Promise<void>): void {
    element<HTMLButtonElement>(id).addEventListener('click', async () => {
      if (busy || closed) return;
      busy = true; refresh();
      try { await task(); await settleContext(map.ctx); }
      catch (error) { report(error instanceof Error ? error.message : String(error), true); }
      finally { busy = false; refresh(); }
    });
  }

  run('dispose-plugin', async () => {
    const fiber = fibers().find(fiber => fiber.name === selectedName);
    if (!fiber || !safe(selectedName)) return;
    await fiber.dispose();
    report(`${selectedName} 已通过原生 Fiber.dispose() 卸载。数据源不会因此删除。`);
  });
  run('reinstall-plugin', async () => {
    const definition = definitions.get(selectedName);
    if (!definition || !safe(selectedName)) return;
    await map.ctx.plugin(definition);
    report(`${selectedName} 已通过 ctx.plugin() 创建新的 Fiber。`);
  });
  run('restart-plugin', async () => {
    const fiber = fibers().find(fiber => fiber.name === selectedName);
    if (!fiber || !safe(selectedName)) return;
    await fiber.restart(); report(`${selectedName} 已执行原生 Fiber.restart()。`);
  });
  run('install-maplibre', async () => {
    const { mapLibrePlugin } = await import('@mapseekai/emap/maplibre');
    definitions.set(mapLibrePlugin.name!, mapLibrePlugin);
    await map.ctx.plugin(mapLibrePlugin); selectedName = mapLibrePlugin.name!;
    report('MapLibre 服务已安装。未配置底图，因此没有初始化 MapLibre 地图或请求在线瓦片。');
  });
  run('install-arrow', async () => {
    const { arrowFormatsPlugin } = await import('@mapseekai/emap/arrow');
    definitions.set(arrowFormatsPlugin.name!, arrowFormatsPlugin);
    await map.ctx.plugin(arrowFormatsPlugin); selectedName = arrowFormatsPlugin.name!;
    report('Arrow / GeoParquet 扩展格式已注册，卸载此 Fiber 会撤销该格式组。');
  });
  run('install-duckdb', async () => {
    const { duckDbPlugin, duckDbCapabilityPlugins } = await import('@mapseekai/emap/duckdb');
    const provider = duckDbPlugin(); definitions.set(provider.name!, provider);
    map.ctx.plugin(provider);
    // Native waiting capability fibers survive provider removal and reactivate automatically.
    for (const plugin of duckDbCapabilityPlugins) {
      if (!fibers().some(fiber => fiber.name === plugin.name)) map.ctx.plugin(plugin);
    }
    await settleContext(map.ctx); selectedName = provider.name!;
    report('DuckDB 与所有工具已安装。数据库仍未初始化；卸载 Provider 后工具进入原生 PENDING 状态。');
  });
  run('invoke-read', async () => {
    const result = await invokeAgentTool(map.capabilities, 'view.getCRS', {});
    element('capability-result').textContent = JSON.stringify(result.content, null, 2);
    report('Agent 通过真实 CapabilityRegistry 读取了当前 CRS；没有发送网络请求。');
  });
  element('refresh').addEventListener('click', refresh);
  pluginSearch.addEventListener('input', refresh);
  capabilitySearch.addEventListener('input', capabilities);

  async function load(file: File): Promise<void> {
    const version = ++loadVersion;
    const source = new emap.TopologySource('runtime-demo', { formats: map.formats });
    await source.setData({ filename: file.name, content: new Uint8Array(await file.arrayBuffer()) });
    if (closed || version !== loadVersion) return;
    if (map.getSource('runtime-demo')) map.removeSource('runtime-demo');
    await map.addSource('runtime-demo', source);
    if (closed || version !== loadVersion) return;
    map.setExtent(source.getExtent());
    element('fixture-state').textContent = `${file.name} · ${source.getLayers().length} 个数据图层`;
  }
  element<HTMLInputElement>('file-input').addEventListener('change', async event => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try { await load(file); } catch (error) { report(String(error), true); }
  });

  const response = await fetch(fixtureUrl('fixtures/task-6-polygons.geojson'));
  if (!response.ok) throw new Error(`Fixture HTTP ${response.status}`);
  await load(new File([await response.arrayBuffer()], 'task-6-polygons.geojson', { type: 'application/geo+json' }));
  const summary = element('preset-summary');
  const counts = (preset: string, instance: typeof map) => {
    const item = document.createElement('div');
    item.textContent = `${preset}: ${inspectContext(instance.ctx).length} Fibers · Canvas ${instance.ctx.get('render') ? '有' : '无'}`;
    summary.append(item);
  };
  counts('editor', map);
  const hidden = document.createElement('div');
  hidden.style.cssText = 'position:absolute;left:-9999px;top:0;width:320px;height:240px;';
  document.body.append(hidden);
  try {
    for (const preset of ['viewer', 'headless', 'empty'] as const) {
      const instance = await emap.Emap.create({ renderer: getExampleRenderer(), preset, ...(preset === 'viewer' ? { container: hidden } : {}) });
      try { counts(preset, instance); } finally { await instance.dispose(); }
    }
  } finally { hidden.remove(); }

  const proof = element('runtime-proof');
  proof.textContent = `cordis@${cordisPackage.version} · Context.is(map.ctx) = ${Context.is(map.ctx)} · 原生 Context / Fiber`;
  proof.dataset.state = Context.is(map.ctx) ? 'ready' : 'error';
  Object.assign(window, { emapHarness: { map, inspect: () => inspectContext(map.ctx) } });
  window.addEventListener('resize', () => { if (!closed) map.resize(); });
  window.addEventListener('pagehide', () => { closed = true; void map.dispose(); }, { once: true });
  report('Cordis 已就绪。先选中 drag-pan，依次测试 Dispose、重新安装、Restart。');
  refresh();
}
