import { withSymbolLabel, symbolStyleFromLegacy } from '../../../../src/engine/map/symbol-compat';
import type { SymbolControlTarget } from './target';
import type { LabelOptions } from '../../../../src/engine/map/label';
import './style.css';

/** One settings panel bound to an existing vector layer; no annotation tree entries. */
export function installLabelControls(
  host: HTMLElement,
  renderer: SymbolControlTarget,
  changed: () => void,
) {
  const panel = document.createElement('details');
  panel.id = 'label-settings';
  panel.className = 'emap-symbol-settings';
  panel.innerHTML = `<summary>图层注记（绑定点 / 线 / 面）</summary>
    <label>所属矢量图层 <select id="label-owner"></select></label>
    <label><input id="label-parent-visible" type="checkbox" checked>显示父图层</label>
    <label><input id="label-enabled" type="checkbox">启用此图层的注记</label>
    <label>注记字段 <select id="label-field"></select></label>
    <label>基准字号 · text-size（px）<input id="label-size" type="number" min="6" max="96" value="14"></label>
    <label>X 偏移 · text-offset（em）<input id="label-offset-x" type="number" step="0.1" value="0"></label>
    <label>Y 偏移 · text-offset（em）<input id="label-offset-y" type="number" step="0.1" value="0"></label>
    <label>字体 · text-font <select id="label-font"><option value="sans-serif">Noto Sans SC（MSDF）</option><option value="serif">Noto Serif SC</option><option value="monospace">Noto Sans Mono</option></select></label>
    <label>自定义字体 URL（TTF / OTF / WOFF1）<input id="label-font-url" type="text" placeholder="留空使用内置 Noto"></label>
    <label>文字颜色 · text-color <input id="label-color" type="color" value="#243447"></label>
    <label>描边颜色 <input id="label-halo-color" type="color" value="#ffffff"></label>
    <label>描边宽度 · text-halo-width <input id="label-halo" type="number" min="0" max="12" step="0.5" value="1.5"></label>
    <label>沿线定位 <select id="label-placement"><option value="auto">自动：点正上方 / 沿线 / 面内部</option><option value="horizontal">线注记保持水平</option><option value="parallel">线注记平行于线段</option></select></label>
    <label><input id="label-collision" type="checkbox" checked>启用注记避让</label>
    <button id="label-show-symbol" type="button" aria-expanded="false">查看 symbol 样式</button><pre id="label-symbol-json" hidden style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>
    <p id="label-message" role="status">加载矢量数据后选择字段。注记不会新增图层。</p>`;
  host.append(panel);
  const $ = <T extends HTMLElement>(id: string) => panel.querySelector<T>(`#${id}`)!;
  const owner = $<HTMLSelectElement>('label-owner'),
    field = $<HTMLSelectElement>('label-field');
  const lifetime = new AbortController();
  const events = { signal: lifetime.signal };
  let signature = '',
    selected = '',
    jsonSignature = '';
  let cachedLayers: ReturnType<SymbolControlTarget['getLayers']> = [];
  function read() {
    const spec = renderer.getLayers().find((l) => l.id === owner.value),
      options = spec?.label;
    const fields = spec ? renderer.getLabelFields(spec.id) : [];
    const chosen =
      options?.field ?? fields.find((f) => /^(name|名称|名字|label)$/i.test(f)) ?? fields[0] ?? '';
    field.replaceChildren(...fields.map((f) => new Option(f, f)));
    field.value = chosen;
    $<HTMLInputElement>('label-enabled').checked = !!options && options.enabled !== false;
    $<HTMLInputElement>('label-parent-visible').checked = spec?.layout?.visibility !== 'none';
    $<HTMLInputElement>('label-size').value = String(options?.fontSize ?? 14);
    const offset = spec?.symbol?.layout?.['text-offset'] ??
      options?.offset?.map((n) => n / (options.fontSize ?? 14)) ?? [0, 0];
    $<HTMLInputElement>('label-offset-x').value = String(offset[0]);
    $<HTMLInputElement>('label-offset-y').value = String(offset[1]);
    const font = $<HTMLSelectElement>('label-font'),
      family = options?.fontFamily ?? 'sans-serif';
    if (![...font.options].some((o) => o.value === family)) font.add(new Option(family, family));
    font.value = family;
    $<HTMLInputElement>('label-font-url').value = options?.fontUrl ?? '';
    $<HTMLInputElement>('label-color').value = options?.color ?? '#243447';
    $<HTMLInputElement>('label-halo-color').value = options?.haloColor ?? '#ffffff';
    $<HTMLInputElement>('label-halo').value = String(options?.haloWidth ?? 1.5);
    $<HTMLInputElement>('label-collision').checked = !options?.allowOverlap;
    $<HTMLSelectElement>('label-placement').value = options?.placement ?? 'auto';
    for (const control of panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      'input,select',
    ))
      control.disabled = !spec;
    owner.disabled = renderer.getLayers().length === 0;
    $<HTMLInputElement>('label-enabled').disabled = !fields.length;
  }
  function refresh() {
    const next = renderer.labelControlRevision;
    if (next !== signature) cachedLayers = renderer.getLayers();
    const specs = cachedLayers;
    if (next !== signature) {
      signature = next;
      selected = owner.value;
      owner.replaceChildren(
        ...specs.map(
          (l) =>
            new Option(
              `${l['source-layer']} · ${l.type === 'circle' ? '点' : l.type === 'fill' ? '面' : '线'}`,
              l.id,
            ),
        ),
      );
      if (specs.some((l) => l.id === selected)) owner.value = selected;
      read();
    }
    const jsonKey = JSON.stringify([signature, owner.value]);
    if (jsonKey !== jsonSignature) {
      jsonSignature = jsonKey;
      $('label-symbol-json').textContent = JSON.stringify(
        specs.find((l) => l.id === owner.value)?.symbol ?? {},
        null,
        2,
      );
    }
    const s = renderer.labelStats;
    if (!s) {
      $('label-message').textContent = specs.length
        ? '点注记默认位于正上方，附加偏移为零。拉远时字号最低 12px；基准字号小于 12px 时按基准字号显示。'
        : '加载矢量数据后选择字段。注记不会新增图层。';
      return;
    }
    const msdf = s as typeof s & {
      mode?: string;
      glyphCount?: number;
      missingGlyphs?: number;
      bitmapFallbackLabels?: number;
    };
    $('label-message').textContent = s.error
      ? `MSDF 字体/注记准备失败：${s.error}。底图继续显示；请修改字体设置后重试。`
      : !specs.length
        ? '加载矢量数据后选择字段。注记不会新增图层。'
        : `MSDF · ${s.pending ? '正在准备字形/注记…' : '注记就绪'} · 显示 ${s.placed ?? 0} · 避让/位置不合适 ${s.collisionSkipped ?? 0} · 预算/尺寸跳过 ${s.capacitySkipped ?? 0} · 字体图集 ${((s.atlasBytes ?? 0) / 1048576).toFixed(1)} MiB · 共享字形 ${msdf.glyphCount ?? 0}${msdf.missingGlyphs ? ' · 轮廓缺字 ' + msdf.missingGlyphs : ''}${msdf.bitmapFallbackLabels ? ' · 浏览器字体回退 ' + msdf.bitmapFallbackLabels + ' 条' : ''}`;
  }
  $('label-show-symbol').addEventListener(
    'click',
    () => {
      const pre = $('label-symbol-json');
      pre.hidden = !pre.hidden;
      $('label-show-symbol').setAttribute('aria-expanded', String(!pre.hidden));
    },
    events,
  );
  owner.addEventListener(
    'change',
    () => {
      read();
      refresh();
    },
    events,
  );
  panel.addEventListener(
    'change',
    (e) => {
      if (e.target === owner || !owner.value) return;
      try {
        if (e.target === $('label-parent-visible'))
          renderer.setLayerVisibility(
            owner.value,
            $<HTMLInputElement>('label-parent-visible').checked ? 'visible' : 'none',
          );
        else {
          if (e.target === $('label-font')) $<HTMLInputElement>('label-font-url').value = '';
          const options: LabelOptions = {
            ...renderer.getLayers().find((l) => l.id === owner.value)?.label,
            enabled: $<HTMLInputElement>('label-enabled').checked,
            ...(field.value ? { field: field.value } : {}),
            fontSize: Number($<HTMLInputElement>('label-size').value),
            fontFamily: $<HTMLSelectElement>('label-font').value,
            color: $<HTMLInputElement>('label-color').value,
            haloColor: $<HTMLInputElement>('label-halo-color').value,
            haloWidth: Number($<HTMLInputElement>('label-halo').value),
            allowOverlap: !$<HTMLInputElement>('label-collision').checked,
            placement: $<HTMLSelectElement>('label-placement').value as LabelOptions['placement'],
          };
          const url = $<HTMLInputElement>('label-font-url').value.trim();
          if (url) options.fontUrl = url;
          else delete options.fontUrl;
          if (field.value) delete options.text;
          const layer = renderer.getLayers().find((l) => l.id === owner.value)!;
          const next = withSymbolLabel(
            layer.symbol ??
              symbolStyleFromLegacy(layer.label, layer.type === 'circle' ? layer.icon : undefined),
            options,
          );
          next.layout = {
            ...next.layout,
            'text-offset': [
              Number($<HTMLInputElement>('label-offset-x').value),
              Number($<HTMLInputElement>('label-offset-y').value),
            ],
          };
          renderer.setLayerSymbol(owner.value, next);
        }
        refresh();
        changed();
      } catch (error) {
        $('label-message').textContent = error instanceof Error ? error.message : String(error);
      }
    },
    events,
  );
  refresh();
  return {
    refresh,
    dispose() {
      lifetime.abort();
      panel.remove();
    },
  };
}
