import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { Db, RunResult, SqlParam } from './types';

class CapDb implements Db {
  constructor(private conn: SQLiteDBConnection) {}
  async exec(sql: string) { await this.conn.execute(sql, false); }
  async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
    const r = await this.conn.run(sql, params, false);
    return { changes: r.changes?.changes ?? 0, lastId: r.changes?.lastId ?? 0 };
  }
  async all<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    const r = await this.conn.query(sql, params);
    return (r.values ?? []) as T[];
  }
  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    await this.conn.beginTransaction();
    try {
      const out = await fn(this);
      await this.conn.commitTransaction();
      return out;
    } catch (e) {
      try { await this.conn.rollbackTransaction(); } catch { /* keep original error */ }
      throw e;
    }
  }
}

const DB_NAME = 'distributor';

export async function openCapacitorDb(): Promise<Db> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  if (Capacitor.getPlatform() === 'web') {
    // Browser dev mode only: jeep-sqlite stores the DB in IndexedDB. Production data lives in native Android SQLite.
    const { defineCustomElements } = await import('jeep-sqlite/loader');
    defineCustomElements(window);
    if (!document.querySelector('jeep-sqlite')) {
      const el = document.createElement('jeep-sqlite');
      document.body.appendChild(el);
    }
    await customElements.whenDefined('jeep-sqlite');
    await sqlite.initWebStore();
  }
  const consistent = (await sqlite.checkConnectionsConsistency()).result;
  const exists = (await sqlite.isConnection(DB_NAME, false)).result;
  const conn = consistent && exists
    ? await sqlite.retrieveConnection(DB_NAME, false)
    : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
  await conn.open();
  await conn.execute('PRAGMA foreign_keys = ON;', false);
  return new CapDb(conn);
}
