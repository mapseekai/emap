import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';
import {
  formatMeasurement,
  MeasurementCalculator,
  type MeasurementContext,
  type MeasurementMode,
  type MeasurementPoint,
} from '../../../domain/geo/measurement';
import type { MeasurementOverlayState, MeasurementSegmentLabel } from '../../rendering/painter';
import { EMAP_THEME_COLORS } from '../../../ui/theme/colors';
import type { EditHandlerHost } from './edit-handler-host';

const CLOSE_THRESHOLD = 12;
const MAX_SAMPLE_DEPTH = 14;
const MAX_SAMPLED_POINTS = 1_500;
const MAX_SCREEN_SEGMENT_LENGTH = 18;
const MAX_CHORD_DEVIATION = 1.5;

const DEFAULT_OPTIONS: MeasureOptions = {
  mode: 'length',
  drawColor: EMAP_THEME_COLORS.primary,
};

export interface MeasureOptions {
  mode: MeasurementMode;
  drawColor?: string;
}

export interface MeasureResult {
  mode: MeasurementMode;
  completed: boolean;
  vertices: readonly (readonly [number, number])[];
  lengthMeters: number | null;
  areaSquareMeters: number | null;
}

/** Resolver boundary retained for deterministic handler tests and alternate map runtimes. */
export interface MeasurementContextResolver {
  getContext(crs: string): Promise<MeasurementContext | null>;
}

export class MeasureHandler implements Handler<MeasureOptions> {
  readonly name = 'measure';
  private readonly _map: EditHandlerHost;
  private readonly _resolver: MeasurementContextResolver;
  private _enabled = false;
  private _opts: MeasureOptions;
  private _vertices: [number, number][] = [];
  private _cursorCoord: [number, number] | null = null;
  private _completed = false;
  private _context: MeasurementContext | null = null;
  private _contextRequest = 0;
  private _lengthMeters: number | null = null;
  private _areaSquareMeters: number | null = null;
  /** Injected by HandlerManager.register (cursor recompute on mode flips). */
  _manager?: { refreshCursor(): void };

  private _onMapMoveBound = () => this._onMapMove();
  private _onCrsChangeBound = () => this._onCrsChange();
  private _onKeyDownBound = (event: KeyboardEvent) => this._onKeyDown(event);

  constructor(
    map: EditHandlerHost,
    options: Partial<MeasureOptions> = {},
    resolver: MeasurementContextResolver = new MeasurementCalculator(),
  ) {
    this._map = map;
    this._opts = { ...DEFAULT_OPTIONS, ...options };
    this._resolver = resolver;
    this._map.on('editmodechange', (event: { mode: string }) => {
      if (event.mode !== 'measure' && this._enabled) this._quietDisable();
    });
  }

