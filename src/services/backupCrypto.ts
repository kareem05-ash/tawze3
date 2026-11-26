import { ServiceError } from './common';

/**
 * Optional passphrase encryption for backup files: AES-256-GCM, key derived with PBKDF2-SHA256 (250k iterations, random salt).
 * GCM authenticates the data, so a wrong passphrase or any tampering fails cleanly. THE PASSPHRASE CANNOT BE RECOVERED:
 * an encrypted backup without its passphrase is unreadable by anyone, including us.
 */
export const ENC_FORMAT = 'tawze3-backup-enc';
export const ENC_ITERATIONS = 250_000;
export interface EncryptedEnvelope { format: typeof ENC_FORMAT; v: 1; iterations: number; salt: string; iv: string; data: string }

const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function key(pass: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export const isEncryptedBackup = (text: string) => { try { return (JSON.parse(text) as { format?: string }).format === ENC_FORMAT; } catch { return false; } };

export async function encryptBackup(plain: string, passphrase: string, iterations = ENC_ITERATIONS): Promise<string> {
  if (passphrase.length < 6) throw new ServiceError('PASSPHRASE_SHORT', 'كلمة سر النسخة يجب ألا تقل عن ٦ أحرف');
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await key(passphrase, salt, iterations), new TextEncoder().encode(plain)));
  const env: EncryptedEnvelope = { format: ENC_FORMAT, v: 1, iterations, salt: b64(salt), iv: b64(iv), data: b64(ct) };
  return JSON.stringify(env);
}
export async function decryptBackup(text: string, passphrase: string): Promise<string> {
  let env: EncryptedEnvelope;
  try { env = JSON.parse(text) as EncryptedEnvelope; } catch { throw new ServiceError('BACKUP_INVALID', 'الملف تالف أو غير مكتمل'); }
  if (env.format !== ENC_FORMAT || !env.salt || !env.iv || !env.data || !(env.iterations >= 1000 && env.iterations <= 5_000_000)) throw new ServiceError('BACKUP_INVALID', 'ملف النسخة المشفّرة غير صالح');
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) as BufferSource }, await key(passphrase, unb64(env.salt), env.iterations), unb64(env.data));
    return new TextDecoder().decode(pt);
  } catch { throw new ServiceError('BACKUP_WRONG_PASSPHRASE', 'كلمة السر غير صحيحة أو أن الملف تالف'); }
}
