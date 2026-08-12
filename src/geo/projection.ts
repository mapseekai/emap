import { Bounds } from './bounds';
import type { MutableTopologySource } from '../source/source';
import { getDefaultMapshaperAdapter } from '../adapter/mapshaper-adapter';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { isWebMercatorCrs } from './crs-resolver';

/** WGS84 semi-major axis (Earth radius in meters) */
const WGS84_SEMI_MAJOR_AXIS = 6378137;

/** Earth circumference in Web Mercator projection */
const EARTH_CIRCUMFERENCE_WEB_MERCATOR = 40075016.6855;

/** Padding factor for initial extent after reprojection */
const INITIAL_EXTENT_PADDING = 1.07;

export interface ReprojectedSource {
  sourceId: string;
  source: MutableTopologySource;
  before: MapshaperDataset;
  beforeEditVersion: number;
  after: MapshaperDataset;
}

export interface PreparedReprojection {
  replacements: ReprojectedSource[];
  extent: Bounds;
}

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
    if (isWebMercatorCrs(this._crs)) {
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
    if (isWebMercatorCrs(this._crs)) {
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
    if (isWebMercatorCrs(this._crs)) {
      return (Math.pow(2, zoom) * 512) / EARTH_CIRCUMFERENCE_WEB_MERCATOR;
    }
    return NaN;
  }

  /**
   * Reproject all sources to a target CRS.
   * Returns the merged extent of all reprojected layers.
   */
  async prepareReproject(
    targetCrs: string,
    sources: globalThis.Map<string, MutableTopologySource>,
    targetCrsMetadata?: string,
  ): Promise<PreparedReprojection> {
    const replacements: ReprojectedSource[] = [];
    for (const [sourceId, source] of sources) {
      const before = source.getDataset();
      if (!before) continue;
      const beforeEditVersion = before.editVersion ?? 0;
      const after = await source.prepareReproject(targetCrs, targetCrsMetadata);
      replacements.push({ sourceId, source, before, beforeEditVersion, after });
    }

    const adapter = getDefaultMapshaperAdapter();
    const extent = new Bounds();
    for (const { after } of replacements) {
      for (const layer of after.layers) {
        if (!adapter.layerHasGeometry(layer)) continue;
        const bbox = adapter.getLayerBounds(layer, after.arcs);
        if (Number.isFinite(bbox.xmin)) {
          extent.merge(new Bounds(bbox.xmin, bbox.ymin, bbox.xmax, bbox.ymax));
        }
      }
    }
    if (extent.hasBounds()) extent.scale(INITIAL_EXTENT_PADDING);
    return { replacements, extent };
  }

  private _webMercatorToLatLng(x: number, y: number): [number, number] {
    const R2D = 180 / Math.PI;
    const lon = (x / WGS84_SEMI_MAJOR_AXIS) * R2D;
    const lat = R2D * (Math.PI * 0.5 - 2 * Math.atan(Math.exp(-y / WGS84_SEMI_MAJOR_AXIS)));
    return [lon, lat];
  }
}
