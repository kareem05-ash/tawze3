import { Capacitor } from '@capacitor/core';
import type { BackupStore } from '../services/autoBackup';

const DB = 'tawze3-backups', STORE = 'files';
const idb = (): Promise<IDBDatabase> => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const run = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const d = await idb();
  try { return await new Promise<T>((res, rej) => { const t = d.transaction(STORE, mode); const rq = f(t.objectStore(STORE)); t.oncomplete = () => res(rq.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); } finally { d.close(); }
};
export const idbBackupStore: BackupStore = {
  put: async (name, text) => { await run('readwrite', s => s.put(text, name)); },
  list: async () => { const keys = await run('readonly', s => s.getAllKeys()); const out: { name: string; size: number }[] = []; for (const k of keys) { const t = await run<string>('readonly', s => s.get(k) as IDBRequest<string>); out.push({ name: String(k), size: t.length }); } return out; },
  get: async name => (await run<string | undefined>('readonly', s => s.get(name) as IDBRequest<string | undefined>)),
  remove: async name => { await run('readwrite', s => s.delete(name)); },
};

/** Android: files in the app's private data directory (not visible to other apps; removed if the app is uninstalled). */
export const nativeBackupStore: BackupStore = {
  async put(name, text) { const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem'); await Filesystem.writeFile({ path: `backups/${name}`, data: text, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true }); },
  async list() { const { Filesystem, Directory } = await import('@capacitor/filesystem'); try { return (await Filesystem.readdir({ path: 'backups', directory: Directory.Data })).files.map(f => ({ name: f.name, size: f.size ?? 0 })); } catch { return []; } },
  async get(name) { const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem'); try { const r = await Filesystem.readFile({ path: `backups/${name}`, directory: Directory.Data, encoding: Encoding.UTF8 }); return String(r.data); } catch { return undefined; } },
  async remove(name) { const { Filesystem, Directory } = await import('@capacitor/filesystem'); await Filesystem.deleteFile({ path: `backups/${name}`, directory: Directory.Data }); },
};
export const getBackupStore = (): BackupStore => (Capacitor.isNativePlatform() ? nativeBackupStore : idbBackupStore);
