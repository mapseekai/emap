import type { Context } from 'cordis';
import type { Plugin } from 'cordis';
import { type InputSchema } from '../../services/capabilities';
import { operationSchemas } from './generated-schemas';
type SchemaEntry = {
  parameters: readonly string[];
  flatten: boolean;
  inputSchema: InputSchema;
};
function unwrap(result: unknown): unknown {
  if (result && typeof result === 'object' && 'ok' in result) {
    if (result.ok === false) {
      const error = 'error' in result ? result.error : undefined;
      throw new Error('GIS operation failed', { cause: error });
    }
    return 'value' in result ? result.value : undefined;
  }
  return result;
}
/** A capability is a consumer of a domain service, never a second GIS algorithm. */
function operationPlugins(
  prefix: string,
  key: keyof Context & string,
  schemas: Record<string, SchemaEntry>,
): Plugin.Object[] {
  return Object.entries(schemas).map(([name, schema]) => ({
    name: `capability.${prefix}.${name}`,
    inject: ['capabilities', key],
    apply(ctx) {
      ctx.effect(function* () {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- The Cordis proxy forwards members with Reflect.apply below.
        const service = ctx[key] as unknown as Record<string, (...args: unknown[]) => unknown>;
        const readOnly =
          name === 'checkGeometry' ||
          name === 'projectLayer' ||
          name.startsWith('get') ||
          name.startsWith('is') ||
          name.startsWith('can') ||
          name.startsWith('query');
        const effect = readOnly
          ? 'read'
          : prefix === 'view'
            ? 'view'
            : prefix === 'selection'
              ? 'selection'
              : 'document';
        const title = name.replace(/([a-z])([A-Z])/g, '$1 $2');
        yield ctx.effect(() =>
          ctx.capabilities.register({
            id: `${prefix}.${name}`,
            title,
            description: `${title}. Uses the ${prefix} domain service and its existing validation.`,
            category: prefix,
            inputSchema: schema.inputSchema,
            effects: [effect],
            undoable: !readOnly && ['mapshaper', 'attributes', 'edit', 'history'].includes(prefix),
            cost: prefix === 'mapshaper' ? 'high' : 'low',
            crs: 'any',
            keywords: [name, prefix],
            execute(input, call) {
              call.assertActive();
              const selected =
                prefix === 'mapshaper'
                  ? (service.withSignal(call.signal) as typeof service)
                  : service;
              const args = schema.flatten
                ? [input]
                : schema.parameters.map((parameter) => input[parameter]);
              const result = Reflect.apply(selected[name], selected, args);
              return result instanceof Promise ? result.then(unwrap) : unwrap(result);
            },
          }),
        );
      });
    },
  }));
}
export const mapshaperCapabilityPlugins = operationPlugins(
  'mapshaper',
  'ops',
  operationSchemas.MapshaperOps,
);
export const attributeCapabilityPlugins = operationPlugins(
  'attributes',
  'attributes',
  operationSchemas.AttributeOps,
);
export const editCapabilityPlugins = operationPlugins(
  'edit',
  'editSession',
  operationSchemas.EditSessions,
);
export const workspaceCapabilityPlugins: readonly Plugin.Object[] = [
  ...operationPlugins('layers', 'layers', operationSchemas.LayerServiceImpl),
  ...operationPlugins('source', 'source', operationSchemas.SourceServiceImpl),
  ...operationPlugins('projection', 'projection', operationSchemas.ProjectionServiceImpl),
  ...operationPlugins('view', 'view', operationSchemas.ViewServiceImpl),
  ...operationPlugins('selection', 'selection', operationSchemas.SelectionServiceImpl),
  ...operationPlugins('history', 'history', operationSchemas.HistoryServiceImpl),
  ...operationPlugins('query', 'query', operationSchemas.QueryServiceImpl),
];
