import type { Cleanup, EffectScope } from './scope';
import type { ServiceKey } from './service';

export interface PluginContext {
  readonly id: string;
  readonly scope: EffectScope;
  readonly signal: AbortSignal;
  get<T>(key: ServiceKey<T>): T;
  /** Request-time lookup of an explicitly declared optional service; do not retain it. */
  optional<T>(key: ServiceKey<T>): T | undefined;
  provide<T>(key: ServiceKey<T>, service: T): void;
  effect(acquire: () => Cleanup | void): void;
  defer(cleanup: Cleanup): Cleanup;
}

/** setup only registers services/effects; async loading belongs to a scoped service method. */
export interface Plugin {
  readonly id: string;
  readonly apiVersion?: 1;
  readonly provides?: readonly ServiceKey<unknown>[];
  readonly requires?: readonly ServiceKey<unknown>[];
  readonly optional?: readonly ServiceKey<unknown>[];
  setup(context: PluginContext): Cleanup | void;
}

export type PluginStatus = 'waiting' | 'starting' | 'active' | 'disabled' | 'failed';

export interface PluginInspection {
  readonly id: string;
  readonly status: PluginStatus;
  readonly requires: readonly string[];
  readonly provides: readonly string[];
  readonly error?: string;
}
