/** JSON Schema subset accepted by the capability gateway. */
export interface InputSchema {
  readonly type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  readonly description?: string;
  readonly enum?: readonly (string | number | boolean | null)[];
  readonly properties?: Readonly<Record<string, InputSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | InputSchema;
  readonly items?: InputSchema;
  readonly prefixItems?: readonly InputSchema[];
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly minLength?: number;
  readonly minimum?: number;
  readonly exclusiveMinimum?: number;
  readonly maximum?: number;
  readonly anyOf?: readonly InputSchema[];
}
export type CapabilityEffect = 'read' | 'document' | 'selection' | 'view' | 'external';
export type CapabilityOrigin = 'api' | 'ui' | 'agent';
export interface CapabilityDescriptor {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly inputSchema: InputSchema;
  readonly effects: readonly CapabilityEffect[];
  readonly undoable: boolean;
  readonly cost: 'low' | 'medium' | 'high';
  readonly crs: 'any' | 'known' | 'projected';
  readonly keywords?: readonly string[];
  readonly whenToUse?: readonly string[];
  readonly avoidWhen?: readonly string[];
}
export interface CapabilityCallContext {
  readonly signal: AbortSignal;
  readonly origin: CapabilityOrigin;
  assertActive(): void;
}
export interface CapabilityDefinition extends CapabilityDescriptor {
  execute(
    input: Readonly<Record<string, unknown>>,
    context: CapabilityCallContext,
  ): unknown | Promise<unknown>;
}
export interface CapabilityInvocation {
  readonly origin?: CapabilityOrigin;
  readonly signal?: AbortSignal;
}
export interface CapabilityAuthorization {
  readonly capability: CapabilityDescriptor;
  readonly origin: CapabilityOrigin;
  readonly input: Readonly<Record<string, unknown>>;
}
/** Trusted host policy, never supplied inside model-generated tool arguments. */
export type CapabilityAuthorizer = (request: CapabilityAuthorization) => boolean | Promise<boolean>;
export interface CapabilityRun {
  readonly runId: number;
  readonly capabilityId: string;
  readonly origin: CapabilityOrigin;
  readonly status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly startedAt: number;
  readonly durationMs?: number;
  readonly error?: string;
}
export interface CapabilityRegistryContract {
  register(definition: CapabilityDefinition): () => void;
  list(category?: string): readonly CapabilityDescriptor[];
  get(id: string): CapabilityDescriptor | undefined;
  search(query: string): readonly CapabilityDescriptor[];
  execute<T = unknown>(
    id: string,
    input?: Readonly<Record<string, unknown>>,
    invocation?: CapabilityInvocation,
  ): Promise<T>;
  history(): readonly CapabilityRun[];
  dispose(): void;
}

/** Native Cordis service contracts; no emap-specific service container. */
declare module 'cordis' {
  interface Context {
    capabilities: CapabilityRegistryContract;
  }
}
