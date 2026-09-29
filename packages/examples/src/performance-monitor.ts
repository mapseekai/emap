import './performance-monitor.css';

/** Counters are cumulative; gauges describe the current renderer. All fields are optional. */
export interface ExampleRenderMetrics {
  backend: string;
  frames?: number;
  drawCalls?: number;
  uploadedBytes?: number;
  gpuBytes?: number;
  pending?: number;
  labels?: number;
  cpuMs?: number;
}
type ReadMetrics = () => ExampleRenderMetrics | null;
type Source = { read: ReadMetrics; previous: ExampleRenderMetrics | null };
const monitors = new WeakMap<Document, PerformanceMonitor>();
const number = (n: number | undefined, digits = 0): string =>
  n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(digits);
const bytes = (n: number | undefined): string => {
  if (n === undefined || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${number(n)} B`;
  if (n < 2 ** 20) return `${number(n / 1024, 1)} KiB`;
  if (n < 2 ** 30) return `${number(n / 2 ** 20, 1)} MiB`;
  return `${number(n / 2 ** 30, 1)} GiB`;
};

export function installPerformanceMonitor(root: Document = document): PerformanceMonitor {
  let monitor = monitors.get(root);
  if (!monitor) {
    monitor = new PerformanceMonitor(root);
    monitors.set(root, monitor);
  }
  return monitor;
}

/** Example-only registration; returning null or calling the disposer releases a source. */
export function registerPerformanceSource(
  read: ReadMetrics,
  root: Document = document,
): () => void {
  return installPerformanceMonitor(root).addSource(read);
}

export class PerformanceMonitor {
  readonly element: HTMLDetailsElement;
  private readonly view: Window & typeof globalThis;
  private readonly values = new Map<string, HTMLElement>();
  private readonly sources = new Set<Source>();
  private readonly history: number[] = [];
  private readonly chart: SVGPolylineElement;
  private readonly pauseButton: HTMLButtonElement;
  private observer: PerformanceObserver | null = null;
  private raf = 0;
  private previousTime: number | null = null;
  private windowStart = 0;
  private frames = 0;
  private intervals: number[] = [];
  private longTasks = 0;
  private blockingMs = 0;
  private longTasksSupported = false;
  private paused = false;
  private suspended = false;
  private disposed = false;

  constructor(private readonly root: Document) {
    this.view = root.defaultView!;
    const panel = root.createElement('details');
    this.element = panel;
    panel.className = 'emap-performance';
    panel.setAttribute('aria-label', '实时性能监控');
    // Avoid announcing rapidly changing numbers to screen readers.
    panel.innerHTML = `<summary title="展开或收起性能指标">
      <span class="emap-performance-heading"><i></i>性能<span data-metric="state">采样中</span></span>
      <span class="emap-performance-primary"><strong data-metric="fps">—</strong><span>页面 FPS</span><span class="emap-performance-chevron">⌄</span></span>
      <span class="emap-performance-preview">帧间隔 P95 <b data-metric="p95">—</b></span>
    </summary>
    <div class="emap-performance-body">
      <svg viewBox="0 0 240 36" preserveAspectRatio="none" role="img" aria-label="最近 30 次 FPS 采样，纵轴 0 至 240">
        <path d="M0 35.5H240"/><polyline points=""/>
      </svg>
      <dl></dl>
      <p>FPS 来自页面 rAF；静止地图按需绘制。CPU 为提交耗时，非 GPU 执行时间。资源数值仅含已统计部分。</p>
      <button type="button">暂停采样</button>
    </div>`;
    const rows = [
      ['interval', '平均帧间隔'],
      ['max', '最长帧间隔'],
      ['longTasks', '长任务 / s'],
      ['blocking', '阻塞 / s（超出 50ms）'],
      ['heap', 'JS 堆（估算）'],
      ['backend', '渲染器'],
      ['frames', 'GPU 提交 / s'],
      ['calls', 'Draw calls / s'],
      ['upload', 'GPU 上传 / s'],
      ['gpu', 'GPU 资源（估算）'],
      ['cpu', '最近 CPU 提交'],
      ['pending', '待准备块'],
      ['labels', '已放置标注'],
      ['canvas', '画布 / DPR'],
    ];
    const list = panel.querySelector('dl')!;
    for (const [key, label] of rows) {
      const term = root.createElement('dt'),
        value = root.createElement('dd');
      term.textContent = label;
      value.dataset.metric = key;
      value.textContent = '—';
      list.append(term, value);
    }
    for (const value of panel.querySelectorAll<HTMLElement>('[data-metric]'))
      this.values.set(value.dataset.metric!, value);
    this.chart = panel.querySelector('polyline')!;
    this.pauseButton = panel.querySelector('button')!;
    this.pauseButton.addEventListener('click', this.togglePause);
    root.body.append(panel);
    root.addEventListener('visibilitychange', this.visibilityChanged);
    this.view.addEventListener('pagehide', this.pageHidden);
    this.view.addEventListener('pageshow', this.pageShown);
    if (root.hidden) this.stop();
    else this.resume();
  }

  addSource(read: ReadMetrics): () => void {
    const source = { read, previous: this.read(read) };
    this.sources.add(source);
    return () => {
      this.sources.delete(source);
    };
  }

  private read(read: ReadMetrics): ExampleRenderMetrics | null {
    try {
      return read();
    } catch {
      return null;
    }
  }

  private set(key: string, value: string): void {
    const element = this.values.get(key)!;
    if (element.textContent !== value) element.textContent = value;
  }

  private readonly togglePause = (): void => {
    this.paused = !this.paused;
    this.pauseButton.textContent = this.paused ? '继续采样' : '暂停采样';
    if (this.paused) this.stop();
    else this.resume();
  };
  private readonly visibilityChanged = (): void => {
    if (this.root.hidden) this.stop();
    else this.resume();
  };
  private readonly pageHidden = (event: PageTransitionEvent): void => {
    if (!event.persisted) this.dispose();
    else {
      this.suspended = true;
      this.stop();
    }
  };
  private readonly pageShown = (): void => {
    this.suspended = false;
    this.resume();
  };

  private stop(): void {
    this.view.cancelAnimationFrame?.(this.raf);
    this.raf = 0;
    this.observer?.disconnect();
    this.observer = null;
    this.previousTime = null;
    this.intervals = [];
    this.frames = this.longTasks = this.blockingMs = 0;
    this.set('state', '已暂停');
    for (const key of [
      'fps',
      'p95',
      'interval',
      'max',
      'longTasks',
      'blocking',
      'frames',
      'calls',
      'upload',
    ])
      this.set(key, '—');
  }

  private resume(): void {
    if (this.disposed || this.paused || this.suspended || this.root.hidden || this.raf) return;
    this.set('state', '采样中');
    this.previousTime = null;
    this.frames = this.longTasks = this.blockingMs = 0;
    this.intervals = [];
    this.history.length = 0;
    this.chart.setAttribute('points', '');
    for (const source of this.sources) source.previous = this.read(source.read);
    const Observer = this.view.PerformanceObserver;
    this.longTasksSupported = Observer?.supportedEntryTypes?.includes('longtask') ?? false;
    if (this.longTasksSupported) {
      try {
        this.observer = new Observer((entries) => this.recordLongTasks(entries.getEntries()));
        this.observer.observe({ type: 'longtask' });
      } catch {
        this.observer = null;
        this.longTasksSupported = false;
      }
    }
    if (this.view.requestAnimationFrame) this.raf = this.view.requestAnimationFrame(this.tick);
  }

  private recordLongTasks(entries: PerformanceEntry[]): void {
    for (const entry of entries) {
      this.longTasks++;
      this.blockingMs += Math.max(0, entry.duration - 50);
    }
  }

  private readonly tick = (time: number): void => {
    this.raf = 0;
    if (this.disposed || this.paused || this.suspended || this.root.hidden) return;
    if (this.previousTime === null) this.windowStart = time;
    else {
      const interval = time - this.previousTime;
      this.frames++;
      // Bounded at unusually high refresh rates; no retained per-frame DOM or GPU work.
      if (this.intervals.length < 512) this.intervals.push(interval);
    }
    this.previousTime = time;
    const elapsed = time - this.windowStart;
    if (elapsed >= 1000) {
      this.observer && this.recordLongTasks(this.observer.takeRecords());
      const fps = (this.frames * 1000) / elapsed;
      const sorted = this.intervals.sort((a, b) => a - b);
      this.set('fps', number(fps, 1));
      this.set('interval', `${number(elapsed / this.frames, 1)} ms`);
      this.set('p95', `${number(sorted[Math.ceil(sorted.length * 0.95) - 1], 1)} ms`);
      this.set('max', `${number(sorted.at(-1), 1)} ms`);
      this.set(
        'longTasks',
        this.longTasksSupported ? number((this.longTasks * 1000) / elapsed, 1) : '不支持',
      );
      this.set(
        'blocking',
        this.longTasksSupported ? `${number((this.blockingMs * 1000) / elapsed, 1)} ms` : '不支持',
      );
      const memory = (
        this.view.performance as Performance & { memory?: { usedJSHeapSize: number } }
      ).memory;
      this.set('heap', memory ? bytes(memory.usedJSHeapSize) : '不支持');
      this.set(
        'canvas',
        `${this.root.querySelectorAll('canvas').length} / ${number(this.view.devicePixelRatio, 2)}`,
      );
      this.sampleSources(elapsed);
      this.history.push(fps);
      if (this.history.length > 30) this.history.shift();
      this.chart.setAttribute(
        'points',
        this.history
          .map((value, i) => `${(i * 240) / 29},${35 - (Math.min(240, value) * 34) / 240}`)
          .join(' '),
      );
      this.windowStart = time;
      this.frames = this.longTasks = this.blockingMs = 0;
      this.intervals = [];
    }
    this.raf = this.view.requestAnimationFrame(this.tick);
  };

  private sampleSources(elapsed: number): void {
    const totals: Partial<Record<keyof ExampleRenderMetrics, number>> = {};
    const backends = new Set<string>();
    for (const source of this.sources) {
      const current = this.read(source.read);
      if (!current) {
        this.sources.delete(source);
        continue;
      }
      backends.add(current.backend);
      for (const key of [
        'frames',
        'drawCalls',
        'uploadedBytes',
        'gpuBytes',
        'pending',
        'labels',
        'cpuMs',
      ] as const) {
        const value = current[key];
        if (value === undefined || !Number.isFinite(value)) continue;
        let amount = value;
        if (['frames', 'drawCalls', 'uploadedBytes'].includes(key)) {
          const previous = source.previous?.[key];
          amount =
            previous === undefined ||
            source.previous?.backend !== current.backend ||
            value < previous
              ? 0
              : ((value - previous) * 1000) / elapsed;
        }
        totals[key] =
          key === 'cpuMs' ? Math.max(totals[key] ?? 0, amount) : (totals[key] ?? 0) + amount;
      }
      source.previous = current;
    }
    this.set('backend', [...backends].join(' + ') || '未接入地图');
    this.set('frames', number(totals.frames, 1));
    this.set('calls', number(totals.drawCalls, 1));
    this.set('upload', bytes(totals.uploadedBytes));
    this.set('gpu', bytes(totals.gpuBytes));
    this.set('pending', number(totals.pending));
    this.set('labels', number(totals.labels));
    this.set('cpu', totals.cpuMs === undefined ? '—' : `${number(totals.cpuMs, 2)} ms`);
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.root.removeEventListener('visibilitychange', this.visibilityChanged);
    this.view.removeEventListener('pagehide', this.pageHidden);
    this.view.removeEventListener('pageshow', this.pageShown);
    this.pauseButton.removeEventListener('click', this.togglePause);
    this.sources.clear();
    this.element.remove();
    monitors.delete(this.root);
  }
}
