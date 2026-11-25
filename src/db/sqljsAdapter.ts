import initSqlJs, { type Database } from 'sql.js';
import type { Db, RunResult, SqlParam } from './types';

export interface SqlJsOptions {
  locateFile?: (file: string) => string;
  /** Provide the wasm bytes directly (used by UI tests running in jsdom). */
  wasmBinary?: ArrayBuffer;
  /** Called (debounced, never mid-transaction) with the full database bytes whenever data changed. */
  persist?: (bytes: Uint8Array) => Promise<void>;
  persistDelayMs?: number;
}

/** SQLite (WASM) adapter used for browser dev mode and tests. Same Db contract as the native Capacitor adapter. */
export class SqlJsDb implements Db {
  private inTx = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  private constructor(private raw: Database, private opts: SqlJsOptions) {}

  static async open(bytes?: Uint8Array, opts: SqlJsOptions = {}): Promise<SqlJsDb> {
    const SQL = await initSqlJs({ ...(opts.locateFile ? { locateFile: opts.locateFile } : {}), ...(opts.wasmBinary ? { wasmBinary: opts.wasmBinary } : {}) });
    const d = new SqlJsDb(bytes ? new SQL.Database(bytes) : new SQL.Database(), opts);
    d.raw.exec('PRAGMA foreign_keys = ON;');
    return d;
  }

  /** Snapshot of the whole database. sql.js resets PRAGMAs on export, so foreign keys are switched back on. */
  export(): Uint8Array {
    const bytes = this.raw.export();
    this.raw.exec('PRAGMA foreign_keys = ON;');
    return bytes;
  }

  private markDirty() {
    if (!this.opts.persist) return;
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, this.opts.persistDelayMs ?? 250);
  }

  /** Writes pending changes now (also call on page hide). Deferred while a transaction is open. */
  async flush(): Promise<void> {
    if (!this.opts.persist || !this.dirty) return;
    if (this.inTx) { this.markDirty(); return; }
    this.dirty = false;
    await this.opts.persist(this.export());
  }

  async exec(sql: string) { this.raw.exec(sql); this.markDirty(); }
  async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
    this.raw.run(sql, params);
    const id = this.raw.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0];
    this.markDirty();
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
    if (this.inTx) throw new Error('Nested transactions are not supported');
    this.raw.exec('BEGIN');
    this.inTx = true;
    try {
      const r = await fn(this);
      this.raw.exec('COMMIT');
      this.inTx = false;
      this.markDirty();
      return r;
    } catch (e) {
      try { this.raw.exec('ROLLBACK'); } catch { /* ignore */ }
      this.inTx = false;
      throw e;
    }
  }
}
