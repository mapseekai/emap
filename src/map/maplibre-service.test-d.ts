import type * as maplibregl from 'maplibre-gl';
import type {
  MapLibreBasemapService,
  MapLibreIntegrationOptions,
  MapLibreOverlayService,
  MapLibreServiceManager,
  MapOptions,
} from '../index';
import type { Emap } from './map';

declare const style: maplibregl.StyleSpecification;
declare const source: maplibregl.SourceSpecification;
declare const layer: maplibregl.LayerSpecification;
declare const map: Emap;

const basemap = {
  id: 'base',
  name: 'Base',
  role: 'basemap',
  style,
} satisfies MapLibreBasemapService;
const overlay = {
  id: 'overlay',
  name: 'Overlay',
  role: 'overlay',
  sources: { source },
  layers: [layer],
} satisfies MapLibreOverlayService;
const integration = {
  services: [basemap, overlay],
  mapOptions: { transformRequest: (url: string) => ({ url }) },
} satisfies MapLibreIntegrationOptions;
const options = { container: document.body, mapLibre: integration } satisfies MapOptions;
const legacyOptions = { container: document.body, interactive: false } satisfies MapOptions;
const manager: MapLibreServiceManager = map.mapLibreServices;
const raw: maplibregl.Map | null = manager.getMapLibreMap();

manager.on('change', (event) => {
  const id: string = event.serviceId;
  const reason: 'add' | 'update' | 'remove' | 'basemap' | 'visibility' | 'status' =
    event.reason;
  // @ts-expect-error MapLibre change events expose only documented reasons.
  const invalidReason: 'invalid' = event.reason;
  void id;
  void reason;
  void invalidReason;
});
manager.on('error', (event) => {
  const phase: 'style' | 'source' | 'layer' | 'tile' | 'lifecycle' = event.phase;
  const fatal: boolean = event.fatal;
  // @ts-expect-error MapLibre errors expose only documented lifecycle phases.
  const invalidPhase: 'invalid' = event.phase;
  void phase;
  void fatal;
  void invalidPhase;
});

const forbiddenContainer = {
  // @ts-expect-error Emap owns the native MapLibre container.
  container: document.body,
} satisfies NonNullable<MapLibreIntegrationOptions['mapOptions']>;
const forbiddenStyle = {
  // @ts-expect-error Basemap services own the native MapLibre style.
  style,
} satisfies NonNullable<MapLibreIntegrationOptions['mapOptions']>;
const forbiddenCenter = {
  // @ts-expect-error Emap synchronizes the native MapLibre center.
  center: [0, 0],
} satisfies NonNullable<MapLibreIntegrationOptions['mapOptions']>;
const forbiddenZoom = {
  // @ts-expect-error Emap synchronizes the native MapLibre zoom.
  zoom: 4,
} satisfies NonNullable<MapLibreIntegrationOptions['mapOptions']>;
const forbiddenInteractive = {
  // @ts-expect-error The manager keeps the native MapLibre map non-interactive.
  interactive: true,
} satisfies NonNullable<MapLibreIntegrationOptions['mapOptions']>;

void options;
void legacyOptions;
void raw;
void forbiddenContainer;
void forbiddenStyle;
void forbiddenCenter;
void forbiddenZoom;
void forbiddenInteractive;