  enable(): void {
    if (this._enabled) return;
    if (!isMeasurementMode(this._opts.mode)) {
      throw new Error('measure: mode must be "length" or "area"');
    }

    this._enabled = true;
    this._map.setEditMode('measure');
    window.addEventListener('keydown', this._onKeyDownBound);
    this._map.on('move', this._onMapMoveBound);
    this._map.on('crschange', this._onCrsChangeBound);
    this._requestContext();
    this._manager?.refreshCursor();
    this._refreshOverlay();
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this._contextRequest++;
    this._resetMeasurement();
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.off('move', this._onMapMoveBound);
    this._map.off('crschange', this._onCrsChangeBound);
    this._map.setEditMode('none');
    this._map.clearEditMeasurementState();
    this._manager?.refreshCursor();
    this._map.render();
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  setOptions(options: Partial<MeasureOptions>): void {
    const previousMode = this._opts.mode;
    const next = { ...this._opts, ...options };
    if (!isMeasurementMode(next.mode)) {
      throw new Error('measure: mode must be "length" or "area"');
    }
    this._opts = next;
    if (!this._enabled) return;

    if (next.mode !== previousMode) {
      this._resetMeasurement();
      this._requestContext();
    }
    this._refreshOverlay();
  }

  getOptions(): Readonly<MeasureOptions> {
    return { ...this._opts };
  }

  getResult(): MeasureResult {
    return {
      mode: this._opts.mode,
      completed: this._completed,
      vertices: this._vertices.map((point) => [point[0], point[1]]),
      lengthMeters: this._lengthMeters,
      areaSquareMeters: this._areaSquareMeters,
    };
  }

  getCursor(): string | null {
    return this._enabled ? 'crosshair' : null;
  }

  handlePointer(event: NormalizedPointerEvent): HandlerResult {
    if (!this._enabled) return 'passthrough';

    if (event.kind === 'move') {
      this._cursorCoord = this._coordinateAt(event.point.x, event.point.y);
      this._refreshOverlay();
      return 'passthrough';
    }
    if (event.kind === 'click') {
      if (event.button !== 0) return 'passthrough';
      this._handleClick(event.point.x, event.point.y);
      return 'consumed';
    }
    if (event.kind === 'dblclick') {
      event.originalEvent.preventDefault();
      event.originalEvent.stopPropagation();
      this._complete();
      return 'consumed';
    }
    return 'passthrough';
  }

  private _quietDisable(): void {
    this._enabled = false;
    this._contextRequest++;
    this._resetMeasurement();
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.off('move', this._onMapMoveBound);
    this._map.off('crschange', this._onCrsChangeBound);
    this._map.clearEditMeasurementState();
    this._manager?.refreshCursor();
    this._map.render();
  }

  private _onMapMove(): void {
    if (this._vertices.length > 0) this._refreshOverlay();
  }

  private _onCrsChange(): void {
    this._resetMeasurement();
    this._requestContext();
    this._refreshOverlay();
  }

  private _onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    this._resetMeasurement();
    this._map.clearEditMeasurementState();
    this._map.render();
  }

  private _handleClick(px: number, py: number): void {
    const point = this._coordinateAt(px, py);
    if (!point) return;

    if (this._completed) this._resetMeasurement();
    if (
      this._opts.mode === 'area' &&
      this._vertices.length >= 3 &&
      this._isNearFirst(point, px, py)
    ) {
      this._complete();
      return;
    }
    const previous = this._vertices.at(-1);
    if (previous && samePoint(previous, point)) return;

    this._vertices.push(point);
    this._cursorCoord = null;
    this._refreshOverlay();
  }

  private _complete(): void {
    const minimumVertices = this._opts.mode === 'length' ? 2 : 3;
    if (this._vertices.length < minimumVertices) return;

    this._completed = true;
    this._cursorCoord = null;
    this._refreshOverlay();
  }

  private _requestContext(): void {
    const crs = this._map.getCRS();
    const request = ++this._contextRequest;
    this._context = null;
    void this._resolver.getContext(crs).then(
      (context) => {
        if (!this._enabled || request !== this._contextRequest || crs !== this._map.getCRS())
          return;
        this._context = context;
        this._refreshOverlay();
      },
      () => {
        if (!this._enabled || request !== this._contextRequest || crs !== this._map.getCRS())
          return;
        this._context = null;
        this._refreshOverlay();
      },
    );
  }

