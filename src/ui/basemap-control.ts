import { Control } from './control';
import { Emap } from '../map/map';

type MapLibreModule = typeof import('maplibre-gl');
type MapLibreMap = import('maplibre-gl').Map;
type MapLibreStyle = import('maplibre-gl').StyleSpecification | string;

export interface BasemapStyle {
  name: string;
  url: string;
  type?: 'vector' | 'raster';
}

export interface BasemapOptions {
  styles?: BasemapStyle[];
  defaultStyle?: string;
}

// Default styles using free tile services
const DEFAULT_STYLES: BasemapStyle[] = [
  {
    name: 'OSM',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    type: 'raster'
  },
  {
    name: 'CartoDB Light',
    url: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    type: 'raster'
  },
  {
    name: 'CartoDB Dark',
    url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    type: 'raster'
  }
];

/** MapLibre tile size - must match zoom calculation in map.ts */
const MAPLIBRE_TILE_SIZE = 512;

export class BasemapControl implements Control {
  private _map: Emap | null = null;
  private _container: HTMLElement | null = null;
  private _basemapContainer: HTMLElement | null = null;
  private _maplibre: MapLibreModule | null = null;
  private _maplibreMap: MapLibreMap | null = null;
  private _styles: BasemapStyle[];
  private _activeStyle: BasemapStyle | null = null;
  private _isOn: boolean = false;
  private _syncBasemapBound: () => void;

  constructor(options: BasemapOptions = {}) {
    this._styles = options.styles || DEFAULT_STYLES;
    this._syncBasemapBound = this._syncBasemap.bind(this);
  }

  onAdd(map: Emap): HTMLElement {
    this._map = map;

    // Create control container for buttons
    this._container = document.createElement('div');
    this._container.className = 'emap-ctrl emap-basemap-ctrl';

    // Create buttons for each style
    this._styles.forEach((style) => {
      const btn = document.createElement('button');
      btn.className = 'emap-basemap-btn';
      btn.textContent = style.name;
      btn.onclick = () => this._toggleStyle(style);
      this._container!.appendChild(btn);
    });

    // Create basemap container (behind canvas)
    this._createBasemapLayer();

    // Listen for map move events to sync basemap
    this._map.on('move', this._syncBasemapBound);

    return this._container;
  }

  private _createBasemapLayer(): void {
    if (!this._map) return;

    const canvasContainer = this._map.getCanvasContainer();

    // Create basemap container and insert before canvas
    this._basemapContainer = document.createElement('div');
    this._basemapContainer.className = 'emap-basemap';
    this._basemapContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
      display: none;
    `;

    // Insert basemap BEHIND the canvas (Z = 0, canvas has higher Z)
    canvasContainer.insertBefore(this._basemapContainer, canvasContainer.firstChild);
  }

  private _toggleStyle(style: BasemapStyle): void {
    if (this._activeStyle === style) {
      // Turn off basemap
      this._turnOff();
    } else {
      // Turn on or switch style
      this._showBasemap(style);
    }
    this._updateButtons();
  }

  private async _showBasemap(style: BasemapStyle): Promise<void> {
    this._activeStyle = style;
    this._isOn = true;

    if (!this._basemapContainer || !this._map) return;
    this._basemapContainer.style.display = 'block';

    // Ensure Map is in Web Mercator if it's not already
    const currentCrs = (this._map.getCRS() || '').toLowerCase();
    if (currentCrs !== 'webmercator' && currentCrs !== 'epsg:3857' && this._map.reproject) {
      // Use 'webmercator' as the target for mapshaper
      await this._map.reproject('webmercator');
      if (!this._basemapContainer || !this._map) return;
    }

    if (!this._maplibreMap) {
      await this._initMapLibre(style);
    } else {
      this._maplibreMap.resize(); // Ensure map handles container visibility change
      this._setStyle(style);
      this._syncBasemap();
    }
  }

  private async _initMapLibre(style: BasemapStyle): Promise<void> {
    if (!this._basemapContainer || !this._map) return;

    const maplibregl = await this._loadMapLibre();
    if (!this._basemapContainer || !this._map) return;
    const maplibreStyle = this._createMapLibreStyle(style);

    this._maplibreMap = new maplibregl.Map({
      container: this._basemapContainer,
      style: maplibreStyle,
      center: this._map.getCenter(),
      zoom: this._map.getZoom(),
      interactive: false,  // Disable all interaction - we sync from parent map
      attributionControl: false,
      maxPitch: 0,

      renderWorldCopies: true,
    });

    this._maplibreMap.on('load', () => {
      this._syncBasemap();
    });
  }

  private async _loadMapLibre(): Promise<MapLibreModule> {
    if (!this._maplibre) {
      this._maplibre = await import('maplibre-gl');
    }
    return this._maplibre;
  }

  private _setStyle(style: BasemapStyle): void {
    if (!this._maplibreMap) return;
    const maplibreStyle = this._createMapLibreStyle(style);
    this._maplibreMap.setStyle(maplibreStyle);
  }

  private _createMapLibreStyle(style: BasemapStyle): MapLibreStyle {
    if (style.type === 'raster' || style.url.includes('{z}')) {
      // Raster tile style
      return {
        version: 8,
        sources: {
          'basemap-tiles': {
            type: 'raster',
            tiles: [style.url],
            tileSize: MAPLIBRE_TILE_SIZE,
          }
        },
        layers: [{
          id: 'basemap-layer',
          type: 'raster',
          source: 'basemap-tiles',
          minzoom: 0,
          maxzoom: 22,
        }]
      };
    } else {
      // Assume vector style URL
      return style.url;
    }
  }


  private _syncBasemap(): void {
    if (!this._maplibreMap || !this._map || !this._isOn) return;
    try {
      this._maplibreMap.jumpTo({
        center: this._map.getCenter(),
        zoom: this._map.getZoom()
      });
    } catch (e) {
      console.warn('Sync basemap failed:', e);
    }
  }

  private _turnOff(): void {
    this._activeStyle = null;
    this._isOn = false;
    if (this._basemapContainer) {
      this._basemapContainer.style.display = 'none';
    }
  }

  private _updateButtons(): void {
    if (!this._container) return;

    const buttons = this._container.querySelectorAll('.emap-basemap-btn');
    buttons.forEach((btn, index) => {
      const isActive = this._styles[index] === this._activeStyle;
      btn.classList.toggle('active', isActive);
    });
  }

  isOn(): boolean {
    return this._isOn;
  }

  onRemove(): void {
    if (this._map) {
      this._map.off('move', this._syncBasemapBound);
    }
    if (this._maplibreMap) {
      this._maplibreMap.remove();
      this._maplibreMap = null;
    }
    if (this._basemapContainer?.parentNode) {
      this._basemapContainer.parentNode.removeChild(this._basemapContainer);
    }
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._map = null;
    this._basemapContainer = null;
    this._container = null;
    this._activeStyle = null;
    this._isOn = false;
  }
}
