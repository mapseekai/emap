import type { BenchmarkRenderers } from './renderers';
import type { LabelOptions } from '../../../../src/engine/map/label';

/** One settings panel bound to an existing vector layer; no annotation tree entries. */
export function installLabelControls(host: HTMLElement, renderer: BenchmarkRenderers, changed: () => void) {
  const panel = document.createElement('details');
  panel.id = 'label-settings'; panel.className = 'emap-bound-label-settings';
  panel.innerHTML = `<summary>图层注记（绑定点 / 线 / 面）</summary>
    <label>所属矢量图层 <select id="label-owner"></select></label>
    <label><input id="label-parent-visible" type="checkbox" checked>显示父图层</label>
    <label><input id="label-enabled" type="checkbox">启用此图层的注记</label>
    <label>注记字段 <select id="label-field"></select></label>
    <label>字号（CSS px）<input id="label-size" type="number" min="6" max="96" value="14"></label>
    <label>字体 <select id="label-font"><option value="sans-serif">Noto Sans SC（MSDF）</option><option value="serif">Noto Serif SC</option><option value="monospace">Noto Sans Mono</option></select></label>
    <label>自定义字体 URL（TTF / OTF / WOFF1）<input id="label-font-url" type="text" placeholder="留空使用内置 Noto"></label>
    <label>文字颜色 <input id="label-color" type="color" value="#243447"></label>
    <label>描边颜色 <input id="label-halo-color" type="color" value="#ffffff"></label>
    <label>描边宽度 <input id="label-halo" type="number" min="0" max="12" step="0.5" value="1.5"></label>
    <label>沿线定位 <select id="label-placement"><option value="auto">自动：点周围 / 沿线 / 面内部</option><option value="horizontal">线注记保持水平</option><option value="parallel">线注记平行于线段</option></select></label>
    <label><input id="label-overlap" type="checkbox">允许注记重叠</label>
    <p id="label-message" role="status">加载矢量数据后选择字段。注记不会新增图层。</p>`;
  const style = document.createElement('style');
  style.textContent = `.emap-bound-label-settings{margin:10px 0;padding:10px;border:1px solid #cdd6dd;background:#fff;color:#243447;font:12px/1.5 system-ui}
.emap-bound-label-settings summary{cursor:pointer;font-weight:600}.emap-bound-label-settings label{display:inline-flex;align-items:center;gap:6px;margin:6px 8px 6px 0;font-size:12px}.emap-bound-label-settings input[type=number]{width:65px}.emap-bound-label-settings input[type=color]{width:40px;height:24px;padding:0}.emap-bound-label-settings input[type=checkbox]{width:auto}.emap-bound-label-settings select{max-width:230px}.emap-bound-label-settings p{margin:6px 0;color:#526574}`;
  panel.append(style); host.append(panel);
  const $ = <T extends HTMLElement>(id: string) => panel.querySelector<T>(`#${id}`)!;
  const owner = $<HTMLSelectElement>('label-owner'), field = $<HTMLSelectElement>('label-field');
  const lifetime = new AbortController(); const events = { signal: lifetime.signal };
  let signature = '', selected = '';
  function read() {
    const spec = renderer.getLayers().find(l => l.id === owner.value), options = spec?.label;
    const fields = spec ? renderer.getLabelFields(spec.id) : [];
    const chosen = options?.field ?? fields.find(f => /^(name|名称|名字|label)$/i.test(f)) ?? fields[0] ?? '';
    field.replaceChildren(...fields.map(f => new Option(f, f)));
    field.value = chosen;
    $<HTMLInputElement>('label-enabled').checked = !!options && options.enabled !== false;
    $<HTMLInputElement>('label-parent-visible').checked = spec?.layout?.visibility !== 'none';
    $<HTMLInputElement>('label-size').value = String(options?.fontSize ?? 14);
    const font = $<HTMLSelectElement>('label-font'), family = options?.fontFamily ?? 'sans-serif';
    if (![...font.options].some(o => o.value === family)) font.add(new Option(family, family));
    font.value = family;
    $<HTMLInputElement>('label-font-url').value = options?.fontUrl ?? '';
    $<HTMLInputElement>('label-color').value = options?.color ?? '#243447';
    $<HTMLInputElement>('label-halo-color').value = options?.haloColor ?? '#ffffff';
    $<HTMLInputElement>('label-halo').value = String(options?.haloWidth ?? 1.5);
    $<HTMLInputElement>('label-overlap').checked = options?.allowOverlap ?? false;
    $<HTMLSelectElement>('label-placement').value = options?.placement ?? 'auto';
    for (const control of panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')) control.disabled = !spec;
    owner.disabled = renderer.getLayers().length === 0;
    $<HTMLInputElement>('label-enabled').disabled = !fields.length;
  }
  function refresh() {
    const specs = renderer.getLayers(), next = JSON.stringify([renderer.labelControlRevision, specs]);
    if (next !== signature) {
      signature = next; selected = owner.value;
      owner.replaceChildren(...specs.map(l => new Option(`${l['source-layer']} · ${l.type === 'circle' ? '点' : l.type === 'fill' ? '面' : '线'}`, l.id)));
      if (specs.some(l => l.id === selected)) owner.value = selected;
      read();
    }
    const s = renderer.labelStats;
    const msdf = s as typeof s & {mode?:string;glyphCount?:number;missingGlyphs?:number};
    $('label-message').textContent = s.error ? `MSDF 字体/注记准备失败：${s.error}。底图继续显示；请修改字体设置后重试。` : !specs.length ? '加载矢量数据后选择字段。注记不会新增图层。' :
      `MSDF · ${s.pending ? '正在准备字形/注记…' : '注记就绪'} · 显示 ${s.placed ?? 0} · 避让/位置不合适 ${s.collisionSkipped ?? 0} · 预算/尺寸跳过 ${s.capacitySkipped ?? 0} · 字体图集 ${((s.atlasBytes ?? 0) / 1048576).toFixed(1)} MiB · 共享字形 ${msdf.glyphCount ?? 0}${msdf.missingGlyphs ? ' · 缺字 '+msdf.missingGlyphs : ''}`;
  }
  owner.addEventListener('change', read, events);
  panel.addEventListener('change', e => {
    if (e.target === owner || !owner.value) return;
    try {
      if (e.target === $('label-parent-visible')) renderer.setLayerVisibility(owner.value, $<HTMLInputElement>('label-parent-visible').checked ? 'visible' : 'none');
      else {
        if(e.target===$('label-font'))$<HTMLInputElement>('label-font-url').value='';
        const options: LabelOptions = {
          ...renderer.getLayers().find(l => l.id === owner.value)?.label,
          enabled: $<HTMLInputElement>('label-enabled').checked,
          ...(field.value ? { field: field.value } : {}),
          fontSize: Number($<HTMLInputElement>('label-size').value), fontFamily: $<HTMLSelectElement>('label-font').value,
          color: $<HTMLInputElement>('label-color').value, haloColor: $<HTMLInputElement>('label-halo-color').value,
          haloWidth: Number($<HTMLInputElement>('label-halo').value), allowOverlap: $<HTMLInputElement>('label-overlap').checked,
          placement: $<HTMLSelectElement>('label-placement').value as LabelOptions['placement'],
        };
        const url=$<HTMLInputElement>('label-font-url').value.trim();
        if(url)options.fontUrl=url;else delete options.fontUrl;
        if (field.value) delete options.text;
        renderer.setLayerLabel(owner.value, options);
      }
      refresh(); changed();
    } catch (error) { $('label-message').textContent = error instanceof Error ? error.message : String(error); }
  }, events);
  refresh();
  return { refresh, dispose() { lifetime.abort(); panel.remove(); } };
}