  private _refreshOverlay(): void {
    if (!this._enabled || this._vertices.length === 0) {
      this._lengthMeters = null;
      this._areaSquareMeters = null;
      this._map.clearEditMeasurementState();
      return;
    }

    const context = this._context;
    const worldWidth = context ? this._worldWidth(context) : 0;
    const resultValue = context ? this._measure(this._vertices, context) : null;
    const displayPoints =
      !this._completed && this._cursorCoord
        ? [...this._vertices, this._cursorCoord]
        : this._vertices;
    const displayValue = context ? this._measure(displayPoints, context) : null;
    this._lengthMeters = this._opts.mode === 'length' ? resultValue : null;
    this._areaSquareMeters = this._opts.mode === 'area' ? resultValue : null;

    const closed = this._completed && this._opts.mode === 'area';
    const committedPath = context
      ? this._samplePath(this._vertices, closed, context, worldWidth)
      : copyPoints(this._vertices, closed);
    const previewPath =
      !this._completed && this._cursorCoord && this._vertices.length > 0
        ? this._samplePath(
            this._opts.mode === 'area' && this._vertices.length >= 2
              ? [this._vertices.at(-1)!, this._cursorCoord, this._vertices[0]]
              : [this._vertices.at(-1)!, this._cursorCoord],
            false,
            context,
            worldWidth,
          )
        : null;
    const labelRingClosed =
      closed ||
      (this._opts.mode === 'area' &&
        !this._completed &&
        this._cursorCoord !== null &&
        this._vertices.length >= 2);
    const fallbackLabelCoord = this._completed ? this._vertices.at(-1)! : this._cursorCoord;
    const labelCoord =
      this._opts.mode === 'area'
        ? ((context ? this._areaCenter(displayPoints, context, worldWidth) : null) ??
          fallbackLabelCoord)
        : fallbackLabelCoord;
    const state: MeasurementOverlayState = {
      mode: this._opts.mode,
      vertices: copyPoints(this._vertices),
      committedPath,
      previewPath,
      fillPath: closed ? committedPath : null,
      segmentLabels: context
        ? this._segmentLabels(displayPoints, labelRingClosed, context, worldWidth)
        : [],
      label: formatMeasurement(this._opts.mode, displayValue),
      labelCoord,
      completed: this._completed,
      drawColor: this._opts.drawColor ?? EMAP_THEME_COLORS.primary,
    };
    this._map.setEditMeasurementState(state);
  }

  private _measure(
    points: readonly MeasurementPoint[],
    context: MeasurementContext,
  ): number | null {
    return this._opts.mode === 'length' ? context.length(points) : context.area(points);
  }

