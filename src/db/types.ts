/** Minimal DB contract. Services/migrations depend on this, never on a specific SQLite plugin. */
export interface RunResult { changes: number; lastId: number }
export type SqlParam = string | number | null;
export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlParam[]): Promise<RunResult>;
  all<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  /** Runs fn atomically: commits if it resolves, rolls back everything if it throws. Not re-entrant. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}
