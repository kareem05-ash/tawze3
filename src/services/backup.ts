import type { Db, SqlParam } from '../db/types';
import { LATEST_VERSION } from '../db/migrations';
import { ServiceError, one } from './common';
import { setSetting } from './settings';

export const BACKUP_FORMAT = 'tawze3-backup';
type TableDump = { columns: string[]; rows: SqlParam[][] };
export interface BackupFile { format: string; schemaVersion: number; createdAt: string; checksum: string; data: Record<string, TableDump> }
export interface BackupSummary { createdAt: string; schemaVersion: number; counts: Record<string, number> }

const EXCLUDED = new Set(['schema_migrations']); // migration history belongs to the installed app, not to the data

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
async function tableNames(db: Db): Promise<string[]> {
  return (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map(r => r.name).filter(n => !EXCLUDED.has(n));
}

/** Complete, integrity-checked snapshot of all business records and settings as JSON text. */
export async function createBackup(db: Db, now = new Date()): Promise<{ text: string; summary: BackupSummary }> {
  const data: Record<string, TableDump> = {};
  for (const t of await tableNames(db)) {
    const info = await db.all<{ name: string }>(`PRAGMA table_info(${q(t)})`);
    const columns = info.map(c => c.name);
    const rows = (await db.all<Record<string, SqlParam>>(`SELECT * FROM ${q(t)} ORDER BY rowid`)).filter(r => !(t === 'settings' && String(r.key).startsWith('pin_'))); // the app-lock PIN never leaves the device
    data[t] = { columns, rows: rows.map(r => columns.map(c => r[c] ?? null)) };
  }
  const createdAt = now.toISOString();
  const file: BackupFile = { format: BACKUP_FORMAT, schemaVersion: LATEST_VERSION, createdAt, checksum: await sha256Hex(JSON.stringify(data)), data };
  return { text: JSON.stringify(file), summary: summarize(file) };
}
const summarize = (f: BackupFile): BackupSummary => ({ createdAt: f.createdAt, schemaVersion: f.schemaVersion, counts: Object.fromEntries(Object.entries(f.data).map(([k, v]) => [k, v.rows.length])) });

const bad = (msg: string) => new ServiceError('BACKUP_INVALID', msg);
/** Never touches the database. Rejects corrupt, truncated, tampered, foreign or too-new files. */
export async function validateBackup(db: Db, text: string): Promise<{ file: BackupFile; summary: BackupSummary }> {
  let f: BackupFile;
  try { f = JSON.parse(text) as BackupFile; } catch { throw bad('الملف تالف أو غير مكتمل'); }
  if (!f || f.format !== BACKUP_FORMAT || typeof f.data !== 'object' || f.data === null || typeof f.checksum !== 'string') throw bad('هذا ليس ملف نسخة احتياطية صالحاً لهذا التطبيق');
  if (!Number.isInteger(f.schemaVersion) || f.schemaVersion < 1) throw bad('إصدار النسخة غير معروف');
  if (f.schemaVersion > LATEST_VERSION) throw bad('النسخة من إصدار أحدث من التطبيق. حدّث التطبيق أولاً.');
  if ((await sha256Hex(JSON.stringify(f.data))) !== f.checksum) throw bad('فشل فحص سلامة الملف: البيانات تالفة أو تم تعديلها');
  const known = new Set(await tableNames(db));
  for (const [t, d] of Object.entries(f.data)) {
    if (!known.has(t)) throw bad(`جدول غير معروف في النسخة: ${t}`);
    if (!Array.isArray(d.columns) || !Array.isArray(d.rows)) throw bad('بنية النسخة غير صالحة');
    const cols = new Set((await db.all<{ name: string }>(`PRAGMA table_info(${q(t)})`)).map(c => c.name));
    if (d.columns.some(c => !cols.has(c))) throw bad(`أعمدة غير معروفة في الجدول ${t}`);
    if (d.rows.some(r => !Array.isArray(r) || r.length !== d.columns.length)) throw bad('صفوف غير مكتملة في النسخة');
  }
  return { file: f, summary: summarize(f) };
}

/** Parents before children, derived from the live schema's foreign keys. */
async function dependencyOrder(db: Db, tables: string[]): Promise<string[]> {
  const deps = new Map<string, Set<string>>();
  for (const t of tables) deps.set(t, new Set((await db.all<{ table: string }>(`PRAGMA foreign_key_list(${q(t)})`)).map(r => r.table).filter(x => x !== t && tables.includes(x))));
  const out: string[] = []; const seen = new Set<string>();
  const visit = (t: string) => { if (seen.has(t)) return; seen.add(t); for (const d of deps.get(t) ?? []) visit(d); out.push(t); };
  tables.forEach(visit);
  return out;
}

/**
 * Replaces ALL current data with the backup, atomically. The caller-supplied `saveSafetyCopy` receives a full backup of the
 * current data FIRST; if it fails, nothing is changed. If anything fails mid-restore, the transaction rolls back.
 */
export async function restoreBackup(db: Db, text: string, saveSafetyCopy: (currentBackupText: string) => Promise<void>): Promise<BackupSummary> {
  const { file, summary } = await validateBackup(db, text);
  const safety = await createBackup(db);
  try { await saveSafetyCopy(safety.text); } catch (e) { throw new ServiceError('SAFETY_COPY_FAILED', 'تعذّر حفظ نسخة أمان من البيانات الحالية، لم يتم أي تغيير', { cause: String(e) }); }
  const tables = await dependencyOrder(db, await tableNames(db));
  const keepPin = await db.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key LIKE 'pin\\_%' ESCAPE '\\'");
  await db.transaction(async tx => {
    for (const t of [...tables].reverse()) await tx.run(`DELETE FROM ${q(t)}`);
    for (const t of tables) {
      const d = file.data[t]; if (!d || d.rows.length === 0) continue;
      const sql = `INSERT INTO ${q(t)}(${d.columns.map(q).join(',')}) VALUES (${d.columns.map(() => '?').join(',')})`;
      for (const r of d.rows) await tx.run(sql, r);
    }
    for (const k of keepPin) await tx.run('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)', [k.key, k.value]); // restoring data must not remove or change the lock
  });
  return summary;
}

export async function markBackupDone(db: Db, when = new Date()) { await setSetting(db, 'last_backup_at', when.toISOString()); }
export async function lastBackupAt(db: Db): Promise<string | undefined> { return (await one<{ value: string }>(db, "SELECT value FROM settings WHERE key = 'last_backup_at'"))?.value; }
