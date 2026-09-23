import type { RendererBackend } from '../../../src/engine/map/renderer';
/** Creation-time selection for formal-map examples, not the experimental renderer harness. */
export function installRendererChoice(select: HTMLSelectElement): RendererBackend {
  const renderer = new URL(location.href).searchParams.get('renderer') ?? 'webgl2';
  if (!['canvas2d', 'webgl2', 'webgpu'].includes(renderer)) throw new Error('Unknown renderer URL parameter');
  select.replaceChildren(...[
    ['webgl2', 'WebGL2（默认）'], ['webgpu', 'WebGPU'], ['canvas2d', 'Canvas2D'],
  ].map(([value, text]) => new Option(text, value)));
  select.value = renderer;
  select.addEventListener('change', () => {
    const url = new URL(location.href); url.searchParams.set('renderer', select.value); location.assign(url.href);
  });
  return renderer as RendererBackend;
}
