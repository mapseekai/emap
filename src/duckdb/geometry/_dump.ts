import { quoteIdentifier } from '../core/pipeline';

export function dumpSql(tableName: string, geometryColumn: string, expression: string): string {
  const table = quoteIdentifier(tableName);
  const geometry = quoteIdentifier(geometryColumn);
  return `SELECT\n  i.* EXCLUDE (${geometry}),\n  ST_AsWKB(part.geom) AS ${geometry}\nFROM ${table} AS i\nCROSS JOIN LATERAL UNNEST(ST_Dump(${expression})) AS dumped(part)\nWHERE part.geom IS NOT NULL`;
}
