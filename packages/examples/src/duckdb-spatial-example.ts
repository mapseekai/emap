import {
  areaDatasetWithDuckDb,
  boundaryDatasetWithDuckDb,
  centroidDatasetWithDuckDb,
  centroidXDatasetWithDuckDb,
  centroidYDatasetWithDuckDb,
  closeDuckDbRuntime,
  containsProperlyDatasetWithDuckDb,
  convexHullDatasetWithDuckDb,
  createDuckDbRuntimeFromJsDelivr,
  geometryTypeDatasetWithDuckDb,
  isEmptyDatasetWithDuckDb,
  isSimpleDatasetWithDuckDb,
  isValidDatasetWithDuckDb,
  lengthDatasetWithDuckDb,
  makeValidDatasetWithDuckDb,
  perimeterDatasetWithDuckDb,
  runRelationOperation as runDuckDbRelationOperation,
  setDuckDbRuntime,
  simplifyDatasetWithDuckDb,
  simplifyPreserveTopologyDatasetWithDuckDb,
  xDatasetWithDuckDb,
  yDatasetWithDuckDb,
} from '@mapseekai/emap/duckdb';
import { autoLoadExampleFixtures, installExampleMapUi, loadExampleRuntime } from './example-runtime';

export type DuckDbSpatialOperation =
  | 'centroid' | 'envelope' | 'convexHull' | 'boundary' | 'simplify'
  | 'simplifyPreserveTopology' | 'makeValid' | 'area' | 'length' | 'perimeter'
  | 'geometryType' | 'isValid' | 'isEmpty' | 'isSimple' | 'x' | 'y' | 'centroidX'
  | 'centroidY' | 'intersects' | 'contains' | 'within' | 'touches' | 'disjoint'
  | 'overlaps' | 'equals' | 'crosses' | 'covers' | 'coveredBy' | 'containsProperly'
  | 'distance' | 'distanceWithin';

type DuckDbSpatialExampleKind = 'geometry' | 'attribute' | 'relation';

type DuckDbSpatialControls = {
  readonly tolerance: boolean;
  readonly relationMode: boolean;
  readonly distance: boolean;
};

export interface DuckDbSpatialOperationDefinition {
  readonly operation: DuckDbSpatialOperation;
  readonly kind: DuckDbSpatialExampleKind;
  readonly label: string;
  readonly controls: DuckDbSpatialControls;
}

export interface DuckDbSpatialExampleConfig {
  readonly id: string;
  readonly operation: DuckDbSpatialOperation;
}

const INPUT_SOURCE_ID = 'duckdb-spatial-input';
const OUTPUT_SOURCE_ID = 'duckdb-spatial-output';
const MASK_SOURCE_ID = 'duckdb-spatial-mask';

const noControls: DuckDbSpatialControls = { tolerance: false, relationMode: false, distance: false };
const toleranceControls: DuckDbSpatialControls = { tolerance: true, relationMode: false, distance: false };
const relationControls: DuckDbSpatialControls = { tolerance: false, relationMode: true, distance: false };
const distanceControls: DuckDbSpatialControls = { tolerance: false, relationMode: false, distance: true };
const distanceWithinControls: DuckDbSpatialControls = { tolerance: false, relationMode: true, distance: true };

function definition(operation: DuckDbSpatialOperation, kind: DuckDbSpatialExampleKind, label: string, controls = noControls): DuckDbSpatialOperationDefinition {
  return { operation, kind, label, controls };
}

