import { EventDispatcher } from './events';
import { Timer, Tween } from './tween';

function MouseWheelDirection() {
  let prevTime = 0;
  let getAvgDir: ((val: number) => number) | null = null;

  return function (delta: number, now: number) {
    const dir = delta > 0 ? 1 : (delta < 0 ? -1 : 0);
    if (!getAvgDir || now - prevTime > 300) {
      getAvgDir = limitedAverage(3);
    }
    prevTime = now;
    const avg = getAvgDir(dir) || dir;
    return avg > 0 ? 1 : (avg < 0 ? -1 : 0);
  };
}

function limitedAverage(maxSize: number) {
  const arr: number[] = [];
  return function (val: number) {
    arr.push(val);
    if (arr.length > maxSize) arr.shift();
    const sum = arr.reduce((acc, v) => acc + v, 0);
    return sum / arr.length;
  };
}

export class MouseWheel extends EventDispatcher {
  private _active: boolean = false;
  private _timer: Timer = new Timer();
  private _sustainInterval: number = 150;
  private _fadeDelay: number = 70;
  private _eventTime: number = 0;
  private _getAverageRate = limitedAverage(10);
  private _getWheelDirection = MouseWheelDirection();
  private _wheelDirection: number = 0;
  private _mouseX: number = 0;
  private _mouseY: number = 0;

  private _wheelHandler = (e: WheelEvent) => this._handleWheel(e);

  constructor(private _element: HTMLElement) {
    super();
    this._timer.on('tick', (e: any) => this._onTick(e));
    this._element.addEventListener('wheel', this._wheelHandler, { passive: false });
  }

  destroy(): void {
    this._element.removeEventListener('wheel', this._wheelHandler);
    this._timer.stop();
  }

  private _updateSustainInterval(eventRate: number) {
    const fadeInterval = 80;
    this._fadeDelay = eventRate + 50;
    this._sustainInterval = this._fadeDelay + fadeInterval;
  }

  private _handleWheel(evt: WheelEvent) {
    const now = Date.now();
    // Invert deltaY for standard direction
    this._wheelDirection = this._getWheelDirection(-evt.deltaY, now);

    if (this._wheelDirection === 0) return;

    evt.preventDefault();

    // Update current mouse position relative to element
    const rect = this._element.getBoundingClientRect();
    this._mouseX = evt.clientX - rect.left;
    this._mouseY = evt.clientY - rect.top;

    if (!this._active) {
      this._active = true;
      this.fire('mousewheelstart');
    } else {
      this._updateSustainInterval(this._getAverageRate(now - this._eventTime));
    }
    this._eventTime = now;
    this._timer.start(this._sustainInterval);
  }

  private _onTick(evt: any) {
    const tickInterval = evt.time - this._eventTime;
    let multiplier = evt.tickTime / 25;
    let fadeFactor = 0;

    if (tickInterval > this._fadeDelay) {
      fadeFactor = Math.min(1, (tickInterval - this._fadeDelay) / (this._sustainInterval - this._fadeDelay));
    }

    if (evt.done) {
      this._active = false;
      this.fire('mousewheelend');
    } else {
      if (fadeFactor > 0) {
        multiplier *= Tween.quadraticOut(1 - fadeFactor);
      }
      this.fire('mousewheel', {
        direction: this._wheelDirection,
        multiplier: multiplier,
        x: this._mouseX,
        y: this._mouseY
      });
    }
  }
}
