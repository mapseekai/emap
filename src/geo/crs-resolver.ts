// CRS resolution for an imported mapshaper dataset.
//
// Why this lives in its own module: the resolver combines several
// independent heuristics (mapshaper's parsed `info.crs` shape, a free-text
// `crs_string`, the raw `.prj` / WKT body) and a fallback ladder. Each
// stage is independently testable; pulling them out of `TopologySource`
// keeps the source class focused on lifecycle / events / data loading.
//
// All inputs are tolerated even when missing — the resolver always returns
// SOME canonical EPSG-like string, defaulting to `EPSG:4326` when nothing
// matches. That matches the prior `TopologySource.getCRS()` behaviour.

import type { MapshaperDataset } from '../types/mapshaper-types';

/** Default fallback when no metadata identifies a CRS. */
export const DEFAULT_CRS = 'EPSG:4326';

/**
 * Resolve a canonical CRS identifier (typically `EPSG:NNNN` or a passthrough
 * label) for a mapshaper dataset.
 *
 * Lookup order, first hit wins:
 *
 *   1. `info.crs_string` — normalised via {@link normalizeCrsString}.
 *   2. `info.prj` (raw WKT) — `AUTHORITY["EPSG", "..."]` clause first;
 *      then Web-Mercator / WGS84 datum heuristics.
 *   3. `info.crs` (mapshaper's parsed Proj4 descriptor) —
 *      `is_latlong` ⇒ EPSG:4326; spheroid `merc` + `a=6378137` ⇒ EPSG:3857.
 *   4. {@link DEFAULT_CRS}.
 */
export function resolveDatasetCRS(dataset: MapshaperDataset | undefined): string {
  if (!dataset) return DEFAULT_CRS;
  const info = dataset.info;
  if (!info) return DEFAULT_CRS;

  if (info.crs_string) return normalizeCrsString(info.crs_string);

  if (info.prj) {
    const fromPrj = inferFromPrj(info.prj);
    if (fromPrj) return fromPrj;
  }

  if (info.crs) {
    if (info.crs.is_latlong) return 'EPSG:4326';
    if (info.crs.projName === 'merc' && info.crs.a === 6378137) return 'EPSG:3857';
  }

  return DEFAULT_CRS;
}

/**
 * Map a free-text CRS label (`'wgs84'`, `'webmercator'`, `'epsg:4326'`, …)
 * onto a canonical `EPSG:NNNN` string when possible. Inputs that look like
 * EPSG codes are upper-cased; anything else (proj4 strings, named aliases
 * mapshaper understands directly) passes through unchanged so case-sensitive
 * tokens like `+proj=utm` survive.
 *
 * This is the inbound direction of the boundary translation: external/raw
 * metadata → canonical EPSG. The outbound direction (canonical EPSG →
 * mapshaper alias) lives in `normalizeProjectCrs` in `map/ops/project.ts`.
 */
export function normalizeCrsString(str: string): string {
  const lower = str.toLowerCase();
  if (lower === 'wgs84' || lower.includes('4326')) return 'EPSG:4326';
  if (lower.includes('3857') || lower === 'webmercator') return 'EPSG:3857';
  if (/^epsg:\d+$/i.test(str)) return str.toUpperCase();
  return str;
}

/**
 * Heuristic-extract a CRS identifier from a raw WKT `.prj` body.
 * Returns `null` when nothing matches; callers fall through to the next
 * resolver stage.
 *
 * Recognised:
 *   - `AUTHORITY["EPSG", "<code>"]` anywhere in the body → `EPSG:<code>`.
 *   - Web-Mercator name fragments → `EPSG:3857`.
 *   - WGS_1984 datum + GEOGCS top-level → `EPSG:4326`.
 */
export function inferFromPrj(prj: string): string | null {
  const authorityMatch = prj.match(/AUTHORITY\["EPSG"\s*,\s*"(\d+)"\]/i);
  if (authorityMatch) return `EPSG:${authorityMatch[1]}`;

  if (
    /Mercator.*WGS.*84.*Pseudo/i.test(prj)
    || /WGS.*84.*Pseudo.*Mercator/i.test(prj)
    || /Web[_ ]Mercator/i.test(prj)
    || /WGS.?1984.*Web.?Mercator/i.test(prj)
  ) {
    return 'EPSG:3857';
  }

  if (/DATUM\["WGS_1984"/i.test(prj) && /GEOGCS/i.test(prj)) {
    return 'EPSG:4326';
  }

  return null;
}
