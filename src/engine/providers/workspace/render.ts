import { PointIconImages } from '../../rendering/icons/images';
import { BoundLabelManager, type LabelBinding } from '../../rendering/labels/manager';
import type { RenderPass, RenderFrame } from '../../../runtime/services/contracts/render-pass';
import { EventDispatcher } from '../../core/events';
import { AffineTransform } from '../../../domain/geo/transform';
import type { PointLodPick } from '../../map/feature-query';
import { renderLayers } from '../../map/layer-renderer';
import { type AffineDelta, type RenderAction, type RenderRequest } from '../../map/types';
import { EditOverlayRenderer } from '../../rendering/edit-overlay-renderer';
import { type EditPainter } from '../../rendering/painter';
import { pointLodForPainter } from '../../rendering/point-lod';
import { RenderScheduler, type RenderSnapshot } from '../../rendering/render-scheduler';
import {
  checkedSourceOrder,
  sourceRenderBlocks,
  type RenderPassStage,
} from '../../rendering/source-order';
import { getLayerId } from '../../../domain/source/layer-utils';
import type { ArcCollection, MapshaperLayer } from '../../../shared/types/mapshaper-types';
import type { CacheContract as WorkspaceCache } from '../../../runtime/services/contracts/cache';
import type { DocumentContract as WorkspaceDocument } from '../../../runtime/services/contracts/document';
import type { EditStateContract as EditStateServiceImpl } from '../../../runtime/services/contracts/edit-state';
import type { LayerContract as LayerServiceImpl } from '../../../runtime/services/contracts/layers';
import type { PainterFactoryContract as PainterFactory } from '../../../runtime/services/contracts/painter-factory';
import type { SurfaceContract as SurfaceServiceImpl } from '../../../runtime/services/contracts/surface';
import type { ViewContract as ViewServiceImpl } from '../../../runtime/services/contracts/view';

interface Dependencies {
  cache: Pick<WorkspaceCache, '_featureQuery' | '_getLayerArcIds'>;
  document: Pick<
    WorkspaceDocument,
    '_highlightManager' | '_removed' | '_selection' | '_sources' | 'layers'
  >;
  editState: Pick<EditStateServiceImpl, '_editState'>;
  events: EventDispatcher;
  layers: Pick<
    LayerServiceImpl,
    | '_featureMaskForPick'
    | '_filterResolver'
    | '_getEffectiveLayers'
    | '_getVisibleLayerKeys'
    | '_styleResolver'
  >;
  painterFactory: Pick<PainterFactory, 'create'>;
  signal: AbortSignal;
  surface: Pick<SurfaceServiceImpl, '_canvasContainer' | '_container'>;
  view: Pick<ViewServiceImpl, '_viewport'>;
}

/** render implementation, wired through explicit service dependencies. */
export class CanvasRenderService {
  private _labels: BoundLabelManager | null = null;
  private _icons: PointIconImages | null = null;
  private readonly _passes = new Map<RenderPass, RenderPassStage>();
  private _sourceOrder: string[] = [];

  setSourceOrder(order: readonly string[]): void {
    const next = checkedSourceOrder(order);
    if (
      next.length === this._sourceOrder.length &&
      next.every((id, i) => id === this._sourceOrder[i])
    )
      return;
    this._sourceOrder = next;
    this._scheduleRender();
  }

  getSourceOrder(): readonly string[] {
    return [...this._sourceOrder];
  }

  registerPass(pass: RenderPass, stage: RenderPassStage = 'before-layers'): () => void {
    const checkedStage =
      typeof stage === 'object' ? { sourceId: checkedSourceOrder([stage.sourceId])[0] } : stage;
    if (this._passes.has(pass)) throw new Error('Render pass is already registered');
    this._passes.set(pass, checkedStage);
    this._scheduleRender();
    return () => {
      if (this._passes.delete(pass)) this._scheduleRender();
    };
  }

  private _renderPasses(stage: 'before-layers' | 'after-layers'): void {
    if (!this._passes.size) return;
    const viewport = this.deps.view._viewport;
    const frame: RenderFrame = {
      transform: viewport.transform.clone(),
      width: viewport.width,
      height: viewport.height,
      pixelRatio: window.devicePixelRatio || 1,
      painter: this._painter,
    };
    for (const [pass, position] of this._passes) {
      if (position !== stage) continue;
      try {
        pass(frame);
      } catch (error) {
        this.deps.events.fire('error', { error });
      }
    }
  }

