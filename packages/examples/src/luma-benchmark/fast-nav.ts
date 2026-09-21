import { AffineTransform } from '../../../../src/domain/geo/transform';

/** Canvas fast-nav's snapshot-relative transform, shared by the experimental GPU APIs.
 * A bounded bitmap is captured AFTER a full frame, never per pointermove. It remains
 * above the live surface until a replacement frame is captured, avoiding a settle flash.
 */
export class FastNavPreview {
  readonly canvas: HTMLCanvasElement;
  enabled = true;
  onChange: () => void = () => {};
  private bitmap: ImageBitmap | null = null;
  private source: HTMLCanvasElement | null = null;
  private sourceVisibility = '';
  private frame: AffineTransform | null = null;
  private latest: AffineTransform | null = null;
  private key = '';
  private epoch = 0;
  private contentRevision = 0;
  private interacting = false;
  private refresh = false;
  private due = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private capturePending = false;
  private shown = false;
  private copied = false;
  private disposed = false;
  private captureFailed = false;
  readonly counters = {
    previewFrames: 0,
    fullRedraws: 0,
    captures: 0,
    lastRefreshMs: 0,
    lastSubmitMs: 0,
    captureErrors: 0,
  };
  constructor(
    private host: HTMLElement,
    private requestRedraw: () => void,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'luma-nav-preview';
    this.canvas.hidden = true;
    this.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '1',
      transformOrigin: '0 0',
      willChange: 'transform',
    });
    host.append(this.canvas);
  }
  get stats() {
    return {
      ...this.counters,
      enabled: this.enabled,
      active: this.shown,
      interacting: this.interacting,
      pending: this.refresh || this.capturePending,
      ready: !!this.bitmap,
      snapshotBytes: this.bitmap ? this.bitmap.width * this.bitmap.height * 4 : 0,
      frame: this.frame?.clone() ?? null,
    };
  }
  get canCapture(): boolean {
    return this.enabled && !this.disposed && !this.captureFailed && !this.capturePending;
  }
  /** A worker result can arrive while a same-view image is being captured. */
  invalidateFrame(): void {
    this.contentRevision++;
    this.refresh = true;
    if (!this.interacting) this.due = true;
  }
  setEnabled(value: boolean): void {
    this.enabled = value;
    this.reset();
    this.onChange();
  }
  setInteracting(value: boolean): void {
    this.interacting = value;
    if (value) {
      this.cancelTimer();
      this.due = false;
    } else if (this.refresh) this.schedule();
  }
  private same(a: AffineTransform | null, b: AffineTransform): boolean {
    return !!a && a.mx === b.mx && a.my === b.my && a.bx === b.bx && a.by === b.by;
  }
  /** Returns true only when the caller must NOT submit a new scene frame. */
  preview(view: AffineTransform, key: string): boolean {
    if (this.disposed || !this.enabled || this.captureFailed) return false;
    if (key !== this.key) {
      this.reset();
      this.key = key;
    }
    this.latest = view.clone();
    if (this.frame && !this.same(this.frame, view)) this.refresh = true;
    if (this.capturePending) {
      if (this.bitmap) this.show(view);
      return true;
    }
    if (!this.bitmap || !this.frame) return false;
    if (this.interacting || (this.refresh && !this.due)) {
      this.show(view);
      if (!this.interacting && this.refresh && !this.timer) this.schedule();
      return true;
    }
    return false;
  }
  private copyBitmap(): void {
    if (!this.bitmap || !this.source) return;
    if (!this.copied) {
      this.canvas.width = this.bitmap.width;
      this.canvas.height = this.bitmap.height;
      this.canvas.style.width = this.source.style.width || `${this.source.clientWidth}px`;
      this.canvas.style.height = this.source.style.height || `${this.source.clientHeight}px`;
      const ctx = this.canvas.getContext('2d');
      if (!ctx) throw new Error('Navigation preview canvas is unavailable.');
      ctx.drawImage(this.bitmap, 0, 0);
      this.copied = true;
    }
  }
  private show(view: AffineTransform): void {
    if (!this.bitmap || !this.frame || !this.source) return;
    this.copyBitmap();
    const delta = new AffineTransform(view.mx / this.frame.mx, view.my / this.frame.my);
    const origin = view.project(...this.frame.unproject(0, 0));
    delta.translate(...origin);
    this.canvas.style.transform = `translate(${delta.bx}px,${delta.by}px) scale(${delta.mx},${delta.my})`;
    this.canvas.hidden = false;
    this.source.style.visibility = 'hidden';
    this.shown = true;
    this.host.dataset.navigation = 'snapshot';
    this.counters.previewFrames++;
    this.onChange();
  }
  /** Keep the previous frame while full-detail blocks for the latest view arrive. */
  hold(view: AffineTransform): boolean {
    if (!this.shown || !this.bitmap) return false;
    this.latest = view.clone();
    this.show(view);
    return true;
  }
  record(
    source: HTMLCanvasElement,
    view: AffineTransform,
    key: string,
    submitMs: number,
    frameDone?: Promise<void>,
  ): void {
    if (!this.enabled || this.disposed || this.captureFailed) return;
    if (key !== this.key) {
      this.reset();
      this.key = key;
    }
    if (this.capturePending) return;
    if (this.source && this.source !== source) this.hide();
    this.source = source;
    if (!this.shown) this.sourceVisibility = source.style.visibility;
    const revision = this.contentRevision;
    const epoch = this.epoch,
      frame = view.clone(),
      started = performance.now();
    this.latest ??= frame.clone();
    this.capturePending = true;
    this.due = false;
    this.cancelTimer();
    this.counters.fullRedraws++;
    this.counters.lastSubmitMs = submitMs;
    let capture: Promise<ImageBitmap>;
    try {
      capture = createImageBitmap(source);
    } catch (error) {
      capture = Promise.reject(error);
    }
    // createImageBitmap may resolve before deferred GPU work is complete. Publish
    // only after the barrier and materialize the small preview before the next gesture.
    let captured: ImageBitmap | null = null,
      abandoned = false;
    const safeCapture = frameDone
      ? Promise.all([
          capture.then((b) => {
            if (abandoned) b.close();
            else captured = b;
            return b;
          }),
          frameDone,
        ]).then(([b]) => b)
      : capture;
    void safeCapture
      .then((bitmap) => {
        if (this.disposed || epoch !== this.epoch) {
          bitmap.close();
          return;
        }
        this.capturePending = false;
        this.bitmap?.close();
        this.bitmap = bitmap;
        this.frame = frame;
        this.copied = false;
        this.copyBitmap();
        this.counters.captures++;
        this.counters.lastRefreshMs = submitMs + performance.now() - started;
        this.refresh = !this.same(this.latest, frame) || revision !== this.contentRevision;
        if (this.latest && (this.interacting || this.refresh)) this.show(this.latest);
        else this.hide();
        if (!this.interacting && this.refresh) this.schedule();
        this.onChange();
      })
      .catch(() => {
        abandoned = true;
        captured?.close();
        if (epoch !== this.epoch || this.disposed) return;
        if (this.bitmap !== captured) this.bitmap?.close();
        this.bitmap = null;
        this.frame = null;
        this.capturePending = false;
        this.captureFailed = true;
        this.refresh = false;
        this.counters.captureErrors++;
        this.hide();
        this.requestRedraw();
        this.onChange();
      });
  }
  private schedule(): void {
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.due = true;
      if (!this.interacting && !this.disposed) this.requestRedraw();
    }, 160);
  }
  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
  private hide(): void {
    this.canvas.hidden = true;
    this.canvas.style.transform = '';
    if (this.source) this.source.style.visibility = this.sourceVisibility;
    this.shown = false;
    this.host.dataset.navigation = 'geometry';
  }
  reset(): void {
    this.epoch++;
    this.cancelTimer();
    this.hide();
    this.bitmap?.close();
    this.bitmap = null;
    this.frame = null;
    this.latest = null;
    this.source = null;
    this.key = '';
    this.capturePending = this.refresh = this.due = this.copied = this.captureFailed = false;
    this.canvas.width = this.canvas.height = 0;
  }
  dispose(): void {
    this.reset();
    this.disposed = true;
    this.canvas.remove();
  }
}
