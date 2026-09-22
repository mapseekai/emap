import { AffineTransform } from './transform';

export interface PerspectiveOptions {
  /** Degrees from nadir. Restricted to [0, 60] so the viewport never crosses the horizon. */
  pitch?: number;
  /** Clockwise camera bearing in degrees. North moves left at a positive bearing. */
  bearing?: number;
}

export type CameraUniforms = readonly [number, number, number, number];
const IDENTITY_CAMERA: CameraUniforms = [1, 0, 1, 0];
const RADIANS = Math.PI / 180;

/**
 * Opt-in ground-plane perspective for the luma renderer. The inherited affine
 * coefficients still describe the north-up, unpitched map in CSS pixels.
 * Existing Canvas renderers must not consume this transform when active.
 * All coordinates remain in the source CRS; this is not a globe or a DEM.
 */
export class PerspectiveTransform extends AffineTransform {
  private _pitch = 0;
  private _bearing = 0;
  private _width = 1;
  private _height = 1;
  private _camera: CameraUniforms = IDENTITY_CAMERA;

  constructor(
    flat: AffineTransform,
    width: number,
    height: number,
    options: PerspectiveOptions = {},
  ) {
    super(flat.mx, flat.my, flat.bx, flat.by);
    if (![flat.mx, flat.my, flat.bx, flat.by].every(Number.isFinite) || !flat.mx || !flat.my)
      throw new Error('Perspective transform requires a finite, invertible affine transform.');
    this.setSize(width, height);
    this.setOrientation(options);
  }

  get width(): number {
    return this._width;
  }
  get height(): number {
    return this._height;
  }
  get pitch(): number {
    return this._pitch;
  }
  get bearing(): number {
    return this._bearing;
  }
  get active(): boolean {
    return this._pitch !== 0 || this._bearing !== 0;
  }
  /** cos(bearing), sin(bearing), cos(pitch), sin(pitch)/focalLength. */
  get cameraUniforms(): CameraUniforms {
    return this._camera;
  }
  get flat(): AffineTransform {
    return new AffineTransform(this.mx, this.my, this.bx, this.by);
  }
  get center(): [number, number] {
    return super.unproject(this._width / 2, this._height / 2);
  }

  private setSize(width: number, height: number): void {
    if (![width, height].every((n) => Number.isFinite(n) && n > 0))
      throw new Error('Perspective viewport dimensions must be finite and positive.');
    this._width = width;
    this._height = height;
  }

  setOrientation(options: PerspectiveOptions): this {
    const pitch = options.pitch ?? this._pitch;
    const bearing = options.bearing ?? this._bearing;
    if (!Number.isFinite(pitch) || pitch < 0 || pitch > 60)
      throw new Error('Perspective pitch must be between 0 and 60 degrees.');
    if (!Number.isFinite(bearing)) throw new Error('Perspective bearing must be finite.');
    this._pitch = pitch;
    this._bearing = ((((bearing + 180) % 360) + 360) % 360) - 180;
    const b = this._bearing * RADIANS,
      p = pitch * RADIANS;
    // Fixed altitude of 1.5 viewport heights, independent of devicePixelRatio.
    this._camera = [Math.cos(b), Math.sin(b), Math.cos(p), Math.sin(p) / (1.5 * this._height)];
    return this;
  }

  resize(width: number, height: number): this {
    const dx = (width - this._width) / 2,
      dy = (height - this._height) / 2;
    this.setSize(width, height);
    super.translate(dx, dy);
    return this.setOrientation({});
  }

  /** Unpitched CSS pixels to screen pixels. Points behind the camera are not pickable. */
  projectFlat(px: number, py: number): [number, number] {
    if (!this.active) return [px, py];
    const [cb, sb, cp, sp] = this._camera;
    const x = px - this._width / 2,
      y = py - this._height / 2;
    const rx = cb * x + sb * y,
      ry = -sb * x + cb * y;
    const w = 1 - sp * ry;
    if (!(w > 0)) return [NaN, NaN];
    return [this._width / 2 + rx / w, this._height / 2 + (cp * ry) / w];
  }

  /** Screen ray intersected with the z=0 ground plane, returned in flat CSS pixels. */
  unprojectFlat(px: number, py: number): [number, number] {
    if (!this.active) return [px, py];
    const [cb, sb, cp, sp] = this._camera;
    const x = px - this._width / 2,
      y = py - this._height / 2;
    const denominator = cp + sp * y;
    if (!(denominator > 0)) return [NaN, NaN];
    const ry = y / denominator,
      rx = x * (1 - sp * ry);
    return [this._width / 2 + cb * rx - sb * ry, this._height / 2 + sb * rx + cb * ry];
  }

