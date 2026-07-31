// Reproduction for the REOPENED Friction #9: consumer reports that in 0.2.0
// `await source.setData(...)` then a synchronous read still renders blank,
// and claims an undocumented addSource/setData ordering dependency.
//
// This exercises BOTH orderings end-to-end against the real Emap.addSource
// and a real TopologySource (mapshaper stubbed). If emap 0.2.0 is correct,
// both orderings must (a) populate the dataset before `await` resolves and
// (b) trigger a render via the addSource-wired `data` listener — proving the
// blank-map symptom is environmental (stale install), not an emap defect.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mapshaper from 'mapshaper';
import { Emap } from './map';
import { Selection } from './selection';
import { EditHistory } from '../edit/edit-history';
import { TopologySource } from '../source/topology-source';

function setPrivate(target: object, key: string, value: unknown): void {
  Reflect.set(target, key, value);
}

/** Bare Emap with only the state addSource()'s data path touches. */
function createBareMap(): { map: Emap; scheduleRender: ReturnType<typeof vi.fn> } {
  const map = Object.create(Emap.prototype) as Emap;
  const scheduleRender = vi.fn();
  setPrivate(map, '_sources', new globalThis.Map());
  setPrivate(map, '_sourceListeners', new globalThis.Map());
  setPrivate(map, '_layers', []);
  setPrivate(map, '_effectiveLayersCache', []);
  setPrivate(map, '_defaultLayersDirty', false);
  setPrivate(map, '_layerArcIdsCache', new globalThis.Map());
  setPrivate(map, '_listeners', {});
  setPrivate(map, '_selection', new Selection());
  setPrivate(map, '_history', new EditHistory());
  setPrivate(map, '_scheduleRender', scheduleRender);
  // CRS adoption in addSource's normalizer reads _projection.crs back after
  // setCRS, so the stub must actually store the assigned CRS like Projection.
  const projection: { crs: string | null; setCRS: ReturnType<typeof vi.fn> } = {
    crs: null,
    setCRS: vi.fn((crs: string) => {
      projection.crs = crs;
    }),
  };
  setPrivate(map, '_projection', projection);
  setPrivate(map, '_viewport', { setCRS: vi.fn() });
  return { map, scheduleRender };
}

describe('Friction #9 reopened — setData/addSource ordering renders correctly', () => {
  const origParse = Reflect.get(mapshaper.internal as object, 'parseCommands');
  const origRun = Reflect.get(mapshaper.internal as object, 'runParsedCommands');

  beforeEach(() => {
    Reflect.set(
      mapshaper.internal as object,
      'parseCommands',
      vi.fn(() => [{ name: 'i', options: {} }]),
    );
    Reflect.set(
      mapshaper.internal as object,
      'runParsedCommands',
      vi.fn((_c: any[], _j: any, cb: any) => {
        cb(null, {
          catalog: {
            getDefaultTargets: () => [{ dataset: { layers: [{ name: 'L' }], info: {} } }],
          },
        });
      }),
    );
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'parseCommands', origParse);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', origRun);
  });

  const input = { filename: 'a.geojson', content: new Uint8Array([1]) };

  it('addSource BEFORE await setData: dataset populated + render scheduled', async () => {
    const { map, scheduleRender } = createBareMap();
    const src = new TopologySource('s');

    await map.addSource('s', src); // consumer order: addSource first

    await src.setData(input); // resolves only after _dataset set + data fired

    expect(src.getDataset()).toBeTruthy();
    expect(src.getLayers()).toHaveLength(1);
    // The listener addSource wired must have fired -> render scheduled.
    expect(scheduleRender).toHaveBeenCalled();
  });

  it('await setData BEFORE addSource: addSource back-fills + render scheduled', async () => {
    const { map, scheduleRender } = createBareMap();
    const src = new TopologySource('s');

    await src.setData(input); // data event fires here, no listener yet
    expect(src.getDataset()).toBeTruthy(); // promise did NOT resolve early

    await map.addSource('s', src); // must back-fill from already-loaded dataset

    expect(scheduleRender).toHaveBeenCalled();
  });
});
