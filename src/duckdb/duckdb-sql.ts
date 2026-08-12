function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** DuckDB spatial function names are interpolated raw into SQL, so they are
 * restricted to the `ST_*` namespace. Identifiers and numeric arguments are
 * quoted/validated elsewhere; this guards the one remaining raw token against
 * a caller wiring untrusted input into `duckDbFunction`. */
const SAFE_DUCKDB_FUNCTION = /^ST_[A-Za-z0-9_]+$/;

function assertSafeDuckDbFunction(duckDbFunction: string): string {
  if (!SAFE_DUCKDB_FUNCTION.test(duckDbFunction)) {
    throw new Error(`Unsafe DuckDB function name: ${JSON.stringify(duckDbFunction)}`);
  }
  return duckDbFunction;
}

export interface BuildUnaryGeometrySqlOptions {
  tableName: string;
  geometryColumn: string;
  duckDbFunction: string;
  args?: readonly number[];
}

export function buildUnaryGeometrySql(opts: BuildUnaryGeometrySqlOptions): string {
  const tableName = quoteIdentifier(opts.tableName);
  const geometryColumn = quoteIdentifier(opts.geometryColumn);
  const duckDbFunction = assertSafeDuckDbFunction(opts.duckDbFunction);
  const args = opts.args?.length ? `, ${opts.args.join(', ')}` : '';

  return [
    'SELECT',
    `  * EXCLUDE (${geometryColumn}),`,
    `  ${duckDbFunction}(${geometryColumn}${args}) AS ${geometryColumn}`,
    `FROM ${tableName}`,
    `WHERE ${geometryColumn} IS NOT NULL`,
  ].join('\n');
}

export interface BuildAttributeSqlOptions {
  tableName: string;
  geometryColumn: string;
  duckDbFunction: string;
  buildExpression?: (geometryColumn: string) => string;
  outputColumn: string;
}

export function buildAttributeSql(opts: BuildAttributeSqlOptions): string {
  const tableName = quoteIdentifier(opts.tableName);
  const geometryColumn = quoteIdentifier(opts.geometryColumn);
  const outputColumn = quoteIdentifier(opts.outputColumn);
  const expression = opts.buildExpression
    ? opts.buildExpression(geometryColumn)
    : `${assertSafeDuckDbFunction(opts.duckDbFunction)}(${geometryColumn})`;

  return [
    'SELECT',
    '  *,',
    `  ${expression} AS ${outputColumn}`,
    `FROM ${tableName}`,
    `WHERE ${geometryColumn} IS NOT NULL`,
  ].join('\n');
}

export type RelationDuckDbFunction =
  | 'ST_Intersects'
  | 'ST_Contains'
  | 'ST_Within'
  | 'ST_Touches'
  | 'ST_Disjoint'
  | 'ST_Overlaps'
  | 'ST_Equals'
  | 'ST_Crosses'
  | 'ST_Covers'
  | 'ST_CoveredBy'
  | 'ST_ContainsProperly';

export type OverlayDuckDbFunction = 'ST_Intersection' | 'ST_Difference';

interface BuildRelationBaseSqlOptions {
  inputTableName: string;
  maskTableName: string;
  inputGeometryColumn: string;
  maskGeometryColumn: string;
}

export interface BuildOverlaySqlOptions {
  inputTableName: string;
  maskTableName: string;
  inputGeometryColumn: string;
  maskGeometryColumn: string;
  duckDbFunction: OverlayDuckDbFunction;
}

export interface BuildRelationPredicateSqlOptions extends BuildRelationBaseSqlOptions {
  duckDbFunction: RelationDuckDbFunction;
}

export interface BuildRelationDistanceWithinSqlOptions extends BuildRelationBaseSqlOptions {
  duckDbFunction: 'ST_Distance';
  distance: number;
}

export type BuildRelationFilterSqlOptions =
  | BuildRelationPredicateSqlOptions
  | BuildRelationDistanceWithinSqlOptions;

interface BuildRelationAttributeBaseSqlOptions extends BuildRelationBaseSqlOptions {
  outputColumn: string;
}

