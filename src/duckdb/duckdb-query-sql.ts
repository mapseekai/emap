import { DuckDbOperationError } from './duckdb-errors';

export interface ValidateDuckDbSelectSqlOptions {
  availableColumns: readonly string[];
  geometryColumn?: string;
  inputTableName?: string;
  physicalTableName: string;
  rowIdColumn?: string;
}

export interface ValidatedDuckDbSelectSql {
  outputColumns: string[];
  rowIdColumn: string;
  sql: string;
}

const DEFAULT_GEOMETRY_COLUMN = 'geometry';
const DEFAULT_INPUT_TABLE_NAME = 'input';
const DEFAULT_ROW_ID_COLUMN = '__emap_rowid';

const MUTATING_KEYWORDS = [
  'alter',
  'attach',
  'copy',
  'create',
  'delete',
  'detach',
  'drop',
  'insert',
  'install',
  'load',
  'pragma',
  'replace',
  'set',
  'update',
];

const UNSUPPORTED_KEYWORD_PATTERNS = [
  /\bjoin\b/i,
  /\bwith\b/i,
  /\bunion\b/i,
  /\bexcept\b/i,
  /\bintersect\b/i,
  /\bgroup\s+by\b/i,
  /\bhaving\b/i,
  /\bqualify\b/i,
  /\bwindow\b/i,
  /\bover\b/i,
];

export function validateDuckDbSelectSql(
  sql: string,
  opts: ValidateDuckDbSelectSqlOptions,
): ValidatedDuckDbSelectSql {
  const inputTableName = opts.inputTableName ?? DEFAULT_INPUT_TABLE_NAME;
  const rowIdColumn = opts.rowIdColumn ?? DEFAULT_ROW_ID_COLUMN;
  const geometryColumn = opts.geometryColumn ?? DEFAULT_GEOMETRY_COLUMN;
  const trimmed = sql.trim();

  if (trimmed.length === 0) {
    throwValidation('must not be empty');
  }
  if (trimmed.includes(';')) {
    throwValidation('must contain a single SELECT statement');
  }
  if (trimmed.includes('--') || trimmed.includes('/*') || trimmed.includes('*/')) {
    throwValidation('must not contain comments');
  }

  const masked = maskQuotedSegments(trimmed);
  const lowerMasked = masked.toLowerCase();

  if (!/^\s*select\b/i.test(masked)) {
    throwValidation('must start with SELECT');
  }
  if (countKeyword(lowerMasked, 'select') !== 1) {
    throwValidation('must contain exactly one SELECT');
  }
  rejectUnsafeKeywords(lowerMasked);
  rejectGeometryReference(trimmed, geometryColumn);

  const fromMatch = /\bfrom\b/i.exec(masked);
  if (!fromMatch) {
    throwValidation(`must read from ${inputTableName}`);
  }

  const selectMatch = /^\s*select\b/i.exec(masked);
  if (!selectMatch) {
    throwValidation('must start with SELECT');
  }

  const projectionSql = trimmed.slice(selectMatch[0].length, fromMatch.index);
  const afterFromIndex = fromMatch.index + fromMatch[0].length;
  const tableInfo = readInputTable(trimmed, afterFromIndex, inputTableName);
  const tail = trimmed.slice(tableInfo.endIndex);
  const maskedTail = masked.slice(tableInfo.endIndex);

  validateTail(maskedTail);

  const outputColumns = parseProjection(
    projectionSql,
    opts.availableColumns,
    geometryColumn,
    rowIdColumn,
  );
  const selectList = [
    `${quoteIdentifier(inputTableName)}.${quoteIdentifier(rowIdColumn)} AS ${quoteIdentifier(rowIdColumn)}`,
    ...outputColumns.map(
      (column) =>
        `${quoteIdentifier(inputTableName)}.${quoteIdentifier(column)} AS ${quoteIdentifier(column)}`,
    ),
  ].join(', ');

  return {
    outputColumns,
    rowIdColumn,
    sql: `SELECT ${selectList} FROM ${quoteIdentifier(opts.physicalTableName)} AS ${quoteIdentifier(inputTableName)}${tail}`,
  };
}

function parseProjection(
  projectionSql: string,
  availableColumns: readonly string[],
  geometryColumn: string,
  rowIdColumn: string,
): string[] {
  const projection = projectionSql.trim();
  if (projection.length === 0) {
    throwValidation('must include a projection');
  }
  if (projection === '*') {
    return availableColumns.filter((column) => column !== geometryColumn && column !== rowIdColumn);
  }
  if (projection.includes('*')) {
    throwValidation('must use either * or column names');
  }

  const available = new Set(availableColumns);
  const seen = new Set<string>();
  const outputColumns: string[] = [];

  for (const item of splitProjectionItems(projectionSql)) {
    const column = parseProjectionColumn(item);
    if (column === geometryColumn || column === rowIdColumn) {
      throwValidation('must not project geometry or row id columns');
    }
    if (!available.has(column)) {
      throwValidation(`references unknown column ${column}`);
    }
    if (seen.has(column)) {
      throwValidation(`projects duplicate column ${column}`);
    }
    seen.add(column);
    outputColumns.push(column);
  }

  return outputColumns;
}

function splitProjectionItems(projectionSql: string): string[] {
  const items: string[] = [];
  let start = 0;
  let inDoubleQuote = false;

  for (let index = 0; index < projectionSql.length; index += 1) {
    const char = projectionSql[index];
    if (char === '"') {
      if (inDoubleQuote && projectionSql[index + 1] === '"') {
        index += 1;
      } else {
        inDoubleQuote = !inDoubleQuote;
      }
      continue;
    }
    if (char === ',' && !inDoubleQuote) {
      items.push(projectionSql.slice(start, index));
      start = index + 1;
    }
  }

  if (inDoubleQuote) {
    throwValidation('has an unterminated quoted identifier');
  }

  items.push(projectionSql.slice(start));
  return items;
}

