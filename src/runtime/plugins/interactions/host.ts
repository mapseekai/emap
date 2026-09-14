import { pluginSignal } from '../../context/cancellation';
import type { EventDispatcher, EventListener } from '../../../engine/core/events';
import type { EditHandlerHost } from '../../../engine/core/handlers/edit-handler-host';
import type { SelectionHandlerHost } from '../../../engine/core/handlers/selection-handler-host';
import type { Context } from 'cordis';
export const selectionHandlerServices = [
  'surface',
  'view',
  'document',
  'query',
  'selection',
  'editState',
] as const;
export const editHandlerServices = [
  ...selectionHandlerServices,
  'mapEvents',
  'history',
  'editSession',
  'ops',
  'signals',
  'cache',
] as const;
export function createSelectionHandlerHost(ctx: Context): SelectionHandlerHost {
  const surface = ctx.surface;
  const view = ctx.view;
  const document = ctx.document;
  const query = ctx.query;
  const selection = ctx.selection;
  const editState = ctx.editState;
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
export function createEditHandlerHost(ctx: Context): EditHandlerHost {
  const signal = pluginSignal(ctx);
  const events = ctx.mapEvents;
  const history = ctx.history;
  const editState = ctx.editState;
  const view = ctx.view;
  const selection = ctx.selection;
  const signals = ctx.signals;
  const cache = ctx.cache;
  // Every subscription acquired by this handler is released on plugin deactivation,
  // even when the handler's own disable method omits an unbind path.
  const on: EventDispatcher['on'] = function <T>(type: string, listener: EventListener<T>) {
    signal.throwIfAborted();
    events.on(type, listener);
    ctx.effect(() => () => {
      events.off(type, listener);
    });
    return events;
  };
  return {
    ...createSelectionHandlerHost(ctx),
    editSession: ctx.editSession,
    ops: ctx.ops,
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