  override project(x: number, y: number): [number, number] {
    return this.projectFlat(...super.project(x, y));
  }
  override unproject(px: number, py: number): [number, number] {
    return super.unproject(...this.unprojectFlat(px, py));
  }
  override clone(): PerspectiveTransform {
    return new PerspectiveTransform(this, this._width, this._height, {
      pitch: this._pitch,
      bearing: this._bearing,
    });
  }
  /** Finest local ground resolution sampled across the viewport, in source units/CSS px.
   * The inverse-camera Jacobian avoids subtracting large geospatial coordinates. */
  groundResolution(): number {
    const [cb, sb, cp, sp] = this._camera;
    let finest = 1 / Math.abs(this.mx);
    for (const x of [-this._width / 2, 0, this._width / 2])
      for (const y of [-this._height / 2, 0, this._height / 2]) {
        const d = cp + sp * y,
          xx = cp / d,
          xy = (-x * cp * sp) / (d * d),
          yy = cp / (d * d);
        const a = (cb * xx) / this.mx,
          b = (sb * xx) / this.my,
          c = (cb * xy - sb * yy) / this.mx,
          e = (sb * xy + cb * yy) / this.my;
        const aa = a * a + b * b,
          bb = c * c + e * e,
          ab = a * c + b * e;
        const largest = Math.sqrt((aa + bb + Math.hypot(aa - bb, 2 * ab)) / 2);
        const smallest = Math.abs(a * e - b * c) / largest;
        if (Number.isFinite(smallest) && smallest > 0) finest = Math.min(finest, smallest);
      }
    return finest;
  }

  /** Zoom around the actual pointer ray, not around its unpitched screen location. */
  override scale(k: number, px: number, py: number): void {
    if (!Number.isFinite(k) || k <= 0) throw new Error('Zoom factor must be finite and positive.');
    const focus = this.unprojectFlat(px, py);
    if (!focus.every(Number.isFinite)) return;
    const next = [
      this.mx * k,
      this.my * k,
      focus[0] * (1 - k) + this.bx * k,
      focus[1] * (1 - k) + this.by * k,
    ];
    if (!next.every(Number.isFinite) || !next[0] || !next[1])
      throw new Error('Zoom exceeds finite coordinate precision.');
    super.scale(k, ...focus);
  }
  /** Keep the ground point grabbed at (x-dx,y-dy) attached to the moving pointer. */
  pan(dx: number, dy: number, x = this._width / 2, y = this._height / 2): void {
    const from = this.unprojectFlat(x - dx, y - dy),
      to = this.unprojectFlat(x, y);
    if (![...from, ...to].every(Number.isFinite)) return;
    super.translate(to[0] - from[0], to[1] - from[1]);
  }
  override translate(dx: number, dy: number): void {
    this.pan(dx, dy);
  }
}

export function perspectiveActive(view: AffineTransform): view is PerspectiveTransform {
  return view instanceof PerspectiveTransform && view.active;
}
export function cameraUniforms(view: AffineTransform): CameraUniforms {
  return view instanceof PerspectiveTransform ? view.cameraUniforms : IDENTITY_CAMERA;
}

/** Conservative footprint: opposite corners are insufficient after bearing/pitch. */
export function groundBounds(
  view: AffineTransform,
  width: number,
  height: number,
  padding = 0,
): [number, number, number, number] {
  const points = [
    [-padding, -padding],
    [width + padding, -padding],
    [width + padding, height + padding],
    [-padding, height + padding],
  ].map(([x, y]) => view.unproject(x, y));
  // A caller requesting padding across the horizon must retain candidates, not drop them.
  if (!points.every((p) => p.every(Number.isFinite)))
    return [-Infinity, -Infinity, Infinity, Infinity];
  return [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ];
}

/** Reproject a completed ground-plane screenshot into the next camera. Column-major
 * CSS-compatible homogeneous matrix; used only for transient navigation previews.
 * Work in relative affine pixels so the map's large source origin cancels first.
 * A snapshot crossing the camera plane is rejected instead of folding the bitmap.
 */
export function groundSnapshotMatrix(
  from: AffineTransform,
  to: AffineTransform,
  width: number,
  height: number,
): number[] | null {
  if (
    ![width, height, from.mx, from.my, to.mx, to.my].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    !from.mx ||
    !from.my ||
    !to.mx ||
    !to.my
  )
    return null;
  const [cb0, sb0, cp0, sp0] = cameraUniforms(from);
  const [cb1, sb1, cp1, sp1] = cameraUniforms(to);
  const cx = width / 2,
    cy = height / 2,
    kx = to.mx / from.mx,
    ky = to.my / from.my;
  const dx = (cx - from.bx) * kx + to.bx - cx,
    dy = (cy - from.by) * ky + to.by - cy;
  const homogeneous = (px: number, py: number): [number, number, number] => {
    const x = px - cx,
      y = py - cy,
      d = cp0 + sp0 * y;
    const ax = kx * (cb0 * cp0 * x - sb0 * y) + dx * d;
    const ay = ky * (sb0 * cp0 * x + cb0 * y) + dy * d;
    const rx = cb1 * ax + sb1 * ay,
      ry = -sb1 * ax + cb1 * ay,
      w = d - sp1 * ry;
    return [cx * w + rx, cy * w + cp1 * ry, w];
  };
  for (const [x, y] of [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ]) {
    const p = homogeneous(x, y);
    if (!p.every(Number.isFinite) || p[2] <= 1e-6) return null;
  }
  const o = homogeneous(0, 0),
    x = homogeneous(1, 0),
    y = homogeneous(0, 1),
    w = o[2];
  const matrix = [
    (x[0] - o[0]) / w,
    (x[1] - o[1]) / w,
    0,
    (x[2] - o[2]) / w,
    (y[0] - o[0]) / w,
    (y[1] - o[1]) / w,
    0,
    (y[2] - o[2]) / w,
    0,
    0,
    1,
    0,
    o[0] / w,
    o[1] / w,
    0,
    1,
  ];
  return matrix.every(Number.isFinite) ? matrix : null;
}
