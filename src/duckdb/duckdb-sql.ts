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
