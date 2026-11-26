import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { SqlJsDb } from './helpers/sqljsDb';
import { migrate } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import * as S from '../src/services';
import { idbBackupStore } from '../src/db/backupStores';

class MemStore implements S.BackupStore {
  files = new Map<string, string>(); failNext = false;
  async put(n: string, t: string) { if (this.failNext) { this.failNext = false; throw new Error('disk full'); } this.files.set(n, t); }
  async list() { return [...this.files].map(([name, t]) => ({ name, size: t.length })); }
  async get(n: string) { return this.files.get(n); } async remove(n: string) { this.files.delete(n); }
}
let db: SqlJsDb; let store: MemStore;
beforeEach(async () => { db = await SqlJsDb.open(); await migrate(db, MIGRATIONS); store = new MemStore(); await S.createParty(db, { kind: 'customer', name: 'النور' }); });

describe('automatic daily backup', () => {
  it('runs once per day, writes a restorable file, and records when', async () => {
    expect(await S.runAutoBackupIfDue(db, store, '2026-11-25')).toBe('done');
    expect(await S.runAutoBackupIfDue(db, store, '2026-11-25')).toBe('already-done');
    expect(store.files.size).toBe(1);
    const target = await SqlJsDb.open(); await migrate(target, MIGRATIONS);
    await S.restoreBackup(target, store.files.get('auto-2026-11-25.json')!, async () => {});
    expect((await S.listParties(target)).map(p => p.name)).toEqual(['النور']);
    expect(await S.runAutoBackupIfDue(db, store, '2026-11-26')).toBe('done');
    expect(store.files.size).toBe(2);
  });
  it('keeps only the most recent 7', async () => {
    for (let d = 1; d <= 10; d++) await S.runAutoBackupIfDue(db, store, `2026-11-${String(d).padStart(2, '0')}`);
    expect([...store.files.keys()].sort()[0]).toBe('auto-2026-11-04.json'); expect(store.files.size).toBe(7);
  });
  it('can be switched off, and a failure is recorded without crashing or marking the day done', async () => {
    await S.setAutoBackupEnabled(db, false);
    expect(await S.runAutoBackupIfDue(db, store, '2026-11-25')).toBe('disabled'); expect(store.files.size).toBe(0);
    await S.setAutoBackupEnabled(db, true); store.failNext = true;
    expect(await S.runAutoBackupIfDue(db, store, '2026-11-25')).toBe('failed');
    expect(await S.getSetting(db, 'auto_backup_error')).toContain('disk full');
    expect(await S.runAutoBackupIfDue(db, store, '2026-11-25')).toBe('done'); // retried later the same day
    expect(await S.getSetting(db, 'auto_backup_error')).toBe('');
  });
  it('IndexedDB store: put/list/get/remove', async () => {
    await idbBackupStore.put('a.json', 'hello'); await idbBackupStore.put('b.json', 'world!');
    expect((await idbBackupStore.list()).map(x => x.name).sort()).toEqual(['a.json', 'b.json']);
    expect(await idbBackupStore.get('b.json')).toBe('world!'); await idbBackupStore.remove('a.json');
    expect(await idbBackupStore.get('a.json')).toBeUndefined();
  });
});
