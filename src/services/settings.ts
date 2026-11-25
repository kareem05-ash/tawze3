import type { Db } from '../db/types';
import { one } from './common';
export async function getSetting(db: Db, key: string): Promise<string | undefined> {
  return (await one<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', [key]))?.value;
}
export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.run('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)', [key, value]);
}
