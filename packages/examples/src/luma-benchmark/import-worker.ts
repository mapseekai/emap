import type { PointLodRequest } from '../../../../src/engine/rendering/luma/point-lod-source';
import type { CoordinatePatch } from '../../../../src/engine/rendering/luma/edit-patch';
import type { MapshaperDataset } from '../../../../src/shared/types/mapshaper-types';
import type { FullGeometrySource } from '../../../../src/engine/rendering/luma/spatial-chunks';
type Message = {
  id?: number;
  type?: string;
  file: File;
  vendorUrl: string;
  bounds: [number, number, number, number];
  chunk: number;
  level: number;
  patch: CoordinatePatch;
  pointView: PointLodRequest;
};
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Message>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
let dataset: MapshaperDataset | null = null;
let lod: FullGeometrySource | null = null;
async function processMessage(event: MessageEvent<Message>): Promise<void> {
  const data = event.data;
  try {
    if (data.type === 'initialize') {
      if (!dataset) throw new Error('No imported dataset');
      const { FullGeometrySource } = await import(
        '../../../../src/engine/rendering/luma/spatial-chunks'
      );
      lod?.dispose();
      lod = new FullGeometrySource(dataset, data.bounds);
      await lod.initialize(new AbortController().signal, (message) =>
        scope.postMessage({ type: 'stage', message }),
      );
      const chunks = lod.chunks.map(({ id, kind, layer, bounds, rawVertices }) => ({
        id,
        kind,
        layer,
        bounds,
        rawVertices,
      }));
      scope.postMessage({ type: 'response', id: data.id, result: chunks });
    } else if (data.type === 'patch') {
      if (!lod) throw new Error('LOD source is not initialized');
      const changed = await lod.patch(data.patch, new AbortController().signal);
      scope.postMessage({
        type: 'response',
        id: data.id,
        result: changed.map(({ id, kind, layer, bounds, rawVertices }) => ({
          id,
          kind,
          layer,
          bounds,
          rawVertices,
        })),
      });
    } else if (data.type === 'point-lod') {
      if (!lod) throw new Error('Point LOD source is not initialized');
      const started = performance.now();
      const result = lod.queryPointLod(data.pointView);
      const transfer = result.flatMap(p => p.geometry ? [p.geometry.vertices.buffer,
        p.featureIds!.buffer, p.componentIds!.buffer] : []) as ArrayBuffer[];
      scope.postMessage({ type: 'response', id: data.id, result, buildMs: performance.now() - started }, transfer);
    } else if (data.type === 'build') {
      if (!lod) throw new Error('LOD source is not initialized');
      const { packDisplayChunk } = await import(
        '../../../../src/engine/rendering/luma/spatial-chunks'
      );
      const started = performance.now();
      const packet = packDisplayChunk(lod.build(lod.chunks[data.chunk], data.level));
      scope.postMessage(
        { type: 'response', id: data.id, result: packet, buildMs: performance.now() - started },
        [
          packet.coordinates.buffer,
          packet.offsets.buffer,
          packet.geometry.vertices.buffer,
          ...(packet.geometry.indices ? [packet.geometry.indices.buffer] : []),
        ] as ArrayBuffer[],
      );
    } else {
      await import(/* @vite-ignore */ data.vendorUrl);
      const { importGeoJSONFileStream } = await import(
        '../../../../src/integrations/mapshaper/geojson-stream'
      );
      const { getDefaultMapshaperAdapter } = await import(
        '../../../../src/integrations/mapshaper/adapter'
      );
      dataset = await importGeoJSONFileStream(
        data.file,
        new AbortController().signal,
        (bytes, features) => scope.postMessage({ type: 'progress', bytes, features }),
      );
      scope.postMessage({ type: 'stage', message: '构建原生 mapshaper 拓扑…' });
      if (dataset.arcs) getDefaultMapshaperAdapter().buildTopology(dataset);
      const vertices = dataset.arcs?.getVertexData?.();
      // Main thread owns the authoritative dataset; the worker keeps a render-only copy.
      const arcs = vertices
        ? { nn: vertices.nn.slice(), xx: vertices.xx.slice(), yy: vertices.yy.slice() }
        : undefined;
      const layers = dataset.layers.map((layer) => ({
        name: layer.name,
        geometry_type: layer.geometry_type,
        shapes: layer.shapes,
        records: layer.data?.getRecords?.(),
      }));
      scope.postMessage(
        { type: 'result', layers, info: dataset.info, arcs },
        arcs ? ([arcs.nn.buffer, arcs.xx.buffer, arcs.yy.buffer] as ArrayBuffer[]) : [],
      );
      // Attributes are not needed in the render-only worker copy.
      for (const layer of dataset.layers) layer.data = undefined;
    }
  } catch (error) {
    scope.postMessage({
      type: 'error',
      id: data.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

let queue = Promise.resolve();
scope.onmessage = (event) => {
  queue = queue.then(() => processMessage(event));
};
