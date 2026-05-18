import { EventDispatcher } from './events';

function scheduleFrame(cb: FrameRequestCallback): number {
  return typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(cb)
    : (setTimeout(cb, 25) as unknown as number);
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle);
  } else {
    clearTimeout(handle);
  }
}

export class Timer extends EventDispatcher {
  private _running: boolean = false;
  private _busy: boolean = false;
  private _tickTime: number = 0;
  private _startTime: number = 0;
  private _duration: number = Infinity;
  private _frame: number | null = null;

  constructor() {
    super();
  }

  start(ms?: number): void {
    const now = Date.now();
    this._duration = ms || Infinity;
    this._startTime = now;
    this._running = true;
    if (!this._busy) this._startTick(now);
  }

  stop(): void {
    this._running = false;
    // Cancel any pending frame so a stopped timer leaves no orphaned
    // callback. An orphaned jsdom rAF callback that outlives a
    // useRealTimers()/useFakeTimers() boundary desyncs the rAF pump and
    // silently starves later timers (observed cross-test in vitest+jsdom).
    if (this._frame !== null) {
      cancelFrame(this._frame);
      this._frame = null;
    }
    this._busy = false;
  }

  private _startTick(now: number): void {
    this._busy = true;
    this._tickTime = now;
    this._frame = scheduleFrame(() => {
      this._frame = null;
      this._onTick();
    });
  }

  private _onTick(): void {
    const now = Date.now();
    const elapsed = now - this._startTime;
    const pct = Math.min((elapsed + 10) / this._duration, 1);
    const done = pct >= 1;

    if (!this._running) {
      this._busy = false;
      return;
    }

    if (done) this._running = false;

    this.fire('tick', {
      elapsed,
      pct,
      done,
      time: now,
      tickTime: now - this._tickTime
    });

    this._busy = false;
    if (this._running) this._startTick(now);
  }
}

export type EaseFunction = (n: number) => number;

export class Tween extends EventDispatcher {
  private _timer: Timer = new Timer();
  private _startValue: number = 0;
  private _endValue: number = 0;
  private _ease: EaseFunction | null;

  constructor(ease?: EaseFunction) {
    super();
    this._ease = ease || null;
    this._timer.on('tick', (e: any) => this._onTick(e));
  }

  start(a: number, b: number, duration?: number): void {
    this._startValue = a;
    this._endValue = b;
    this._timer.start(duration || 500);
  }

  stop(): void {
    this._timer.stop();
  }

  private _onTick(e: any): void {
    const pct = this._ease ? this._ease(e.pct) : e.pct;
    const val = this._endValue * pct + this._startValue * (1 - pct);
    this.fire('change', { value: val });
  }

  static sineInOut(n: number): number {
    return 0.5 - Math.cos(n * Math.PI) / 2;
  }

  static quadraticOut(n: number): number {
    return 1 - Math.pow((1 - n), 2);
  }
}
