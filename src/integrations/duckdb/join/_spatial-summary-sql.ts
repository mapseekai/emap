import { quoteIdentifier } from '../core/pipeline';

export type SpatialSummaryJoinDuckDbFunction =
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

type SpatialSummarySqlOperation = 'count' | 'sum' | 'avg' | 'min' | 'max';

interface BuildSpatialSummaryJoinAggregation {
  operation: SpatialSummarySqlOperation;
  field?: string;
  outputColumn: string;
}

export interface BuildSpatialSummaryJoinSqlOptions {
  targetTableName: string;
  joinTableName: string;
  targetGeometryColumn: string;
  joinGeometryColumn: string;
  targetRowIdColumn: string;
  duckDbFunction: SpatialSummaryJoinDuckDbFunction;
  aggregations: readonly BuildSpatialSummaryJoinAggregation[];
}

const SPATIAL_SUMMARY_JOIN_FUNCTIONS = new Set<SpatialSummaryJoinDuckDbFunction>([
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

const SPATIAL_SUMMARY_SQL_FUNCTIONS: Record<SpatialSummarySqlOperation, string> = {
  count: 'COUNT',
  sum: 'SUM',
  avg: 'AVG',
  min: 'MIN',
  max: 'MAX',
};

export function buildSpatialSummaryJoinSql(opts: BuildSpatialSummaryJoinSqlOptions): string {
  if (!SPATIAL_SUMMARY_JOIN_FUNCTIONS.has(opts.duckDbFunction)) {
    throw new Error(
      `Unsupported spatial summary join function: ${JSON.stringify(opts.duckDbFunction)}`,
    );
  }
  if (opts.aggregations.length === 0) {
    throw new Error('At least one spatial summary aggregation is required');
  }

  const targetTableName = quoteIdentifier(opts.targetTableName);
  const joinTableName = quoteIdentifier(opts.joinTableName);
  const targetGeometryColumn = quoteIdentifier(opts.targetGeometryColumn);
  const joinGeometryColumn = quoteIdentifier(opts.joinGeometryColumn);
  const targetRowIdColumn = quoteIdentifier(opts.targetRowIdColumn);
  const aggregations = opts.aggregations.map((aggregation) => {
    if (
      !Object.prototype.hasOwnProperty.call(SPATIAL_SUMMARY_SQL_FUNCTIONS, aggregation.operation)
    ) {
      throw new Error(
        `Unsupported spatial summary operation: ${JSON.stringify(aggregation.operation)}`,
      );
    }
    if (aggregation.operation === 'count') {
      if (aggregation.field !== undefined) {
        throw new Error('Count spatial summary aggregation must not specify a field');
      }
      return `COUNT(*) AS ${quoteIdentifier(aggregation.outputColumn)}`;
    }
    if (aggregation.field === undefined) {
      throw new Error(`${aggregation.operation} spatial summary aggregation requires a field`);
    }
    return `${SPATIAL_SUMMARY_SQL_FUNCTIONS[aggregation.operation]}(j.${quoteIdentifier(
      aggregation.field,
    )}) AS ${quoteIdentifier(aggregation.outputColumn)}`;
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
