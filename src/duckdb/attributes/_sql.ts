import { quoteIdentifier } from '../core/pipeline';
import { assertSafeDuckDbFunction } from '../core/sql-safety';

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
