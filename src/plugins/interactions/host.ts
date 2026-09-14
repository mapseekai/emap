import type { EventDispatcher, EventListener } from '../../core/events';
import type { EditHandlerHost } from '../../core/handlers/edit-handler-host';
import type { SelectionHandlerHost } from '../../core/handlers/selection-handler-host';
import type { PluginContext } from '../../kernel/plugin';
import {
  CacheService,
  DocumentService,
  EditSessionService,
  EditStateService,
  EventService,
  HistoryService,
  MapshaperProcessingService,
  QueryService,
  RenderSignalService,
  SelectionService,
  SurfaceService,
  ViewService,
} from '../../services/keys';

export const selectionHandlerServices = [
  SurfaceService,
  ViewService,
  DocumentService,
  QueryService,
  SelectionService,
  EditStateService,
] as const;
export const editHandlerServices = [
  ...selectionHandlerServices,
  EventService,
  HistoryService,
  EditSessionService,
  MapshaperProcessingService,
  RenderSignalService,
  CacheService,
] as const;

export function createSelectionHandlerHost(ctx: PluginContext): SelectionHandlerHost {
  const surface = ctx.get(SurfaceService);
  const view = ctx.get(ViewService);
  const document = ctx.get(DocumentService);
  const query = ctx.get(QueryService);
  const selection = ctx.get(SelectionService);
  const editState = ctx.get(EditStateService);
  return {
    layers: document.layers,
    getCanvasContainer: () => surface.getCanvasContainer(),
    getSource: (id) => document._sources.get(id),
    getEditMode: () => editState.getEditMode(),
    project: (x, y) => view.project(x, y),
    queryFeatures: (geometry, options) => query.queryFeatures(geometry, options),
    select: (features, options) => selection.select(features, options),
    getSelection: () => selection.getSelection(),
  };
}

export function createEditHandlerHost(ctx: PluginContext): EditHandlerHost {
  const events = ctx.get(EventService);
  const history = ctx.get(HistoryService);
  const editState = ctx.get(EditStateService);
  const view = ctx.get(ViewService);
  const selection = ctx.get(SelectionService);
  const signals = ctx.get(RenderSignalService);
  const cache = ctx.get(CacheService);
  // Every subscription acquired by this handler is released on plugin deactivation,
  // even when the handler's own disable method omits an unbind path.
  const on: EventDispatcher['on'] = function <T>(type: string, listener: EventListener<T>) {
    ctx.scope.assertActive();
    events.on(type, listener);
    ctx.defer(() => {
      events.off(type, listener);
    });
    return events;
  };
  return {
    ...createSelectionHandlerHost(ctx),
    editSession: ctx.get(EditSessionService),
    ops: ctx.get(MapshaperProcessingService),
    on,
    off: events.off.bind(events),
    fire: events.fire.bind(events),
    canRedo: () => history.canRedo(),
    clearEditDrawState: () => editState.clearEditDrawState(),
    clearEditMeasurementState: () => editState.clearEditMeasurementState(),
    clearEditVertexState: () => editState.clearEditVertexState(),
    isSelected: (ref) => selection.isSelected(ref),
    getCRS: () => view.getCRS(),
    getSelection: () => selection.getSelection(),
    pushCommand: (command) => history.pushCommand(command),
    render: () => signals.requestRender(),
    setEditDrawState: (state) => editState.setEditDrawState(state),
    setEditMeasurementState: (state) => editState.setEditMeasurementState(state),
    setEditVertexState: (state) => editState.setEditVertexState(state),
    setEditMode: (mode) => editState.setEditMode(mode),
    unproject: (x, y) => view.unproject(x, y),
    _invalidateShapeCachesForSources: (ids) => cache._invalidateShapeCachesForSources(ids),
  };
}
