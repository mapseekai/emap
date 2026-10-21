import type { Emap, EmapOptions } from '../../../src';

declare const map: Emap;
const options: EmapOptions = { container: 'map', geometryLod: { pixelTolerance: 2 } };
void options;
map.setGeometryLod({ pixelTolerance: 1 });
map.setGeometryLod({});
map.setGeometryLod(false);
map.setGeometryLod();
map.setScreenPathFiltering(true);
map.setScreenPathFiltering(false);
map.setScreenPathFiltering();
// @ts-expect-error screen filtering takes a boolean
map.setScreenPathFiltering('false');
// @ts-expect-error enabling uses a validated options object
map.setGeometryLod(true);
// @ts-expect-error pixel tolerance is numeric
map.setGeometryLod({ pixelTolerance: '2' });
