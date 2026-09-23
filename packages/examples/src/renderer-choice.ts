import type { RendererBackend } from '../../../src/engine/map/renderer';

const backends: readonly RendererBackend[] = ['canvas2d', 'webgl2', 'webgpu'];
const labels: Record<RendererBackend, string> = {
  canvas2d: 'Canvas2D',
  webgl2: 'WebGL2',
  webgpu: 'WebGPU',
};
const reloadHint = '切换将重新加载示例；未保存编辑会丢失，本地文件需重新选择。';
function currentUrl(): URL {
  return new URL(globalThis.location?.href ?? 'http://localhost/');
}
function experiment(url: URL): string | undefined {
  return /\/examples\/(luma-benchmark|luma-raster|luma-25d|luma-vertex-editing)\/(?:index\.html)?$/.exec(
    url.pathname,
  )?.[1];
}
function gpuOnly(url: URL): boolean {
  return ['luma-25d', 'luma-vertex-editing'].includes(experiment(url) ?? '');
}
/** URL settings belong to the example host, never to the library or a global Emap patch. */
export function resolveExampleRenderer(url: URL = currentUrl()): RendererBackend {
  const requested = url.searchParams.get('renderer');
  if (requested && backends.includes(requested as RendererBackend))
    return requested as RendererBackend;
  const experimental = experiment(url);
  if (requested !== null && !(experimental && ['canvas', 'luma'].includes(requested)))
    throw new Error('renderer 必须为 canvas2d、webgl2 或 webgpu。');
  if (experimental) {
    if (requested === 'canvas' || (!requested && url.searchParams.get('gpu') === 'canvas'))
      return 'canvas2d';
    return url.searchParams.get('gpu') === 'webgpu' ? 'webgpu' : 'webgl2';
  }
  return 'webgl2';
}
export function getExampleRenderer(): RendererBackend {
  const url = currentUrl(),
    renderer = resolveExampleRenderer(url);
  if (renderer === 'canvas2d' && gpuOnly(url))
    throw new Error(
      '此专用实验不支持 Canvas2D，请选择 WebGL2 或 WebGPU；正式地图示例支持三种后端。',
    );
  return renderer;
}
/** The experimental adapters call WebGL2 "webgl" internally; no rendering change is made here. */
export function getExampleGpuBackend(): 'webgl' | 'webgpu' {
  const renderer = getExampleRenderer();
  // A/B mode still prepares the requested GPU even while the Canvas comparison is visible.
  if (renderer === 'canvas2d' && experiment(currentUrl()) === 'luma-benchmark')
    return currentUrl().searchParams.get('gpu') === 'webgpu' ? 'webgpu' : 'webgl';
  return renderer === 'webgpu' ? 'webgpu' : 'webgl';
}
export function exampleRendererUrl(renderer: RendererBackend, url: URL = currentUrl()): string {
  if (!backends.includes(renderer)) throw new Error('Unknown example renderer');
  const next = new URL(url.href);
  next.searchParams.set('renderer', renderer);
  if (experiment(next) && !(experiment(next) === 'luma-benchmark' && renderer === 'canvas2d'))
    next.searchParams.set(
      'gpu',
      renderer === 'webgl2' ? 'webgl' : renderer === 'canvas2d' ? 'canvas' : 'webgpu',
    );
  return next.href;
}
export function navigateExampleRenderer(renderer: RendererBackend): void {
  globalThis.location.assign(exampleRendererUrl(renderer));
}
/** Shared header shell survives map re-creation, initialization failures and inspector-only pages. */
export function installExampleRendererToolbar(root: Document = document): HTMLElement | null {
  const header = root.querySelector<HTMLElement>('#header');
  if (!header) return null;
  let tools = header.querySelector<HTMLElement>('.emap-example-map-tools');
  if (!tools) {
    tools = root.createElement('div');
    tools.className = 'emap-example-map-tools';
    header.append(tools);
  }
  if (tools.querySelector('.emap-example-renderer-tools')) return tools;
  const url = new URL(root.defaultView?.location.href ?? root.baseURI);
  let selected: RendererBackend | null = null;
  try {
    selected = resolveExampleRenderer(url);
  } catch {
    /* Keep recovery buttons usable for bad URL settings. */
  }
  const group = root.createElement('div');
  group.className = 'emap-example-renderer-tools';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', '切换渲染引擎');
  group.setAttribute('aria-describedby', 'emap-example-renderer-hint');
  const caption = root.createElement('span');
  caption.className = 'emap-example-renderer-caption';
  caption.textContent = '渲染';
  group.append(caption);
  for (const renderer of backends) {
    const button = root.createElement('button');
    button.type = 'button';
    button.dataset.exampleRenderer = renderer;
    button.textContent = labels[renderer];
    button.setAttribute('aria-pressed', String(renderer === selected));
    button.disabled = renderer === 'canvas2d' && gpuOnly(url);
    button.title = button.disabled
      ? '此专用示例仅支持 GPU；Canvas2D 可在正式地图示例中测试。'
      : labels[renderer] + '：' + reloadHint;
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-pressed') === 'true') return;
      root.defaultView?.location.assign(
        exampleRendererUrl(renderer, new URL(root.defaultView.location.href)),
      );
    });
    group.append(button);
  }
  const hint = root.createElement('span');
  hint.id = 'emap-example-renderer-hint';
  hint.className = 'emap-example-renderer-hint';
  hint.textContent = reloadHint;
  group.append(hint);
  const note = root.createElement('span');
  note.className = 'emap-example-renderer-limit';
  note.textContent = gpuOnly(url) ? '仅 GPU' : '↻';
  note.title = gpuOnly(url) ? '此专用实验不支持 Canvas2D。' + reloadHint : reloadHint;
  group.append(note);
  tools.prepend(group);
  // Floating-header examples derive their map/panel offsets from the actual wrapped toolbar height.
  const view = root.defaultView;
  if (view?.ResizeObserver) {
    const resize = new view.ResizeObserver(() =>
      root.documentElement.style.setProperty(
        '--emap-example-header-height',
        header.getBoundingClientRect().height + 'px',
      ),
    );
    resize.observe(header);
    view.addEventListener('pagehide', () => resize.disconnect(), { once: true });
  }
  return tools;
}
/** Live A/B controls keep the shared header truthful without reloading their prepared dataset. */
export function syncExampleRendererToolbar(
  renderer: RendererBackend,
  root: Document = document,
): void {
  installExampleRendererToolbar(root);
  for (const button of root.querySelectorAll<HTMLElement>('[data-example-renderer]'))
    button.setAttribute('aria-pressed', String(button.dataset.exampleRenderer === renderer));
}
