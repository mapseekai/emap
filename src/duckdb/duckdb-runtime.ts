import type { Table } from 'apache-arrow';

export interface DuckDbConnection {
  insertArrowTable(table: Table, opts: { name: string }): Promise<void>;
  query(sql: string): Promise<Table>;
  close?(): Promise<void>;
}

export interface DuckDbRuntime {
  connect(): Promise<DuckDbConnection>;
  ensureSpatial(): Promise<void>;
  close?(): Promise<void>;
}

let injectedRuntime: DuckDbRuntime | null = null;

export function setDuckDbRuntime(runtime: DuckDbRuntime | null): void {
  injectedRuntime = runtime;
}

export function getDuckDbRuntime(): DuckDbRuntime | null {
  return injectedRuntime;
}
