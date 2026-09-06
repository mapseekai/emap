import {
  area,
  boundary,
  centroid,
  centroidX,
  centroidY,
  closeDuckDbRuntime,
  convexHull,
  createDuckDbRuntimeFromJsDelivr,
  envelope,
  geometryType,
  isEmpty,
  isSimple,
  isValid,
  length,
  repairGeometry,
  perimeter,
  spatialRelation,
  setDuckDbRuntime,
  simplify,
  simplifyPreserveTopology,
  x,
  y,
} from '@mapseekai/emap/duckdb';
import type { SourceLoadDraft } from '@mapseekai/emap';
import { autoLoadExampleFixtures, installExampleMapUi, loadExampleRuntime } from './example-runtime';

export type DuckDbSpatialOperation =
  | 'centroid' | 'envelope' | 'convexHull' | 'boundary' | 'simplify'
  | 'simplifyPreserveTopology' | 'repairGeometry' | 'area' | 'length' | 'perimeter'
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

type PendingCrsLoad = {
  readonly sourceId: typeof INPUT_SOURCE_ID | typeof MASK_SOURCE_ID;
  readonly sourceName: '输入数据' | 'Mask 数据';
  readonly draft: SourceLoadDraft;
};

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
  definition('repairGeometry', 'geometry', 'Repair Geometry'), definition('area', 'attribute', 'Area Attribute'),
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
  const maskFileInput = document.getElementById('mask-file') as HTMLInputElement | null;
  const crsRecovery = requireElement<HTMLElement>('crs-recovery');
  const crsRecoveryLabel = requireElement<HTMLLabelElement>('crs-recovery-label');
  const crsRecoveryInput = requireElement<HTMLInputElement>('crs-recovery-input');
  const crsRecoveryApply = requireElement<HTMLButtonElement>('crs-recovery-apply');
  const allowGeographicInput = operation.controls.tolerance
    ? requireElement<HTMLInputElement>('allow-geographic')
    : null;
  const runButton = requireElement<HTMLButtonElement>('run');
  const status = requireElement<HTMLElement>('status');
  const pickedAttributes = requireElement<HTMLElement>('picked-attributes');
  const toleranceInput = operation.controls.tolerance
    ? requireElement<HTMLInputElement>('tolerance')
    : null;
  const toleranceLabel = document.getElementById('tolerance-label');
  const distanceInput = operation.controls.distance
    ? requireElement<HTMLInputElement>('distance')
    : null;
  const distanceLabel = document.getElementById('distance-label');
  const relationMode = operation.controls.relationMode
    ? requireElement<HTMLSelectElement>('relation-mode')
    : null;
  const relationModeLabel = document.getElementById('relation-mode-label');
  const maskLayerSelect = operation.kind === 'relation' || operation.operation === 'distance'
    ? requireElement<HTMLSelectElement>('mask-layer')
    : null;
  const maskLayerLabel = document.getElementById('mask-layer-label');
  const emap = await loadExampleRuntime();
  const { Emap, TopologySource, NavigationControl } = emap;
  const map = new Emap({ container: 'map' });
  map.addControl(new NavigationControl(), 'top-left');
  installExampleMapUi(map, emap);
  const mapContainer = map.getCanvasContainer();
  let runtimePromise: ReturnType<typeof createDuckDbRuntimeFromJsDelivr> | null = null;
  let layerPickerEntries: Array<{ value: string; sourceId: string; layerIndex: number; layerIds: string[] }> = [];
  const pendingCrsLoads = new Map<
    typeof INPUT_SOURCE_ID | typeof MASK_SOURCE_ID,
    PendingCrsLoad
  >();
  let applyingCrsRecovery = false;

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
        if (!map.getLayer(`${baseId}-fill`)) map.addLayer({ id: `${baseId}-fill`, source: sourceId, 'source-layer': sourceLayer, type: 'fill', paint: { 'fill-color': colors.fill, 'fill-opacity': colors.fillOpacity } });
        if (!map.getLayer(`${baseId}-line`)) map.addLayer({ id: `${baseId}-line`, source: sourceId, 'source-layer': sourceLayer, type: 'line', paint: { 'line-color': colors.line, 'line-width': colors.lineWidth } });
      } else if (layer.geometry_type === 'polyline') {
        if (!map.getLayer(`${baseId}-line`)) map.addLayer({ id: `${baseId}-line`, source: sourceId, 'source-layer': sourceLayer, type: 'line', paint: { 'line-color': colors.line, 'line-width': colors.lineWidth } });
      } else if (layer.geometry_type === 'point' && !map.getLayer(`${baseId}-point`)) {
        map.addLayer({ id: `${baseId}-point`, source: sourceId, 'source-layer': sourceLayer, type: 'circle', paint: { 'circle-radius': colors.pointRadius, 'circle-color': colors.line, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } });
      }
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
    if (!maskLayerSelect) return;
    maskLayerSelect.replaceChildren(...layerPickerEntries.map((entry) => new Option(entry.value, entry.value)));
    maskLayerSelect.disabled = layerPickerEntries.length === 0;
  }

  function updateControls() {
    if (toleranceLabel) toleranceLabel.style.display = operation.controls.tolerance ? 'inline-flex' : 'none';
    if (toleranceInput) toleranceInput.disabled = !operation.controls.tolerance;
    if (allowGeographicInput) allowGeographicInput.disabled = !operation.controls.tolerance;
    if (relationModeLabel) relationModeLabel.style.display = operation.controls.relationMode ? 'inline-flex' : 'none';
    if (maskLayerLabel) maskLayerLabel.style.display = operation.kind === 'relation' || operation.operation === 'distance' ? 'inline-flex' : 'none';
    if (distanceLabel) distanceLabel.style.display = operation.controls.distance ? 'inline-flex' : 'none';
    if (relationMode) relationMode.disabled = !operation.controls.relationMode;
    if (maskLayerSelect) maskLayerSelect.disabled = layerPickerEntries.length === 0;
    if (distanceInput) distanceInput.disabled = !operation.controls.distance;
  }

  function syncControls() {
    const pending = pendingCrsLoads.size > 0;
    fileInput.disabled = pending;
    if (maskFileInput) maskFileInput.disabled = pending;
    const noInput = !map.getSource(INPUT_SOURCE_ID)?.getDataset() || targetSelect.options.length === 0;
    targetSelect.disabled = pending || noInput;
    runButton.disabled = pending || noInput;
    crsRecoveryInput.disabled = applyingCrsRecovery;
    crsRecoveryApply.disabled = !pending || applyingCrsRecovery;
  }

  function getPendingCrsLoad(): PendingCrsLoad | undefined {
    return pendingCrsLoads.values().next().value;
  }

  function showCrsRecovery(
    pendingLoad: PendingCrsLoad,
    statusMessage = `无法识别${pendingLoad.sourceName}的 CRS，请填写数据 CRS 后重试。`,
  ) {
    crsRecoveryLabel.textContent = `${pendingLoad.sourceName} CRS`;
    crsRecovery.hidden = false;
    status.textContent = statusMessage;
  }

  function registerSources() {
    targetSelect.replaceChildren();
    layerPickerEntries = [];
    const inputSource = map.getSource(INPUT_SOURCE_ID);
    const maskSource = map.getSource(MASK_SOURCE_ID);
    if (inputSource) {
      addDisplayLayers(INPUT_SOURCE_ID, inputSource, 'duckdb-spatial-input', { fill: '#dbeafe', fillOpacity: 0.45, line: '#1d4ed8', lineWidth: 1.5, pointRadius: 4 });
      appendLayerPickerOptions(inputSource, INPUT_SOURCE_ID, 'duckdb-spatial-input');
    }
    if (maskSource) {
      addDisplayLayers(MASK_SOURCE_ID, maskSource, 'duckdb-spatial-mask', { fill: '#dcfce7', fillOpacity: 0.45, line: '#15803d', lineWidth: 1.5, pointRadius: 4 });
      appendLayerPickerOptions(maskSource, MASK_SOURCE_ID, 'duckdb-spatial-mask', 'Mask / ');
    }
    const inputEntry = layerPickerEntries.find((entry) => entry.sourceId === INPUT_SOURCE_ID);
    if (inputEntry) {
      targetSelect.value = inputEntry.value;
      setCurrentLayerVisibility(targetSelect.value);
    }
    populateMaskLayerPicker();
    const maskEntry = layerPickerEntries.find((entry) => entry.sourceId === MASK_SOURCE_ID);
    if (maskLayerSelect && maskEntry) maskLayerSelect.value = maskEntry.value;
    updateControls();
    if (inputSource) map.setExtent(inputSource.getExtent());
  }

  async function loadSource(
    sourceId: typeof INPUT_SOURCE_ID | typeof MASK_SOURCE_ID,
    sourceName: PendingCrsLoad['sourceName'],
    upload: { filename: string; content: Uint8Array },
  ) {
    const source = new TopologySource(sourceId);
    await source.setData(upload);
    if (!source.getDataset()) throw new Error(sourceId === INPUT_SOURCE_ID ? '文件未生成可用 dataset' : '遮罩文件未生成可用 dataset');
    if (sourceId === INPUT_SOURCE_ID) removeSourceWithLayers(OUTPUT_SOURCE_ID);
    removeSourceWithLayers(sourceId);
    registerSources();
    const result = await map.preflightSource({ id: sourceId, source });
    if (result.status === 'ready') {
      await map.confirmSource(result.plan);
      registerSources();
      return;
    }
    if (result.status === 'needs-input' && result.requirements.some((requirement) => requirement.code === 'source-crs')) {
      const pendingLoad = { sourceId, sourceName, draft: result.draft };
      const activePendingLoad = getPendingCrsLoad();
      pendingCrsLoads.set(sourceId, pendingLoad);
      if (!activePendingLoad || activePendingLoad.sourceId === sourceId) {
        showCrsRecovery(pendingLoad);
      }
      syncControls();
      return;
    }
    throw new Error(result.diagnostics[0]?.message ?? '加载需要额外输入。');
  }

  async function loadInput(upload: { filename: string; content: Uint8Array }) {
    await loadSource(INPUT_SOURCE_ID, '输入数据', upload);
  }

  async function loadMask(upload: { filename: string; content: Uint8Array }) {
    await loadSource(MASK_SOURCE_ID, 'Mask 数据', upload);
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
      case 'centroid': return centroid(dataset, options, runtime);
      case 'envelope': return envelope(dataset, options, runtime);
      case 'convexHull': return convexHull(dataset, options, runtime);
      case 'boundary': return boundary(dataset, options, runtime);
      case 'simplify': return simplify(dataset, options, runtime);
      case 'simplifyPreserveTopology': return simplifyPreserveTopology(dataset, options, runtime);
      case 'repairGeometry': return repairGeometry(dataset, options, runtime);
      case 'area': return area(dataset, options, runtime);
      case 'length': return length(dataset, options, runtime);
      case 'perimeter': return perimeter(dataset, options, runtime);
      case 'geometryType': return geometryType(dataset, options, runtime);
      case 'isValid': return isValid(dataset, options, runtime);
      case 'isEmpty': return isEmpty(dataset, options, runtime);
      case 'isSimple': return isSimple(dataset, options, runtime);
      case 'x': return x(dataset, options, runtime);
      case 'y': return y(dataset, options, runtime);
      case 'centroidX': return centroidX(dataset, options, runtime);
      case 'centroidY': return centroidY(dataset, options, runtime);
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
      const upload = { filename: file.name, content: new Uint8Array(await file.arrayBuffer()) };
      await loadInput(upload);
      if (pendingCrsLoads.size === 0) status.textContent = `已加载 ${file.name}。`;
    } catch (error) {
      console.error(error);
      removeSourceWithLayers(INPUT_SOURCE_ID);
      status.textContent = `加载失败: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      syncControls();
    }
  });

  maskFileInput?.addEventListener('change', async () => {
    const file = maskFileInput.files?.[0];
    if (!file) return;
    maskFileInput.disabled = true;
    runButton.disabled = true;
    try {
      const upload = { filename: file.name, content: new Uint8Array(await file.arrayBuffer()) };
      await loadMask(upload);
      if (pendingCrsLoads.size === 0) status.textContent = `已加载遮罩 ${file.name}。`;
    } catch (error) {
      console.error(error);
      removeSourceWithLayers(MASK_SOURCE_ID);
      status.textContent = `遮罩加载失败: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      syncControls();
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
          ? { tolerance: Number(toleranceInput!.value), failOnGeographicCrs: !allowGeographicInput!.checked }
          : {}),
      };
      let result;
      if (operation.kind === 'relation' || operation.operation === 'distance') {
        const mask = layerPickerEntries.find((entry) => entry.value === maskLayerSelect!.value) ?? selected;
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
        result = await spatialRelation(dataset, maskDataset, {
          ...options,
          maskLayer: 0,
          predicate: operation.operation,
          mode: operation.operation === 'distance' ? 'attribute' : relationMode!.value as 'filter' | 'attribute',
          ...(operation.controls.distance ? { distance: Number(distanceInput!.value) } : {}),
        }, runtime);
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
      syncControls();
    }
  });

  targetSelect.addEventListener('change', () => setCurrentLayerVisibility(targetSelect.value));
  crsRecoveryApply.addEventListener('click', async () => {
    const pendingLoad = getPendingCrsLoad();
    if (!pendingLoad || applyingCrsRecovery) return;
    applyingCrsRecovery = true;
    syncControls();
    const sourceCrs = crsRecoveryInput.value.trim();
    try {
      const result = await map.preflightSource(pendingLoad.draft, { sourceCrs });
      if (result.status === 'ready') {
        await map.confirmSource(result.plan);
        pendingCrsLoads.delete(pendingLoad.sourceId);
        crsRecoveryInput.value = '';
        registerSources();
        const nextPendingLoad = getPendingCrsLoad();
        if (nextPendingLoad) {
          showCrsRecovery(nextPendingLoad);
        } else {
          crsRecovery.hidden = true;
        }
        status.textContent = `已按 ${sourceCrs} 加载${pendingLoad.sourceName}。`;
        return;
      }
      if (result.status === 'needs-input' && result.requirements.some((requirement) => requirement.code === 'source-crs')) return;
      throw new Error(result.diagnostics[0]?.message ?? '加载需要额外输入。');
    } catch (error) {
      console.error(error);
      pendingCrsLoads.delete(pendingLoad.sourceId);
      crsRecoveryInput.value = '';
      const nextPendingLoad = getPendingCrsLoad();
      if (nextPendingLoad) {
        showCrsRecovery(
          nextPendingLoad,
          `加载失败: ${error instanceof Error ? error.message : String(error)} 请填写${nextPendingLoad.sourceName}的 CRS 后重试。`,
        );
      } else {
        crsRecovery.hidden = true;
        status.textContent = `加载失败: ${error instanceof Error ? error.message : String(error)}`;
      }
    } finally {
      applyingCrsRecovery = false;
      syncControls();
    }
  });
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
