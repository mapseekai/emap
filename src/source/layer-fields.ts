import type { DataTable, MapshaperDataset, MapshaperLayer } from '../types/mapshaper-types';
import type { PackedSession, ParsedCommand } from '../adapter/mapshaper-adapter';
import type { LayerFieldDefinition } from './create-layer';

/** Restore field discovery after mapshaper clones a table. */
export function bindLayerFields(layer: MapshaperLayer): void {
  if (!layer.fields || !layer.data) return;
  const table = layer.data;
  table.getFields = () =>
    Array.from(
      new Set([
        ...(layer.fields ?? []).map((field) => field.name),
        ...Object.keys(table.getRecords?.()[0] ?? {}),
      ]),
    );
}

export function packLayerFields(packed: PackedSession, datasets: MapshaperDataset[]): void {
  if (!datasets.some((dataset) => dataset.layers.some((layer) => layer.fields))) return;
  packed.emapLayerFields = datasets.map((dataset) => dataset.layers.map((layer) => layer.fields));
}

export function restoreLayerFields(packed: PackedSession, datasets: MapshaperDataset[]): void {
  const schemas = packed.emapLayerFields as (LayerFieldDefinition[] | undefined)[][] | undefined;
  if (!Array.isArray(schemas)) return;
  datasets.forEach((dataset, i) =>
    dataset.layers.forEach((layer, j) => {
      const fields = schemas[i]?.[j];
      if (!Array.isArray(fields)) return;
      layer.fields = fields.map((field) => ({ ...field }));
      bindLayerFields(layer);
    }),
  );
}

/** Apply field-name commands to metadata with the same semantics as mapshaper's records. */
export async function runWithLayerFields(
  dataset: MapshaperDataset,
  commands: ParsedCommand[],
  run: (commands: ParsedCommand[]) => Promise<MapshaperDataset>,
  createTable: (records: Record<string, unknown>[]) => DataTable,
  targets: () => MapshaperLayer[],
  runSchema: (dataset: MapshaperDataset, commands: ParsedCommand[]) => Promise<MapshaperDataset>,
): Promise<MapshaperDataset> {
  for (const layer of dataset.layers) bindLayerFields(layer);
  if (
    !dataset.layers.some((layer) => layer.fields) ||
    !commands.some(
      (command) => command.name === 'rename-fields' || command.name === 'filter-fields',
    )
  )
    return run(commands);
  let result = dataset;
  // Keep the same Job/catalog throughout: target selections survive each step.
  for (const command of commands) {
    const updates: Array<{ layer: MapshaperLayer; fields: LayerFieldDefinition[] }> = [];
    if (command.name === 'rename-fields' || command.name === 'filter-fields') {
      for (const layer of targets()) {
        if (!layer.fields) continue;
        bindLayerFields(layer);
        const record = Object.fromEntries(
          (layer.data?.getFields?.() ?? []).map((name) => [
            name,
            layer.fields?.find((field) => field.name === name) ?? null,
          ]),
        );
        const { target: _target, ...options } = command.options;
        const schema = await runSchema(
          { layers: [{ name: layer.name, shapes: [null], data: createTable([record]) }] },
          [{ name: command.name, options }],
        );
        const fields = Object.entries(schema.layers[0].data?.getRecords?.()[0] ?? {})
          .filter(([, field]) => field !== null)
          .map(([name, field]) => ({ ...(field as LayerFieldDefinition), name }));
        updates.push({ layer, fields });
      }
    }
    result = await run([command]);
    for (const { layer, fields } of updates) {
      layer.fields = fields;
      bindLayerFields(layer);
    }
  }
  return result;
}