export const duckDbSpatialOperationDefinitions: readonly DuckDbSpatialOperationDefinition[] = [
  definition('centroid', 'geometry', 'Centroid'), definition('envelope', 'geometry', 'Envelope'),
  definition('convexHull', 'geometry', 'Convex Hull'), definition('boundary', 'geometry', 'Boundary'),
  definition('simplify', 'geometry', 'Simplify', toleranceControls), definition('simplifyPreserveTopology', 'geometry', 'Simplify Preserve Topology', toleranceControls),
  definition('makeValid', 'geometry', 'Make Valid'), definition('area', 'attribute', 'Area Attribute'),
  definition('length', 'attribute', 'Length Attribute'), definition('perimeter', 'attribute', 'Perimeter Attribute'),
  definition('geometryType', 'attribute', 'Geometry Type Attribute'), definition('isValid', 'attribute', 'Is Valid Attribute'),
  definition('isEmpty', 'attribute', 'Is Empty Attribute'), definition('isSimple', 'attribute', 'Is Simple Attribute'),
  definition('x', 'attribute', 'X Attribute'), definition('y', 'attribute', 'Y Attribute'),
  definition('centroidX', 'attribute', 'Centroid X Attribute'), definition('centroidY', 'attribute', 'Centroid Y Attribute'),
  definition('intersects', 'relation', 'Intersects', relationControls), definition('contains', 'relation', 'Contains', relationControls),
  definition('within', 'relation', 'Within', relationControls), definition('touches', 'relation', 'Touches', relationControls),
  definition('disjoint', 'relation', 'Disjoint', relationControls), definition('overlaps', 'relation', 'Overlaps', relationControls),
  definition('equals', 'relation', 'Equals', relationControls), definition('crosses', 'relation', 'Crosses', relationControls),
  definition('covers', 'relation', 'Covers', relationControls), definition('coveredBy', 'relation', 'Covered By', relationControls),
  definition('containsProperly', 'relation', 'Contains Properly', relationControls), definition('distance', 'attribute', 'Distance', distanceControls),
  definition('distanceWithin', 'relation', 'Distance Within', distanceWithinControls),
];

export function getDuckDbSpatialOperationDefinition(operation: DuckDbSpatialOperation): DuckDbSpatialOperationDefinition {
  const result = duckDbSpatialOperationDefinitions.find((definition) => definition.operation === operation);
  if (!result) throw new Error(`Unknown DuckDB spatial operation: ${operation}`);
  return result;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`DuckDB spatial example is missing required control: #${id}`);
  return element as T;
}

