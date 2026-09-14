import type { InputSchema } from '../services/capabilities';

function assertJson(
  value: unknown,
  depth: number,
  seen: Set<object>,
  budget: { nodes: number },
): void {
  if (++budget.nodes > 20000 || depth > 32)
    throw new TypeError('Capability arguments exceed the structural budget');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object')
    throw new TypeError('Capability arguments must contain finite JSON values');
  if (seen.has(value)) throw new TypeError('Capability arguments must not contain cycles');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
    throw new TypeError('Capability arguments must be plain objects');
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string')
      throw new TypeError('Capability arguments cannot contain symbol keys');
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in property))
      throw new TypeError('Capability arguments cannot contain accessors');
    assertJson(property.value, depth + 1, seen, budget);
  }
  seen.delete(value);
}

function check(schema: InputSchema, value: unknown, path: string, depth = 0): void {
  if (depth > 32) throw new TypeError('Capability schema exceeds maximum depth');
  const fail = (message: string): never => {
    throw new TypeError(`${path}: ${message}`);
  };
  if (schema.anyOf) {
    const valid = schema.anyOf.some((branch) => {
      try {
        check(branch, value, path, depth + 1);
        return true;
      } catch {
        return false;
      }
    });
    if (!valid) fail('does not match any allowed schema');
  }
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value)))
    fail('not an allowed enum value');
  if (schema.type === 'null' && value !== null) fail('must be null');
  if (schema.type === 'string') {
    if (typeof value !== 'string') fail('must be a string');
    if (schema.minLength !== undefined && (value as string).length < schema.minLength)
      fail('string is too short');
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') fail('must be a boolean');
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('must be a finite number');
    const number = value as number;
    if (schema.type === 'integer' && !Number.isInteger(number)) fail('must be an integer');
    if (schema.minimum !== undefined && number < schema.minimum) fail('below minimum');
    if (schema.exclusiveMinimum !== undefined && number <= schema.exclusiveMinimum)
      fail('must exceed minimum');
    if (schema.maximum !== undefined && number > schema.maximum) fail('above maximum');
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('must be an array');
    const array = value as unknown[];
    if (schema.minItems !== undefined && array.length < schema.minItems) fail('too few items');
    if (schema.maxItems !== undefined && array.length > schema.maxItems) fail('too many items');
    array.forEach((item, index) =>
      check(
        schema.prefixItems?.[index] ?? schema.items ?? {},
        item,
        `${path}[${index}]`,
        depth + 1,
      ),
    );
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('must be an object');
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? [])
      if (!Object.hasOwn(object, key)) fail(`missing ${key}`);
    for (const key of Object.keys(object)) {
      const property = Object.hasOwn(schema.properties ?? {}, key)
        ? schema.properties![key]
        : undefined;
      if (property) check(property, object[key], `${path}.${key}`, depth + 1);
      else if (schema.additionalProperties === false) fail(`unknown property ${key}`);
      else if (typeof schema.additionalProperties === 'object')
        check(schema.additionalProperties, object[key], `${path}.${key}`, depth + 1);
    }
  }
}

export function validateCapabilityInput(schema: InputSchema, value: unknown): void {
  assertJson(value, 0, new Set(), { nodes: 0 });
  check(schema, value, '$');
}

export function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeJson(child);
  }
  return value;
}
