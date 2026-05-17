import { EventDispatcher } from '../events';
import type { Handler, HandlerResult, NormalizedPointerEvent, PointerModifiers } from '../handler';
import { resolveMode, type ModifierCombo } from './select-mode';
import { featureMatchesLasso, pathBBox } from './select-geometry';
import type { SelectHandlerOptions } from './click-select';
import type { Emap, FeatureRef } from '../../map/map';

export interface LassoStyle { stroke?: string; strokeWidth?: number; fill?: string; }
export interface LassoSelectHandlerOptions extends SelectHandlerOptions {
  dragThreshold?: number;
  dragActivator?: ModifierCombo;
  /** Loose hit (any part inside) vs strict containment. Default true. */
  includeIntersecting?: boolean;
  style?: LassoStyle;
}

const LASSO_DEFAULT_MODS = { replace: 'none', add: 'ctrl', toggle: 'alt' } as const;
const SVG_NS = 'http://www.w3.org/2000/svg';

function comboHeld(m: PointerModifiers, combo: ModifierCombo): boolean {
  if (combo === 'none') return true;
  return combo.split('+').every((k) => (m as any)[k] === true);
}

/**
 * Named `lassoSelect` handler. Disabled by default. `dragActivator`+down →
 * `'exclusive'`; each move appends to a pixel-space path drawn as an SVG
 * polyline in `_canvasContainer`; release closes the polygon, bbox-prefilters
 * via `queryFeatures`, then refines per-feature with the shared
 * `featureMatchesLasso`. Mutually exclusive with `boxSelect` (a later task).
 */
export class LassoSelectHandler extends EventDispatcher implements Handler<LassoSelectHandlerOptions> {
  readonly name = 'lassoSelect';
  private _enabled = false;
  private _opts: LassoSelectHandlerOptions = {};
  private _path: Array<[number, number]> | null = null;
  private _svg: SVGSVGElement | null = null;
  private _poly: SVGPolylineElement | null = null;

  constructor(private _map: Emap) { super(); }

  enable(): void { this._enabled = true; }
  disable(): void {
    this._enabled = false;
    if (this._path) this._cancel();
  }
  isEnabled(): boolean { return this._enabled; }
  setOptions(opts: Partial<LassoSelectHandlerOptions>): void { this._opts = { ...this._opts, ...opts }; }
  getOptions(): Readonly<LassoSelectHandlerOptions> { return this._opts; }

  private get _threshold(): number { return this._opts.dragThreshold ?? 4; }
  private get _activator(): ModifierCombo { return this._opts.dragActivator ?? 'shift'; }

  private _ensureSvg(): { svg: SVGSVGElement; poly: SVGPolylineElement } {
    if (this._svg && this._poly) return { svg: this._svg, poly: this._poly };
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.display = 'none';
    svg.setAttribute('class', 'emap-lasso-select');
    const poly = document.createElementNS(SVG_NS, 'polyline') as SVGPolylineElement;
    const s = this._opts.style ?? {};
    poly.setAttribute('fill', s.fill ?? 'rgba(0, 120, 255, 0.1)');
    poly.setAttribute('stroke', s.stroke ?? '#0078ff');
    poly.setAttribute('stroke-width', String(s.strokeWidth ?? 1.5));
    poly.setAttribute('points', '');
    svg.appendChild(poly);
    this._map.getCanvasContainer().appendChild(svg);
    this._svg = svg;
    this._poly = poly;
    return { svg, poly };
  }

  private _cancel(): void {
    if (this._svg) this._svg.style.display = 'none';
    this._path = null;
  }

  handlePointer(ev: NormalizedPointerEvent): HandlerResult {
    if (!this._enabled) return 'passthrough';

    if (ev.kind === 'down') {
      if (ev.button !== 0 || !comboHeld(ev.modifiers, this._activator)) return 'passthrough';
      const { svg, poly } = this._ensureSvg();
      this._path = [[ev.point.x, ev.point.y]];
      poly.setAttribute('points', `${ev.point.x},${ev.point.y}`);
      svg.style.display = 'block';
      return 'exclusive';
    }

    if (ev.kind === 'move' && this._path) {
      this._path.push([ev.point.x, ev.point.y]);
      this._poly?.setAttribute('points', this._path.map((p) => `${p[0]},${p[1]}`).join(' '));
      return 'exclusive';
    }

    if (ev.kind === 'up' && this._path) {
      const path = this._path;
      this._cancel();
      if (path.length < 3) return 'passthrough';
      const bbox = pathBBox(path);
      if (Math.hypot(bbox[2] - bbox[0], bbox[3] - bbox[1]) < this._threshold) return 'passthrough';
      const closed = path.slice();
      closed.push(path[0]);
      const candidates = this._map.queryFeatures(
        [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
        this._opts.layers ? { layers: this._opts.layers } : undefined,
      );
      const includeIntersecting = this._opts.includeIntersecting !== false;
      const refs: FeatureRef[] = [];
      const seen = new Set<string>();
      for (const f of candidates) {
        const key = `${f.source}|${f.layer}|${f.id}`;
        if (seen.has(key)) continue;
        if (!featureMatchesLasso(this._map, f, closed, includeIntersecting)) continue;
        seen.add(key);
        refs.push({ source: f.source, layer: f.layer, id: f.id });
      }
      const mode = resolveMode(ev.modifiers, this._opts.modifiers ?? LASSO_DEFAULT_MODS, this._activator);
      this._map.select(refs, { mode });
      return 'passthrough';
    }

    return 'passthrough';
  }
}