export interface BuildRelationPredicateAttributeSqlOptions
  extends BuildRelationAttributeBaseSqlOptions {
  duckDbFunction: RelationDuckDbFunction;
  output?: 'predicate';
}

export interface BuildRelationDistanceAttributeSqlOptions
  extends BuildRelationAttributeBaseSqlOptions {
  duckDbFunction: 'ST_Distance';
  output: 'distance';
}

export interface BuildRelationDistanceWithinAttributeSqlOptions
  extends BuildRelationAttributeBaseSqlOptions {
  duckDbFunction: 'ST_Distance';
  distance: number;
  output?: 'predicate';
}

export type BuildRelationSqlOptions =
  | BuildRelationPredicateAttributeSqlOptions
  | BuildRelationDistanceAttributeSqlOptions
  | BuildRelationDistanceWithinAttributeSqlOptions;

function relationPredicate(opts: BuildRelationFilterSqlOptions): string {
  const inputGeometryColumn = `i.${quoteIdentifier(opts.inputGeometryColumn)}`;
  const maskGeometryColumn = `m.${quoteIdentifier(opts.maskGeometryColumn)}`;
  const duckDbFunction = assertSafeDuckDbFunction(opts.duckDbFunction);
  const expression = `${duckDbFunction}(${inputGeometryColumn}, ${maskGeometryColumn})`;

  return 'distance' in opts ? `${expression} <= ${opts.distance}` : expression;
}

export function buildRelationFilterSql(opts: BuildRelationFilterSqlOptions): string {
  const inputTableName = quoteIdentifier(opts.inputTableName);
  const maskTableName = quoteIdentifier(opts.maskTableName);
  const inputGeometryColumn = `i.${quoteIdentifier(opts.inputGeometryColumn)}`;
  const maskGeometryColumn = `m.${quoteIdentifier(opts.maskGeometryColumn)}`;

  return [
    'SELECT',
    ' i.*',
    `FROM ${inputTableName} AS i`,
    `WHERE ${inputGeometryColumn} IS NOT NULL`,
    ' AND EXISTS (',
    '  SELECT 1',
    `  FROM ${maskTableName} AS m`,
    `  WHERE ${maskGeometryColumn} IS NOT NULL`,
    `   AND ${relationPredicate(opts)}`,
    ' )',
  ].join('\n');
}

export function buildRelationAttributeSql(opts: BuildRelationSqlOptions): string {
  const inputTableName = quoteIdentifier(opts.inputTableName);
  const maskTableName = quoteIdentifier(opts.maskTableName);
  const inputGeometryColumn = `i.${quoteIdentifier(opts.inputGeometryColumn)}`;
  const maskGeometryColumn = `m.${quoteIdentifier(opts.maskGeometryColumn)}`;
  const outputColumn = quoteIdentifier(opts.outputColumn);
  const expression =
    opts.output === 'distance'
      ? [
          '(',
          `  SELECT MIN(${assertSafeDuckDbFunction(opts.duckDbFunction)}(${inputGeometryColumn}, ${maskGeometryColumn}))`,
          `  FROM ${maskTableName} AS m`,
          `  WHERE ${maskGeometryColumn} IS NOT NULL`,
          ` ) AS ${outputColumn}`,
        ]
      : [
          'EXISTS (',
          '  SELECT 1',
          `  FROM ${maskTableName} AS m`,
          `  WHERE ${maskGeometryColumn} IS NOT NULL`,
          `   AND ${relationPredicate(opts)}`,
          ` ) AS ${outputColumn}`,
        ];

  return [
    'SELECT',
    ' i.*,',
    ...expression.map((line, index) => (index === 0 ? ` ${line}` : line)),
    `FROM ${inputTableName} AS i`,
    `WHERE ${inputGeometryColumn} IS NOT NULL`,
  ].join('\n');
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

export function buildBufferSql(opts: {
  tableName: string;
  geometryColumn: string;
  distance: number;
}): string {
  return buildUnaryGeometrySql({
    tableName: opts.tableName,
    geometryColumn: opts.geometryColumn,
    duckDbFunction: 'ST_Buffer',
    args: [opts.distance],
  });
}

export default buildBufferSql;
