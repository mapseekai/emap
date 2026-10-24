import { EventDispatcher } from '../../core/events';
import { Bounds } from '../../../domain/geo/bounds';
import {
  Camera,
  type AnimationOptions,
  type CameraOptions,
  type FitBoundsOptions,
  type FlyToOptions,
} from '../../../domain/geo/camera';
import { Projection } from '../../../domain/geo/projection';
import { AffineTransform } from '../../../domain/geo/transform';
import { Viewport } from '../../../domain/geo/viewport';
import type { DocumentContract as WorkspaceDocument } from '../../../runtime/services/contracts/document';
import type { RenderSignalsContract as RenderSignals } from '../../../runtime/services/contracts/signals';
import type { MapOptions } from '../../map/types';

interface Dependencies {
  document: Pick<WorkspaceDocument, '_sources'>;
  events: EventDispatcher;
  signals: RenderSignals;
  options?: Pick<MapOptions, 'geometryLod' | 'screenPathFiltering'>;
}

/** view implementation, wired through explicit service dependencies. */
export class ViewServiceImpl {
  _viewport: Viewport = new Viewport();

  _projection: Projection = new Projection();

  _camera!: Camera;

  public getCRS(): string {
    return this._projection.crs;
  }

  public setGeometryLod(options?: MapOptions['geometryLod']): void {
    if (
      options !== undefined &&
      options !== false &&
      (!options ||
        typeof options !== 'object' ||
        Array.isArray(options) ||
        Object.keys(options).some((key) => key !== 'pixelTolerance') ||
        (options.pixelTolerance !== undefined &&
          (typeof options.pixelTolerance !== 'number' ||
            !Number.isFinite(options.pixelTolerance) ||
            options.pixelTolerance <= 0 ||
            options.pixelTolerance > 64)))
    )
      throw new Error('geometryLod must be false or { pixelTolerance: >0..64 }.');
    const tolerance = options === false ? 0 : (options?.pixelTolerance ?? 0.5);
    if (tolerance === this._viewport.geometryLodTolerance) return;
    this._viewport.geometryLodTolerance = tolerance;
    this.deps.signals.requestRender();
  }

  public setScreenPathFiltering(enabled = false): void {
    if (typeof enabled !== 'boolean') throw new Error('screenPathFiltering must be a boolean.');
    if (enabled === this._viewport.screenPathFiltering) return;
    this._viewport.screenPathFiltering = enabled;
    this.deps.signals.requestRender();
  }

  public getCenter(): [number, number] {
    const t = this._viewport.transform;
    const cx = (this._viewport.width / 2 - t.bx) / t.mx;
    const cy = (this._viewport.height / 2 - t.by) / t.my;
    return this._projection.getCenter(cx, cy);
  }

  public getZoom(): number {
    return this._projection.getZoom(Math.abs(this._viewport.transform.mx));
  }

  public getTransform(): AffineTransform {
    return this._viewport.transform.clone();
  }

  public getExtent(): Bounds {
    return this._viewport.extent.clone();
  }

  public setExtent(bounds: Bounds): void {
    this._viewport.setExtent(bounds);
    this.deps.events.fire('move');
  }

  public reset(): void {
    const dataExtent = new Bounds();
    for (const source of this.deps.document._sources?.values() ?? []) {
      dataExtent.merge(source.getExtent());
    }
    if (dataExtent.hasBounds()) {
      this._viewport.clearInitialState();
      this._viewport.setExtent(dataExtent);
    } else {
      this._viewport.reset();
    }
    this.deps.signals.requestRender();
    this.deps.events.fire('move');
  }

  public zoomIn(): void {
    this._viewport.zoomIn();
  }

  public zoomOut(): void {
    this._viewport.zoomOut();
  }

  public jumpTo(o: CameraOptions): this {
    this._camera.jumpTo(o);
    return this;
  }

  public setCenter(center: [number, number]): this {
    this._camera.setCenter(center);
    return this;
  }

  public setZoom(zoom: number): this {
    this._camera.setZoom(zoom);
    return this;
  }

  public easeTo(o: CameraOptions & AnimationOptions): this {
    this._camera.easeTo(o);
    return this;
  }

  public panTo(center: [number, number], o: AnimationOptions = {}): this {
    this._camera.panTo(center, o);
    return this;
  }

  public panBy(offset: [number, number], o: AnimationOptions = {}): this {
    this._camera.panBy(offset, o);
    return this;
  }

  public zoomTo(zoom: number, o: AnimationOptions = {}): this {
    this._camera.zoomTo(zoom, o);
    return this;
  }

  public flyTo(o: FlyToOptions): this {
    this._camera.flyTo(o);
    return this;
  }

  public fitBounds(b: import('../../../domain/geo/bounds').Bounds, o: FitBoundsOptions = {}): this {
    this._camera.fitBounds(b, o);
    return this;
  }

  public stop(): this {
    this._camera.stop();
    return this;
  }

  public project(x: number, y: number): [number, number] {
    return this._viewport.project(x, y);
  }

  public unproject(px: number, py: number): [number, number] {
    return this._viewport.unproject(px, py);
  }

  dispose(): void {
    this._camera.stop();
    this._viewport.cancelZoomAnimation();
    this._viewport.onViewChange = () => {};
  }

  constructor(private readonly deps: Dependencies) {
    this.setGeometryLod(deps.options?.geometryLod);
    this.setScreenPathFiltering(deps.options?.screenPathFiltering);
    this._viewport.onViewChange = () => this.deps.events.fire('move');
    this._viewport.initZoomTween();
    this._camera = new Camera({
      getCameraState: () => this._viewport.getCameraState(),
      applyCameraState: (c, s) => this._viewport.applyCameraState(c, s),
      scaleFromZoom: (z) => this._projection.getScale(z),
      getViewportSize: () => ({ width: this._viewport.width, height: this._viewport.height }),
      fire: (type, event) => this.deps.events.fire(type, event),
      requestRender: () => this.deps.signals.requestRender('nav'),
      cancelZoomAnimation: () => this._viewport.cancelZoomAnimation(),
    });
  }
}
