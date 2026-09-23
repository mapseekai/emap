import type { BenchmarkRenderers } from './renderers';
import { ICON_ANCHORS, type SymbolLayout } from '../../../../src/engine/map/symbol';
import { symbolStyleFromLegacy } from '../../../../src/engine/map/symbol-compat';
const svg = (body: string) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${body}</svg>`);
const presets = {
  pin: svg('<path d="M32 61C25 50 9 35 9 24a23 23 0 0 1 46 0c0 11-16 26-23 37z" fill="#2563eb" stroke="white" stroke-width="3"/><circle cx="32" cy="24" r="9" fill="white"/>'),
  hospital: svg('<rect x="5" y="5" width="54" height="54" rx="12" fill="#dc3652" stroke="white" stroke-width="3"/><path d="M26 15h12v11h11v12H38v11H26V38H15V26h11z" fill="white"/>'),
  camera: svg('<rect x="4" y="17" width="56" height="39" rx="8" fill="#334155" stroke="white" stroke-width="3"/><path d="M20 17l5-9h14l5 9" fill="#334155" stroke="white" stroke-width="3"/><circle cx="32" cy="36" r="12" fill="#22b4be" stroke="white" stroke-width="3"/>'),
  flag: svg('<path d="M15 58V7h3v51z" fill="#334155"/><path d="M19 8h35L44 20l10 12H19z" fill="#ed8b29" stroke="white" stroke-width="2"/>'),
};
/** Parent point-layer settings, not another entry in the layer tree. */
export function installIconControls(host: HTMLElement, renderer: BenchmarkRenderers, changed: () => void) {
  const panel = document.createElement('details');panel.id='icon-settings';panel.className='emap-bound-label-settings';
  panel.innerHTML=`<summary>点图标（替换现有点符号）</summary>
