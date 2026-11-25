import { Capacitor } from '@capacitor/core';
import type { Db } from './types';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';

export interface OpenedDb { db: Db; version: number }
let pending: Promise<OpenedDb> | undefined;

async function openRaw(): Promise<Db> {
  if (Capacitor.isNativePlatform()) return (await import('./capacitorAdapter')).openCapacitorDb();
  return (await import('./browserAdapter')).openBrowserDb();
}
const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('انتهت مهلة فتح قاعدة البيانات')), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); });

/** Opens + migrates exactly once, even if React StrictMode runs effects twice. Retry after failure is allowed. */
export function initDb(): Promise<OpenedDb> {
  if (!pending) {
    pending = withTimeout((async () => { const db = await openRaw(); return { db, version: await migrate(db, MIGRATIONS) }; })(), 20000);
    pending.catch(() => { pending = undefined; });
  }
  return pending;
}
