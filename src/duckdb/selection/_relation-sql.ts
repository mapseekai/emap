import { quoteIdentifier } from '../core/pipeline';
import { assertSafeDuckDbFunction } from '../core/sql-safety';

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

interface BuildRelationBaseSqlOptions {
  inputTableName: string;
  maskTableName: string;
  inputGeometryColumn: string;
  maskGeometryColumn: string;
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
