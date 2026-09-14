/** @module providers */
export { capabilitiesPlugin } from './capabilities/plugin';
export { formatsPlugin } from './formats/plugin';
export { cachePlugin } from '../../engine/providers/workspace/cache-plugin';
export { canvasPainterPlugin } from '../../engine/providers/workspace/canvas-plugin';
export { controlContextPlugin } from '../../engine/providers/workspace/control-context-plugin';
export { controlsPlugin } from '../../engine/providers/workspace/controls-plugin';
export { documentPlugin } from '../../engine/providers/workspace/document-plugin';
export { editStatePlugin } from '../../engine/providers/workspace/edit-state-plugin';
export { executionPlugin } from '../../engine/providers/workspace/execution-plugin';
export { historyPlugin } from '../../engine/providers/workspace/history-plugin';
export { interactionPlugin } from '../../engine/providers/workspace/interaction-plugin';
export { layersPlugin } from '../../engine/providers/workspace/layers-plugin';
export { mutationPlugin } from '../../engine/providers/workspace/mutation-plugin';
export { policyPlugin } from '../../engine/providers/workspace/policy-plugin';
export { projectionPlugin } from '../../engine/providers/workspace/projection-plugin';
export { queryPlugin } from '../../engine/providers/workspace/query-plugin';
export { renderPlugin } from '../../engine/providers/workspace/render-plugin';
export { routingPlugin } from '../../engine/providers/workspace/routing-plugin';
export { scalePlugin } from '../../engine/providers/workspace/scale-plugin';
export { selectionPlugin } from '../../engine/providers/workspace/selection-plugin';
export { shortcutsPlugin } from '../../engine/providers/workspace/shortcuts-plugin';
export { snapshotPlugin } from '../../engine/providers/workspace/snapshot-plugin';
export { sourcePlugin } from '../../engine/providers/workspace/source-plugin';
export { surfacePlugin } from '../../engine/providers/workspace/surface-plugin';
export { validationPlugin } from '../../engine/providers/workspace/validation-plugin';
export { viewPlugin } from '../../engine/providers/workspace/view-plugin';
export {
  eventsPlugin,
  renderSignalsPlugin,
  topologySourceFactoryPlugin,
} from '../../engine/providers/workspace/base-plugins';
export { operationHostPlugin } from '../../engine/providers/workspace/operation-host';
export { mapshaperProcessingPlugin } from '../../integrations/mapshaper/plugin';
export {
  editSessionsPlugin,
  attributesPlugin,
} from '../../engine/providers/topology/editing-plugin';
