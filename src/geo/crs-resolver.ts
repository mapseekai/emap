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
import epsgIndex from 'epsg-index/all.json';

/** Default fallback when no metadata identifies a CRS. */
export const DEFAULT_CRS = 'EPSG:4326';

interface EpsgIndexRecord {
  code?: string;
  proj4?: string;
}

const EPSG_CODE_RE = /^(?:EPSG:)?(\d+)$/i;
const WEB_MERCATOR_CODES = new Set(['3857', '900913', '102100']);
const EPSG_RECORDS = epsgIndex as Record<string, EpsgIndexRecord>;

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
 * metadata → canonical EPSG. Use {@link normalizeProjectCrs} for the outbound
 * direction before handing CRS labels to mapshaper's `-proj`.
 */
export function normalizeCrsString(str: string): string {
  const lower = str.toLowerCase();
  if (lower === 'wgs84' || lower.includes('4326')) return 'EPSG:4326';
  if (lower.includes('3857') || lower === 'webmercator') return 'EPSG:3857';
  if (/^epsg:\d+$/i.test(str)) return str.toUpperCase();
  return str;
}

/**
 * Translate user-facing / canonical CRS labels into the aliases mapshaper's
 * browser bundle can project without trying to read EPSG init files.
 */
export function normalizeProjectCrs(crs: string): string {
  const trimmed = crs.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'epsg:3857' || lower === 'epsg:900913' || lower === 'epsg:102100') {
    return 'webmercator';
  }
  if (lower === 'epsg:4326') {
    return 'wgs84';
  }
  return trimmed;
}

export class EpsgProjectionError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'EpsgProjectionError';
  }
}

function parseEpsgCode(crs: string): string | null {
  const match = crs.match(EPSG_CODE_RE);
  return match ? match[1] : null;
}

function formatEpsgCode(code: string): string {
  return `EPSG:${code}`;
}

/**
 * Resolve outbound projection input into a string mapshaper/mproj can consume.
 *
 * This keeps the existing browser-safe aliases for WGS84 and Web Mercator,
 * converts other standard EPSG codes through epsg-index's Proj.4 definitions,
 * and leaves custom Proj.4 strings / mapshaper aliases untouched.
 */
export async function resolveProjectCrs(crs: string): Promise<string> {
  const trimmed = crs.trim();
  const code = parseEpsgCode(trimmed);
  if (!code) return normalizeProjectCrs(trimmed);

  if (code === '4326') return 'wgs84';
  if (WEB_MERCATOR_CODES.has(code)) return 'webmercator';

  const record = EPSG_RECORDS[code];
  const proj4 = typeof record?.proj4 === 'string' ? record.proj4.trim() : '';
  if (!record) {
    throw new EpsgProjectionError(
      `Unsupported EPSG code: ${formatEpsgCode(code)}`,
      formatEpsgCode(code),
    );
  }
  if (!proj4) {
    throw new EpsgProjectionError(
      `${formatEpsgCode(code)} does not include a Proj.4 definition`,
      formatEpsgCode(code),
    );
  }
  return proj4;
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
