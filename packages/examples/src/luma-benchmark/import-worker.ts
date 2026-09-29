import { serve, browserHost, output } from '@mapseekai/tasklane/host';
import { encodeWorkerPacket, workerPacketTransfers } from '../../../../src/integrations/mapshaper/binary';
import type { ScreenPathRequest } from '../../../../src/engine/rendering/luma/screen-paths';
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
  screenView: ScreenPathRequest;
};
serve(browserHost(self as unknown as Parameters<typeof browserHost>[0]), { benchmark: async (payload, ctx) => {
  const data = payload as Message;
  let state = ctx.cache.get<{dataset: MapshaperDataset | null; lod: FullGeometrySource | null}>('source');
  if (!state) {
    state = { dataset: null, lod: null };
    ctx.cache.setResource('source', state, 2 * 1024 ** 3, (value) => { value.lod?.dispose(); value.lod = null; value.dataset = null; });
  }
  let { dataset, lod } = state;
  const respond = (value: unknown, transfer: Transferable[] = []) => {
    const packet = encodeWorkerPacket(value, transfer);
    return output(packet, workerPacketTransfers(packet));
  };
    if (data.type === 'initialize') {
      if (!dataset) throw new Error('No imported dataset');
      const { FullGeometrySource } = await import(
        '../../../../src/engine/rendering/luma/spatial-chunks'
      );
      lod?.dispose();
      lod = state.lod = new FullGeometrySource(dataset, data.bounds);
      await lod.initialize(ctx.signal, (message) =>
        ctx.progress({ type: 'stage', message }),
      );
      const chunks = lod.chunks.map(({ id, kind, layer, bounds, rawVertices }) => ({
        id,
        kind,
        layer,
        bounds,
        rawVertices,
      }));
      return respond({ type: 'response', id: data.id, result: chunks });
    } else if (data.type === 'patch') {
      if (!lod) throw new Error('LOD source is not initialized');
      const changed = await lod.patch(data.patch, ctx.signal);
      return respond({
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
      return respond({ type: 'response', id: data.id, result, buildMs: performance.now() - started }, transfer);
    } else if (data.type === 'screen-paths') {
      if (!lod) throw new Error('Screen path source is not initialized');
      const started=performance.now();
      const result=lod.buildScreenPaths(lod.chunks[data.chunk],data.screenView);
      const transfer=[result.geometry.vertices.buffer,result.coordinates.buffer,result.offsets.buffer,result.arcIds.buffer,
        ...(result.geometry.pathRanges?[result.geometry.pathRanges.bounds.buffer,result.geometry.pathRanges.segments.buffer]:[])];
      return respond({type:'response',id:data.id,result,buildMs:performance.now()-started},transfer as ArrayBuffer[]);
    } else if (data.type === 'build') {
      if (!lod) throw new Error('LOD source is not initialized');
      const { packDisplayChunk } = await import(
        '../../../../src/engine/rendering/luma/spatial-chunks'
      );
      const started = performance.now();
      const packet = packDisplayChunk(lod.build(lod.chunks[data.chunk], data.level));
      return respond(
        { type: 'response', id: data.id, result: packet, buildMs: performance.now() - started, triangulationStats: lod.triangulationStats },
        [
          packet.coordinates.buffer,
          packet.offsets.buffer,
          packet.geometry.vertices.buffer,
          ...(packet.geometry.pathRanges ? [packet.geometry.pathRanges.bounds.buffer, packet.geometry.pathRanges.segments.buffer] : []),
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
      dataset = state.dataset = await importGeoJSONFileStream(
        data.file,
        ctx.signal,
        (bytes, features) => ctx.progress({ type: 'progress', bytes, features }),
      );
      ctx.progress({ type: 'stage', message: '构建原生 mapshaper 拓扑…' });
      if (dataset.arcs) getDefaultMapshaperAdapter().buildTopology(dataset);
      const vertices = dataset.arcs?.getVertexData?.();
      // Main thread owns the authoritative dataset; the worker keeps a render-only copy.
      const arcs = vertices
        ? { nn: vertices.nn, xx: vertices.xx, yy: vertices.yy }
        : undefined;
      const layers = dataset.layers.map((layer) => ({
        name: layer.name,
        geometry_type: layer.geometry_type,
        shapes: layer.shapes,
        records: layer.data?.getRecords?.(),
      }));
      const response = respond({ type: 'result', layers, info: dataset.info, arcs });
      for (const layer of dataset.layers) layer.data = undefined;
      return response;
    }
}});
