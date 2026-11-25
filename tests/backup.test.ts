import { describe, it, expect, beforeEach } from 'vitest';
import { SqlJsDb } from './helpers/sqljsDb';
import { migrate } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import * as S from '../src/services';

const D = '2026-11-20';
let db: SqlJsDb; let prod: number; let cust: number; let supp: number; let piece: number;
async function fresh() { const d = await SqlJsDb.open(); await migrate(d, MIGRATIONS); return d; }
async function seed() {
  piece = await S.createUnit(db, 'قطعة');
  prod = await S.createProduct(db, { name: 'شيبسي', baseUnitId: piece, buyPrice: 500, sellPrice: 700, lowStockMilli: 0 });
  cust = await S.createParty(db, { kind: 'customer', name: 'النور', openingBalance: 1000, openingDate: '2026-01-01' });
  supp = await S.createParty(db, { kind: 'supplier', name: 'الأمل' });
  await S.postInvoice(db, { kind: 'purchase', partyId: supp, date: D, paidNow: 10000, lines: [{ productId: prod, unitId: piece, qtyMilli: 100000, unitPrice: 500 }] });
  const s = await S.postInvoice(db, { kind: 'sale', partyId: cust, date: D, paidNow: 3000, lines: [{ productId: prod, unitId: piece, qtyMilli: 10000, unitPrice: 700 }] });
  const line = (await S.getInvoiceDetail(db, s.id))!.lines[0]!.id as number;
  await S.postReturn(db, { invoiceId: s.id, date: D, lines: [{ invoiceLineId: line, qtyMilli: 2000 }] });
  await S.setSetting(db, 'business_name', 'توزيع الأمل');
}
const snapshot = async (d: SqlJsDb) => ({ stock: await S.getStock(d, prod), c: await S.getPartyBalance(d, cust), s: await S.getPartyBalance(d, supp), cash: await S.cashTotals(d, D, D), settings: await S.getSetting(d, 'business_name') });
beforeEach(async () => { db = await fresh(); await seed(); });

describe('backup & restore', () => {
  it('round trip into an empty database reproduces records, balances and settings', async () => {
    const before = await snapshot(db);
    const { text, summary } = await S.createBackup(db);
    expect(summary.counts.invoices).toBe(2);
    const target = await fresh();
    await S.restoreBackup(target, text, async () => {});
    expect(await snapshot(target)).toEqual(before);
    expect((await S.listInvoices(target, {})).length).toBe(2);
    // numbering continues without clashing
    const next = await S.postInvoice(target, { kind: 'sale', partyId: cust, date: D, lines: [{ productId: prod, unitId: piece, qtyMilli: 1000, unitPrice: 700 }] });
    expect(next.ref).toBe('S-000002');
  });
  it('restoring over existing data replaces it and hands over a safety copy of the current data first', async () => {
    const { text } = await S.createBackup(db);
    await S.createParty(db, { kind: 'customer', name: 'عميل جديد بعد النسخة' });
    let safety = '';
    await S.restoreBackup(db, text, async t => { safety = t; });
    expect((await S.listParties(db)).map(p => p.name)).not.toContain('عميل جديد بعد النسخة');
    const safe = await S.validateBackup(await fresh(), safety);
    expect(safe.summary.counts.parties).toBe(3);
  });
  it('aborts without any change when the safety copy cannot be saved', async () => {
    const { text } = await S.createBackup(db);
    await S.createParty(db, { kind: 'customer', name: 'لن يُحذف' });
    await expect(S.restoreBackup(db, text, async () => { throw new Error('disk full'); })).rejects.toMatchObject({ code: 'SAFETY_COPY_FAILED' });
    expect((await S.listParties(db)).map(p => p.name)).toContain('لن يُحذف');
  });
  it('rejects corrupt, truncated, tampered, foreign and too-new files and leaves data untouched', async () => {
    const { text } = await S.createBackup(db);
    const before = await snapshot(db);
    const tampered = JSON.parse(text); tampered.data.ledger_entries.rows[0][2] = 999999;
    const tooNew = JSON.parse(text); tooNew.schemaVersion = 999;
    const unknownTable = JSON.parse(text); unknownTable.data.evil = { columns: ['a'], rows: [] };
    for (const bad of [text.slice(0, text.length / 2), '{"hello":1}', 'not json', JSON.stringify(tampered), JSON.stringify(tooNew), JSON.stringify(unknownTable)]) {
      await expect(S.restoreBackup(db, bad, async () => {})).rejects.toMatchObject({ code: 'BACKUP_INVALID' });
    }
    expect(await snapshot(db)).toEqual(before);
  });
  it('a backup from an older schema (v1) restores into the current schema', async () => {
    const old = await SqlJsDb.open(); await migrate(old, MIGRATIONS.slice(0, 1));
    await old.run("INSERT INTO units(name) VALUES ('قطعة')"); await old.run("INSERT INTO parties(kind,name) VALUES ('customer','قديم')");
    // hand-build a v1 backup (no v2 columns) with a valid checksum
    const data = { units: { columns: ['id', 'name'], rows: [[1, 'قطعة']] }, parties: { columns: ['id', 'kind', 'name', 'phone', 'address', 'notes', 'archived'], rows: [[1, 'customer', 'قديم', null, null, null, 0]] } };
    const sum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data))))].map(b => b.toString(16).padStart(2, '0')).join('');
    const v1 = JSON.stringify({ format: S.BACKUP_FORMAT, schemaVersion: 1, createdAt: '2026-01-01T00:00:00Z', checksum: sum, data });
    await S.restoreBackup(db, v1, async () => {});
    expect((await S.listParties(db)).map(p => p.name)).toEqual(['قديم']);
    expect(await S.listProducts(db)).toHaveLength(0);
  });
  it('failure mid-restore rolls everything back', async () => {
    const { text } = await S.createBackup(db);
    const broken = JSON.parse(text);
    broken.data.invoice_lines.rows[0][1] = 424242; // dangling invoice_id -> FK violation at insert
    broken.checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(broken.data))))].map(b => b.toString(16).padStart(2, '0')).join('');
    const before = await snapshot(db);
    await expect(S.restoreBackup(db, JSON.stringify(broken), async () => {})).rejects.toThrow();
    expect(await snapshot(db)).toEqual(before);
  });
  it('records the last successful backup time', async () => {
    expect(await S.lastBackupAt(db)).toBeUndefined();
    await S.markBackupDone(db, new Date('2026-11-25T10:00:00Z'));
    expect(await S.lastBackupAt(db)).toBe('2026-11-25T10:00:00.000Z');
  });
});
