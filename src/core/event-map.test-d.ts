// Type-level assertions for EmapEventMap. Checked by `tsc --noEmit`
// (tsconfig excludes only *.test.ts / *.test.tsx — this file IS checked).
// Vitest globs *.test.ts so this file is never executed.
import type { Emap } from '../map/map';
import type { LayerSpecification } from '../map/layer';
import type { LayerChangeEvent, LayerChangeReason } from '../index';

declare const map: Emap;

// --- payload inference on known events ---
map.on('moveend', (e) => {
  const c: [number, number] = e.center;
  const z: number = e.zoom;
  const t: 'moveend' = e.type;
  const oe: MouseEvent | null = e.originalEvent;
  void c;
  void z;
  void t;
  void oe;
});

map.on('error', (e) => {
  const err: Error = e.error;
  void err;
});

map.on('selectionchange', (e) => {
  const n: number = e.selected.length + e.added.length + e.removed.length;
  void n;
});

map.on('layerchange', (event) => {
  const reason: 'add' | 'remove' | 'visibility' | 'effective' = event.reason;
  const layerId: string | undefined = event.layerId;
  const layers: readonly LayerSpecification[] = event.layers;
  // @ts-expect-error a layer change never has an arbitrary reason
  const invalidReason: 'invalid' = event.reason;
  void reason;
  void layerId;
  void layers;
  void invalidReason;
});

declare const exportedLayerChangeReason: LayerChangeReason;
declare const exportedLayerChangeEvent: LayerChangeEvent;
void exportedLayerChangeReason;
void exportedLayerChangeEvent;

// `move` is Partial<CameraEvent> — center is optional
map.on('move', (e) => {
  const c: [number, number] | undefined = e.center;
  void c;
});

// off / once infer identically
map.off('zoomend', (e) => {
  const z: number = e.zoom;
  void z;
});
map.once('editmodechange', (e) => {
  const m: 'none' | 'vertex' | 'draw' | 'transform' = e.mode;
  void m;
});

// --- bad property on a known event must error ---
map.on('moveend', (e) => {
  // @ts-expect-error 'nope' is not on the moveend payload
  void e.nope;
});

// --- escape hatch: arbitrary custom names still compile ---
map.on('totallyCustomAppEvent', (e) => {
  void e;
});
map.off('anotherCustomEvent', (e) => {
  void e;
});

// --- module augmentation adds a key that then infers ---
declare module './event-map' {
  interface EmapEventMap {
    myAugmentedEvent: { detail: string };
  }
}
map.on('myAugmentedEvent', (e) => {
  const d: string = e.detail;
  void d;
});

// --- bespoke overloads still work (regression guard) ---
map.on('mousemove', (e) => {
  const p: { x: number; y: number } = e.point;
  const mc: [number, number] = e.mapCoord;
  void p;
  void mc;
});
map.on('feature:click', { layers: ['district-fill'] }, (e) => {
  const refId: number = e.ref.id;
  const point: { x: number; y: number } = e.point;
  void refId;
  void point;
});

// The event-map type is useful to facade authors too.
type PointerMovePayload = import('./event-map').EmapEventMap['mousemove'];
type FeatureClickPayload = import('./event-map').EmapEventMap['feature:click'];
declare const pointerMovePayload: PointerMovePayload;
declare const featureClickPayload: FeatureClickPayload;
void pointerMovePayload.mapCoord;
void featureClickPayload.ref.layer;

// --- keyed overloads return `this` (chainable, documented guarantee) ---
const chained: Emap = map
  .on('moveend', () => {})
  .off('moveend', () => {})
  .once('zoom', () => {});
void chained;
