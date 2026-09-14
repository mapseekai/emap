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

import type { MapshaperDataset } from '../../shared/types/mapshaper-types';
import { EPSG_CODES_WITHOUT_PROJ4, EPSG_PROJ4_TABLE } from './epsg-proj4-data';
import { lookupEpsgTsv } from './epsg-table';
import { resolveMapshaperCrsSignature } from '../../integrations/mapshaper/adapter';

/** Default fallback when no metadata identifies a CRS. */
export const DEFAULT_CRS = 'EPSG:4326';

const EPSG_CODE_RE = /^(?:EPSG:)?(\d+)$/i;
const EPSG_URN_RE = /^urn:ogc:def:crs:epsg(?::[^:]*)?:(\d+)$/i;
const EPSG_HTTP_RE = /\/epsg\/(?:[^/]+\/)?(\d+)$/i;
const WEB_MERCATOR_CODES = new Set(['3857', '900913', '102100']);

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
  return resolveDatasetCRSMetadata(dataset) ?? DEFAULT_CRS;
}

/**
 * Resolve only CRS metadata explicitly carried by the dataset. Unlike
 * {@link resolveDatasetCRS}, this does not invent the display fallback CRS.
 * Use it for file export metadata where unknown CRS must remain unknown.
 */
export function resolveDatasetCRSMetadata(
  dataset: MapshaperDataset | undefined,
): string | undefined {
  if (!dataset) return undefined;
  const info = dataset.info;
  if (!info) return undefined;

  if (info.crs_string) return normalizeCrsString(info.crs_string);

  if (info.prj) {
    const fromPrj = inferFromPrj(info.prj);
    if (fromPrj) return fromPrj;
  }

  if (info.wkt1) {
    const fromWkt1 = inferFromPrj(info.wkt1);
    if (fromWkt1) return fromWkt1;
  }

  if (info.crs) {
    if (info.crs.is_latlong) return 'EPSG:4326';
    if (info.crs.projName === 'merc' && info.crs.a === 6378137) return 'EPSG:3857';
  }

  return undefined;
}

/**
 * Map a free-text CRS label (`'wgs84'`, `'webmercator'`, `'epsg:4326'`, …)
 * onto a canonical `EPSG:NNNN` string when possible. Inputs that look like
 * EPSG codes are upper-cased; anything else (proj4 strings, named aliases
 * mapshaper understands directly) passes through unchanged so case-sensitive
 * tokens like `+proj=utm` survive.
 *
 * This is the inbound direction of the boundary translation: external/raw
 * metadata → canonical EPSG. Use `normalizeProjectCrs` for the outbound
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

/**
 * Canonical CRS identifier to persist after a successful projection.
 * This preserves user-facing EPSG authority codes even when
 * {@link resolveProjectCrs} must hand mapshaper a Proj.4 string.
 */
export function normalizeProjectCrsMetadata(crs: string): string | undefined {
  const trimmed = crs.trim();
  if (!trimmed) return undefined;

  const code = parseEpsgCode(trimmed);
  if (code) return formatEpsgCode(code);

  const lower = trimmed.toLowerCase();
  if (lower === 'wgs84' || lower === 'ogc:crs84' || lower === 'crs84') return 'EPSG:4326';
  if (lower === 'webmercator') return 'EPSG:3857';

  return normalizeCrsString(trimmed);
}

export function setDatasetCrsMetadata(
  dataset: MapshaperDataset | undefined,
  crs: string | undefined,
): void {
  if (!dataset) return;
  dataset.info ??= {};
  delete dataset.info.prj;
  delete dataset.info.wkt1;
  if (crs) {
    dataset.info.crs_string = crs;
  } else {
    delete dataset.info.crs_string;
  }
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
  const trimmed = crs.trim();
  const match = trimmed.match(EPSG_CODE_RE);
  if (match) return match[1];

  const urnMatch = trimmed.match(EPSG_URN_RE);
  if (urnMatch) return urnMatch[1];

  const httpMatch = trimmed.match(EPSG_HTTP_RE);
  return httpMatch ? httpMatch[1] : null;
}
/**
 * Whether the CRS label denotes Web Mercator — the `webmercator` mapshaper
 * alias or one of the EPSG codes (`3857`, `900913`, `102100`) that
 * {@link resolveProjectCrs} maps to it.
 */