  beginNavigation(): void {
    this._ensureNavSnapshot();
  }
  updateNavigation(): void {
    this._scheduleRender('nav', this._computeNavDelta());
  }
  endNavigation(): void {
    this._endNavGesture();
  }
  settleNavigation(delay: number): void {
    if (this._wheelSettleTimer !== null) clearTimeout(this._wheelSettleTimer);
    this._wheelSettleTimer = setTimeout(() => {
      this._wheelSettleTimer = null;
      this._endNavGesture();
    }, delay);
  }
  cancelNavigation(): void {
    const wasNavigating = this._navSnapshotTransform !== null;
    if (this._wheelSettleTimer !== null) clearTimeout(this._wheelSettleTimer);
    this._wheelSettleTimer = null;
    this._navSnapshotTransform = null;
    this._clearFastTransform();
    if (wasNavigating) this.deps.events.fire('interactionend');
    this._scheduleRender();
  }

  _canvas!: HTMLCanvasElement;

  _painter!: EditPainter;

  _overlayPainter!: EditPainter;

  _editOverlay!: EditOverlayRenderer;

  _overlayPainted = false;

  _overlayPending = false;

  _scheduler!: RenderScheduler;

  _pendingRender = 0;

  _rafId = 0;

  _pendingAction: RenderAction = 'redraw';

  _pendingNavDelta: AffineDelta | null = null;

  _pendingRedrawIsSettle = false;

  _navSnapshotTransform: { mx: number; my: number; bx: number; by: number } | null = null;

  _wheelSettleTimer: number | NodeJS.Timeout | null = null;

  static readonly _WHEEL_SETTLE_MS = 250;

  _ensureNavSnapshot(): void {
    if (this._navSnapshotTransform) return;
    const t = this.deps.view._viewport.transform;
    this._navSnapshotTransform = { mx: t.mx, my: t.my, bx: t.bx, by: t.by };
    this.deps.events.fire('interactionstart');
  }

  _computeNavDelta(): AffineDelta {
    const snap = this._navSnapshotTransform;
    if (!snap) return { tx: 0, ty: 0, sx: 1, sy: 1 };
    const cur = this.deps.view._viewport.transform;
    const sx = cur.mx / snap.mx;
    const sy = cur.my / snap.my;
    return {
      sx,
      sy,
      tx: cur.bx - sx * snap.bx,
      ty: cur.by - sy * snap.by,
    };
  }

  _endNavGesture(): void {
    const hasPendingNav = this._pendingAction === 'nav' && this._pendingRender > 0;
    this._navSnapshotTransform = null;
    if (this._wheelSettleTimer !== null) {
      clearTimeout(this._wheelSettleTimer);
      this._wheelSettleTimer = null;
    }
    this._scheduler.notifyInteractionEnd(hasPendingNav);
    this.deps.events.fire('interactionend');
  }

  _updateSize(): void {
    const width = this.deps.surface._container.clientWidth;
    const height = this.deps.surface._container.clientHeight;
    this.deps.view._viewport.updateSize(width, height);
    this._painter.resize(width, height);
    this._overlayPainter.resize(width, height);
  }

  _scheduleRender(
    action: RenderAction = 'redraw',
    navDelta?: AffineDelta,
    settleRedraw = false,
  ): void {
    if (this.deps.document._removed || this.deps.signal.aborted) return;
    const hadPendingRender = this._pendingRender > 0;
    this._pendingRender++;
    if (!hadPendingRender) {
      this._pendingAction = action;
      this._pendingNavDelta = navDelta ? { ...navDelta } : null;
      this._pendingRedrawIsSettle = action === 'redraw' && settleRedraw;
    } else if (
      this._pendingAction === 'redraw' &&
      action === 'nav' &&
      navDelta &&
      this._pendingRedrawIsSettle &&
      this._scheduler.fastActive
    ) {
      this._pendingAction = 'nav';
      this._pendingNavDelta = { ...navDelta };
      this._pendingRedrawIsSettle = false;
    } else if (this._pendingAction === 'redraw' || action === 'redraw') {
      this._pendingAction = 'redraw';
      this._pendingNavDelta = null;
      this._pendingRedrawIsSettle = action === 'redraw' && settleRedraw;
    } else {
      this._pendingAction = 'nav';
      if (navDelta) this._pendingNavDelta = { ...navDelta };
      this._pendingRedrawIsSettle = false;
    }
    if (this._rafId === 0) {
      this._rafId = requestAnimationFrame(() => this._doRender());
    }
  }

