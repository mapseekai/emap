/** Available main-map rendering backends. Editing affordances use a separate Canvas2D overlay.
 * @example
 * const renderer: RendererBackend = 'webgl2';
 * const map = await Emap.create({ container: 'map', renderer });
 */
export type RendererBackend = 'canvas2d' | 'webgl2' | 'webgpu';

export function resolveRenderer(renderer: RendererBackend | undefined = 'webgl2'): RendererBackend {
  if (!['canvas2d', 'webgl2', 'webgpu'].includes(renderer))
    throw new Error('renderer must be canvas2d, webgl2 or webgpu.');
  return renderer;
}
