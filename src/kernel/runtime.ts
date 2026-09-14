import type { Plugin, PluginContext, PluginInspection, PluginStatus } from './plugin';
import { EffectScope } from './scope';
import { ServiceRegistry, type ServiceKey, type ServiceResolver } from './service';

interface MountedPlugin {
  plugin: Plugin;
  status: PluginStatus;
  scope?: EffectScope;
  error?: unknown;
}

/** A browser/DOM/GIS-independent plugin graph with instance-local services. */
export class PluginRuntime {
  private readonly registry = new ServiceRegistry();
  private readonly plugins = new Map<string, MountedPlugin>();
  private readonly pending: Promise<void>[] = [];
  private readonly failures: unknown[] = [];
  private disposed = false;
  private reconciling = false;

  get services(): ServiceResolver {
    return this.registry;
  }
  get isDisposed(): boolean {
    return this.disposed;
  }

  use(plugin: Plugin): this {
    return this.mount([plugin]);
  }

  /** Installation is atomic for the supplied group; order follows service dependencies. */
  mount(plugins: readonly Plugin[]): this {
    this.assertActive();
    if (this.reconciling)
      throw new Error('Cannot mount plugins during setup; pass them together to mount()');
    const previous = new Map(
      [...this.plugins].map(([id, mounted]) => [
        id,
        { status: mounted.status, error: mounted.error },
      ]),
    );
    const definitions = plugins.map((plugin) =>
      Object.freeze({
        ...plugin,
        requires: Object.freeze([...(plugin.requires ?? [])]),
        optional: Object.freeze([...(plugin.optional ?? [])]),
        provides: Object.freeze([...(plugin.provides ?? [])]),
      }),
    );
    this.validate([...this.plugins.values()].map((p) => p.plugin).concat(definitions));
    for (const plugin of definitions) this.plugins.set(plugin.id, { plugin, status: 'waiting' });
    try {
      this.reconcile();
    } catch (error) {
      for (const plugin of [...definitions].reverse()) {
        const mounted = this.plugins.get(plugin.id);
        if (mounted) this.deactivate(mounted);
        this.plugins.delete(plugin.id);
      }
      // A newly installed provider may have activated an older waiter. Restore
      // the waiter state as well so a failed installation cannot strand it.
      for (const [id, state] of previous) {
        const mounted = this.plugins.get(id);
        if (mounted && state.status === 'waiting') {
          this.deactivate(mounted);
          mounted.status = state.status;
          mounted.error = state.error;
        }
      }
      throw error;
    }
    return this;
  }

  /** Removing a provider suspends its consumers before releasing provider resources. */
  unmount(id: string): void {
    this.assertActive();
    const mounted = this.plugins.get(id);
    if (!mounted) return;
    this.deactivate(mounted);
    this.plugins.delete(id);
    this.reconcile();
  }

  disable(id: string): void {
    this.assertActive();
    const mounted = this.requirePlugin(id);
    this.deactivate(mounted);
    mounted.status = 'disabled';
    this.reconcile();
  }

  enable(id: string): void {
    this.assertActive();
    const mounted = this.requirePlugin(id);
    if (mounted.status === 'active') return;
    mounted.status = 'waiting';
    mounted.error = undefined;
    this.reconcile();
  }

  assertReady(): void {
    this.assertActive();
    const waiting = [...this.plugins.values()].filter(
      (p) => p.status !== 'active' && p.status !== 'disabled',
    );
    if (waiting.length)
      throw new Error(`Plugins not ready: ${waiting.map((p) => p.plugin.id).join(', ')}`);
  }

  inspect(): readonly PluginInspection[] {
    return [...this.plugins.values()].map(({ plugin, status, error }) => ({
      id: plugin.id,
      status,
      requires: (plugin.requires ?? []).map((key) => key.description ?? ''),
      provides: (plugin.provides ?? []).map((key) => key.description ?? ''),
      ...(error === undefined
        ? {}
        : { error: error instanceof Error ? error.message : String(error) }),
    }));
  }

