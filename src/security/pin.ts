import type { Db } from '../db/types';
import { ServiceError, one } from '../services/common';
import { setSetting } from '../services/settings';

/**
 * App lock PIN. Only a salted PBKDF2-SHA256 hash is stored (never the PIN). Failed attempts add an increasing delay.
 * This is a privacy barrier for someone holding an unlocked phone, NOT encryption of the database: 4-8 digit PINs cannot resist
 * offline guessing if the data file itself is extracted. The pin_* settings are deliberately excluded from backup files.
 */
export const PIN_ITERATIONS = 150_000;
export const MAX_FREE_ATTEMPTS = 5;
const AR = '٠١٢٣٤٥٦٧٨٩';
export const normalizePin = (raw: string) => raw.replace(/[٠-٩]/g, c => String(AR.indexOf(c))).trim();
export const isValidPin = (raw: string) => /^\d{4,8}$/.test(normalizePin(raw));

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array((s.match(/.{2}/g) ?? []).map(h => parseInt(h, 16)));
export async function hashPin(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256));
}
const safeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

const get = async (db: Db, k: string) => (await one<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', [k]))?.value;
export const hasPin = async (db: Db) => (await get(db, 'pin_hash')) !== undefined;
export async function pinLength(db: Db): Promise<number> { return Number(await get(db, 'pin_len')) || 4; }

export async function setPin(db: Db, rawPin: string, iterations = PIN_ITERATIONS): Promise<void> {
  const pin = normalizePin(rawPin);
  if (!isValidPin(pin)) throw new ServiceError('PIN_INVALID', 'الرمز يجب أن يكون من ٤ إلى ٨ أرقام');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const h = await hashPin(pin, salt, iterations);
  await db.transaction(async tx => {
    await setSetting(tx, 'pin_salt', hex(salt)); await setSetting(tx, 'pin_iter', String(iterations)); await setSetting(tx, 'pin_len', String(pin.length));
    await setSetting(tx, 'pin_fails', '0'); await setSetting(tx, 'pin_lock_until', '0'); await setSetting(tx, 'pin_hash', h);
  });
}

export interface VerifyResult { ok: boolean; lockedUntil?: number; attemptsLeft?: number }
/** Delay after the 5th consecutive failure: 30s, doubling per further failure, capped at 15 minutes. */
export const lockDelayMs = (fails: number) => (fails < MAX_FREE_ATTEMPTS ? 0 : Math.min(15 * 60_000, 30_000 * 2 ** (fails - MAX_FREE_ATTEMPTS)));

export async function verifyPin(db: Db, rawPin: string, now = Date.now()): Promise<VerifyResult> {
  const [h, salt, iter, fails0, until] = await Promise.all(['pin_hash', 'pin_salt', 'pin_iter', 'pin_fails', 'pin_lock_until'].map(k => get(db, k)));
  if (h === undefined || salt === undefined) return { ok: true }; // no PIN set
  if (Number(until) > now) return { ok: false, lockedUntil: Number(until) };
  const ok = safeEqual(await hashPin(normalizePin(rawPin), unhex(salt), Number(iter) || PIN_ITERATIONS), h);
  if (ok) { await setSetting(db, 'pin_fails', '0'); await setSetting(db, 'pin_lock_until', '0'); return { ok: true }; }
  const fails = (Number(fails0) || 0) + 1; const delay = lockDelayMs(fails);
  await setSetting(db, 'pin_fails', String(fails));
  if (delay > 0) { await setSetting(db, 'pin_lock_until', String(now + delay)); return { ok: false, lockedUntil: now + delay }; }
  return { ok: false, attemptsLeft: MAX_FREE_ATTEMPTS - fails };
}

async function requireCurrent(db: Db, current: string) {
  const r = await verifyPin(db, current);
  if (!r.ok) throw new ServiceError('PIN_WRONG', r.lockedUntil ? 'تم إيقاف المحاولات مؤقتاً' : 'الرمز الحالي غير صحيح');
}
export async function changePin(db: Db, current: string, next: string, iterations = PIN_ITERATIONS) { await requireCurrent(db, current); await setPin(db, next, iterations); }
export async function disablePin(db: Db, current: string) {
  await requireCurrent(db, current);
  await db.run("DELETE FROM settings WHERE key LIKE 'pin\\_%' ESCAPE '\\'");
}
