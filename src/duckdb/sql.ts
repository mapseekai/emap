import { quoteIdentifier } from './pipeline';

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

interface BuildRelationPredicateSqlOptions extends BuildRelationBaseSqlOptions {
  duckDbFunction: RelationDuckDbFunction;
}

interface BuildRelationDistanceWithinSqlOptions extends BuildRelationBaseSqlOptions {
  duckDbFunction: 'ST_Distance';
  distance: number;
}

export type BuildRelationFilterSqlOptions =
  | BuildRelationPredicateSqlOptions
  | BuildRelationDistanceWithinSqlOptions;

interface BuildRelationAttributeBaseSqlOptions extends BuildRelationBaseSqlOptions {
  outputColumn: string;
}

interface BuildRelationPredicateAttributeSqlOptions extends BuildRelationAttributeBaseSqlOptions {
  duckDbFunction: RelationDuckDbFunction;
  output?: 'predicate';
}

interface BuildRelationDistanceAttributeSqlOptions extends BuildRelationAttributeBaseSqlOptions {
  duckDbFunction: 'ST_Distance';
  output: 'distance';
}

interface BuildRelationDistanceWithinAttributeSqlOptions
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

export type SpatialAggregateJoinDuckDbFunction =
  | 'ST_Intersects'
  | 'ST_Contains'
  | 'ST_Within'
  | 'ST_Touches'
  | 'ST_Overlaps'
  | 'ST_Equals'
  | 'ST_Crosses'
  | 'ST_Covers'
  | 'ST_CoveredBy'
  | 'ST_ContainsProperly';

type SpatialAggregateSqlOperation = 'count' | 'sum' | 'avg' | 'min' | 'max';

interface BuildSpatialAggregateJoinAggregation {
  operation: SpatialAggregateSqlOperation;
  field?: string;
  outputColumn: string;
}

export interface BuildSpatialAggregateJoinSqlOptions {
  targetTableName: string;
  joinTableName: string;
  targetGeometryColumn: string;
  joinGeometryColumn: string;
  targetRowIdColumn: string;
  duckDbFunction: SpatialAggregateJoinDuckDbFunction;
  aggregations: readonly BuildSpatialAggregateJoinAggregation[];
}

const SPATIAL_AGGREGATE_JOIN_FUNCTIONS = new Set<SpatialAggregateJoinDuckDbFunction>([
  'ST_Intersects',
  'ST_Contains',
  'ST_Within',
  'ST_Touches',
  'ST_Overlaps',
  'ST_Equals',
  'ST_Crosses',
  'ST_Covers',
  'ST_CoveredBy',
  'ST_ContainsProperly',
]);

const SPATIAL_AGGREGATE_SQL_FUNCTIONS: Record<SpatialAggregateSqlOperation, string> = {
  count: 'COUNT',
  sum: 'SUM',
  avg: 'AVG',
  min: 'MIN',
  max: 'MAX',
};

export function buildSpatialAggregateJoinSql(opts: BuildSpatialAggregateJoinSqlOptions): string {
  if (!SPATIAL_AGGREGATE_JOIN_FUNCTIONS.has(opts.duckDbFunction)) {
    throw new Error(
      `Unsupported spatial aggregate join function: ${JSON.stringify(opts.duckDbFunction)}`,
    );
  }
  if (opts.aggregations.length === 0) {
    throw new Error('At least one spatial aggregate is required');
  }

  const targetTableName = quoteIdentifier(opts.targetTableName);
  const joinTableName = quoteIdentifier(opts.joinTableName);
  const targetGeometryColumn = quoteIdentifier(opts.targetGeometryColumn);
  const joinGeometryColumn = quoteIdentifier(opts.joinGeometryColumn);
  const targetRowIdColumn = quoteIdentifier(opts.targetRowIdColumn);
  const aggregations = opts.aggregations.map((aggregation) => {
    if (
      !Object.prototype.hasOwnProperty.call(SPATIAL_AGGREGATE_SQL_FUNCTIONS, aggregation.operation)
    ) {
      throw new Error(
        `Unsupported spatial aggregate operation: ${JSON.stringify(aggregation.operation)}`,
      );
    }
    if (aggregation.operation === 'count') {
      if (aggregation.field !== undefined) {
        throw new Error('Count spatial aggregate must not specify a field');
      }
      return `COUNT(*) AS ${quoteIdentifier(aggregation.outputColumn)}`;
    }
    if (aggregation.field === undefined) {
      throw new Error(`${aggregation.operation} spatial aggregate requires a field`);
    }
    return `${SPATIAL_AGGREGATE_SQL_FUNCTIONS[aggregation.operation]}(j.${quoteIdentifier(aggregation.field)}) AS ${quoteIdentifier(aggregation.outputColumn)}`;
  });

  return [
    'WITH target_valid AS (',
    '  SELECT *',
    `  FROM ${targetTableName}`,
    `  WHERE ${targetGeometryColumn} IS NOT NULL`,
    '),',
    'join_valid AS (',
    '  SELECT *',
    `  FROM ${joinTableName}`,
    `  WHERE ${joinGeometryColumn} IS NOT NULL`,
    ')',
    'SELECT',
    `  t.${targetRowIdColumn},`,
    ...aggregations.map(
      (aggregation, index) => `  ${aggregation}${index === aggregations.length - 1 ? '' : ','}`,
    ),
    'FROM target_valid AS t',
    'INNER JOIN join_valid AS j',
    `  ON ${opts.duckDbFunction}(t.${targetGeometryColumn}, j.${joinGeometryColumn})`,
    `GROUP BY t.${targetRowIdColumn}`,
    `ORDER BY t.${targetRowIdColumn}`,
  ].join('\n');
}
