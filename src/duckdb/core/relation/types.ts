import type { RelationDuckDbFunction } from '../sql/relation';

export const RELATION_OPERATIONS = {
  intersects: { duckDbFunction: 'ST_Intersects', outputColumn: 'duckdb_intersects' },
  contains: { duckDbFunction: 'ST_Contains', outputColumn: 'duckdb_contains' },
  within: { duckDbFunction: 'ST_Within', outputColumn: 'duckdb_within' },
  touches: { duckDbFunction: 'ST_Touches', outputColumn: 'duckdb_touches' },
  disjoint: { duckDbFunction: 'ST_Disjoint', outputColumn: 'duckdb_disjoint' },
  overlaps: { duckDbFunction: 'ST_Overlaps', outputColumn: 'duckdb_overlaps' },
  equals: { duckDbFunction: 'ST_Equals', outputColumn: 'duckdb_equals' },
  crosses: { duckDbFunction: 'ST_Crosses', outputColumn: 'duckdb_crosses' },
  covers: { duckDbFunction: 'ST_Covers', outputColumn: 'duckdb_covers' },
  coveredBy: { duckDbFunction: 'ST_CoveredBy', outputColumn: 'duckdb_covered_by' },
  containsProperly: {
    duckDbFunction: 'ST_ContainsProperly',
    outputColumn: 'duckdb_contains_properly',
  },
} as const satisfies Record<
  string,
  { duckDbFunction: RelationDuckDbFunction; outputColumn: string }
>;

export type TopologicalRelationOperationId = keyof typeof RELATION_OPERATIONS;
export type RelationOperationId = TopologicalRelationOperationId | 'distance' | 'distanceWithin';

export interface NamedRelationOperation {
  id: RelationOperationId;
  duckDbFunction: RelationDuckDbFunction | 'ST_Distance';
  outputColumn?: string;
  output: 'predicate' | 'distance';
}