  private _segmentLabels(
    points: readonly MeasurementPoint[],
    closed: boolean,
    context: MeasurementContext,
    worldWidth: number,
  ): MeasurementSegmentLabel[] {
    const labels: MeasurementSegmentLabel[] = [];
    const edgeCount = closed ? points.length : points.length - 1;
    for (let index = 0; index < edgeCount; index++) {
      const start = points[index];
      const end = points[(index + 1) % points.length];
      if (samePoint(start, end)) continue;
      const lengthMeters = context.length([start, end]);
      if (lengthMeters === null) continue;
      const label = formatMeasurement('length', lengthMeters);
      if (!label) continue;
      const startLngLat = context.inverse(start);
      const endLngLat = context.inverse(end);
      const midpointLngLat =
        startLngLat && endLngLat ? interpolateGreatCircle(startLngLat, endLngLat) : null;
      const midpointProjected = midpointLngLat ? context.forward(midpointLngLat) : null;
      const coord: [number, number] = midpointProjected
        ? shiftTowardWorldCopy(midpointProjected, start, worldWidth)
        : [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
      labels.push({ label, coord });
    }
    return labels;
  }

  private _areaCenter(
    points: readonly MeasurementPoint[],
    context: MeasurementContext,
    worldWidth: number,
  ): [number, number] | null {
    if (points.length === 0) return null;
    let anchor: number | null = null;
    let sumLng = 0;
    let sumLat = 0;
    for (const point of points) {
      const lngLat = context.inverse(point);
      if (!lngLat) return null;
      if (anchor === null) anchor = lngLat[0];
      let lng = lngLat[0];
      while (lng - anchor > 180) lng -= 360;
      while (lng - anchor < -180) lng += 360;
      sumLng += lng;
      sumLat += lngLat[1];
    }
    const centerLngLat: [number, number] = [sumLng / points.length, sumLat / points.length];
    const center = context.forward(centerLngLat);
    return center ? shiftTowardWorldCopy(center, points[0], worldWidth) : null;
  }

  private _samplePath(
    points: readonly MeasurementPoint[],
    close: boolean,
    context: MeasurementContext | null,
    worldWidth = 0,
  ): [number, number][] {
    if (points.length === 0) return [];
    if (points.length === 1 || !context) return copyPoints(points, close);
    const path: [number, number][] = [[points[0][0], points[0][1]]];
    const budget = { count: 1 };
    const segmentCount = close ? points.length : points.length - 1;
    for (let index = 0; index < segmentCount; index++) {
      const start = points[index];
      const end = points[(index + 1) % points.length];
      const segment = this._sampleSegment(start, end, context, budget, worldWidth);
      for (let pointIndex = 1; pointIndex < segment.length; pointIndex++) {
        path.push(segment[pointIndex]);
      }
    }
    return path;
  }

  private _sampleSegment(
    start: MeasurementPoint,
    end: MeasurementPoint,
    context: MeasurementContext,
    budget: { count: number },
    worldWidth: number,
  ): [number, number][] {
    const fallback: [number, number][] = [
      [start[0], start[1]],
      [end[0], end[1]],
    ];
    try {
      const startLngLat = context.inverse(start);
      const endLngLat = context.inverse(end);
      if (!startLngLat || !endLngLat) return fallback;

      const path: [number, number][] = [[start[0], start[1]]];
      const append = (point: MeasurementPoint): void => {
        const previous = path.at(-1)!;
        if (!samePoint(previous, point)) {
          path.push([point[0], point[1]]);
          budget.count++;
        }
      };
      const sample = (
        from: MeasurementPoint,
        fromLngLat: MeasurementPoint,
        to: MeasurementPoint,
        toLngLat: MeasurementPoint,
        depth: number,
      ): void => {
        if (budget.count >= MAX_SAMPLED_POINTS || depth >= MAX_SAMPLE_DEPTH) {
          append(to);
          return;
        }
        const midpointLngLat = interpolateGreatCircle(fromLngLat, toLngLat);
        const midpointProjected = midpointLngLat ? context.forward(midpointLngLat) : null;
        // forward() normalizes into the base world copy (±180° for geographic
        // CRS) while the canvas pans across world copies with unwrapped
        // coordinates. Shift each sample toward its segment anchor so the
        // path never jumps 360° across the canvas.
        const midpoint = midpointProjected
          ? shiftTowardWorldCopy(midpointProjected, from, worldWidth)
          : null;
        if (!midpointLngLat || !midpoint) {
          append(to);
          return;
        }
        const fromScreen = this._map.project(from[0], from[1]);
        const toScreen = this._map.project(to[0], to[1]);
        const midpointScreen = this._map.project(midpoint[0], midpoint[1]);
        if (
          !isFinitePoint(fromScreen) ||
          !isFinitePoint(toScreen) ||
          !isFinitePoint(midpointScreen)
        ) {
          append(to);
          return;
        }
        const screenLength = Math.hypot(toScreen[0] - fromScreen[0], toScreen[1] - fromScreen[1]);
        const deviation = pointToSegmentDistance(midpointScreen, fromScreen, toScreen);
        if (screenLength <= MAX_SCREEN_SEGMENT_LENGTH && deviation <= MAX_CHORD_DEVIATION) {
          append(to);
          return;
        }
        sample(from, fromLngLat, midpoint, midpointLngLat, depth + 1);
        sample(midpoint, midpointLngLat, to, toLngLat, depth + 1);
      };

      sample(start, startLngLat, end, endLngLat, 0);
      return path;
    } catch {
      return fallback;
    }
  }

  private _worldWidth(context: MeasurementContext): number {
    try {
      const west = context.forward([-180, 0]);
      const east = context.forward([180, 0]);
      if (!west || !east) return 0;
      const width = east[0] - west[0];
      return Number.isFinite(width) && width > 0 ? width : 0;
    } catch {
      return 0;
    }
  }

  private _coordinateAt(px: number, py: number): [number, number] | null {
    try {
      const point = this._map.unproject(px, py);
      return isFinitePoint(point) ? [point[0], point[1]] : null;
    } catch {
      return null;
    }
  }

  private _isNearFirst(point: MeasurementPoint, px: number, py: number): boolean {
    const first = this._vertices[0];
    if (!first || !isFinitePoint(point)) return false;
    try {
      const projected = this._map.project(first[0], first[1]);
      return (
        isFinitePoint(projected) &&
        Math.hypot(projected[0] - px, projected[1] - py) <= CLOSE_THRESHOLD
      );
    } catch {
      return false;
    }
  }

  private _resetMeasurement(): void {
    this._vertices = [];
    this._cursorCoord = null;
    this._completed = false;
    this._lengthMeters = null;
    this._areaSquareMeters = null;
  }
}

function copyPoints(points: readonly MeasurementPoint[], close = false): [number, number][] {
  const copied = points.map((point) => [point[0], point[1]] as [number, number]);
  if (close && copied.length > 1) copied.push([copied[0][0], copied[0][1]]);
  return copied;
}

// CRS transforms normalize into the base world copy (±180° for geographic
// CRS) while the canvas pans across world copies with unwrapped coordinates.
// Shift a transformed point toward a reference copy so adjacent path points
// never jump a full world width across the canvas.
function shiftTowardWorldCopy(
  point: [number, number],
  reference: MeasurementPoint,
  worldWidth: number,
): [number, number] {
  if (worldWidth <= 0) return point;
  let x = point[0];
  while (x - reference[0] > worldWidth / 2) x -= worldWidth;
  while (x - reference[0] < -worldWidth / 2) x += worldWidth;
  return x === point[0] ? point : [x, point[1]];
}

function isMeasurementMode(mode: unknown): mode is MeasurementMode {
  return mode === 'length' || mode === 'area';
}

function isFinitePoint(point: readonly [number, number]): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function samePoint(first: MeasurementPoint, second: MeasurementPoint): boolean {
  return first[0] === second[0] && first[1] === second[1];
}

function interpolateGreatCircle(
  first: MeasurementPoint,
  second: MeasurementPoint,
): [number, number] | null {
  const firstVector = lngLatToVector(first);
  const secondVector = lngLatToVector(second);
  const dot = clamp(dotProduct(firstVector, secondVector), -1, 1);
  const angle = Math.acos(dot);
  const sinAngle = Math.sin(angle);
  if (sinAngle < 1e-12) return null;

  const firstWeight = Math.sin(angle * 0.5) / sinAngle;
  const secondWeight = firstWeight;
  const x = firstVector[0] * firstWeight + secondVector[0] * secondWeight;
  const y = firstVector[1] * firstWeight + secondVector[1] * secondWeight;
  const z = firstVector[2] * firstWeight + secondVector[2] * secondWeight;
  const longitude = Math.atan2(y, x) * (180 / Math.PI);
  const latitude = Math.atan2(z, Math.hypot(x, y)) * (180 / Math.PI);
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null;
}

function lngLatToVector(point: MeasurementPoint): [number, number, number] {
  const longitude = point[0] * (Math.PI / 180);
  const latitude = point[1] * (Math.PI / 180);
  const cosLatitude = Math.cos(latitude);
  return [Math.cos(longitude) * cosLatitude, Math.sin(longitude) * cosLatitude, Math.sin(latitude)];
}

function dotProduct(first: readonly number[], second: readonly number[]): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function pointToSegmentDistance(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const ratio = clamp(
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(point[0] - (start[0] + ratio * dx), point[1] - (start[1] + ratio * dy));
}
