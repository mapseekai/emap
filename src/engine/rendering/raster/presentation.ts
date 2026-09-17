/** Group completed display blocks for a bounded interval, never wait for slow siblings. */
export class RasterPresentationQueue {
  private readonly keys = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private readonly interval: number,
    private flushKeys: ((keys: readonly string[]) => void) | undefined,
  ) {}
  add(key: string, complete = false): void {
    if (!this.flushKeys) return;
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
    this.keys.clear();
    this.flushKeys?.(keys);
  }
  clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.keys.clear();
  }
  dispose(): void {
    this.clear();
    this.flushKeys = undefined;
  }
}
