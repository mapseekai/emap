import type { Emap } from '../map/map';
import {
  formatScaleDistance,
  selectScaleDistance,
  type ScaleCalculationMethod,
} from '../geo/scale-calculator';
import type { Control } from './control';

export interface ScaleControlOptions {
  units?: 'metric' | 'imperial' | 'dual';
  calculationMethod?: ScaleCalculationMethod;
  maxWidth?: number;
  dpi?: number;
  showScale?: boolean;
  showZoom?: boolean;
  className?: string;
}

export class ScaleControl implements Control {
  private _map: Emap | null = null;
  private _container: HTMLElement | null = null;
  private _summary: HTMLElement | null = null;
  private _labels: HTMLElement | null = null;
  private _bar: HTMLElement | null = null;
  private _frameId: number | null = null;
  private _revision = 0;
  private readonly _options: Required<Omit<ScaleControlOptions, 'className'>> & Pick<ScaleControlOptions, 'className'>;
  private readonly _onUpdateBound: () => void;
  private readonly _onCrsChangeBound: () => void;

  constructor(options: ScaleControlOptions = {}) {
    this._options = {
      units: 'metric',
      calculationMethod: 'center',
      maxWidth: 140,
      dpi: 96,
      showScale: true,
      showZoom: true,
      ...options,
    };
    this._onUpdateBound = this._scheduleUpdate.bind(this);
    this._onCrsChangeBound = this._onCrsChange.bind(this);
  }

  onAdd(map: Emap): HTMLElement {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = `emap-ctrl emap-scale-ctrl ${this._options.className ?? ''}`;
    this._container.setAttribute('aria-label', 'Map scale');

    this._summary = document.createElement('div');
    this._summary.className = 'emap-scale-summary';
    this._labels = document.createElement('div');
    this._labels.className = 'emap-scale-labels';
    this._labels.setAttribute('aria-hidden', 'true');
    this._labels.classList.toggle('emap-scale-labels-dual', this._options.units === 'dual');
    this._bar = document.createElement('div');
    this._bar.className = 'emap-scale-bar';
    this._bar.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 4; index += 1) {
      const segment = document.createElement('span');
      segment.className = 'emap-scale-segment';
      this._bar.append(segment);
    }
    this._container.append(this._summary, this._labels, this._bar);

    this._map.on('move', this._onUpdateBound);
    this._map.on('resize', this._onUpdateBound);
    this._map.on('crschange', this._onCrsChangeBound);
    this._scheduleUpdate();
    return this._container;
  }

  onRemove(): void {
    if (this._map) {
      this._map.off('move', this._onUpdateBound);
      this._map.off('resize', this._onUpdateBound);
      this._map.off('crschange', this._onCrsChangeBound);
    }
    if (this._frameId !== null) cancelAnimationFrame(this._frameId);
    if (this._container?.parentNode) this._container.parentNode.removeChild(this._container);
    this._revision += 1;
    this._frameId = null;
    this._map = null;
    this._container = null;
    this._summary = null;
    this._labels = null;
    this._bar = null;
  }

  private _onCrsChange(): void {
    this._revision += 1;
    this._container?.setAttribute('hidden', '');
    if (this._summary) this._summary.textContent = '';
    if (this._labels) this._labels.textContent = '';
    this._scheduleUpdate();
  }

  private _scheduleUpdate(): void {
    this._revision += 1;
    if (this._frameId !== null) return;
    this._frameId = requestAnimationFrame(() => {
      this._frameId = null;
      void this._update(this._revision);
    });
  }

  private async _update(revision: number): Promise<void> {
    const map = this._map;
    if (!map) return;
    const metrics = await map.getScaleMetrics({
      calculationMethod: this._options.calculationMethod,
      dpi: this._options.dpi,
    });
    if (revision !== this._revision || map !== this._map || !this._container) return;
    if (!metrics) {
      this._container.hidden = true;
      return;
    }

    this._container.hidden = false;
    this._render(metrics);
  }

  private _render(metrics: Awaited<ReturnType<Emap['getScaleMetrics']>> & {}): void {
    if (!this._container || !this._summary || !this._labels || !this._bar) return;
    const summary = [];
    if (this._options.showScale) summary.push(`1:${Math.round(metrics.scaleDenominator).toLocaleString('en-US')}`);
    if (metrics.zoom !== undefined && this._options.showZoom) summary.push(`Zoom ${Math.round(metrics.zoom * 100) / 100}`);
    this._summary.textContent = summary.join(' · ');

    const scale = this._options.showScale
      ? selectScaleDistance(metrics.metersPerPixel, this._options.maxWidth)
      : null;
    if (!scale) {
      this._labels.textContent = '';
      this._bar.hidden = true;
      return;
    }

    const dual = this._options.units === 'dual';
    const midpoint = dual ? null : formatScaleDistance(scale.distance / 2, this._options.units);
    const end = formatScaleDistance(scale.distance, this._options.units);
    if (!end || (!dual && !midpoint)) {
      this._labels.textContent = '';
      this._bar.hidden = true;
      return;
    }
    this._labels.replaceChildren(...(dual ? ['0', end] : ['0', midpoint, end]).map((label) => {
      const element = document.createElement('span');
      element.textContent = label;
      return element;
    }));
    this._container.style.setProperty('--emap-scale-width', `${scale.width}px`);
    this._bar.hidden = false;
  }
}
