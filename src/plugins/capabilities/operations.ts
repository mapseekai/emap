import type { Plugin } from '../../kernel/plugin';
import type { ServiceKey } from '../../kernel/service';
import { CapabilityService, type InputSchema } from '../../services/capabilities';
import {
  AttributeService,
  EditSessionService,
  MapshaperProcessingService,
  LayerService,
  SourceService,
  ProjectionService,
  ViewService,
  SelectionService,
  HistoryService,
  QueryService,
} from '../../services/keys';
import { operationSchemas } from './generated-schemas';

type SchemaEntry = { parameters: readonly string[]; flatten: boolean; inputSchema: InputSchema };

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
  key: ServiceKey<unknown>,
  schemas: Record<string, SchemaEntry>,
): Plugin[] {
  return Object.entries(schemas).map(([name, schema]) => ({
    id: `capability.${prefix}.${name}`,
    requires: [CapabilityService, key],
    setup(ctx) {
      const service = ctx.get(key) as Record<string, (...args: unknown[]) => unknown>;
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
      ctx.defer(
        ctx.get(CapabilityService).register({
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
    },
  }));
}

export const mapshaperCapabilityPlugins = operationPlugins(
  'mapshaper',
  MapshaperProcessingService,
  operationSchemas.MapshaperOps,
);
export const attributeCapabilityPlugins = operationPlugins(
  'attributes',
  AttributeService,
  operationSchemas.AttributeOps,
);
export const editCapabilityPlugins = operationPlugins(
  'edit',
  EditSessionService,
  operationSchemas.EditSessions,
);

export const workspaceCapabilityPlugins: readonly Plugin[] = [
  ...operationPlugins('layers', LayerService, operationSchemas.LayerServiceImpl),
  ...operationPlugins('source', SourceService, operationSchemas.SourceServiceImpl),
  ...operationPlugins('projection', ProjectionService, operationSchemas.ProjectionServiceImpl),
  ...operationPlugins('view', ViewService, operationSchemas.ViewServiceImpl),
  ...operationPlugins('selection', SelectionService, operationSchemas.SelectionServiceImpl),
  ...operationPlugins('history', HistoryService, operationSchemas.HistoryServiceImpl),
  ...operationPlugins('query', QueryService, operationSchemas.QueryServiceImpl),
];
