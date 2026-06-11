function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function buildBufferSql(opts: {
  tableName: string;
  geometryColumn: string;
  distance: number;
}): string {
  const tableName = quoteIdentifier(opts.tableName);
  const geometryColumn = quoteIdentifier(opts.geometryColumn);

  return [
    'SELECT',
    `  * EXCLUDE (${geometryColumn}),`,
    `  ST_Buffer(${geometryColumn}, ${opts.distance}) AS ${geometryColumn}`,
    `FROM ${tableName}`,
    `WHERE ${geometryColumn} IS NOT NULL`,
  ].join('\n');
}
