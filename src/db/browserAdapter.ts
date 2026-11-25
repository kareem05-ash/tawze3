import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { Db } from './types';
import { SqlJsDb } from './sqljsAdapter';
import { loadBytes, saveBytes } from './browserStore';

export async function openBrowserDb(): Promise<Db> {
  const db = await SqlJsDb.open(await loadBytes(), { locateFile: () => wasmUrl, persist: saveBytes });
  const flush = () => { void db.flush(); };
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  return db;
}