function parseProjectionColumn(item: string): string {
  const trimmed = item.trim();
  if (trimmed.length === 0) {
    throwValidation('has an empty projection');
  }
  if (trimmed.includes('.')) {
    throwValidation('must not use qualified projections');
  }
  if (
    /\bas\b/i.test(maskQuotedSegments(trimmed)) ||
    /\s/.test(maskQuotedSegments(trimmed).trim())
  ) {
    throwValidation('must not use projection aliases');
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const column = unquoteIdentifier(trimmed);
    if (column.length === 0) {
      throwValidation('has an empty quoted projection');
    }
    return column;
  }

  throwValidation('must project only bare or quoted column names');
}

function readInputTable(
  sql: string,
  afterFromIndex: number,
  inputTableName: string,
): { endIndex: number } {
  let index = afterFromIndex;
  while (index < sql.length && /\s/.test(sql[index])) {
    index += 1;
  }

  const tableStart = index;
  while (index < sql.length && /[A-Za-z0-9_]/.test(sql[index])) {
    index += 1;
  }

  if (tableStart === index) {
    throwValidation(`must read from ${inputTableName}`);
  }

  const tableName = sql.slice(tableStart, index);
  if (tableName.toLowerCase() !== inputTableName.toLowerCase()) {
    throwValidation(`must read from ${inputTableName}`);
  }

  return { endIndex: index };
}

function validateTail(maskedTail: string): void {
  const trimmed = maskedTail.trimStart();
  if (trimmed.length === 0) {
    return;
  }
  if (/^as\b/i.test(trimmed)) {
    throwValidation('must not alias the input table');
  }
  if (!/^(where\b|order\s+by\b|limit\b)/i.test(trimmed)) {
    throwValidation('has an unsupported clause after FROM input');
  }
  if (!tailClausesAreOrdered(maskedTail)) {
    throwValidation('supports only WHERE, ORDER BY, and LIMIT in that order');
  }
  if (/\bfrom\b/i.test(maskedTail)) {
    throwValidation('must not read from additional tables');
  }
}

function tailClausesAreOrdered(maskedTail: string): boolean {
  const whereIndex = findKeyword(maskedTail, /\bwhere\b/i);
  const orderIndex = findKeyword(maskedTail, /\border\s+by\b/i);
  const limitIndex = findKeyword(maskedTail, /\blimit\b/i);
  const positions = [
    { index: whereIndex, order: 0 },
    { index: orderIndex, order: 1 },
    { index: limitIndex, order: 2 },
  ]
    .filter((position) => position.index !== -1)
    .sort((left, right) => left.index - right.index);
  let lastOrder = -1;

  return positions.every((position) => {
    if (position.order <= lastOrder) {
      return false;
    }
    lastOrder = position.order;
    return true;
  });
}

function rejectUnsafeKeywords(lowerMasked: string): void {
  for (const keyword of MUTATING_KEYWORDS) {
    if (countKeyword(lowerMasked, keyword) > 0) {
      throwValidation(`must not use ${keyword.toUpperCase()}`);
    }
  }
  for (const pattern of UNSUPPORTED_KEYWORD_PATTERNS) {
    if (pattern.test(lowerMasked)) {
      throwValidation('uses an unsupported SQL clause');
    }
  }
}

function rejectGeometryReference(sql: string, geometryColumn: string): void {
  const maskedStrings = maskSingleQuotedStrings(sql);
  const escaped = escapeRegex(geometryColumn);
  if (new RegExp(`(^|[^A-Za-z0-9_])"?${escaped}"?([^A-Za-z0-9_]|$)`, 'i').test(maskedStrings)) {
    throwValidation('must not reference the geometry column');
  }
}

function countKeyword(sql: string, keyword: string): number {
  return sql.match(new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'g'))?.length ?? 0;
}

function findKeyword(sql: string, pattern: RegExp): number {
  return pattern.exec(sql)?.index ?? -1;
}

function maskQuotedSegments(sql: string): string {
  const chars = sql.split('');
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    if (!quote && (char === '"' || char === "'")) {
      quote = char;
      chars[index] = ' ';
      continue;
    }
    if (quote) {
      chars[index] = ' ';
      if (char === quote) {
        const nextChar = sql[index + 1];
        if (nextChar === quote) {
          chars[index + 1] = ' ';
          index += 1;
        } else {
          quote = undefined;
        }
      }
    }
  }
  if (quote) {
    throwValidation('has an unterminated quoted string or identifier');
  }

  return chars.join('');
}

function maskSingleQuotedStrings(sql: string): string {
  const chars = sql.split('');
  let inString = false;

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    if (!inString && char === "'") {
      inString = true;
      chars[index] = ' ';
      continue;
    }
    if (inString) {
      chars[index] = ' ';
      if (char === "'") {
        if (sql[index + 1] === "'") {
          chars[index + 1] = ' ';
          index += 1;
        } else {
          inString = false;
        }
      }
    }
  }
  if (inString) {
    throwValidation('has an unterminated quoted string');
  }

  return chars.join('');
}

function unquoteIdentifier(identifier: string): string {
  let value = '';
  for (let index = 1; index < identifier.length - 1; index += 1) {
    const char = identifier[index];
    if (char === '"') {
      if (identifier[index + 1] !== '"') {
        throwValidation('has an invalid quoted identifier');
      }
      value += '"';
      index += 1;
    } else {
      value += char;
    }
  }
  return value;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function throwValidation(message: string): never {
  throw new DuckDbOperationError('validation', `DuckDB query ${message}`, {
    field: 'sql',
  });
}
