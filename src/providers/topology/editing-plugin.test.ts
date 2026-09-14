import { describe, expect, it } from 'vitest';
import { Emap } from '../../map/map';
import { TopologySource } from '../../source/topology-source';

describe('live edit ownership', () => {
  it('cancels an uncommitted preview when its provider is unloaded', async () => {
    const map = new Emap({ preset: 'headless' });
    const source = await TopologySource.fromBytes(
      's',
      new TextEncoder().encode(
        JSON.stringify({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [1, 2] },
        }),
      ),
      { filename: 'point.geojson' },
    );
    await map.addSource('s', source);
    map.select([{ source: 's', layer: 'point', id: 0 }]);
    const session = map.editSession.beginTranslateSession();
    expect(session).not.toBeNull();
    session!.move(10, 20);
    expect(source.getLayers()[0].shapes![0]).toEqual([[11, 22]]);
    map.runtime.disable('feature.edit-sessions');
    expect(source.getLayers()[0].shapes![0]).toEqual([[1, 2]]);
    session!.move(50, 50);
    expect(source.getLayers()[0].shapes![0]).toEqual([[1, 2]]);
    expect(map.canUndo()).toBe(false);
    await map.dispose();
  });
});
