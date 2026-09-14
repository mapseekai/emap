import type {
  GeometryType,
  MapshaperDataset,
  MapshaperLayer,
} from '../../shared/types/mapshaper-types';
import { getDefaultMapshaperAdapter } from '../../integrations/mapshaper/adapter';
import { normalizeProjectCrsMetadata, resolveProjectCrsDefinition } from '../geo/crs-resolver';

/**
 * Field metadata for a newly created layer. Types describe defaults, not an expression schema.
 * @example
 * const field: LayerFieldDefinition = { name: 'name', type: 'string', defaultValue: '' };
 */
export interface LayerFieldDefinition {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean';
  readonly defaultValue?: string | number | boolean | null;
}

/**
 * Options for creating one empty, editable data layer.
 * @example
 * const options: CreateLayerOptions = {
 *   name: 'places', geometryType: 'point', crs: 'EPSG:4326',
 *   fields: [{ name: 'name', type: 'string', defaultValue: '' }],
 * };
 * await map.createLayer('places', options);
 */
export interface CreateLayerOptions {
  name: string;
  geometryType: GeometryType;
  /** Input CRS; registered sources use the map's project CRS. */
  crs: string;
  fields?: readonly LayerFieldDefinition[];
}

/** @internal Construct through the adapter; never import a dummy feature. */
export async function createLayerDataset(options: CreateLayerOptions): Promise<MapshaperDataset> {
  const name = options.name?.trim();
  if (!name) throw new Error('Layer name is required');
  if (!['point', 'polyline', 'polygon'].includes(options.geometryType)) {
    throw new Error('Invalid layer geometryType');
  }
  const fields = (options.fields ?? []).map((field) => ({ ...field }));
  const names = new Set<string>();
  for (const field of fields) {
    if (!field.name?.trim() || names.has(field.name))
      throw new Error('Invalid or duplicate field name');
    names.add(field.name);
    if (!['string', 'number', 'boolean'].includes(field.type))
      throw new Error('Invalid field type');
    const value = field.defaultValue;
    if (
      value != null &&
      (typeof value !== field.type || (typeof value === 'number' && !Number.isFinite(value)))
    ) {
      throw new Error(`Invalid default value for field '${field.name}'`);
    }
  }
  if (!options.crs?.trim()) throw new Error('Layer CRS is required');
  await resolveProjectCrsDefinition(options.crs);
  const adapter = getDefaultMapshaperAdapter();
  return {
    layers: [
      {
        name,
        geometry_type: options.geometryType,
        shapes: [],
        data: adapter.createDataTable([]),
        fields,
      },
    ],
    ...(options.geometryType === 'point' ? {} : { arcs: adapter.createArcCollection([]) }),
    info: { crs_string: normalizeProjectCrsMetadata(options.crs) ?? options.crs },
  };
}

/** @internal Fresh record for drawing; each feature owns its properties. */
export function createLayerRecord(layer: MapshaperLayer): Record<string, unknown> {
  return Object.fromEntries(
    (layer.fields ?? []).map((field) => [field.name, field.defaultValue ?? null]),
  );
}
