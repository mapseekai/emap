export type Cleanup = () => void | Promise<void>;

/** Owns registrations and resources, including cancellation of asynchronous work. */
export class EffectScope {
  private readonly controller = new AbortController();
  private readonly effects = new Set<Cleanup>();
  private readonly pending: Promise<void>[] = [];
  private readonly failures: unknown[] = [];
  private closed = false;

  get signal(): AbortSignal {
    return this.controller.signal;
  }
  get disposed(): boolean {
    return this.closed;
  }

  assertActive(): void {
    if (this.closed) {
      const error = new Error('Plugin scope has been disposed');
      error.name = 'AbortError';
      throw error;
    }
  }

  /** Register immediately after acquiring a resource. The returned release is idempotent. */
  defer(cleanup: Cleanup): Cleanup {
    let active = true;
    const release: Cleanup = () => {
      if (!active) return;
      active = false;
      this.effects.delete(release);
      return cleanup();
    };
    if (this.closed) this.release(release);
    else this.effects.add(release);
    return release;
  }

  effect(acquire: () => Cleanup | void): void {
    this.assertActive();
    const cleanup = acquire();
    if (cleanup) this.defer(cleanup);
  }

  /** Disposed scopes cannot publish an asynchronous result. */
  async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.assertActive();
    const result = await work(this.signal);
    this.assertActive();
    return result;
  }

  private release(cleanup: Cleanup): void {
    try {
      const result = cleanup();
      if (result)
        this.pending.push(
          Promise.resolve(result).catch((error) => {
            this.failures.push(error);
          }),
        );
    } catch (error) {
      this.failures.push(error);
    }
  }

  /** Synchronous cleanups run before this method returns; async resources can be awaited. */
  dispose(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.controller.abort();
      for (const release of [...this.effects].reverse()) this.release(release);
      this.effects.clear();
    }
    return this.settled();
  }

  async settled(): Promise<void> {
    while (this.pending.length) await Promise.all(this.pending.splice(0));
    if (this.failures.length)
      throw new AggregateError(this.failures.splice(0), 'Plugin cleanup failed');
  }
}