export function isWebMercatorCrs(crs: string): boolean {
  const trimmed = crs.trim().toLowerCase();
  if (trimmed === 'webmercator') return true;
  const code = parseEpsgCode(trimmed);
  return code !== null && WEB_MERCATOR_CODES.has(code);
}

function formatEpsgCode(code: string): string {
  return `EPSG:${code}`;
}

function isLongLatProj4(proj4: string): boolean {
  return /(?:^|\s)\+proj=(?:longlat|latlong)(?:\s|$)/i.test(proj4);
}

function isGeographicEpsgCode(code: string): boolean {
  if (code === '4326') return true;
  const proj4 = lookupEpsgTsv(EPSG_PROJ4_TABLE, code);
  return proj4 ? isLongLatProj4(proj4) : false;
}

function detectTopLevelWktGeographic(wkt: string): boolean | null {
  const trimmed = wkt.trim();
  if (/^(?:GEOGCS|GEODCRS|GEOGRAPHICCRS)\s*\[/i.test(trimmed)) return true;
  if (/^(?:PROJCS|PROJCRS|PROJECTEDCRS)\s*\[/i.test(trimmed)) return false;
  return null;
}

export function isGeographicCrsString(crs: string | undefined): boolean {
  if (!crs) return false;

  const trimmed = crs.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'wgs84' || lower === 'ogc:crs84' || lower === 'crs84') return true;

  const wktType = detectTopLevelWktGeographic(trimmed);
  if (wktType !== null) return wktType;

  const code = parseEpsgCode(trimmed);
  if (code) return isGeographicEpsgCode(code);

  const inferred = inferFromPrj(trimmed);
  if (inferred) return isGeographicCrsString(inferred);

  return isLongLatProj4(trimmed);
}

export function isGeographicCrs(dataset: MapshaperDataset | undefined): boolean {
  const info = dataset?.info;
  if (!info) return false;

  if (isGeographicCrsString(info.crs_string)) return true;
  if (isGeographicCrsString(info.prj)) return true;
  if (isGeographicCrsString(info.wkt1)) return true;

  return info.crs?.is_latlong === true;
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

  const proj4 = lookupEpsgTsv(EPSG_PROJ4_TABLE, code);
  if (proj4) return proj4;

  if (!EPSG_CODES_WITHOUT_PROJ4.includes(`|${code}|`)) {
    throw new EpsgProjectionError(
      `Unsupported EPSG code: ${formatEpsgCode(code)}`,
      formatEpsgCode(code),
    );
  }
  throw new EpsgProjectionError(
    `${formatEpsgCode(code)} does not include a Proj.4 definition`,
    formatEpsgCode(code),
  );
}

export interface ResolvedProjectCrs {
  readonly definition: string;
  readonly signature: string;
}

export async function resolveProjectCrsDefinition(crs: string): Promise<ResolvedProjectCrs> {
  const definition = await resolveProjectCrs(crs);
  return {
    definition,
    signature: resolveMapshaperCrsSignature(definition),
  };
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
    /Mercator.*WGS.*84.*Pseudo/i.test(prj) ||
    /WGS.*84.*Pseudo.*Mercator/i.test(prj) ||
    /Web[_ ]Mercator/i.test(prj) ||
    /WGS.?1984.*Web.?Mercator/i.test(prj)
  ) {
    return 'EPSG:3857';
  }

  if (/DATUM\["(?:D_)?WGS_1984"/i.test(prj) && /GEOGCS/i.test(prj)) {
    return 'EPSG:4326';
  }

  return null;
}
