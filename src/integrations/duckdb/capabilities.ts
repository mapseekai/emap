import type { Plugin } from 'cordis';
import { type InputSchema } from '../../runtime/services/capabilities';
import { resolveDatasetCRSMetadata } from '../../domain/geo/crs-resolver';
import type { DuckDbToolParameter, DuckDbToolObjectProperty } from './core/tool-definition';
import { duckDbToolbox } from './toolbox';
function parameterSchema(parameter: DuckDbToolParameter | DuckDbToolObjectProperty): InputSchema {
  if (parameter.type === 'enum') return { type: 'string', enum: parameter.enumValues ?? [] };
  if (parameter.type === 'string[]')
    return {
      type: 'array',
      items: { type: 'string' },
      ...('minItems' in parameter ? { minItems: parameter.minItems } : {}),
    };
  if (parameter.type === 'object[]') {
    const fields = parameter.itemProperties ?? [];
    return {
      type: 'array',
      minItems: parameter.minItems,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(fields.map((field) => [field.name, parameterSchema(field)])),
        required: fields.filter((field) => field.required).map((field) => field.name),
      },
    };
  }
  return {
    type: parameter.type,
    ...('minimum' in parameter ? { minimum: parameter.minimum } : {}),
    ...('exclusiveMinimum' in parameter ? { exclusiveMinimum: parameter.exclusiveMinimum } : {}),
  };
}
/** Exposes every toolbox tool through source references, never model-supplied datasets. */
export const duckDbCapabilityPlugins: readonly Plugin.Object[] = duckDbToolbox
  .list()
  .map((tool) => ({
    name: `capability.duckdb.${tool.id}`,
    inject: ['capabilities', 'document', 'duckDbProcessing'],
    apply(ctx) {
      ctx.effect(function* () {
        const document = ctx.document;
        const processing = ctx.duckDbProcessing;
        yield ctx.effect(() =>
          ctx.capabilities.register({
            id: `duckdb.${tool.id}`,
            title: tool.title,
            description: tool.description,
            category: `duckdb.${tool.category}`,
            effects: ['read'],
            undoable: false,
            cost: tool.cost,
            crs: tool.crs,
            keywords: tool.agent.keywords,
            whenToUse: tool.agent.whenToUse,
            avoidWhen: tool.agent.avoidWhen,
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              required: ['inputs'],
              properties: {
                inputs: {
                  type: 'object',
                  additionalProperties: false,
                  properties: Object.fromEntries(
                    tool.inputs.map((input) => [input.name, { type: 'string', minLength: 1 }]),
                  ),
                  required: tool.inputs
                    .filter((input) => input.required)
                    .map((input) => input.name),
                },
                params: {
                  type: 'object',
                  additionalProperties: false,
                  properties: Object.fromEntries(
                    tool.parameters.map((parameter) => [
                      parameter.name,
                      parameterSchema(parameter),
                    ]),
                  ),
                  required: tool.parameters
                    .filter((parameter) => parameter.required && parameter.default === undefined)
                    .map((parameter) => parameter.name),
                },
              },
            },
            async execute(input, call) {
              const sources = input.inputs as Record<string, string>;
              const snapshots = Object.entries(sources).map(([name, id]) => {
                const source = document._sources.get(id);
                const dataset = source?.getDataset();
                if (!source || !dataset) throw new Error(`Source not found: ${id}`);
                return {
                  name,
                  id,
                  source,
                  dataset,
                  edit: dataset.editVersion,
                  attributes: dataset.attributeVersion,
                  crs: resolveDatasetCRSMetadata(dataset),
                };
              });
              call.assertActive();
              const result = await processing.execute(tool.id, {
                inputs: Object.fromEntries(
                  snapshots.map((snapshot) => [snapshot.name, snapshot.dataset]),
                ),
                params: input.params as Record<string, unknown> | undefined,
              });
              call.assertActive();
              for (const snapshot of snapshots) {
                if (
                  document._sources.get(snapshot.id) !== snapshot.source ||
                  snapshot.source.getDataset() !== snapshot.dataset ||
                  snapshot.dataset.editVersion !== snapshot.edit ||
                  snapshot.dataset.attributeVersion !== snapshot.attributes ||
                  resolveDatasetCRSMetadata(snapshot.dataset) !== snapshot.crs
                )
                  throw new Error(`Source changed during processing: ${snapshot.id}`);
              }
              return result;
            },
          }),
        );
      });
    },
  }));
