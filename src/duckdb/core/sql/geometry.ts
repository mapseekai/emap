import { quoteIdentifier } from '../pipeline';
import { assertSafeDuckDbFunction } from '../sql-safety';

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
