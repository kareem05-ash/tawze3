import { describe, it, expect, beforeEach } from 'vitest';
import { SqlJsDb } from './helpers/sqljsDb';
import { migrate } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import * as P from '../src/security/pin';
import * as S from '../src/services';

let db: SqlJsDb; const IT = 1000; // fast iterations for tests; production uses PIN_ITERATIONS
beforeEach(async () => { db = await SqlJsDb.open(); await migrate(db, MIGRATIONS); });

describe('app lock PIN', () => {
  it('never stores the PIN; stores a salted hash, with a fresh salt each time', async () => {
    expect(await P.hasPin(db)).toBe(false);
    await P.setPin(db, '123456', IT);
    const rows = await db.all<{ key: string; value: string }>("SELECT * FROM settings WHERE key LIKE 'pin\\_%' ESCAPE '\\'");
    expect(rows.some(r => r.value === '123456')).toBe(false);
    expect(JSON.stringify(rows)).not.toContain('123456');
    const h1 = rows.find(r => r.key === 'pin_hash')!.value; const s1 = rows.find(r => r.key === 'pin_salt')!.value;
    await P.setPin(db, '123456', IT);
    expect((await db.all<{ value: string }>("SELECT value FROM settings WHERE key = 'pin_salt'"))[0]!.value).not.toBe(s1);
    expect((await db.all<{ value: string }>("SELECT value FROM settings WHERE key = 'pin_hash'"))[0]!.value).not.toBe(h1);
    expect(await P.pinLength(db)).toBe(6);
  });
  it('accepts the right PIN (Arabic digits too) and rejects wrong ones', async () => {
    await P.setPin(db, '2468', IT);
    expect((await P.verifyPin(db, '2468')).ok).toBe(true);
    expect((await P.verifyPin(db, '٢٤٦٨')).ok).toBe(true);
    expect((await P.verifyPin(db, '1111'))).toMatchObject({ ok: false, attemptsLeft: 4 });
  });
  it('validates PIN format', async () => {
    for (const bad of ['123', '123456789', 'abcd', '12 34', '']) await expect(P.setPin(db, bad, IT)).rejects.toMatchObject({ code: 'PIN_INVALID' });
    expect(P.isValidPin('٠٠٠٠')).toBe(true);
  });
  it('locks out with an increasing delay after 5 failures, even for the right PIN, then recovers', async () => {
    await P.setPin(db, '2468', IT); const t0 = 1_000_000;
    for (let i = 1; i <= 4; i++) expect((await P.verifyPin(db, '0000', t0))).toMatchObject({ ok: false, attemptsLeft: 5 - i });
    const r5 = await P.verifyPin(db, '0000', t0);
    expect(r5).toEqual({ ok: false, lockedUntil: t0 + 30_000 });
    expect(await P.verifyPin(db, '2468', t0 + 1000)).toEqual({ ok: false, lockedUntil: t0 + 30_000 }); // correct PIN refused while locked
    expect((await P.verifyPin(db, '2468', t0 + 30_001)).ok).toBe(true);
    expect(await P.verifyPin(db, '2468', t0 + 30_002)).toEqual({ ok: true });
    expect(P.lockDelayMs(6)).toBe(60_000); expect(P.lockDelayMs(30)).toBe(15 * 60_000); expect(P.lockDelayMs(2)).toBe(0);
  });
  it('failure counter resets after a success', async () => {
    await P.setPin(db, '2468', IT);
    await P.verifyPin(db, '0000'); await P.verifyPin(db, '0000'); await P.verifyPin(db, '2468');
    expect(await P.verifyPin(db, '0000')).toMatchObject({ attemptsLeft: 4 });
  });
  it('changing or disabling needs the current PIN', async () => {
    await P.setPin(db, '2468', IT);
    await expect(P.changePin(db, '9999', '1357', IT)).rejects.toMatchObject({ code: 'PIN_WRONG' });
    await P.changePin(db, '2468', '1357', IT);
    expect((await P.verifyPin(db, '1357')).ok).toBe(true); expect((await P.verifyPin(db, '2468')).ok).toBe(false);
    await expect(P.disablePin(db, '0000')).rejects.toMatchObject({ code: 'PIN_WRONG' });
    await P.disablePin(db, '1357');
    expect(await P.hasPin(db)).toBe(false);
    expect(await db.all("SELECT 1 FROM settings WHERE key LIKE 'pin\\_%' ESCAPE '\\'")).toHaveLength(0);
  });
});

describe('PIN and backups', () => {
  it('backup files never contain the PIN data, and restoring keeps the current lock', async () => {
    await S.setSetting(db, 'business_name', 'توزيع');
    await P.setPin(db, '2468', IT);
    const { text } = await S.createBackup(db);
    expect(text).not.toContain('pin_'); expect(text).toContain('business_name');
    await S.setSetting(db, 'business_name', 'تغيّر');
    await S.restoreBackup(db, text, async () => {});
    expect(await S.getSetting(db, 'business_name')).toBe('توزيع');
    expect(await P.hasPin(db)).toBe(true); expect((await P.verifyPin(db, '2468')).ok).toBe(true);
  });
});
