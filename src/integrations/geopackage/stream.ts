import { getDefaultMapshaperAdapter } from '../mapshaper/adapter';
import {
  restoreGeoPackageDataset,
  transferGeoPackageDataset,
  type GeoPackageTransfer,
} from './transfer';
import type { GeoPackageDataset, GeoPackageLimits } from './types';
import type { FeatureShape, MapshaperLayer } from '../../shared/types/mapshaper-types';

/** Bound structured-clone/deserialization by rows; one acknowledged batch in flight.
 * A single unusually large feature is not split or truncated. */
export const GEOPACKAGE_TRANSFER_ROWS = 4096;
type LayerHeader = Pick<MapshaperLayer, 'name' | 'geometry_type' | 'fields'> & {
  rows: number;
};
export type GeoPackageStreamMessage =
  | { type: 'header'; sequence: number; layers: LayerHeader[]; info: GeoPackageDataset['info'] }
  | {
      type: 'batch';
      sequence: number;
      layer: number;
      offset: number;
      value: GeoPackageTransfer['layers'][number];
    }
  | { type: 'result'; sequence: number; arcs?: GeoPackageTransfer['arcs'] };

/** Consumes a worker-owned, fully validated dataset only after topology is complete.
 * Coordinates transfer; attribute blobs are cloned so shared mixed-family records
 * cannot be detached by an earlier batch. No input bytes or partial dataset escape. */
export async function streamGeoPackageDataset(
  dataset: GeoPackageDataset,
  send: (message: GeoPackageStreamMessage, transfers: Transferable[]) => Promise<void>,
): Promise<void> {
  let sequence = 0;
  const layers = dataset.layers.map((layer) => ({
    name: layer.name,
    geometry_type: layer.geometry_type,
    fields: layer.fields,
    rows: layer.shapes?.length ?? 0,
  }));
  await send(
    { type: 'header', sequence: sequence++, layers, info: { ...dataset.info, crs: undefined } },
    [],
  );
  const adapter = getDefaultMapshaperAdapter();
  for (let index = 0; index < dataset.layers.length; index++) {
    const layer = dataset.layers[index],
      records = layer.data?.getRecords?.() ?? [];
    for (let offset = 0; offset < layers[index].rows; offset += GEOPACKAGE_TRANSFER_ROWS) {
      const end = Math.min(layers[index].rows, offset + GEOPACKAGE_TRANSFER_ROWS);
      const value = transferGeoPackageDataset({
        layers: [
          {
            ...layer,
            shapes: layer.shapes!.slice(offset, end),
            data: adapter.createDataTable(records.slice(offset, end)),
          },
        ],
        info: dataset.info,
      }).layers[0];
      const transfers = [
        value.pointCoordinates,
        value.pointCounts,
        value.pathCounts,
        value.partCounts,
        value.arcIds,
      ]
        .filter((v) => v !== undefined)
        .map((v) => v!.buffer as ArrayBuffer);
      await send({ type: 'batch', sequence: sequence++, layer: index, offset, value }, transfers);
    }
    // The sender exclusively owns this dataset. Release completed layers instead
    // of retaining both complete worker and UI copies until the last table arrives.
    layer.shapes = null;
    layer.data = undefined;
  }
  const data = dataset.arcs?.getVertexData?.();
  const arcs = data ? { nn: data.nn, xx: data.xx, yy: data.yy } : undefined;
  await send(
    { type: 'result', sequence, arcs },
    arcs ? ([...new Set([arcs.nn.buffer, arcs.xx.buffer, arcs.yy.buffer])] as ArrayBuffer[]) : [],
  );
}

/** Staged native storage remains private until every table and arc buffer arrives. */
export class GeoPackageStreamReceiver {
  private sequence = 0;
  private info?: GeoPackageDataset['info'];
  private layers: GeoPackageTransfer['layers'] = [];
  private received: number[] = [];
  private completed = false;
  constructor(private readonly limits: GeoPackageLimits) {}
  accept(message: GeoPackageStreamMessage): GeoPackageDataset | undefined {
    if (this.completed || message.sequence !== this.sequence++)
      throw new Error('Out-of-order GeoPackage Worker response');
    if (message.type === 'header') {
      if (
        this.info ||
        !Array.isArray(message.layers) ||
        message.layers.length > this.limits.maxLayers * 4
      )
        throw new Error('Invalid GeoPackage Worker header');
      let total = 0;
      for (const layer of message.layers) {
        if (
          !Number.isSafeInteger(layer.rows) ||
          layer.rows < 0 ||
          (total += layer.rows) > this.limits.maxFeatures * 3
        )
          throw new Error('Invalid GeoPackage Worker row count');
        this.layers.push({
          name: layer.name,
          geometry_type: layer.geometry_type,
          fields: layer.fields,
          shapes: new Array(layer.rows),
          records: new Array(layer.rows),
        });
        this.received.push(0);
      }
      this.info = message.info;
      return;
    }
    if (!this.info) throw new Error('Missing GeoPackage Worker header');
    if (message.type === 'batch') {
      const layer = this.layers[message.layer],
        value = message.value;
      const count = value?.records?.length;
      if (
        !layer ||
        !Number.isInteger(message.layer) ||
        message.offset !== this.received[message.layer] ||
        !Number.isSafeInteger(count) ||
        count < 1 ||
        count > GEOPACKAGE_TRANSFER_ROWS ||
        message.offset + count > layer.records.length ||
        value.geometry_type !== layer.geometry_type
      )
        throw new Error('Invalid GeoPackage Worker batch');
      const restored = restoreGeoPackageDataset({ layers: [value], info: this.info }).layers[0];
      if (!restored.shapes || restored.shapes.length !== count)
        throw new Error('GeoPackage Worker shape/record count differs');
      for (let i = 0; i < count; i++) {
        layer.shapes![message.offset + i] = restored.shapes[i] as FeatureShape | null;
        layer.records[message.offset + i] = value.records[i];
      }
      this.received[message.layer] += count;
      return;
    }
    if (
      message.type !== 'result' ||
      this.layers.some((layer, i) => layer.records.length !== this.received[i])
    )
      throw new Error('Incomplete GeoPackage Worker dataset');
    this.completed = true;
    const result = restoreGeoPackageDataset({
      layers: this.layers,
      arcs: message.arcs,
      info: this.info,
    });
    this.layers = [];
    this.info = undefined;
    return result;
  }
}
