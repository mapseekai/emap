import { DuckDbOperationError } from './errors';
import { quoteIdentifier } from './pipeline';

export interface ValidateDuckDbSelectSqlOptions {
  allowGeometryProjection?: boolean;
  availableColumns: readonly string[];
  geometryColumn?: string;
  inputTableName?: string;
  physicalTableName: string;
  rowIdColumn?: string | null;
}

export interface ValidatedDuckDbSelectSql {
  outputColumns: string[];
  rowIdColumn: string | null;
  sql: string;
}

export interface ValidatedDuckDbSelectSqlWithRowId extends ValidatedDuckDbSelectSql {
  rowIdColumn: string;
}

export interface ValidatedDuckDbSelectSqlWithoutRowId extends ValidatedDuckDbSelectSql {
  rowIdColumn: null;
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
  /\bread_parquet\s*\(/i,
];

export function validateDuckDbSelectSql(
  sql: string,
  opts: ValidateDuckDbSelectSqlOptions & { rowIdColumn: null },
): ValidatedDuckDbSelectSqlWithoutRowId;
export function validateDuckDbSelectSql(
  sql: string,
  opts: ValidateDuckDbSelectSqlOptions & { rowIdColumn?: string },
): ValidatedDuckDbSelectSqlWithRowId;
export function validateDuckDbSelectSql(
  sql: string,
  opts: ValidateDuckDbSelectSqlOptions,
): ValidatedDuckDbSelectSql {
  const inputTableName = opts.inputTableName ?? DEFAULT_INPUT_TABLE_NAME;
  const rowIdColumn =
    opts.rowIdColumn === null ? null : (opts.rowIdColumn ?? DEFAULT_ROW_ID_COLUMN);
  const reservedRowIdColumn = rowIdColumn ?? DEFAULT_ROW_ID_COLUMN;
  const geometryColumn = opts.geometryColumn ?? DEFAULT_GEOMETRY_COLUMN;
  const scalarColumns = selectableColumnSet(opts.availableColumns, {
    allowGeometryProjection: false,
    geometryColumn,
    rowIdColumn: reservedRowIdColumn,
  });
  const projectionColumns = selectableColumnSet(opts.availableColumns, {
    allowGeometryProjection: opts.allowGeometryProjection === true,
    geometryColumn,
    rowIdColumn: reservedRowIdColumn,
  });
  const trimmed = sql.trim();

  if (trimmed.length === 0) {
    throwValidation('must not be empty');
  }

  const masked = maskQuotedSegments(trimmed);
  const lowerMasked = masked.toLowerCase();
  if (masked.includes(';')) {
    throwValidation('must contain a single SELECT statement');
  }
  if (masked.includes('--') || masked.includes('/*') || masked.includes('*/')) {
    throwValidation('must not contain comments');
  }

  if (!/^\s*select\b/i.test(masked)) {
    throwValidation('must start with SELECT');
  }
  if (countKeyword(lowerMasked, 'select') !== 1) {
    throwValidation('must contain exactly one SELECT');
  }
  rejectUnsafeKeywords(lowerMasked);

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

  validateTail(tail, maskedTail, scalarColumns);

  const outputColumns = parseProjection(projectionSql, projectionColumns);
  const rowIdSelect = rowIdColumn
    ? [
        `${quoteIdentifier(inputTableName)}.${quoteIdentifier(rowIdColumn)} AS ${quoteIdentifier(rowIdColumn)}`,
      ]
    : [];
  const selectList = [
    ...rowIdSelect,
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

function parseProjection(projectionSql: string, scalarColumns: ReadonlySet<string>): string[] {
  const projection = projectionSql.trim();
  if (projection.length === 0) {
    throwValidation('must include a projection');
  }
  if (projection === '*') {
    return [...scalarColumns];
  }
  if (projection.includes('*')) {
    throwValidation('must use either * or column names');
  }

  const seen = new Set<string>();
  const outputColumns: string[] = [];

  for (const item of splitProjectionItems(projectionSql)) {
    const column = parseProjectionColumn(item);
    if (!scalarColumns.has(column)) {
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
  return splitCommaSeparated(projectionSql);
}

function splitCommaSeparated(value: string): string[] {
  const items: string[] = [];
  let start = 0;
  let inDoubleQuote = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') {
      if (inDoubleQuote && value[index + 1] === '"') {
        index += 1;
      } else {
        inDoubleQuote = !inDoubleQuote;
      }
      continue;
    }
    if (char === ',' && !inDoubleQuote) {
      items.push(value.slice(start, index));
      start = index + 1;
    }
  }

  if (inDoubleQuote) {
    throwValidation('has an unterminated quoted identifier');
  }

  items.push(value.slice(start));
  return items;
}

function parseProjectionColumn(item: string): string {
  const trimmed = item.trim();
  if (trimmed.length === 0) {
    throwValidation('has an empty projection');
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

function validateTail(tail: string, maskedTail: string, scalarColumns: ReadonlySet<string>): void {
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

  const clauses = findTailClauses(maskedTail);
  const whereClause = clauses.find((clause) => clause.kind === 'where');
  const orderClause = clauses.find((clause) => clause.kind === 'order');
  const limitClause = clauses.find((clause) => clause.kind === 'limit');

  if (whereClause) {
    const endIndex = orderClause?.index ?? limitClause?.index ?? tail.length;
    validatePredicate(tail.slice(whereClause.endIndex, endIndex), scalarColumns);
  }
  if (orderClause) {
    const endIndex = limitClause?.index ?? tail.length;
    validateOrderBy(tail.slice(orderClause.endIndex, endIndex), scalarColumns);
  }
  if (limitClause) {
    validateLimit(tail.slice(limitClause.endIndex));
  }
}

function tailClausesAreOrdered(maskedTail: string): boolean {
  const positions = findTailClauses(maskedTail).sort((left, right) => left.index - right.index);
  let lastOrder = -1;

  return positions.every((position) => {
    const order = tailClauseOrder(position.kind);
    if (order <= lastOrder) {
      return false;
    }
    lastOrder = order;
    return true;
  });
}

interface TailClause {
  endIndex: number;
  index: number;
  kind: 'where' | 'order' | 'limit';
}

function findTailClauses(maskedTail: string): TailClause[] {
  const clauses: TailClause[] = [];
  const pattern = /\b(where|order\s+by|limit)\b/gi;
  let match = pattern.exec(maskedTail);

  while (match) {
    clauses.push({
      endIndex: match.index + match[0].length,
      index: match.index,
      kind: tailClauseKind(match[1]),
    });
    match = pattern.exec(maskedTail);
  }

  return clauses;
}

function tailClauseKind(value: string): TailClause['kind'] {
  if (/^order/i.test(value)) {
    return 'order';
  }
  if (/^limit/i.test(value)) {
    return 'limit';
  }
  return 'where';
}

function tailClauseOrder(kind: TailClause['kind']): number {
  if (kind === 'where') {
    return 0;
  }
  if (kind === 'order') {
    return 1;
  }
  return 2;
}

function validatePredicate(predicate: string, scalarColumns: ReadonlySet<string>): void {
  const parts = splitLogicalPredicate(predicate);
  if (parts.length === 0) {
    throwValidation('must include a WHERE predicate');
  }

  for (const part of parts) {
    if (!validateComparisonPredicate(part.trim(), scalarColumns)) {
      throwValidation('has an unsupported WHERE predicate');
    }
  }
}

function splitLogicalPredicate(predicate: string): string[] {
  const masked = maskQuotedSegments(predicate);
  const parts: string[] = [];
  const pattern = /\b(?:and|or)\b/gi;
  let start = 0;
  let match = pattern.exec(masked);

  while (match) {
    parts.push(predicate.slice(start, match.index));
    start = match.index + match[0].length;
    match = pattern.exec(masked);
  }

  parts.push(predicate.slice(start));
  return parts;
}

function validateComparisonPredicate(
  predicate: string,
  scalarColumns: ReadonlySet<string>,
): boolean {
  const masked = maskQuotedSegments(predicate);
  const match = /(?:!=|<>|<=|>=|=|<|>)/.exec(masked);
  if (!match) {
    return false;
  }

  const left = predicate.slice(0, match.index).trim();
  const right = predicate.slice(match.index + match[0].length).trim();
  if (!identifierIsAllowed(left, scalarColumns)) {
    return false;
  }
  if (new RegExp(`^${literalPattern()}$`, 'i').test(right)) {
    return true;
  }
  const rightIdentifier = parseSqlIdentifier(right);
  if (rightIdentifier) {
    return scalarColumns.has(rightIdentifier);
  }

  return false;
}

function validateOrderBy(orderBy: string, scalarColumns: ReadonlySet<string>): void {
  const parts = splitCommaSeparated(orderBy);
  if (parts.length === 0) {
    throwValidation('must include ORDER BY columns');
  }

  for (const part of parts) {
    const trimmed = part.trim();
    const directionMatch = /\b(?:asc|desc)\s*$/i.exec(maskQuotedSegments(trimmed));
    const beforeDirection = directionMatch ? trimmed.slice(0, directionMatch.index) : '';
    const identifier =
      directionMatch && /\s$/.test(beforeDirection) ? beforeDirection.trim() : trimmed;
    if (!identifierIsAllowed(identifier, scalarColumns)) {
      throwValidation('has an unsupported ORDER BY clause');
    }
  }
}

function validateLimit(limit: string): void {
  if (!/^\s*\d+\s*$/.test(limit)) {
    throwValidation('must use a non-negative integer LIMIT');
  }
}

function literalPattern(): string {
  return "(?:\\d+(?:\\.\\d+)?|'(?:[^']|'')*'|true|false|null)";
}

function selectableColumnSet(
  availableColumns: readonly string[],
  opts: {
    allowGeometryProjection: boolean;
    geometryColumn: string;
    rowIdColumn: string | null;
  },
): ReadonlySet<string> {
  return new Set(
    availableColumns.filter((column) => {
      if (opts.rowIdColumn && column === opts.rowIdColumn) return false;
      if (!opts.allowGeometryProjection && column === opts.geometryColumn) return false;
      return true;
    }),
  );
}

function identifierIsAllowed(identifier: string, scalarColumns: ReadonlySet<string>): boolean {
  const column = parseSqlIdentifier(identifier);
  return column !== undefined && scalarColumns.has(column);
}

function parseSqlIdentifier(identifier: string): string | undefined {
  const trimmed = identifier.trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const column = unquoteIdentifier(trimmed);
    if (column.length === 0) {
      return undefined;
    }
    return column;
  }
  return undefined;
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

function countKeyword(sql: string, keyword: string): number {
  return sql.match(new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'g'))?.length ?? 0;
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function throwValidation(message: string): never {
  throw new DuckDbOperationError('validation', `DuckDB query ${message}`, {
    field: 'sql',
  });
}