<label>所属点图层 <select id="icon-owner"></select></label>
<label><input id="icon-enabled" type="checkbox">使用图标</label>
<label>预设 <select id="icon-preset"><option value="pin">定位针</option><option value="hospital">医院</option><option value="camera">相机</option><option value="flag">旗帜</option><option value="custom">自定义图片</option></select></label>
<label>图片 URL <input id="icon-url" type="text" placeholder="PNG / SVG / WebP URL"></label>
<label>本地图片 <input id="icon-file" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"></label>
<label>缩放 · icon-size<input id="icon-size" type="number" min="0" step="0.1" value="1"></label>
<label>基准宽（0=等比）<input id="icon-base-width" type="number" min="0" max="512" value="0"></label>
<label>基准高（CSS px）<input id="icon-base-height" type="number" min="1" max="512" value="32"></label>
<label>锚点 · icon-anchor <select id="icon-anchor"><option value="bottom">底部中心</option><option value="center">中心</option><option value="top-left">左上角</option><option value="top">顶部中心</option><option value="top-right">右上角</option><option value="left">左侧中心</option><option value="right">右侧中心</option><option value="bottom-left">左下角</option><option value="bottom-right">右下角</option></select></label>
<label>旋转 · icon-rotate（°）<input id="icon-rotation" type="number" value="0"></label>
<label>X 偏移 · icon-offset<input id="icon-x" type="number" min="-512" max="512" value="0"></label>
<label>Y 偏移 · icon-offset<input id="icon-y" type="number" min="-512" max="512" value="0"></label>
<label>透明度 · icon-opacity<input id="icon-opacity" type="number" min="0" max="1" step="0.1" value="1"></label>
<label><input id="icon-tinted" type="checkbox">单色着色<input id="icon-tint" type="color" value="#2563eb"></label>
<button id="icon-retry" type="button">重试图片</button>
<button id="icon-show-symbol" type="button" aria-expanded="false">查看 symbol 样式</button><pre id="icon-symbol-json" hidden style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>
<p id="icon-message" role="status">加载点数据后启用。支持原色与透明背景；不新增图层。</p>`;
  host.append(panel);
  const $=<T extends HTMLElement=HTMLElement>(id:string)=>panel.querySelector<T>('#'+id)!;
  const owner=$<HTMLSelectElement>('icon-owner'), preset=$<HTMLSelectElement>('icon-preset');
  const lifetime=new AbortController(),events={signal:lifetime.signal},ownedUrls=new Set<string>();
  let signature='',jsonSignature='';
  let cachedPoints:ReturnType<BenchmarkRenderers['getLayers']>=[];
  const number=(id:string)=>Number($<HTMLInputElement>(id).value);
  function read() {
    const layer=renderer.getLayers().find(l=>l.id===owner.value), icon=layer?.type==='circle'?layer.icon:undefined;
    const symbol=layer?.symbol??symbolStyleFromLegacy(layer?.label,icon), layout=symbol.layout??{};
    const image=layout['icon-image']?symbol.images?.[layout['icon-image']]:undefined;
    $<HTMLInputElement>('icon-enabled').checked=!!icon&&icon.enabled!==false;
    preset.value=(Object.entries(presets).find(([,url])=>url===icon?.url)?.[0])??(icon?'custom':'pin');
    $<HTMLInputElement>('icon-url').value=icon?.url??presets.pin;
    $<HTMLInputElement>('icon-size').value=String(layout['icon-size']??1);
    const base=image?.size??32;
    $<HTMLInputElement>('icon-base-width').value=String(Array.isArray(base)?base[0]:0);
    $<HTMLInputElement>('icon-base-height').value=String(Array.isArray(base)?base[1]:base);
    const anchor=$<HTMLSelectElement>('icon-anchor'), value=layout['icon-anchor']??(symbol.icon?.anchor?'custom':'bottom');
    if(![...anchor.options].some(o=>o.value===value))anchor.add(new Option(`自定义 ${symbol.icon?.anchor?.join(',')}`,value));anchor.value=value;
    $<HTMLInputElement>('icon-rotation').value=String(layout['icon-rotate']??0);
    $<HTMLInputElement>('icon-x').value=String(layout['icon-offset']?.[0]??0);$<HTMLInputElement>('icon-y').value=String(layout['icon-offset']?.[1]??0);
    $<HTMLInputElement>('icon-opacity').value=String(icon?.opacity??1);
    $<HTMLInputElement>('icon-tinted').checked=!!icon?.tint;$<HTMLInputElement>('icon-tint').value=icon?.tint??'#2563eb';
    for(const element of panel.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>('input,select,button'))element.disabled=!layer;
  }
  function refresh() {
    const next=renderer.labelControlRevision;
    if(next!==signature)cachedPoints=renderer.getLayers().filter(l=>l.type==='circle');
    const points=cachedPoints;
    if(signature!==next){signature=next;const selected=owner.value;owner.replaceChildren(...points.map(l=>new Option(String(l['source-layer']??l.id),l.id)));if(points.some(l=>l.id===selected))owner.value=selected;read();}
    for(const url of ownedUrls)if(!points.some(l=>(l.type==='circle'&&l.icon?.url===url)||Object.values(l.symbol?.images??{}).some(image=>image.url===url))){URL.revokeObjectURL(url);ownedUrls.delete(url);}
    const jsonKey=JSON.stringify([signature,owner.value]);
    if(jsonKey!==jsonSignature){jsonSignature=jsonKey;$('icon-symbol-json').textContent=JSON.stringify(points.find(l=>l.id===owner.value)?.symbol??{},null,2);}
    const s=renderer.iconStats;
    $('icon-message').textContent=s.errors.length?`图标加载失败，保留普通点：${s.errors.join('；')}`:points.length?`${s.pending?'加载图标中…':'图标就绪'} · 图片 ${s.images} · 解码内存 ${(s.imageBytes/1048576).toFixed(2)} MiB · 本帧实例 ${s.instances.toLocaleString()}`:'加载点数据后启用。图标不会新增图层。';
  }
  function apply() {
    const layer=renderer.getLayers().find(l=>l.id===owner.value);if(!layer||layer.type!=='circle')return;
    const next=layer.symbol??symbolStyleFromLegacy(layer.label,layer.icon);
    const id=next.layout?.['icon-image']||'marker', old=next.images?.[id], url=$<HTMLInputElement>('icon-url').value.trim();
    const w=number('icon-base-width'),h=number('icon-base-height');
    next.images={...next.images,[id]:{url,size:w>0?[w,h]:h,...(old?.url===url&&old.rect?{rect:old.rect}:{})}};
    next.layout={...next.layout,'icon-image':id,'icon-size':number('icon-size'),'icon-rotate':number('icon-rotation'),'icon-offset':[number('icon-x'),number('icon-y')]};
    next.paint={...next.paint,'icon-opacity':number('icon-opacity')};
    next.icon={...next.icon,enabled:$<HTMLInputElement>('icon-enabled').checked};
    const anchor=$<HTMLSelectElement>('icon-anchor').value;
    if(Object.hasOwn(ICON_ANCHORS,anchor)){next.layout['icon-anchor']=anchor as SymbolLayout['icon-anchor'];delete next.icon.anchor;}
    else delete next.layout['icon-anchor'];
    if($<HTMLInputElement>('icon-tinted').checked)next.paint['icon-color']=$<HTMLInputElement>('icon-tint').value;else delete next.paint['icon-color'];
    renderer.setLayerSymbol(owner.value,next);refresh();changed();
  }
  $('icon-show-symbol').addEventListener('click',()=>{const pre=$('icon-symbol-json');pre.hidden=!pre.hidden;$('icon-show-symbol').setAttribute('aria-expanded',String(!pre.hidden));},events);
  owner.addEventListener('change',()=>{read();refresh();},events);
  panel.addEventListener('change',e=>{
    if(e.target===owner)return;
    try {
      if(e.target===preset&&preset.value!=='custom'){$<HTMLInputElement>('icon-url').value=presets[preset.value as keyof typeof presets];$<HTMLSelectElement>('icon-anchor').value=preset.value==='pin'?'bottom':'center';$<HTMLInputElement>('icon-enabled').checked=true;}
      if(e.target===$('icon-file')){const file=$<HTMLInputElement>('icon-file').files?.[0];if(!file)return;if(file.size>8*1024**2)throw new Error('图片不得超过 8 MiB。');const url=URL.createObjectURL(file);ownedUrls.add(url);$<HTMLInputElement>('icon-url').value=url;preset.value='custom';$<HTMLInputElement>('icon-enabled').checked=true;}
      apply();
    }catch(error){$('icon-message').textContent=error instanceof Error?error.message:String(error);}
  },events);
  $('icon-retry').addEventListener('click',()=>{try{apply();}catch(error){$('icon-message').textContent=String(error);}},events);
  refresh();return {refresh,dispose(){lifetime.abort();panel.remove();for(const url of ownedUrls)URL.revokeObjectURL(url);ownedUrls.clear();}};
}
