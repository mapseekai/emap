import { quoteIdentifier } from '../core/pipeline';
import { assertSafeDuckDbFunction } from '../core/sql-safety';

export type OverlayDuckDbFunction = 'ST_Intersection' | 'ST_Difference';

export interface BuildOverlaySqlOptions {
  inputTableName: string;
  maskTableName: string;
  inputGeometryColumn: string;
  maskGeometryColumn: string;
  duckDbFunction: OverlayDuckDbFunction;
}

export function buildOverlaySql(opts: BuildOverlaySqlOptions): string {
  const inputTableName = quoteIdentifier(opts.inputTableName);
  const maskTableName = quoteIdentifier(opts.maskTableName);
  const inputGeometryColumn = `i.${quoteIdentifier(opts.inputGeometryColumn)}`;
  const maskGeometryColumn = `m.${quoteIdentifier(opts.maskGeometryColumn)}`;
  const outputGeometryColumn = quoteIdentifier(opts.inputGeometryColumn);
  const duckDbFunction = assertSafeDuckDbFunction(opts.duckDbFunction);
  const overlayExpression = `${duckDbFunction}(${inputGeometryColumn}, mask_coverage.mask_geometry)`;
  const emptyMaskPredicate =
    opts.duckDbFunction === 'ST_Intersection' ? 'mask_coverage.mask_geometry IS NOT NULL' : 'TRUE';
  return [
    'WITH mask_coverage AS (',
    ' SELECT',
    `  ST_Union_Agg(${maskGeometryColumn}) AS mask_geometry`,
    ` FROM ${maskTableName} AS m`,
    ` WHERE ${maskGeometryColumn} IS NOT NULL`,
    '), overlay AS (',
    ' SELECT',
    `  i.* EXCLUDE (${outputGeometryColumn}),`,
    `  CASE WHEN mask_coverage.mask_geometry IS NULL THEN i.${outputGeometryColumn} ELSE ${overlayExpression} END AS overlay_geometry`,
    ` FROM ${inputTableName} AS i`,
    ' CROSS JOIN mask_coverage',
    ` WHERE ${inputGeometryColumn} IS NOT NULL`,
    `  AND ${emptyMaskPredicate}`,
    ')',
    'SELECT',
    ' * EXCLUDE (overlay_geometry),',
    ` ST_AsWKB(overlay_geometry) AS ${outputGeometryColumn}`,
    'FROM overlay',
    'WHERE overlay_geometry IS NOT NULL',
    ' AND NOT ST_IsEmpty(overlay.overlay_geometry)',
  ].join('\n');
}