export async function mountDuckDbSpatialExample(config: DuckDbSpatialExampleConfig): Promise<void> {
  const operation = getDuckDbSpatialOperationDefinition(config.operation);
  const fileInput = requireElement<HTMLInputElement>('file');
  const targetSelect = requireElement<HTMLSelectElement>('target');
  const crsInput = requireElement<HTMLInputElement>('crs');
  const allowGeographicInput = requireElement<HTMLInputElement>('allow-geographic');
  const runButton = requireElement<HTMLButtonElement>('run');
  const status = requireElement<HTMLElement>('status');
  const pickedAttributes = requireElement<HTMLElement>('picked-attributes');
  const toleranceInput = requireElement<HTMLInputElement>('tolerance');
  const toleranceLabel = requireElement<HTMLElement>('tolerance-label');
  const distanceInput = requireElement<HTMLInputElement>('distance');
  const distanceLabel = requireElement<HTMLElement>('distance-label');
  const relationMode = requireElement<HTMLSelectElement>('relation-mode');
  const relationModeLabel = requireElement<HTMLElement>('relation-mode-label');
  const maskLayerSelect = requireElement<HTMLSelectElement>('mask-layer');
  const maskLayerLabel = requireElement<HTMLElement>('mask-layer-label');
  const emap = await loadExampleRuntime();
  const { Emap, TopologySource, NavigationControl } = emap;
  const map = new Emap({ container: 'map' });
  map.addControl(new NavigationControl(), 'top-left');
  installExampleMapUi(map, emap);
  const mapContainer = map.getCanvasContainer();
  let uploadedInput: { filename: string; content: Uint8Array } | null = null;
  let runtimePromise: ReturnType<typeof createDuckDbRuntimeFromJsDelivr> | null = null;
  let layerPickerEntries: Array<{ value: string; sourceId: string; layerIndex: number; layerIds: string[] }> = [];

  function removeSourceWithLayers(id: string) {
    for (const layer of map.getLayers().filter((layer) => layer.source === id)) map.removeLayer(layer.id);
    if (map.getSource(id)) map.removeSource(id);
  }

  function getLayerId(layer: { name?: string; id?: string } | undefined, index: number) {
    return String(layer?.name || layer?.id || `layer-${index}`);
  }

  function displayLayerIds(prefix: string, layer: { geometry_type?: string } | undefined, index: number) {
    const baseId = `${prefix}-${index}`;
    if (layer?.geometry_type === 'polygon') return [`${baseId}-fill`, `${baseId}-line`];
    if (layer?.geometry_type === 'polyline') return [`${baseId}-line`];
    if (layer?.geometry_type === 'point') return [`${baseId}-point`];
    return [];
  }

  function addDisplayLayers(sourceId: string, source: InstanceType<typeof TopologySource>, prefix: string, colors: Record<string, number | string>) {
    source.getLayers().forEach((layer: { geometry_type?: string }, index: number) => {
      const sourceLayer = getLayerId(layer, index);
      const baseId = `${prefix}-${index}`;
      if (layer.geometry_type === 'polygon') {
        map.addLayer({ id: `${baseId}-fill`, source: sourceId, 'source-layer': sourceLayer, type: 'fill', paint: { 'fill-color': colors.fill, 'fill-opacity': colors.fillOpacity } });
        map.addLayer({ id: `${baseId}-line`, source: sourceId, 'source-layer': sourceLayer, type: 'line', paint: { 'line-color': colors.line, 'line-width': colors.lineWidth } });
      } else if (layer.geometry_type === 'polyline') map.addLayer({ id: `${baseId}-line`, source: sourceId, 'source-layer': sourceLayer, type: 'line', paint: { 'line-color': colors.line, 'line-width': colors.lineWidth } });
      else if (layer.geometry_type === 'point') map.addLayer({ id: `${baseId}-point`, source: sourceId, 'source-layer': sourceLayer, type: 'circle', paint: { 'circle-radius': colors.pointRadius, 'circle-color': colors.line, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } });
    });
  }

  function setCurrentLayerVisibility(value: string) {
    layerPickerEntries.forEach((entry) => entry.layerIds.forEach((layerId) => {
      if (map.getLayer(layerId)) map.setLayerVisibility(layerId, entry.value === value ? 'visible' : 'none');
    }));
    pickedAttributes.textContent = '(点击地图上的要素)';
    map.clearHighlightedFeatures();
  }

  function appendLayerPickerOptions(source: InstanceType<typeof TopologySource>, sourceId: string, prefix: string, labelPrefix = '') {
    source.getLayers().forEach((layer: { name?: string; id?: string; geometry_type?: string }, layerIndex: number) => {
      const value = `${sourceId}:${layerIndex}`;
      const option = new Option(`${labelPrefix}${getLayerId(layer, layerIndex)}`, value);
      targetSelect.add(option);
      layerPickerEntries.push({ value, sourceId, layerIndex, layerIds: displayLayerIds(prefix, layer, layerIndex) });
    });
  }

  function populateMaskLayerPicker() {
    maskLayerSelect.replaceChildren(...layerPickerEntries.map((entry) => new Option(entry.value, entry.value)));
    maskLayerSelect.disabled = layerPickerEntries.length === 0;
  }

  function updateControls() {
    toleranceLabel.style.display = operation.controls.tolerance ? 'inline-flex' : 'none';
    toleranceInput.disabled = !operation.controls.tolerance;
    allowGeographicInput.disabled = !operation.controls.tolerance;
    relationModeLabel.style.display = operation.controls.relationMode ? 'inline-flex' : 'none';
    maskLayerLabel.style.display = operation.kind === 'relation' || operation.operation === 'distance' ? 'inline-flex' : 'none';
    distanceLabel.style.display = operation.controls.distance ? 'inline-flex' : 'none';
    relationMode.disabled = !operation.controls.relationMode;
    maskLayerSelect.disabled = !(operation.kind === 'relation' || operation.operation === 'distance') || layerPickerEntries.length === 0;
    distanceInput.disabled = !operation.controls.distance;
  }

  function registerInputSource(source: InstanceType<typeof TopologySource>) {
    targetSelect.replaceChildren();
    layerPickerEntries = [];
    addDisplayLayers(INPUT_SOURCE_ID, source, 'duckdb-spatial-input', { fill: '#dbeafe', fillOpacity: 0.45, line: '#1d4ed8', lineWidth: 1.5, pointRadius: 4 });
    appendLayerPickerOptions(source, INPUT_SOURCE_ID, 'duckdb-spatial-input');
    if (layerPickerEntries[0]) {
      targetSelect.value = layerPickerEntries[0].value;
      setCurrentLayerVisibility(targetSelect.value);
    }
    populateMaskLayerPicker();
    updateControls();
    map.setExtent(source.getExtent());
  }

  async function loadInput(upload: { filename: string; content: Uint8Array }) {
    const source = new TopologySource(INPUT_SOURCE_ID);
    await source.setData(upload);
    const dataset = source.getDataset();
    if (!dataset) throw new Error('文件未生成可用 dataset');
    dataset.info = { ...dataset.info, crs_string: crsInput.value.trim() || undefined };
    removeSourceWithLayers(OUTPUT_SOURCE_ID);
    removeSourceWithLayers(INPUT_SOURCE_ID);
    await map.addSource(INPUT_SOURCE_ID, source);
    registerInputSource(source);
  }

  async function reapplyInputCrs() {
    if (!uploadedInput) return;
    fileInput.disabled = true;
    crsInput.disabled = true;
    runButton.disabled = true;
    targetSelect.disabled = true;
    try {
      await loadInput(uploadedInput);
      status.textContent = `已按 ${crsInput.value.trim() || '默认'} CRS 重新注册数据。`;
    } catch (error) {
      console.error(error);
      removeSourceWithLayers(INPUT_SOURCE_ID);
      status.textContent = `CRS 应用失败: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      fileInput.disabled = false;
      crsInput.disabled = false;
      runButton.disabled = !map.getSource(INPUT_SOURCE_ID)?.getDataset() || targetSelect.options.length === 0;
      targetSelect.disabled = runButton.disabled;
    }
  }

  async function ensureRuntime() {
    runtimePromise ??= createDuckDbRuntimeFromJsDelivr().then((runtime) => {
      setDuckDbRuntime(runtime);
      return runtime;
    });
    return runtimePromise;
  }

  async function runGeometryOrAttribute(dataset: object, options: object, runtime: Awaited<ReturnType<typeof ensureRuntime>>) {
    switch (operation.operation) {
      case 'centroid': return centroidDatasetWithDuckDb(dataset, options, runtime);
      case 'envelope': return envelopeDatasetWithDuckDb(dataset, options, runtime);
      case 'convexHull': return convexHullDatasetWithDuckDb(dataset, options, runtime);
      case 'boundary': return boundaryDatasetWithDuckDb(dataset, options, runtime);
      case 'simplify': return simplifyDatasetWithDuckDb(dataset, options, runtime);
      case 'simplifyPreserveTopology': return simplifyPreserveTopologyDatasetWithDuckDb(dataset, options, runtime);
      case 'makeValid': return makeValidDatasetWithDuckDb(dataset, options, runtime);
      case 'area': return areaDatasetWithDuckDb(dataset, options, runtime);
      case 'length': return lengthDatasetWithDuckDb(dataset, options, runtime);
      case 'perimeter': return perimeterDatasetWithDuckDb(dataset, options, runtime);
      case 'geometryType': return geometryTypeDatasetWithDuckDb(dataset, options, runtime);
      case 'isValid': return isValidDatasetWithDuckDb(dataset, options, runtime);
      case 'isEmpty': return isEmptyDatasetWithDuckDb(dataset, options, runtime);
      case 'isSimple': return isSimpleDatasetWithDuckDb(dataset, options, runtime);
      case 'x': return xDatasetWithDuckDb(dataset, options, runtime);
      case 'y': return yDatasetWithDuckDb(dataset, options, runtime);
      case 'centroidX': return centroidXDatasetWithDuckDb(dataset, options, runtime);
      case 'centroidY': return centroidYDatasetWithDuckDb(dataset, options, runtime);
      default: throw new Error(`Unknown unary DuckDB spatial operation: ${operation.operation}`);
    }
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.disabled = true;
    runButton.disabled = true;
    targetSelect.disabled = true;
    try {
      uploadedInput = { filename: file.name, content: new Uint8Array(await file.arrayBuffer()) };
      await loadInput(uploadedInput);
      status.textContent = `已加载 ${file.name}。`;
    } catch (error) {
      console.error(error);
      removeSourceWithLayers(INPUT_SOURCE_ID);
      status.textContent = `加载失败: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      fileInput.disabled = false;
      runButton.disabled = !map.getSource(INPUT_SOURCE_ID)?.getDataset() || targetSelect.options.length === 0;
      targetSelect.disabled = runButton.disabled;
    }
  });

  runButton.addEventListener('click', async () => {
    const inputSource = map.getSource(INPUT_SOURCE_ID);
    const selected = layerPickerEntries.find((entry) => entry.value === targetSelect.value);
    const selectedSource = selected ? map.getSource(selected.sourceId) : null;
    if (!inputSource?.getDataset() || !selectedSource?.getDataset() || !selected) { status.textContent = '请先上传数据文件。'; return; }
    runButton.disabled = true;
    try {
      const runtime = await ensureRuntime();
      const dataset = selectedSource.getDataset();
      const options = {
        layer: selected.layerIndex,
        outputLayer: `${getLayerId(dataset.layers[selected.layerIndex], selected.layerIndex)}_${operation.operation}`,
        ...(operation.controls.tolerance
          ? { tolerance: Number(toleranceInput.value), failOnGeographicCrs: !allowGeographicInput.checked }
          : {}),
      };
      let result;
      if (operation.kind === 'relation' || operation.operation === 'distance') {
        const mask = layerPickerEntries.find((entry) => entry.value === maskLayerSelect.value) ?? selected;
        if (
          operation.operation === 'distance' &&
          mask.sourceId === selected.sourceId &&
          mask.layerIndex === selected.layerIndex
        ) {
          throw new Error('Distance requires a different Mask layer.');
        }
        const maskSource = map.getSource(mask.sourceId);
        const maskInput = maskSource?.getDataset();
        if (!maskInput) throw new Error('请选择 Mask 图层。');
        const maskDataset = {
          ...maskInput,
          layers: [maskInput.layers[mask.layerIndex]],
        };
        result = await runDuckDbRelationOperation(dataset, maskDataset, {
          ...options,
          maskLayer: 0,
          operation: operation.operation,
          mode: operation.operation === 'distance' ? 'attribute' : relationMode.value,
          runtime,
          ...(operation.controls.distance ? { distance: Number(distanceInput.value) } : {}),
        });
      } else result = await runGeometryOrAttribute(dataset, options, runtime);
      if (map.getSource(INPUT_SOURCE_ID) !== inputSource) { status.textContent = '输入 CRS 已变更，结果已丢弃，请重新运行。'; return; }
      const outputSource = new TopologySource(OUTPUT_SOURCE_ID);
      outputSource.setDataset(result);
      removeSourceWithLayers(OUTPUT_SOURCE_ID);
      await map.addSource(OUTPUT_SOURCE_ID, outputSource);
      if (map.getSource(INPUT_SOURCE_ID) !== inputSource) {
        if (map.getSource(OUTPUT_SOURCE_ID) === outputSource) removeSourceWithLayers(OUTPUT_SOURCE_ID);
        status.textContent = '输入 CRS 已变更，结果已丢弃，请重新运行。';
        return;
      }
      addDisplayLayers(OUTPUT_SOURCE_ID, outputSource, 'duckdb-spatial-output', { fill: '#fef3c7', fillOpacity: 0.5, line: '#b45309', lineWidth: 2.5, pointRadius: 5 });
      layerPickerEntries = layerPickerEntries.filter((entry) => entry.sourceId !== OUTPUT_SOURCE_ID);
      targetSelect.querySelectorAll(`option[value^="${OUTPUT_SOURCE_ID}:"]`).forEach((option) => option.remove());
      appendLayerPickerOptions(outputSource, OUTPUT_SOURCE_ID, 'duckdb-spatial-output', '输出 / ');
      populateMaskLayerPicker();
      const output = layerPickerEntries.find((entry) => entry.sourceId === OUTPUT_SOURCE_ID);
      if (output) { targetSelect.value = output.value; setCurrentLayerVisibility(output.value); }
      map.setExtent(outputSource.getExtent());
      status.textContent = `${operation.label} 完成。`;
    } catch (error) {
      console.error(error);
      status.textContent = `DuckDB 空间处理失败: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      runButton.disabled = !map.getSource(INPUT_SOURCE_ID)?.getDataset() || targetSelect.options.length === 0;
    }
  });

  targetSelect.addEventListener('change', () => setCurrentLayerVisibility(targetSelect.value));
  crsInput.addEventListener('change', reapplyInputCrs);
  mapContainer.addEventListener('click', (event) => {
    const rect = mapContainer.getBoundingClientRect();
    const features = map.queryFeatures([event.clientX - rect.left, event.clientY - rect.top]);
    if (!features.length) { pickedAttributes.textContent = '(未命中要素)'; map.clearHighlightedFeatures(); return; }
    map.clearHighlightedFeatures();
    map.setHighlightedFeatures(features, { color: '#dc2626', width: 3, radius: 7, fill: true });
    pickedAttributes.textContent = `命中 ${features.length} 个要素\n\n${JSON.stringify(features[0].properties, null, 2)}`;
  });
  window.addEventListener('pagehide', () => { void (runtimePromise?.then((runtime) => closeDuckDbRuntime(runtime)) ?? closeDuckDbRuntime()); }, { once: true });
  updateControls();
  await autoLoadExampleFixtures(config.id);
}
