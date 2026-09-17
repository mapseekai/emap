/** Group completed display blocks for a bounded interval, never wait for slow siblings. */
export class RasterPresentationQueue {
  private readonly keys = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private batchStarted = 0;
  private waitMs = 0;
  private flushes = 0;
  constructor(
    private readonly interval: number,
    private flushKeys: ((keys: readonly string[]) => void) | undefined,
  ) {}
  getDiagnostics(): { waitMs: number; flushes: number } {
    return { waitMs: this.waitMs, flushes: this.flushes };
  }
  add(key: string, complete = false): void {
    if (!this.flushKeys) return;
    if (!this.keys.size) this.batchStarted = performance.now();
    this.keys.add(key);
    if (complete || this.interval === 0) {
      this.flush();
      return;
    }
    if (this.timer === null) this.timer = setTimeout(() => this.flush(), this.interval);
  }
  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (!this.keys.size) return;
    const keys = [...this.keys];
    this.waitMs += Math.max(0, performance.now() - this.batchStarted);
    this.flushes++;
    this.batchStarted = 0;
    this.keys.clear();
    this.flushKeys?.(keys);
  }
  clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.keys.clear();
    this.batchStarted = 0;
  }
  dispose(): void {
    this.clear();
    this.flushKeys = undefined;
  }
}
