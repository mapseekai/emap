import type { DuckDbRuntime } from './runtime';
import { createDuckDbRuntimeFromJsDelivr } from './runtime';

export interface DuckDbRuntimeOptions {
  /** Supplied runtimes stay caller-owned unless owned is explicitly true. */
  runtime?: DuckDbRuntime;
  create?: () => Promise<DuckDbRuntime>;
  owned?: boolean;
}

/** One runtime per provider instance, initialized lazily and closed exactly once. */
export class DuckDbRuntimeScope {
  private value?: DuckDbRuntime;
  private pending?: Promise<DuckDbRuntime>;
  private disposal?: Promise<void>;
  private closed = false;
  private readonly owned: boolean;

  constructor(private readonly options: DuckDbRuntimeOptions = {}) {
    if (options.runtime && options.create) throw new Error('Supply runtime or create, not both');
    this.value = options.runtime;
    this.owned = options.owned ?? !options.runtime;
  }

  peek(): DuckDbRuntime | undefined {
    return this.value;
  }

  async get(): Promise<DuckDbRuntime> {
    if (this.closed) throw new Error('DuckDB provider is disposed');
    if (this.value) return this.value;
    this.pending ??= Promise.resolve()
      .then(() => (this.options.create ?? createDuckDbRuntimeFromJsDelivr)())
      .then(async (runtime) => {
        if (this.closed) {
          if (this.owned) await runtime.close?.();
          throw new InitializationDisposedError(
            'DuckDB provider was disposed during initialization',
          );
        }
        this.value = runtime;
        return runtime;
      })
      .catch((error) => {
        this.pending = undefined;
        throw error;
      });
    return this.pending;
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closed = true;
    const value = this.value;
    this.value = undefined;
    this.disposal = value
      ? Promise.resolve().then(() => {
          if (this.owned) return value.close?.();
        })
      : (this.pending?.then(
          () => undefined,
          (error) => {
            if (!(error instanceof InitializationDisposedError)) throw error;
          },
        ) ?? Promise.resolve());
    return this.disposal;
  }
}

class InitializationDisposedError extends Error {}
