/** @module presets */
import { viewerControlPlugins, editorControlPlugins } from '../plugins/controls/builtins';
import {
  mapshaperCapabilityPlugins,
  attributeCapabilityPlugins,
  editCapabilityPlugins,
  workspaceCapabilityPlugins,
} from '../plugins/capabilities/operations';
import { capabilitiesPlugin } from '../providers/capabilities/plugin';
import { formatsPlugin } from '../providers/formats/plugin';
import type { Plugin } from 'cordis';
import {
  attributesPlugin,
  editSessionsPlugin,
} from '../../engine/providers/topology/editing-plugin';
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
import { mapshaperProcessingPlugin } from '../../integrations/mapshaper/plugin';
import {
  eventsPlugin,
  renderSignalsPlugin,
  topologySourceFactoryPlugin,
} from '../../engine/providers/workspace/base-plugins';
import { cachePlugin } from '../../engine/providers/workspace/cache-plugin';
import { rendererPainterPlugin } from '../../engine/providers/workspace/renderer-plugin';
import { controlContextPlugin } from '../../engine/providers/workspace/control-context-plugin';
import { controlsPlugin } from '../../engine/providers/workspace/controls-plugin';
import { documentPlugin } from '../../engine/providers/workspace/document-plugin';
import { editStatePlugin } from '../../engine/providers/workspace/edit-state-plugin';
import { executionPlugin } from '../../engine/providers/workspace/execution-plugin';
import { historyPlugin } from '../../engine/providers/workspace/history-plugin';
import { interactionPlugin } from '../../engine/providers/workspace/interaction-plugin';
import { layersPlugin } from '../../engine/providers/workspace/layers-plugin';
import { mutationPlugin } from '../../engine/providers/workspace/mutation-plugin';
import { operationHostPlugin } from '../../engine/providers/workspace/operation-host';
import { policyPlugin } from '../../engine/providers/workspace/policy-plugin';
import { projectionPlugin } from '../../engine/providers/workspace/projection-plugin';
import { queryPlugin } from '../../engine/providers/workspace/query-plugin';
import { renderPlugin } from '../../engine/providers/workspace/render-plugin';
import { routingPlugin } from '../../engine/providers/workspace/routing-plugin';
import { scalePlugin } from '../../engine/providers/workspace/scale-plugin';
import { selectionPlugin } from '../../engine/providers/workspace/selection-plugin';
import { shortcutsPlugin } from '../../engine/providers/workspace/shortcuts-plugin';
import { snapshotPlugin } from '../../engine/providers/workspace/snapshot-plugin';
import { sourcePlugin } from '../../engine/providers/workspace/source-plugin';
import { surfacePlugin } from '../../engine/providers/workspace/surface-plugin';
import { validationPlugin } from '../../engine/providers/workspace/validation-plugin';
import { viewPlugin } from '../../engine/providers/workspace/view-plugin';
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
  rendererPainterPlugin,
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
  const replacements = new Set((options.plugins ?? []).map((plugin) => plugin.name ?? ''));
  // Preserve callers explicitly replacing/excluding the former Canvas-only factory.
  if (excluded.has('provider.canvas2d') || replacements.has('provider.canvas2d'))
    excluded.add('provider.renderer');
  return [
    ...selected.filter(
      (plugin) => !excluded.has(plugin.name ?? '') && !replacements.has(plugin.name ?? ''),
    ),
    ...(options.plugins ?? []),
  ];
}
