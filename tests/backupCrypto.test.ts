import { describe, it, expect } from 'vitest';
import { SqlJsDb } from './helpers/sqljsDb';
import { migrate } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import * as S from '../src/services';

const IT = 1000;
describe('encrypted backups', () => {
  it('round trip: encrypted file hides the data; correct passphrase restores everything', async () => {
    const db = await SqlJsDb.open(); await migrate(db, MIGRATIONS);
    await S.createParty(db, { kind: 'customer', name: 'عميل سري جداً' });
    const plain = await S.createBackupFile(db);
    expect(plain.encrypted).toBe(false); expect(plain.text).toContain('عميل سري جداً');
    const { text: enc, encrypted } = await S.createBackupFile(db, { passphrase: 'كلمة-سر-قوية' });
    expect(encrypted).toBe(true); expect(S.isEncryptedBackup(enc)).toBe(true);
    expect(enc).not.toContain('عميل'); expect(enc).not.toContain('tawze3-backup"');
    const target = await SqlJsDb.open(); await migrate(target, MIGRATIONS);
    await expect(S.openBackupText(enc)).rejects.toMatchObject({ code: 'BACKUP_NEEDS_PASSPHRASE' });
    await S.restoreBackup(target, await S.openBackupText(enc, 'كلمة-سر-قوية'), async () => {});
    expect((await S.listParties(target)).map(p => p.name)).toEqual(['عميل سري جداً']);
  });
  it('wrong passphrase, tampering and junk are rejected cleanly', async () => {
    const db = await SqlJsDb.open(); await migrate(db, MIGRATIONS);
    const enc = (await S.createBackupFile(db, { passphrase: 'abcdef' })).text;
    await expect(S.openBackupText(enc, 'abcdeg')).rejects.toMatchObject({ code: 'BACKUP_WRONG_PASSPHRASE' });
    const env = JSON.parse(enc); env.data = env.data.slice(0, -4) + 'AAAA';
    await expect(S.openBackupText(JSON.stringify(env), 'abcdef')).rejects.toMatchObject({ code: 'BACKUP_WRONG_PASSPHRASE' });
    await expect(S.openBackupText(JSON.stringify({ ...JSON.parse(enc), iterations: 5 }), 'abcdef')).rejects.toMatchObject({ code: 'BACKUP_INVALID' });
    await expect(S.createBackupFile(db, { passphrase: 'abc' })).rejects.toMatchObject({ code: 'PASSPHRASE_SHORT' });
    expect(S.isEncryptedBackup('not json')).toBe(false);
  });
  it('each encryption uses a fresh salt/iv', async () => {
    const a = JSON.parse(await (await import('../src/services/backupCrypto')).encryptBackup('x', 'abcdef', IT)); const b = JSON.parse(await (await import('../src/services/backupCrypto')).encryptBackup('x', 'abcdef', IT));
    expect(a.salt).not.toBe(b.salt); expect(a.iv).not.toBe(b.iv); expect(a.data).not.toBe(b.data);
  });
});
