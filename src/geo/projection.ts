import { Bounds } from './bounds';
import { TopologySource } from '../source/source';
import { getDefaultMapshaperAdapter } from '../adapter/mapshaper-adapter';

/** WGS84 semi-major axis (Earth radius in meters) */
const WGS84_SEMI_MAJOR_AXIS = 6378137;

/** Earth circumference in Web Mercator projection */
const EARTH_CIRCUMFERENCE_WEB_MERCATOR = 40075016.6855;

/** Padding factor for initial extent after reprojection */
const INITIAL_EXTENT_PADDING = 1.07;

/**
 * Projection manages the coordinate reference system and provides
 * coordinate conversion between CRS-specific units and view-agnostic
 * representations.
 */
export class Projection {
  private _crs = 'EPSG:4326';

  get crs(): string {
    return this._crs;
  }

  setCRS(crs: string): void {
    this._crs = crs;
  }

  /**
   * Compute the map center in geographic coordinates.
   * For Web Mercator, converts projected coords to lat/lng.
   */
  getCenter(cx: number, cy: number): [number, number] {
    const crs = this._crs.toLowerCase();
    if (crs === 'epsg:3857' || crs === 'webmercator') {
      return this._webMercatorToLatLng(cx, cy);
    }
    return [cx, cy];
  }

  /**
   * Compute a zoom level from the scale factor.
   * Only meaningful for Web Mercator — returns `0` for other CRS
   * (not a sentinel; prefer the {@link getScale} round-trip to detect CRS).
   */
  getZoom(mx: number): number {
    const crs = this._crs.toLowerCase();
    if (crs === 'epsg:3857' || crs === 'webmercator') {
      return Math.log2((mx * EARTH_CIRCUMFERENCE_WEB_MERCATOR) / 512);
    }
    return 0;
  }

  /**
   * Inverse of `getZoom`: the scale factor (|mx|) for a given zoom.
   * Only meaningful for Web Mercator — returns `NaN` otherwise so callers
   * can detect "zoom not applicable for this CRS" and fall back to scale.
   */
  getScale(zoom: number): number {
    const crs = this._crs.toLowerCase();
    if (crs === 'epsg:3857' || crs === 'webmercator') {
      return (Math.pow(2, zoom) * 512) / EARTH_CIRCUMFERENCE_WEB_MERCATOR;
    }
    return NaN;
  }

  /**
   * Reproject all sources to a target CRS.
   * Returns the merged extent of all reprojected layers.
   */
  async reproject(
    targetCrs: string,
    sources: globalThis.Map<string, TopologySource>,
    targetCrsMetadata?: string,
  ): Promise<Bounds> {
    for (const source of sources.values()) {
      if (source.reproject) {
        await source.reproject(targetCrs, targetCrsMetadata);
      }
    }

    this._crs = targetCrs;

    const adapter = getDefaultMapshaperAdapter();
    const newExtent = new Bounds();
    for (const source of sources.values()) {
      const dataset = source.getDataset();
      if (dataset?.layers) {
        for (const layer of dataset.layers) {
          if (adapter.layerHasGeometry(layer)) {
            const bb = adapter.getLayerBounds(layer, dataset.arcs);
            if (bb) {
              newExtent.merge(new Bounds(bb.xmin, bb.ymin, bb.xmax, bb.ymax));
            }
          }
        }
      }
    }

    if (newExtent.hasBounds()) {
      newExtent.scale(INITIAL_EXTENT_PADDING);
    }

    return newExtent;
  }

  private _webMercatorToLatLng(x: number, y: number): [number, number] {
    const R2D = 180 / Math.PI;
    const lon = (x / WGS84_SEMI_MAJOR_AXIS) * R2D;
    const lat = R2D * (Math.PI * 0.5 - 2 * Math.atan(Math.exp(-y / WGS84_SEMI_MAJOR_AXIS)));
    return [lon, lat];
  }
}
