import type { Db } from '../db/types';
import { createBackup } from './backup';
import { getSetting, setSetting } from './settings';

/** Where automatic backups live. Browser dev: IndexedDB. Android: app-private storage (see db/backupStores.ts). */
export interface BackupStore {
  put(name: string, text: string): Promise<void>;
  list(): Promise<{ name: string; size: number }[]>;
  get(name: string): Promise<string | undefined>;
  remove(name: string): Promise<void>;
}
export const AUTO_KEEP = 7;
export type AutoResult = 'disabled' | 'already-done' | 'done' | 'failed';

export const autoBackupEnabled = async (db: Db) => (await getSetting(db, 'auto_backup')) !== 'off';
export const setAutoBackupEnabled = (db: Db, on: boolean) => setSetting(db, 'auto_backup', on ? 'on' : 'off');

/**
 * At most one automatic backup per calendar day, attempted whenever the app is open (start, resume, hourly).
 * Android does not guarantee background execution when the app is closed, so a day is only covered if the app is opened that day.
 * These copies stay on the phone: they protect against mistakes and data corruption, NOT against losing the phone.
 */
export async function runAutoBackupIfDue(db: Db, store: BackupStore, today: string, now = new Date(), keep = AUTO_KEEP): Promise<AutoResult> {
  if (!(await autoBackupEnabled(db))) return 'disabled';
  if ((await getSetting(db, 'last_auto_backup_date')) === today) return 'already-done';
  try {
    const { text } = await createBackup(db, now);
    await store.put(`auto-${today}.json`, text);
    await setSetting(db, 'last_auto_backup_date', today); await setSetting(db, 'last_auto_backup_at', now.toISOString()); await setSetting(db, 'auto_backup_error', '');
    const names = (await store.list()).map(x => x.name).filter(n => /^auto-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().reverse();
    for (const n of names.slice(keep)) await store.remove(n);
    return 'done';
  } catch (e) {
    await setSetting(db, 'auto_backup_error', e instanceof Error ? e.message : String(e)).catch(() => {});
    return 'failed';
  }
}
