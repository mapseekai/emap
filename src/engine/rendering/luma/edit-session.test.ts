import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../../integrations/mapshaper/adapter';
import { AffineTransform } from '../../../domain/geo/transform';
import { LumaEditSession } from './edit-session';

// Tiny contract fixtures, not performance data; browser acceptance uses the five local files.
function polygons() {
  const a = getDefaultMapshaperAdapter(),
    i = a.createPathImporter();
  i.startShape({ name: 'west' });
  i.importRing([
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ]);
  i.importRing(
    [
      [2, 2],
      [2, 4],
      [4, 4],
      [4, 2],
      [2, 2],
    ],
    true,
  );
  i.startShape({ name: 'east' });
  i.importRing([
    [10, 0],
    [20, 0],
    [20, 10],
    [10, 10],
    [10, 0],
  ]);
  const d = i.done();
  a.buildTopology(d);
  return d;
}
const transform = new AffineTransform(10, -10, 40, 160);
describe('luma original vertex editing', () => {
  it('selects original geometry, ignores polygon holes and exposes original coordinates', () => {
    const d = polygons(),
      s = new LumaEditSession(d),
      zoom = new AffineTransform(40, -40, 0, 500);
    s.setView(zoom, 1000, 600, 40);
    s.initialize();
    expect(s.pick(zoom.project(3, 3))).toBeNull();
    expect(s.pick(zoom.project(5, 5))?.id).toBe(0);
    expect(s.properties.name).toBe('west');
    expect(s.vertexHandles.some((h) => h.position[0] === 2 && h.position[1] === 2)).toBe(true);
    expect(d.editVersion).toBeUndefined();
    s.dispose();
  });
  it('keeps previews read-only and preserves closed rings/shared nodes through undo/redo', () => {
    const d = polygons(),
      raw = d.arcs!.getVertexData!(),
      x = raw.xx.slice(),
      y = raw.yy.slice();
    const s = new LumaEditSession(d);
    s.setView(transform, 400, 200);
    s.selectId(0, 0);
    const draft = s.begin(transform.project(10, 0))!;
    expect(draft.target.vertices.length).toBeGreaterThan(1);
    s.move(transform.project(11, -1));
    expect(raw.xx).toEqual(x);
    expect(raw.yy).toEqual(y);
    const patch = s.commit()!;
    expect(s.history.size()).toBe(1);
    expect(patch.revision).toBe(1);
    for (const id of draft.target.vertices) {
      expect(raw.xx[id]).toBe(11);
      expect(raw.yy[id]).toBe(-1);
    }
    expect(JSON.parse(s.exportSelected()).features[0].properties.name).toBe('west');
    const undo = s.undo()!;
    expect(undo.revision).toBe(2);
    expect(raw.xx).toEqual(x);
    expect(raw.yy).toEqual(y);
    s.redo();
    for (const id of draft.target.vertices) expect(raw.xx[id]).toBe(11);
    expect(s.selected?.id).toBe(0);
    s.dispose();
  });
  it('cancels a vertex preview without changing revision, coordinates or history', () => {
    const d = polygons(),
      s = new LumaEditSession(d),
      before = d.arcs!.getVertexData!().xx.slice();
    s.setView(transform, 400, 200);
    s.selectId(0, 0);
    s.begin(transform.project(0, 0));
    s.move(transform.project(-3, 2));
    s.cancel();
    expect(s.commit()).toBeNull();
    expect(d.arcs!.getVertexData!().xx).toEqual(before);
    expect(s.history.size()).toBe(0);
    expect(d.editVersion).toBeUndefined();
    s.dispose();
  });
  it('edits only the chosen MultiPoint component and restores exact floats', () => {
    const d = {
      info: { crs_string: 'urn:ogc:def:crs:EPSG::3857' },
      layers: [
        {
          geometry_type: 'point' as const,
          shapes: [
            [
              [123.123456789, 45.987654321],
              [130, 50],
            ] as [number, number][],
          ],
        },
      ],
    };
    const s = new LumaEditSession(d);
    const t = new AffineTransform(10, -10, -1200, 600);
    s.setView(t, 300, 300);
    s.selectId(0, 0);
    s.begin(t.project(130, 50));
    s.move(t.project(131, 51));
    const patch = s.commit()!;
    expect(patch.vertices).toHaveLength(0);
    expect(patch.points[0].component).toBe(1);
    expect(d.layers[0].shapes[0][0]).toEqual([123.123456789, 45.987654321]);
    expect(JSON.parse(s.exportSelected()).crs.properties.name).toBe('urn:ogc:def:crs:EPSG::3857');
    s.undo();
    expect(d.layers[0].shapes[0][1]).toEqual([130, 50]);
    s.redo();
    expect(d.layers[0].shapes[0][1]).toEqual([131, 51]);
    s.dispose();
  });
});