  _scheduleOverlayRender(): void {
    if (this.deps.document._removed || this.deps.signal.aborted) return;
    this._overlayPending = true;
    if (this._rafId === 0) {
      this._rafId = requestAnimationFrame(() => this._doRender());
    }
  }

  _doRender(): void {
    this._rafId = 0;
    if (this._pendingRender > 0) {
      this._pendingRender = 0;
      const req: RenderRequest = { action: this._pendingAction };
      if (this._pendingNavDelta) req.navDelta = this._pendingNavDelta;
      this._pendingAction = 'redraw';
      this._pendingNavDelta = null;
      this._pendingRedrawIsSettle = false;
      this.render(req);
    }
    if (this._overlayPending) this._renderEditOverlay();
  }

  public render(req?: RenderRequest): void {
    this._scheduler.schedule(req ?? { action: 'redraw' });
  }

  _renderFull(): void {
    this._clearFastTransform();
    const t0 = performance.now();
    this._renderImpl();
    // A full frame during a gesture replaces the bitmap that fast-nav transforms.
    if (this._navSnapshotTransform) {
      const { mx, my, bx, by } = this.deps.view._viewport.transform;
      this._navSnapshotTransform = { mx, my, bx, by };
    }
    this._scheduler.recordFrame(performance.now() - t0, this._captureRenderSnapshot());
  }

  private _prepareIcons(): void {
    const icons = this.deps.layers
      ._getEffectiveLayers()
      .flatMap((layer) =>
        layer.type === 'circle' &&
        layer.icon?.enabled !== false &&
        layer.icon &&
        layer.layout?.visibility !== 'none'
          ? [layer.icon]
          : [],
      );
    if (!icons.length) {
      this._icons?.dispose();
      this._icons = null;
      this._painter.clearIcons?.();
      return;
    }
    this._icons ??= new PointIconImages(
      () => this._scheduleRender(),
      () => this._painter.clearIcons?.(),
      (_url, error) => this.deps.events.fire('warning', { layerId: 'point-icons', error }),
    );
    this._icons.retain(icons);
  }
  _renderImpl(): void {
    this._prepareIcons();
    const transform = this.deps.view._viewport.transform;
    this._painter.setTransform(transform);

    this._painter.clear();

    const lineScale = this.deps.view._viewport.getLineScale();
    const pixelSize = 1 / Math.abs(transform.mx);
    this._renderPasses('before-layers');
    this._renderLayers(pixelSize, lineScale);
    this._renderPasses('after-layers');
    this._renderBoundLabels();
    this._renderHighlight(transform, lineScale);
    this._renderEditOverlay();
  }

  _renderEditOverlay(): void {
    this._overlayPending = false;
    const hasOverlay = !!(
      this.deps.editState._editState.vertex ||
      this.deps.editState._editState.draw ||
      this.deps.editState._editState.measurement
    );
    if (!hasOverlay && !this._overlayPainted) return;
    this._overlayPainter.setTransform(this.deps.view._viewport.transform);
    this._overlayPainter.clear();
    this._overlayPainted = hasOverlay;
    const vertexState = this.deps.editState._editState.vertex;
    const vertexArcFilter =
      this.deps.editState._editState.mode === 'vertex' && vertexState
        ? this.deps.view._viewport.getArcFilter(vertexState.arcs as unknown as ArcCollection)
        : undefined;
    this._editOverlay.render(
      this.deps.editState._editState.mode,
      vertexState,
      this.deps.editState._editState.draw,
      this.deps.editState._editState.measurement,
      vertexArcFilter,
    );
  }

  _captureRenderSnapshot(): RenderSnapshot {
    return {
      canvasWidth: this._canvas.width,
      canvasHeight: this._canvas.height,
      pixelRatio: window.devicePixelRatio || 1,
    };
  }

  _applyFastTransform(delta: AffineDelta): void {
    this._canvas.style.transformOrigin = 'top left';
    this._canvas.style.transform = `translate(${delta.tx}px,${delta.ty}px) scale(${delta.sx},${delta.sy})`;
    // Keep preview strokes, handles and labels at their actual screen size.
    this._renderEditOverlay();
  }

  _clearFastTransform(): void {
    if (!this._canvas.style.transform) return;
    this._canvas.style.transform = '';
    this._canvas.style.transformOrigin = '';
  }

