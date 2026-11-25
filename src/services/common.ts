import type { Db, SqlParam } from '../db/types';

export class ServiceError extends Error {
  constructor(public readonly code: string, message: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ServiceError';
  }
}

export async function one<T>(db: Db, sql: string, params: SqlParam[] = []): Promise<T | undefined> {
  return (await db.all<T>(sql, params))[0];
}

export function assertIsoDate(d: unknown, label = 'التاريخ'): asserts d is string {
  const bad = () => new ServiceError('INVALID_DATE', `${label} غير صالح`);
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw bad();
  const dt = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== d) throw bad();
}

export function assertInt(n: unknown, label: string, opts: { min?: number } = {}): asserts n is number {
  if (typeof n !== 'number' || !Number.isInteger(n)) throw new ServiceError('INVALID_NUMBER', `${label} غير صالح`);
  if (opts.min !== undefined && n < opts.min) throw new ServiceError('INVALID_NUMBER', `${label} غير صالح`);
}

export function requireText(v: unknown, label: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new ServiceError('REQUIRED', `${label} مطلوب`);
  return s;
}

/** Human-readable sequential reference (S-000001). Runs inside the caller's transaction, so a rollback also rolls back the counter. */
export async function nextRef(tx: Db, prefix: string): Promise<string> {
  const key = `seq:${prefix}`;
  const r = await one<{ value: string }>(tx, 'SELECT value FROM settings WHERE key = ?', [key]);
  const n = (r ? Number(r.value) : 0) + 1;
  await tx.run('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)', [key, String(n)]);
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

export const escapeLike = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);
