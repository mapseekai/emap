/** A stable service identity shared across bundles, never shared mutable state. */
export type ServiceKey<T> = symbol & { readonly __serviceType?: T };

export function serviceKey<T>(id: string): ServiceKey<T> {
  if (!id.trim()) throw new Error('Service id must not be empty');
  return Symbol.for(`emap.service.${id}`) as ServiceKey<T>;
}

export interface ServiceResolver {
  has<T>(key: ServiceKey<T>): boolean;
  get<T>(key: ServiceKey<T>): T;
  list(): readonly { key: symbol; owner: string }[];
}

/** Instance-local registry. Publishing is owned by PluginRuntime contexts. */
export class ServiceRegistry implements ServiceResolver {
  private readonly entries = new Map<symbol, { value: unknown; owner: string }>();

  has<T>(key: ServiceKey<T>): boolean {
    return this.entries.has(key);
  }

  get<T>(key: ServiceKey<T>): T {
    const entry = this.entries.get(key);
    if (!entry) throw new Error(`Missing service: ${key.description}`);
    return entry.value as T;
  }

  list(): readonly { key: symbol; owner: string }[] {
    return [...this.entries].map(([key, { owner }]) => ({ key, owner }));
  }

  publish<T>(key: ServiceKey<T>, value: T, owner: string): () => void {
    if (this.entries.has(key)) throw new Error(`Service already provided: ${key.description}`);
    if (value === undefined) throw new Error(`Undefined service: ${key.description}`);
    const entry = { value, owner };
    this.entries.set(key, entry);
    return () => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    };
  }
}
