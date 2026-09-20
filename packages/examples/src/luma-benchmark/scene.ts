import { Bounds } from '../../../../src/domain/geo/bounds';
import { getDefaultMapshaperAdapter } from '../../../../src/integrations/mapshaper/adapter';
import { normalizePointShape } from '../../../../src/domain/source/layer-utils';
import { openGeoTIFF } from '../../../../src/integrations/geotiff/source';
import { planRasterTile } from '../../../../src/engine/rendering/raster/tile';
import type { MapshaperDataset, MapshaperLayer } from '../../../../src/shared/types/mapshaper-types';
import type { RasterProcessingStats } from '../../../../src/domain/raster/types';
import type { Rect } from '../../../../src/integrations/luma/types';

export type Scenario = 'point' | 'polyline' | 'polygon' | 'raster';
export interface RasterTile { image: HTMLCanvasElement; bounds: Rect }
export interface Scene {
  lodSource?: import('./import-file').BenchmarkFileWorker;
  name: string;
  dataset: MapshaperDataset;
  bounds: Bounds;
  featureCount: number;
  vertexCount: number;
  tiles: RasterTile[];
  preparationMs: number;
  rasterStats?: RasterProcessingStats;
  dispose(): void;
}
export const MAX_FEATURES = 1_000_000;
export const MAX_VERTICES = 4_000_000;
export function yieldTask(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => signal.throwIfAborted());
}
/** Reads the authoritative dataset; never replaces it with GeoJSON or rounded coordinates. */
export function vectorScene(dataset: MapshaperDataset, name: string, preparationMs = 0): Scene {
  const bounds = new Bounds();
  let featureCount = 0;
  let vertexCount = dataset.arcs?.getPointCount?.() ?? 0;
  for (const layer of dataset.layers) {
    featureCount += layer.shapes?.length ?? 0;
    if (layer.geometry_type !== 'point') continue;
    for (const shape of layer.shapes ?? []) {
      if (!shape) continue;
      for (const p of normalizePointShape(shape)) {
        vertexCount++;
        if (Number.isFinite(p[0]) && Number.isFinite(p[1])) bounds.mergePoint(p[0], p[1]);
      }
    }
  }
  const arcs = dataset.arcs;
  if (arcs) {
    for (let id = 0; id < arcs.size(); id++) {
      const iter = arcs.getArcIter(id);
      while (iter.hasNext()) {
        if (!arcs.getPointCount) vertexCount++;
        if (Number.isFinite(iter.x) && Number.isFinite(iter.y)) bounds.mergePoint(iter.x, iter.y);
      }
    }
  }
  if (!bounds.hasBounds() || !Number.isFinite(bounds.width + bounds.height))
    throw new Error('The dataset has no finite drawable coordinates.');
  return { name, dataset, bounds, featureCount, vertexCount, tiles: [], preparationMs, dispose() {} };
}
export async function generateScene(kind: Exclude<Scenario, 'raster'>, count: number, signal: AbortSignal): Promise<Scene> {
  if (!Number.isInteger(count) || count < 1 || count > (kind === 'point' ? MAX_FEATURES : 100_000))
    throw new Error('Invalid benchmark feature count.');
  const start = performance.now();
  const importer = getDefaultMapshaperAdapter().createPathImporter();
  let seed = 12345;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const side = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    if (i % 4096 === 0) await yieldTask(signal);
    importer.startShape();
    const x = 13_000_000 + (kind === 'point' ? random() * 10_000 : (i % side) * 10_000 / side);
    const y = 4_000_000 + (kind === 'point' ? random() * 10_000 : Math.floor(i / side) * 10_000 / side);
    const size = 7000 / side;
    if (kind === 'point') importer.importPoints([[x, y]]);
    else if (kind === 'polyline') {
      importer.importLine(Array.from({ length: 8 }, (_, j): [number, number] =>
        [x + j * size / 7, y + Math.sin(j * 0.8) * size * 0.4]));
    } else {
      importer.importRing([[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]);
      if (i % 4 === 0) {
        const a = size * 0.3, b = size * 0.7;
        importer.importRing([[x+a,y+a],[x+b,y+a],[x+b,y+b],[x+a,y+b],[x+a,y+a]], true);
      }
    }
  }
  signal.throwIfAborted();
  const dataset = importer.done();
  dataset.info = { ...dataset.info, crs_string: 'EPSG:3857' };
  const scene = vectorScene(dataset, `seed=12345 · ${kind} · ${count.toLocaleString()}`);
  scene.preparationMs = performance.now() - start;
  return scene;
}
/** Fixed decoded-tile working set: navigation intentionally excludes new I/O/LOD selection. */
export async function rasterScene(file: File, overview: File | undefined, signal: AbortSignal): Promise<Scene> {
  const start = performance.now();
  const source = await openGeoTIFF(file, {
    workerUrl: new URL(`${import.meta.env.BASE_URL}emap-geotiff-worker.js`, location.href),
    overviewFile: overview, signal, workerCount: 2,
  });
  const tiles: RasterTile[] = [];
  try {
    const metadata = source.metadata;
    const bounds = new Bounds(...metadata.bounds);
    const base = metadata.levels[0];
    const cols = Math.max(1, Math.ceil(8 * base.width / Math.max(base.width, base.height)));
    const rows = Math.max(1, Math.ceil(8 * base.height / Math.max(base.width, base.height)));
    const style = { resampling: 'bilinear' as const, stretch: 'auto' as const };
    for (let y = 0; y < rows; y++) {
      await yieldTask(signal);
      const outcomes = await Promise.allSettled(Array.from({ length: cols }, async (_, x) => {
        const b: Rect = [bounds.xmin + x * bounds.width / cols, bounds.ymin + y * bounds.height / rows,
          bounds.xmin + (x+1) * bounds.width / cols, bounds.ymin + (y+1) * bounds.height / rows];
        const plan = planRasterTile(metadata, b, (px, py) => [px, py], style, 256);
        if (!plan) return;
        if (!source.renderTile) throw new Error('GeoTIFF source has no Worker render capability.');
        const result = await source.renderTile({ read: plan.request, warp: plan.warp,
          width: plan.width, height: plan.height, style }, signal);
        signal.throwIfAborted();
        const image = document.createElement('canvas');
        image.width = result.width; image.height = result.height;
        const ctx = image.getContext('2d');
        if (!ctx) throw new Error('Cannot allocate raster tile.');
        ctx.putImageData(new ImageData(result.rgba, result.width, result.height), 0, 0);
        tiles.push({ image, bounds: b });
      }));
      for (const result of outcomes) if (result.status === 'rejected') throw result.reason;
    }
    signal.throwIfAborted();
    if (!tiles.length) throw new Error('GeoTIFF produced no display tiles.');
    return { name: `${file.name} · ${metadata.crs} · fixed decoded tiles`, dataset: { layers: [] }, bounds,
      tiles, featureCount: 0, vertexCount: 0, preparationMs: performance.now() - start,
      rasterStats: source.getProcessingStats?.(),
      dispose() { for (const t of tiles) t.image.width = t.image.height = 0; tiles.length = 0; },
    };
  } catch (error) {
    for (const t of tiles) t.image.width = t.image.height = 0;
    throw error;
  } finally { source.dispose(); }
}
export function drawableLayers(scene: Scene): MapshaperLayer[] {
  return scene.dataset.layers.filter((layer) => layer.shapes?.length && layer.geometry_type);
}
