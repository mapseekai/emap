import { viewerControlPlugins, editorControlPlugins } from '../plugins/controls/builtins';
import {
  mapshaperCapabilityPlugins,
  attributeCapabilityPlugins,
  editCapabilityPlugins,
  workspaceCapabilityPlugins,
} from '../plugins/capabilities/operations';
import { capabilitiesPlugin } from '../providers/capabilities/plugin';
import { formatsPlugin } from '../providers/formats/plugin';
import type { Plugin } from '../kernel/plugin';
import { attributesPlugin, editSessionsPlugin } from '../providers/topology/editing-plugin';
import { autoCompletePolygonPlugin } from '../plugins/interactions/auto-complete-polygon-plugin';
import { boxSelectPlugin } from '../plugins/interactions/box-select-plugin';
import { clickSelectPlugin } from '../plugins/interactions/click-select-plugin';
import { dragPanPlugin } from '../plugins/interactions/drag-pan-plugin';
import { drawFeaturePlugin } from '../plugins/interactions/draw-feature-plugin';
import { lassoSelectPlugin } from '../plugins/interactions/lasso-select-plugin';
import { measurePlugin } from '../plugins/interactions/measure-plugin';
import { partEditPlugin } from '../plugins/interactions/part-edit-plugin';
import { reshapeFeaturePlugin } from '../plugins/interactions/reshape-feature-plugin';
import { ringEditPlugin } from '../plugins/interactions/ring-edit-plugin';
import { scrollZoomPlugin } from '../plugins/interactions/scroll-zoom-plugin';
import { splitFeaturePlugin } from '../plugins/interactions/split-feature-plugin';
import { transformFeaturePlugin } from '../plugins/interactions/transform-feature-plugin';
import { vertexEditPlugin } from '../plugins/interactions/vertex-edit-plugin';
import { mapshaperProcessingPlugin } from '../providers/mapshaper/plugin';
import {
  eventsPlugin,
  renderSignalsPlugin,
  topologySourceFactoryPlugin,
} from '../providers/workspace/base-plugins';
import { cachePlugin } from '../providers/workspace/cache-plugin';
import { canvasPainterPlugin } from '../providers/workspace/canvas-plugin';
import { controlContextPlugin } from '../providers/workspace/control-context-plugin';
import { controlsPlugin } from '../providers/workspace/controls-plugin';
import { documentPlugin } from '../providers/workspace/document-plugin';
import { editStatePlugin } from '../providers/workspace/edit-state-plugin';
import { executionPlugin } from '../providers/workspace/execution-plugin';
import { historyPlugin } from '../providers/workspace/history-plugin';
import { interactionPlugin } from '../providers/workspace/interaction-plugin';
import { layersPlugin } from '../providers/workspace/layers-plugin';
import { mutationPlugin } from '../providers/workspace/mutation-plugin';
import { operationHostPlugin } from '../providers/workspace/operation-host';
import { policyPlugin } from '../providers/workspace/policy-plugin';
import { projectionPlugin } from '../providers/workspace/projection-plugin';
import { queryPlugin } from '../providers/workspace/query-plugin';
import { renderPlugin } from '../providers/workspace/render-plugin';
import { routingPlugin } from '../providers/workspace/routing-plugin';
import { scalePlugin } from '../providers/workspace/scale-plugin';
import { selectionPlugin } from '../providers/workspace/selection-plugin';
import { shortcutsPlugin } from '../providers/workspace/shortcuts-plugin';
import { snapshotPlugin } from '../providers/workspace/snapshot-plugin';
import { sourcePlugin } from '../providers/workspace/source-plugin';
import { surfacePlugin } from '../providers/workspace/surface-plugin';
import { validationPlugin } from '../providers/workspace/validation-plugin';
import { viewPlugin } from '../providers/workspace/view-plugin';
import type { EmapOptions } from '../services/options';

/** A complete processing workspace with no DOM, pointer listeners or renderer. */
export const headlessPreset: readonly Plugin[] = [
  ...workspaceCapabilityPlugins,
  ...mapshaperCapabilityPlugins,
  ...attributeCapabilityPlugins,
  ...editCapabilityPlugins,
  capabilitiesPlugin,
  formatsPlugin,
  eventsPlugin,
  renderSignalsPlugin,
  topologySourceFactoryPlugin,
  operationHostPlugin,
  mapshaperProcessingPlugin,
  editSessionsPlugin,
  attributesPlugin,
  documentPlugin,
  viewPlugin,
  cachePlugin,
  layersPlugin,
  selectionPlugin,
  historyPlugin,
  sourcePlugin,
  editStatePlugin,
  policyPlugin,
  executionPlugin,
  queryPlugin,
  validationPlugin,
  snapshotPlugin,
  projectionPlugin,
  mutationPlugin,
  scalePlugin,
];
/** The default viewer omits modal editing handlers but retains data processing. */
export const viewerPreset: readonly Plugin[] = [
  ...viewerControlPlugins,
  ...headlessPreset,
  canvasPainterPlugin,
  controlContextPlugin,
  surfacePlugin,
  renderPlugin,
  interactionPlugin,
  routingPlugin,
  controlsPlugin,
  shortcutsPlugin,
  dragPanPlugin,
  scrollZoomPlugin,
  clickSelectPlugin,
  boxSelectPlugin,
  lassoSelectPlugin,
];
/** All capabilities shipped before the migration; controls remain opt-in. */
export const editorPreset: readonly Plugin[] = [
  ...editorControlPlugins,
  ...viewerPreset,
  vertexEditPlugin,
  drawFeaturePlugin,
  splitFeaturePlugin,
  reshapeFeaturePlugin,
  autoCompletePolygonPlugin,
  ringEditPlugin,
  partEditPlugin,
  measurePlugin,
  transformFeaturePlugin,
];

export function resolvePlugins(options: EmapOptions): readonly Plugin[] {
  const preset = options.preset ?? 'editor';
  const selected =
    preset === 'editor'
      ? editorPreset
      : preset === 'viewer'
        ? viewerPreset
        : preset === 'headless'
          ? headlessPreset
          : preset === 'empty'
            ? []
            : null;
  if (!selected) throw new Error(`Unknown preset: ${String(preset)}`);
  const excluded = new Set(options.excludePlugins ?? []);
  const replacements = new Set((options.plugins ?? []).map((plugin) => plugin.id));
  return [
    ...selected.filter((plugin) => !excluded.has(plugin.id) && !replacements.has(plugin.id)),
    ...(options.plugins ?? []),
  ];
}
