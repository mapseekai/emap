import type * as maplibregl from 'maplibre-gl';
import type {
  MapLibreBasemapService,
  MapLibreIntegrationOptions,
  MapLibreOverlayResourceService,
  MapLibreOverlayService,
  MapLibreOverlayStyleService,
  MapLibreServiceManager,
  MapOptions,
} from '../../../src/index';
import type { Emap } from '../../../src/engine/map/map';

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
const resourceOverlay = {
  id: 'resource-overlay',
  name: 'Resource overlay',
  role: 'overlay',
  sources: { source },
  layers: [layer],
} satisfies MapLibreOverlayService;
const styleOverlay = {
  id: 'style-overlay',
  name: 'Style overlay',
  role: 'overlay',
  style,
} satisfies MapLibreOverlayStyleService;
const styleUrlOverlay = {
  id: 'style-url-overlay',
  name: 'Style URL overlay',
  role: 'overlay',
  style: 'https://tiles.openfreemap.org/styles/bright',
} satisfies MapLibreOverlayService;
const resourceOverlayDeclaration = resourceOverlay satisfies MapLibreOverlayResourceService;
// @ts-expect-error Overlay definitions cannot mix a complete style with sources/layers.
const mixedOverlay: MapLibreOverlayService = {
  ...resourceOverlay,
  style,
};
// @ts-expect-error An overlay must provide either style or sources/layers.
const emptyOverlay: MapLibreOverlayService = {
  id: 'empty',
  name: 'Empty',
  role: 'overlay',
};
const overlay = resourceOverlay;
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
  const reason: 'add' | 'update' | 'remove' | 'basemap' | 'visibility' | 'status' = event.reason;
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
void styleOverlay;
void styleUrlOverlay;
void resourceOverlayDeclaration;
void mixedOverlay;
void emptyOverlay;
