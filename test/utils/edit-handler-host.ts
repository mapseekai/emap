import type { EditHandlerHost } from '../../src/engine/core/handlers/edit-handler-host';
import { EventDispatcher } from '../../src/engine/core/events';
import { EditSessions } from '../../src/engine/map/edit-sessions';
import { MapshaperOps } from '../../src/engine/map/mapshaper-ops';
import { makeStubCtx } from '../../src/engine/map/ops/_test-helpers';
import { TopologySource } from '../../src/domain/source/topology-source';
import {
  asMutableTopologySource,
  type MutableTopologySource,
} from '../../src/domain/source/source';
import type {
  ArcCollection,
  ArcVertexData,
  MapshaperDataset,
} from '../../src/shared/types/mapshaper-types';

type VertexDataFixture = Omit<ArcVertexData, 'zz' | 'bb'> & {
  zz?: Float64Array | null;
  bb?: Float64Array | null;
};
type ArcFixture = Partial<Omit<ArcCollection, 'getVertexData' | 'getVertex2'>> & {
  getVertexData?(): VertexDataFixture;
  getVertex2?(id: number): number[] | null;
};
type DatasetFixture = Partial<Omit<MapshaperDataset, 'arcs'>> & { arcs?: ArcFixture };
type SourceFixture = Partial<Omit<MutableTopologySource, 'getArcs' | 'getDataset'>> & {
  getArcs?(): ArcFixture | undefined;
  getDataset?(): DatasetFixture | undefined;
};
type HostFixture = Partial<
  Omit<EditHandlerHost, 'layers' | 'editSession' | 'getSource' | 'queryFeatures'>
> & {
  layers?: Partial<EditHandlerHost['layers']>;
  editSession?: Partial<EditHandlerHost['editSession']>;
  getSource?(id: string): SourceFixture | undefined;
  queryFeatures?: (...args: Parameters<EditHandlerHost['queryFeatures']>) => Array<
    Omit<ReturnType<EditHandlerHost['queryFeatures']>[number], 'properties'> & {
      properties?: Record<string, unknown>;
    }
  >;
};

/** Complete a focused unit fixture with real services and checked source/arc contracts. */
export function createEditHandlerFixture(input: HostFixture = {}): EditHandlerHost {
  const { host } = makeStubCtx().ctx;
  const events = new EventDispatcher();
  const arcs = new WeakMap<ArcFixture, ArcCollection>();
  const sources = new WeakMap<SourceFixture, MutableTopologySource>();
  const completeArcs = (value: ArcFixture): ArcCollection => {
    const cached = arcs.get(value);
    if (cached) return cached;
    const vertices = value.getVertexData?.bind(value);
    const vertex = value.getVertex2?.bind(value);
    const complete = Object.assign(value, {
      size: value.size ?? (() => vertices?.().nn.length ?? 0),
      getArcIter:
        value.getArcIter ??
        (() => {
          throw new Error('Arc iteration is not configured in this fixture');
        }),
      getVertexData: vertices
        ? () => {
            const data = vertices();
            return { ...data, zz: data.zz ?? null, bb: data.bb ?? undefined };
          }
        : undefined,
      getVertex2: vertex
        ? (id: number): [number, number] | null => {
            const point = vertex(id);
            if (!point) return null;
            if (point.length !== 2) throw new Error('Expected a two-coordinate fixture vertex');
            return [point[0], point[1]];
          }
        : undefined,
    });
    arcs.set(value, complete);
    return complete;
  };
  const completeSource = (value: SourceFixture): MutableTopologySource => {
    const cached = sources.get(value);
    if (cached) return cached;
    const source = asMutableTopologySource(new TopologySource(value.id ?? 'edit-fixture'));
    const overrides: Partial<MutableTopologySource> = {
      ...value,
      getArcs: () => {
        const data = value.getArcs?.();
        return data ? completeArcs(data) : undefined;
      },
      getDataset: () => {
        const data = value.getDataset?.();
        return data
          ? Object.assign(data, {
              layers: data.layers ?? [],
              arcs: data.arcs ? completeArcs(data.arcs) : undefined,
            })
          : undefined;
      },
    };
    Object.assign(source, overrides);
    sources.set(value, source);
    return source;
  };
  return {
    ...input,
    layers: Object.assign(host.layers, input.layers),
    editSession: Object.assign(new EditSessions(host), input.editSession),
    ops: input.ops ?? new MapshaperOps(host),
    on: input.on ?? events.on.bind(events),
    off: input.off ?? events.off.bind(events),
    fire: input.fire ?? events.fire.bind(events),
    getCanvasContainer: input.getCanvasContainer ?? (() => document.createElement('div')),
    getSource: (id) => {
      const source = input.getSource?.(id);
      return source ? completeSource(source) : undefined;
    },
    queryFeatures: (...args) =>
      (input.queryFeatures?.(...args) ?? []).map((feature) => ({
        ...feature,
        properties: feature.properties ?? {},
      })),
    project: input.project ?? ((x, y) => [x, y]),
    unproject: input.unproject ?? ((x, y) => [x, y]),
    canRedo: input.canRedo ?? (() => host._history.canRedo()),
    getCRS: input.getCRS ?? (() => 'EPSG:4326'),
    getSelection: input.getSelection ?? (() => host._selection.getAll()),
    select:
      input.select ?? ((refs, options) => host._selection.apply(refs, options?.mode ?? 'replace')),
    isSelected: input.isSelected ?? ((ref) => host._selection.has(ref)),
    pushCommand: input.pushCommand ?? ((command) => host._history.push(command)),
    render: input.render ?? (() => {}),
    clearEditDrawState: input.clearEditDrawState ?? (() => {}),
    clearEditMeasurementState: input.clearEditMeasurementState ?? (() => {}),
    clearEditVertexState: input.clearEditVertexState ?? (() => {}),
    setEditDrawState: input.setEditDrawState ?? (() => {}),
    setEditMeasurementState: input.setEditMeasurementState ?? (() => {}),
    setEditVertexState: input.setEditVertexState ?? (() => {}),
    setEditMode: input.setEditMode ?? (() => {}),
    _invalidateShapeCachesForSources: input._invalidateShapeCachesForSources ?? (() => {}),
  };
}