  _renderLayers(
    pixelSize: number,
    lineScale: number,
    selectedLayers?: readonly ReturnType<LayerServiceImpl['_getEffectiveLayers']>[number][],
    retainLayerIds?: ReadonlySet<string>,
  ): void {
    if (
      selectedLayers === undefined &&
      [...this._passes.values()].some((stage) => typeof stage === 'object')
    ) {
      const all = this.deps.layers._getEffectiveLayers();
      const retain = new Set(all.map((layer) => layer.id));
      const viewport = this.deps.view._viewport;
      const frame: RenderFrame = {
        transform: viewport.transform.clone(),
        width: viewport.width,
        height: viewport.height,
        pixelRatio: window.devicePixelRatio || 1,
        painter: this._painter,
      };
      for (const block of sourceRenderBlocks(all, this._passes, this._sourceOrder)) {
        if ('layers' in block) this._renderLayers(pixelSize, lineScale, block.layers, retain);
        else {
          try {
            block.pass(frame);
          } catch (error) {
            this.deps.events.fire('error', { error });
          }
        }
      }
      return;
    }
    renderLayers(
      {
        layers: selectedLayers ?? this.deps.layers._getEffectiveLayers(),
        retainLayerIds,
        sources: this.deps.document._sources,
        viewport: this.deps.view._viewport,
        painter: this._painter,
        iconImages: this._icons,
        styleResolver: this.deps.layers._styleResolver,
        filterResolver: this.deps.layers._filterResolver,
        resolveSourceLayer: (sourceId, sourceLayerName) =>
          this.deps.document.layers.resolve(sourceId, sourceLayerName),
        getLayerArcIds: (sourceId, ml, arcs) => this.deps.cache._getLayerArcIds(sourceId, ml, arcs),
        getRenderCandidates: (sourceId, ml, bounds) =>
          this.deps.cache._featureQuery?.getRenderCandidates(sourceId, ml, bounds) ?? null,
      },
      pixelSize,
      lineScale,
    );
  }

  private _renderBoundLabels(): void {
    if (!this._painter.drawLabels) return;
    const bindings: LabelBinding[] = [];
    for (const spec of this.deps.layers._getEffectiveLayers()) {
      if (!spec.label || spec.label.enabled === false || spec.layout?.visibility === 'none')
        continue;
      const source = this.deps.document._sources.get(spec.source);
      const dataset = source?.getDataset();
      const layer = this.deps.document.layers.resolve(spec.source, spec['source-layer']);
      if (!dataset || !layer) continue;
      const mask = spec.filter
        ? this.deps.layers._filterResolver.mask({
            layerId: spec.id,
            filter: spec.filter,
            dataset,
            layer,
          })
        : null;
      bindings.push({
        id: spec.id,
        dataset,
        layer,
        options: spec.label,
        mask,
        pointRadius:
          spec.type === 'circle'
            ? Math.max(spec.paint?.['circle-radius'] ?? 4, this._icons?.get(spec.icon)?.radius ?? 0)
            : undefined,
      });
    }
    if (!bindings.length) {
      this._labels?.dispose();
      this._labels = null;
      return;
    }
    this._labels ??= new BoundLabelManager(
      () => this._scheduleRender(),
      (error) => this.deps.events.fire('error', { error }),
    );
    const view = this.deps.view._viewport;
    this._painter.drawLabels(
      this._labels.request(
        bindings,
        view.transform,
        view.width,
        view.height,
        window.devicePixelRatio || 1,
      ),
    );
  }

  _renderHighlight(transform: AffineTransform, lineScale: number): void {
    const visibleKeys = this.deps.layers._getVisibleLayerKeys();
    this.deps.document._highlightManager.renderHighlights(
      this._painter,
      this.deps.document._sources,
      transform,
      lineScale,
      visibleKeys,
      this.deps.layers._featureMaskForPick,
    );
  }

  public resize(): void {
    this._updateSize();
    this.deps.view._viewport.setExtent(this.deps.view._viewport.extent);
    this.deps.events.fire('resize');
  }