  /** Cancels and synchronously unregisters everything, then awaits asynchronous cleanup. */
  dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true;
      for (const mounted of [...this.plugins.values()].reverse()) this.deactivate(mounted);
      this.plugins.clear();
    }
    return this.settled();
  }

  async settled(): Promise<void> {
    while (this.pending.length) await Promise.all(this.pending.splice(0));
    if (this.failures.length)
      throw new AggregateError(this.failures.splice(0), 'Runtime cleanup failed');
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Plugin runtime is disposed');
  }

  private requirePlugin(id: string): MountedPlugin {
    const mounted = this.plugins.get(id);
    if (!mounted) throw new Error(`Unknown plugin: ${id}`);
    return mounted;
  }

  private reconcile(): void {
    if (this.reconciling || this.disposed) return;
    this.reconciling = true;
    try {
      let changed = true;
      while (changed) {
        changed = false;
        for (const mounted of this.plugins.values()) {
          if (mounted.status !== 'waiting') continue;
          if (!(mounted.plugin.requires ?? []).every((key) => this.registry.has(key))) continue;
          this.activate(mounted);
          changed = true;
        }
      }
    } finally {
      this.reconciling = false;
    }
  }

  private activate(mounted: MountedPlugin): void {
    const { plugin } = mounted;
    const scope = new EffectScope();
    mounted.scope = scope;
    mounted.status = 'starting';
    const requires = new Set(plugin.requires);
    const provides = new Set(plugin.provides);
    const optional = new Set(plugin.optional);
    const context: PluginContext = {
      id: plugin.id,
      scope,
      signal: scope.signal,
      get: <T>(key: ServiceKey<T>): T => {
        scope.assertActive();
        if (!requires.has(key) && !provides.has(key))
          throw new Error(`${plugin.id}: undeclared dependency ${key.description}`);
        return this.registry.get(key);
      },
      optional: <T>(key: ServiceKey<T>): T | undefined => {
        scope.assertActive();
        if (!optional.has(key))
          throw new Error(`${plugin.id}: undeclared optional dependency ${key.description}`);
        return this.registry.has(key) ? this.registry.get(key) : undefined;
      },
      provide: <T>(key: ServiceKey<T>, service: T): void => {
        scope.assertActive();
        if (!provides.has(key))
          throw new Error(`${plugin.id}: undeclared service ${key.description}`);
        scope.defer(this.registry.publish(key, service, plugin.id));
      },
      effect: (acquire) => scope.effect(acquire),
      defer: (cleanup) => scope.defer(cleanup),
    };
    try {
      const cleanup = plugin.setup(Object.freeze(context));
      if (cleanup !== undefined && typeof cleanup !== 'function') {
        // Do not leave an accidental async setup rejection unobserved. Its
        // scope is revoked below, so any later publication is rejected.
        if (cleanup && typeof (cleanup as { then?: unknown }).then === 'function') {
          void Promise.resolve(cleanup).catch(() => undefined);
        }
        throw new Error(`${plugin.id}: setup must be synchronous`);
      }
      if (cleanup) scope.defer(cleanup);
      for (const key of provides) {
        if (!this.registry.has(key))
          throw new Error(`${plugin.id}: did not provide ${key.description}`);
      }
      mounted.status = 'active';
    } catch (error) {
      mounted.status = 'failed';
      mounted.error = error;
      this.track(scope.dispose());
      mounted.scope = undefined;
      throw error;
    }
  }

  private deactivate(mounted: MountedPlugin): void {
    if (mounted.status !== 'active' && mounted.status !== 'starting') return;
    const provided = new Set(mounted.plugin.provides);
    for (const candidate of [...this.plugins.values()].reverse()) {
      if (
        candidate !== mounted &&
        [...(candidate.plugin.requires ?? []), ...(candidate.plugin.optional ?? [])].some((key) =>
          provided.has(key),
        )
      ) {
        this.deactivate(candidate);
      }
    }
    mounted.status = 'waiting';
    const scope = mounted.scope;
    mounted.scope = undefined;
    if (scope) this.track(scope.dispose());
  }

  private track(promise: Promise<void>): void {
    this.pending.push(
      promise.catch((error) => {
        this.failures.push(error);
      }),
    );
  }

  private validate(definitions: readonly Plugin[]): void {
    const ids = new Set<string>();
    const providers = new Map<symbol, string>();
    for (const plugin of definitions) {
      if (typeof plugin.id !== 'string' || !plugin.id.trim() || ids.has(plugin.id))
        throw new Error(`Invalid or duplicate plugin: ${plugin.id}`);
      if (typeof plugin.setup !== 'function') throw new Error(`Missing plugin setup: ${plugin.id}`);
      if (plugin.apiVersion !== undefined && plugin.apiVersion !== 1)
        throw new Error(`Unsupported plugin API: ${plugin.id}`);
      ids.add(plugin.id);
      for (const key of plugin.provides ?? []) {
        if (providers.has(key)) throw new Error(`Multiple providers for ${key.description}`);
        providers.set(key, plugin.id);
      }
    }
    const graph = new Map(
      definitions.map((plugin) => [
        plugin.id,
        [...(plugin.requires ?? []), ...(plugin.optional ?? [])]
          .map((key) => providers.get(key))
          .filter((id): id is string => id !== undefined),
      ]),
    );
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string, path: readonly string[]): void => {
      if (visiting.has(id))
        throw new Error(`Plugin dependency cycle: ${[...path, id].join(' -> ')}`);
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dependency of graph.get(id) ?? []) visit(dependency, [...path, id]);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of ids) visit(id, []);
  }
}
