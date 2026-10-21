import { TopologySource } from '../../src/domain/source/topology-source';
import { asMutableTopologySource } from '../../src/domain/source/source';
import { EventDispatcher } from '../../src/engine/core/events';
import { DrawFeatureHandler } from '../../src/engine/core/handlers/draw-feature';
import { MapshaperOps } from '../../src/engine/map/mapshaper-ops';
import { createEditHandlerFixture } from './edit-handler-host';
import { makeStubCtx } from './map-ops';
import { setPrivate } from './private-access';

export async function createPolygonDrawing() {
  const { host } = makeStubCtx().ctx;
  const source = asMutableTopologySource(
    await TopologySource.create('s1', {
      name: 'draft',
      geometryType: 'polygon',
      crs: 'EPSG:4326',
      fields: [{ name: 'label', type: 'string', defaultValue: 'drawn' }],
    }),
  );
  host._sources.set('s1', source);
  const errors: unknown[] = [];
  const events = new EventDispatcher();
  events.on('error', (event) => errors.push(event));
  const ops = new MapshaperOps(host);
  const handler = new DrawFeatureHandler(
    createEditHandlerFixture({
      getSource: () => source,
      ops,
      pushCommand: (command) => host._history.push(command),
      fire: events.fire.bind(events),
      // Keep the close threshold in pixels separate from the small XY fixture.
      project: (x, y) => [x * 100, y * 100],
      unproject: (x, y) => [x / 100, y / 100],
    }),
    { source: 's1', type: 'polygon', snapToVertex: false, snapToEdge: false },
  );
  setPrivate(handler, '_enabled', true);
  const pointer = (kind: 'click' | 'dblclick', [x, y]: [number, number]) =>
    handler.handlePointer({
      kind,
      point: { x: x * 100, y: y * 100 },
      button: 0,
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      originalEvent: new Event(kind),
    });
  const draw = (points: [number, number][], completion: 'click' | 'dblclick' = 'dblclick') => {
    for (const point of points) pointer('click', point);
    pointer(completion, completion === 'click' ? points[0]! : points.at(-1)!);
  };
  return { source, host, ops, draw, errors };
}