  _overlayCanvas!: HTMLCanvasElement;
  initialize(): void {
    const container = this.deps.surface._canvasContainer;
    this._canvas = document.createElement('canvas');
    this._canvas.style.position = 'absolute';
    this._canvas.style.top = '0';
    this._canvas.style.left = '0';
    container.appendChild(this._canvas);
    this._painter = this.deps.painterFactory.create(this._canvas);
    this._painter.setPixelRatio(window.devicePixelRatio || 1);
    this._overlayCanvas = document.createElement('canvas');
    this._overlayCanvas.style.position = 'absolute';
    this._overlayCanvas.style.top = '0';
    this._overlayCanvas.style.left = '0';
    this._overlayCanvas.style.pointerEvents = 'none';
    container.appendChild(this._overlayCanvas);
    this._overlayPainter = this.deps.painterFactory.create(this._overlayCanvas);
    this._overlayPainter.setPixelRatio(window.devicePixelRatio || 1);
    this._editOverlay = new EditOverlayRenderer(this._overlayPainter);
    this._scheduler = new RenderScheduler({
      fullRedraw: () => this._renderFull(),
      requestRedraw: () => this._scheduleRender('redraw', undefined, true),
      fastNav: (delta) => this._applyFastTransform(delta),
      getSnapshot: () => this._captureRenderSnapshot(),
    });
    this._updateSize();
  }
  clearLodCache(options: { sourceId?: string; layerId?: string } = {}): void {
    if (!this._painter) return;
    const cache = pointLodForPainter(this._painter);
    if (options.layerId !== undefined) cache.clear(options.layerId);
    else if (options.sourceId !== undefined) cache.clearSource(options.sourceId);
    else cache.clear();
  }
  dispose(): void {
    this._icons?.dispose();
    this._icons = null;
    this._painter?.clearIcons?.();
    this._labels?.dispose();
    this._labels = null;
    if (this._rafId !== 0) cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    this._pendingRender = 0;
    this._overlayPending = false;
    this._pendingAction = 'redraw';
    this._pendingNavDelta = null;
    this._navSnapshotTransform = null;
    if (this._wheelSettleTimer !== null) clearTimeout(this._wheelSettleTimer);
    this._wheelSettleTimer = null;
    this._passes.clear();
    this._scheduler?.dispose();
    this.clearLodCache();
    // Detaching a DOM node alone does not release backing pixels when a host
    // still retains a disposed map/provider handle for diagnostics.
    for (const canvas of [this._canvas, this._overlayCanvas]) {
      if (!canvas) continue;
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
    }
  }

  getPointLodPick(
    sourceId: string,
    ml: MapshaperLayer,
    bounds: readonly number[],
  ): PointLodPick | null {
    const source = this.deps.document._sources.get(sourceId);
    if (!source || !this._painter) return null;
    const dataset = source.getDataset?.();
    const selections: PointLodPick['selections'] = [];
    const fullDetailMasks: PointLodPick['fullDetailMasks'] = [];
    for (const spec of this.deps.layers._getEffectiveLayers()) {
      if (
        spec.type !== 'circle' ||
        spec.source !== sourceId ||
        spec.layout?.visibility === 'none' ||
        this.deps.document.layers.resolve(sourceId, spec['source-layer']) !== ml
      )
        continue;
      const mask =
        spec.filter && dataset
          ? this.deps.layers._filterResolver.mask({
              layerId: spec.id,
              filter: spec.filter,
              dataset,
              layer: ml,
            })
          : null;
      const cache = pointLodForPainter(this._painter);
      const painted = cache.queryPainted(spec, ml, dataset, mask, bounds);
      const viewBounds = this.deps.view._viewport.getViewBounds();
      const padding =
        (Number(spec.paint?.['circle-radius']) || 4) /
        Math.abs(this.deps.view._viewport.transform.mx);
      const renderBounds = viewBounds
        ? [
            viewBounds[0] - padding,
            viewBounds[1] - padding,
            viewBounds[2] + padding,
            viewBounds[3] + padding,
          ]
        : null;
      const lod =
        painted !== undefined
          ? painted
          : cache.query(spec, ml, dataset, mask, this.deps.view._viewport.transform, bounds, {
              width: this.deps.view._viewport.width ?? 1024,
              height: this.deps.view._viewport.height ?? 768,
              bounds: renderBounds ?? undefined,
              getCandidates: () =>
                renderBounds
                  ? this.deps.cache._featureQuery.getRenderCandidates(sourceId, ml, renderBounds)
                  : null,
            });
      if (lod) selections.push(lod);
      else fullDetailMasks.push(mask);
    }
    if (!selections.length) return null;
    const layerId = getLayerId(ml, source.getLayers().indexOf(ml));
    return {
      selections,
      fullDetailMasks,
      overlayIds: [
        ...(this.deps.document._selection?.getByLayer(sourceId, layerId) ?? []),
        ...(this.deps.document._highlightManager?.getByLayer(sourceId, layerId) ?? []),
      ],
    };
  }

  constructor(private readonly deps: Dependencies) {}
}
