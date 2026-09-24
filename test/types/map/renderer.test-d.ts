import { Emap, type RendererBackend, type EmapOptions } from '../../../src';
const renderer: RendererBackend = 'webgl2';
const options: EmapOptions = { container: 'map', renderer };
void Emap.create(options);
void Emap.create({ container: 'map', renderer: 'canvas2d' });
void Emap.create({
  container: 'map',
  renderer: 'webgpu',
  msdfWorkerUrl: new URL('https://example.test/emap-msdf-worker.js'),
  geometryWorkerUrl: new URL('https://example.test/emap-geometry-worker.js'),
  screenPathFiltering: false,
});
declare const map: Emap;
const actual: RendererBackend | null = map.getRenderer();
void actual;
// @ts-expect-error backend spellings are explicit, not a device selection heuristic
void Emap.create({ container: 'map', renderer: 'webgl' });
