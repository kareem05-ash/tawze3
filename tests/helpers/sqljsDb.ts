import initSqlJs, { type Database } from 'sql.js';
import type { Db, RunResult, SqlParam } from '../../src/db/types';

/** Test adapter implementing the same Db contract as the Capacitor adapter (real SQLite engine, WASM). */
export class SqlJsDb implements Db {
  constructor(public raw: Database) {}
  static async open(bytes?: Uint8Array): Promise<SqlJsDb> {
    const SQL = await initSqlJs();
    const d = new SqlJsDb(bytes ? new SQL.Database(bytes) : new SQL.Database());
    d.raw.exec('PRAGMA foreign_keys = ON;');
    return d;
  }
  export(): Uint8Array { return this.raw.export(); }
  async exec(sql: string) { this.raw.exec(sql); }
  async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
    this.raw.run(sql, params);
    const id = this.raw.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0];
    return { changes: this.raw.getRowsModified(), lastId: Number(id ?? 0) };
  }
  async all<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    const st = this.raw.prepare(sql); st.bind(params);
    const out: T[] = [];
    while (st.step()) out.push(st.getAsObject() as T);
    st.free();
    return out;
  }
  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    this.raw.exec('BEGIN');
    try { const r = await fn(this); this.raw.exec('COMMIT'); return r; }
    catch (e) { this.raw.exec('ROLLBACK'); throw e; }
  }
}
