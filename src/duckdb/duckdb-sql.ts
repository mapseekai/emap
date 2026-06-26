function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
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
  const args = opts.args?.length ? `, ${opts.args.join(', ')}` : '';

  return [
    'SELECT',
    `  * EXCLUDE (${geometryColumn}),`,
    `  ${opts.duckDbFunction}(${geometryColumn}${args}) AS ${geometryColumn}`,
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
    : `${opts.duckDbFunction}(${geometryColumn})`;

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
  | 'ST_Disjoint';

interface BuildRelationBaseSqlOptions {
  inputTableName: string;
  maskTableName: string;
  inputGeometryColumn: string;
  maskGeometryColumn: string;
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
  const expression = `${opts.duckDbFunction}(${inputGeometryColumn}, ${maskGeometryColumn})`;

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
          `  SELECT MIN(${opts.duckDbFunction}(${inputGeometryColumn}, ${maskGeometryColumn}))`,
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
