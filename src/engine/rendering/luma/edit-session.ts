import { EventDispatcher } from '../../core/events';
import { FeatureQuery } from '../../map/feature-query';
import { LayerRegistry } from '../../map/layer-registry';
import { Selection } from '../../map/selection';
import type { FeatureRef } from '../../map/types';
import { EditHistory } from '../../../domain/edit/edit-history';
import type { EditCommand } from '../../../domain/edit/edit-command';
import { VertexMoveCommand } from '../../../domain/edit/commands/vertex-move';
import { markSourceChanged, findArcIdForVertex } from '../../../domain/edit/commands/_shared';
import { TopologySource } from '../../../domain/source/topology-source';
import { asMutableTopologySource } from '../../../domain/source/source';
import { getLayerId, normalizePointShape } from '../../../domain/source/layer-utils';
import { getDefaultMapshaperAdapter } from '../../../integrations/mapshaper/adapter';
import { Bounds } from '../../../domain/geo/bounds';
import { AffineTransform } from '../../../domain/geo/transform';
import {
  absArcId,
  type MapshaperDataset,
  type MapshaperLayer,
  type PathShape,
} from '../../../shared/types/mapshaper-types';
import { readPart, type Point } from './geometry';
import type { CoordinatePatch } from './edit-patch';

/** Picking in this editor intentionally queries authoritative geometry, never display arcs. */
class OriginalGeometrySource extends TopologySource {
  override getDisplayArcs(): null {
    return null;
  }
}
export interface VertexHandle {
  position: [number, number];
  vertex?: number;
  component?: number;
}
interface EditTarget {
  vertices: number[];
  points: { layer: number; feature: number; component: number }[];
}
export interface VertexDraft {
  target: EditTarget;
  from: [number, number];
  to: [number, number];
}
/** Independent example session, reusing emap selection, query and reversible edit commands. */
export class LumaEditSession extends EventDispatcher {
  readonly source = new OriginalGeometrySource('editor');
  readonly selection = new Selection();
  readonly history = new EditHistory({ maxSize: 200 });
  readonly layers: LayerRegistry;
  readonly query: FeatureQuery;
  private transform = new AffineTransform();
  private size = { width: 1, height: 1 };
  private initialScale = 1;
  private handles: VertexHandle[] = [];
  private commands = new WeakMap<EditCommand, EditTarget>();
  private disposed = false;
  draft: VertexDraft | null = null;
  constructor(readonly dataset: MapshaperDataset) {
    super();
    this.source.setDataset(dataset, false);
    const sources = new Map([['editor', asMutableTopologySource(this.source)]]);
    this.layers = new LayerRegistry(sources);
    this.query = new FeatureQuery(
      sources,
      () => this.transform,
      () => this.size,
      () => this.initialScale,
    );
  }
  initialize(): void {
    this.query.prebuild();
  }
  setView(transform: AffineTransform, width: number, height: number, initialScale?: number): void {
    this.transform = transform;
    this.size = { width, height };
    if (initialScale !== undefined) this.initialScale = Math.abs(initialScale);
  }
  get selected(): FeatureRef | null {
    return this.selection.getAll()[0] ?? null;
  }
  get layer(): MapshaperLayer | null {
    const ref = this.selected;
    return ref ? this.layers.resolve(ref.source, ref.layer) : null;
  }
  get vertexHandles(): readonly VertexHandle[] {
    return this.handles;
  }
  get properties(): Record<string, unknown> {
    const ref = this.selected,
      table = this.layer?.data;
    return ref ? (table?.getRecordAt?.(ref.id) ?? table?.getRecords?.()[ref.id] ?? {}) : {};
  }
  pick(point: [number, number]): FeatureRef | null {
    if (this.disposed || this.draft) return this.selected;
    const hits = this.query.query(point);
    const ref = hits.at(-1);
    this.select(ref ?? null);
    return this.selected;
  }
  select(ref: FeatureRef | null): void {
    if (this.disposed) return;
    this.cancel();
    if (
      ref &&
      (ref.source !== 'editor' ||
        !Number.isSafeInteger(ref.id) ||
        ref.id < 0 ||
        !this.layers.resolve(ref.source, ref.layer)?.shapes?.[ref.id])
    )
      throw new Error('Feature does not exist');
    this.selection.apply(
      ref ? [{ source: ref.source, layer: ref.layer, id: ref.id }] : [],
      'replace',
    );
    this.refreshHandles();
    this.fire('selectionchange');
  }
  selectId(layer: number, id: number): void {
    const value = this.dataset.layers[layer];
    if (!value) throw new Error('Layer does not exist');
    this.select({ source: 'editor', layer: getLayerId(value, layer), id });
  }
  private refreshHandles(): void {
    this.handles = [];
    const ref = this.selected,
      layer = this.layer;
    const shape = ref && layer?.shapes?.[ref.id];
    if (!shape) return;
    if (layer!.geometry_type === 'point') {
      this.handles = normalizePointShape(shape).map((p, component) => ({
        position: [p[0], p[1]],
        component,
      }));
    } else {
      const data = this.dataset.arcs?.getVertexData?.();
      if (!data) return;
      const seen = new Set<number>();
      for (const part of shape as PathShape)
        for (const arc of part) {
          const id = absArcId(arc),
            start = data.ii[id],
            end = start + data.nn[id];
          for (let vertex = start; vertex < end; vertex++)
            if (!seen.has(vertex)) {
              seen.add(vertex);
              this.handles.push({ vertex, position: [data.xx[vertex], data.yy[vertex]] });
            }
        }
    }
  }
  selectionBounds(): Bounds {
    const bounds = new Bounds();
    for (const handle of this.handles) bounds.mergePoint(...handle.position);
    return bounds;
  }
  paths(): readonly (readonly Point[])[] {
    const ref = this.selected,
      layer = this.layer,
      arcs = this.dataset.arcs;
    const shape = ref && layer?.shapes?.[ref.id];
    return shape && arcs && layer!.geometry_type !== 'point'
      ? (shape as PathShape).map((part) => readPart(arcs, part))
      : [];
  }
  nearest(point: [number, number], radius = 9): VertexHandle | null {
    let best: VertexHandle | null = null,
      distance = radius * radius;
    for (const handle of this.handles) {
      const p = this.transform.project(...handle.position);
      const d = (p[0] - point[0]) ** 2 + (p[1] - point[1]) ** 2;
      if (d < distance) {
        distance = d;
        best = handle;
      }
    }
    return best;
  }
  begin(point: [number, number]): VertexDraft | null {
    if (this.disposed || this.draft || !this.selected) return null;
    const handle = this.nearest(point);
    if (!handle) return null;
    const target: EditTarget = { vertices: [], points: [] };
    if (handle.vertex !== undefined) {
      const arcs = this.dataset.arcs!;
      target.vertices = getDefaultMapshaperAdapter().findNearestVertices(
        handle.position,
        this.layer!.shapes![this.selected.id] as PathShape,
        arcs,
      );
      if (!target.vertices.length) throw new Error('No original topology node found');
    } else
      target.points.push({
        layer: this.dataset.layers.indexOf(this.layer!),
        feature: this.selected.id,
        component: handle.component!,
      });
    this.draft = { target, from: [...handle.position], to: [...handle.position] };
    return this.draft;
  }
  move(point: [number, number]): void {
    if (!this.draft) return;
    const to = this.transform.unproject(...point);
    if (to.every(Number.isFinite)) this.draft.to = to;
  }
  /** Only adjacent original segments need a live preview; no per-pointer polygon triangulation. */
  previewPaths(): Point[][] {
    if (!this.draft) return [];
    const { target, from, to } = this.draft,
      data = this.dataset.arcs?.getVertexData?.();
    if (target.points.length) return [[from, to]];
    if (!data) return [];
    const ids = new Set(target.vertices),
      segments = new Set<number>(),
      paths: Point[][] = [];
    const position = (id: number): Point => (ids.has(id) ? to : [data.xx[id], data.yy[id]]);
    for (const id of ids) {
      const arc = findArcIdForVertex(id, data),
        first = data.ii[arc],
        last = first + data.nn[arc] - 1;
      if (id > first) segments.add(id - 1);
      if (id < last) segments.add(id);
    }
    for (const id of segments) paths.push([position(id), position(id + 1)]);
    return paths;
  }
  cancel(): void {
    this.draft = null;
  }
  commit(): CoordinatePatch | null {
    const draft = this.draft;
    this.draft = null;
    if (!draft || this.disposed || draft.from.every((v, i) => v === draft.to[i])) return null;
    const { target, from, to } = draft;
    let command: EditCommand;
    if (target.vertices.length) {
      const native = new VertexMoveCommand({
        vertexIds: target.vertices,
        from,
        to,
        arcs: this.dataset.arcs!,
        source: this.source,
      });
      // One completed pointer drag is one undo entry (not time-window-merged).
      command = { label: native.label, do: () => native.do(), undo: () => native.undo() };
    } else {
      const p = target.points[0],
        coord = normalizePointShape(this.dataset.layers[p.layer].shapes![p.feature]!)[p.component];
      const set = (value: Point) => {
        coord[0] = value[0];
        coord[1] = value[1];
        markSourceChanged(this.source);
      };
      command = { label: 'Move point vertex', do: () => set(to), undo: () => set(from) };
    }
    command.do();
    this.commands.set(command, target);
    this.history.push(command);
    return this.changed(target);
  }
  undo(): CoordinatePatch | null {
    this.cancel();
    const cmd = this.history.undo();
    return cmd ? this.changed(this.commands.get(cmd)!) : null;
  }
  redo(): CoordinatePatch | null {
    this.cancel();
    const cmd = this.history.redo();
    return cmd ? this.changed(this.commands.get(cmd)!) : null;
  }
  private changed(target: EditTarget): CoordinatePatch {
    this.query.clear();
    this.refreshHandles();
    const data = this.dataset.arcs?.getVertexData?.();
    const patch: CoordinatePatch = {
      revision: this.dataset.editVersion ?? 0,
      vertices: target.vertices.map((id) => ({ id, x: data!.xx[id], y: data!.yy[id] })),
      points: target.points.map((p) => {
        const c = normalizePointShape(this.dataset.layers[p.layer].shapes![p.feature]!)[
          p.component
        ];
        return { ...p, x: c[0], y: c[1] };
      }),
    };
    this.fire('geometrychange', { patch });
    return patch;
  }
  exportSelected(): string {
    const ref = this.selected,
      layer = this.layer;
    if (!ref || !layer) throw new Error('Select one feature first');
    const adapter = getDefaultMapshaperAdapter();
    // Keep native source units. GeoJSON 2008 supports the input CRS member; RFC 7946 requires WGS84.
    const options = { format: 'geojson', gj2008: true };
    const info = {
      ...this.dataset.info,
      input_geojson_crs: this.dataset.info?.crs_string
        ? { type: 'name', properties: { name: this.dataset.info.crs_string } }
        : undefined,
    };
    const files = adapter.exportFileContent(
      {
        ...this.dataset,
        info,
        layers: [
          {
            ...layer,
            shapes: [layer.shapes![ref.id]],
            data: adapter.createDataTable([{ ...this.properties }]),
          },
        ],
      },
      options,
    );
    const content = files[0]?.content;
    if (content === undefined) throw new Error('No GeoJSON export generated');
    return typeof content === 'string' ? content : new TextDecoder().decode(content);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.selection.clear();
    this.history.clear();
    this.handles = [];
    this.query.clear();
    this.source.setDataset({ layers: [] }, false);
  }
}
