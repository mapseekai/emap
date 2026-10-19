import type { CapabilityRegistryContract, CapabilityInvocation } from '../services/capabilities';

/** Provider-neutral tool definitions. The host chooses the model and transport. */
export function describeAgentTools(registry: CapabilityRegistryContract) {
  return registry.list().map((tool) => ({
    name: tool.id,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      readOnlyHint: tool.effects.every((effect) => effect === 'read'),
      destructiveHint: tool.effects.includes('document'),
    },
  }));
}

/** Summaries contain no full feature geometry or attribute table by default. */
export function summarizeCapabilityResult(value: unknown): Readonly<Record<string, unknown>> {
  if (value === undefined) return { kind: 'completed' };
  if (value === null || typeof value === 'number' || typeof value === 'boolean')
    return { kind: 'value', value };
  if (typeof value === 'string')
    return {
      kind: 'text',
      value: value.slice(0, 2000),
      truncated: value.length > 2000,
    };
  if (typeof Blob !== 'undefined' && value instanceof Blob)
    return { kind: 'file', bytes: value.size, mimeType: value.type };
  if (Array.isArray(value)) return { kind: 'array', count: value.length };
  if (value && typeof value === 'object' && 'layers' in value && Array.isArray(value.layers)) {
    const layers = value.layers.slice(0, 100).map((layer: unknown) => {
      if (!layer || typeof layer !== 'object') return {};
      let features = 0;
      if ('shapes' in layer && Array.isArray(layer.shapes)) features = layer.shapes.length;
      else if (
        'data' in layer &&
        layer.data &&
        typeof layer.data === 'object' &&
        'size' in layer.data &&
        typeof layer.data.size === 'function'
      ) {
        const count: unknown = Reflect.apply(layer.data.size, layer.data, []);
        if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
          features = count;
      }
      return {
        name: 'name' in layer && typeof layer.name === 'string' ? layer.name : undefined,
        geometry:
          'geometry_type' in layer &&
          (typeof layer.geometry_type === 'string' || layer.geometry_type === null)
            ? layer.geometry_type
            : undefined,
        features,
      };
    });
    return { kind: 'dataset', layerCount: value.layers.length, layers };
  }
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string')
    return { kind: 'resource', id: value.id };
  return { kind: 'object' };
}

/** `content` is model-facing; `value` stays local for UI/workflow consumption. No network I/O. */
export async function invokeAgentTool(
  registry: CapabilityRegistryContract,
  id: string,
  input: Readonly<Record<string, unknown>>,
  invocation: Omit<CapabilityInvocation, 'origin'> = {},
) {
  const value = await registry.execute(id, input, {
    ...invocation,
    origin: 'agent',
  });
  return { content: summarizeCapabilityResult(value), value };
}
