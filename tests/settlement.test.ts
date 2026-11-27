import { describe, it, expect, beforeEach } from 'vitest';
import { SqlJsDb } from './helpers/sqljsDb';
import { migrate } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import * as S from '../src/services';
import { allocateFifo } from '../src/domain/payments';

let db: SqlJsDb; let piece: number; let prod: number; let cust: number; let supp: number;
const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}`;
async function setup() {
  db = await SqlJsDb.open(); await migrate(db, MIGRATIONS);
  piece = await S.createUnit(db, 'قطعة');
  prod = await S.createProduct(db, { name: 'صنف', baseUnitId: piece, buyPrice: 100, sellPrice: 150, lowStockMilli: 0 });
  cust = await S.createParty(db, { kind: 'customer', name: 'العميل س' });
  supp = await S.createParty(db, { kind: 'supplier', name: 'المورد ص' });
  await S.postInvoice(db, { kind: 'purchase', partyId: supp, date: '2026-10-01', lines: [{ productId: prod, unitId: piece, qtyMilli: 100_000_000, unitPrice: 100 }] });
}
/** a sale of exactly `amount` piasters (1 piece at that price) */
const sale = (amount: number, date = day(1), party = cust, paid = 0) => S.postInvoice(db, { kind: 'sale', partyId: party, date, paidNow: paid, lines: [{ productId: prod, unitId: piece, qtyMilli: 1000, unitPrice: amount }] });
const buy = (amount: number, date = day(1), paid = 0, party = supp) => S.postInvoice(db, { kind: 'purchase', partyId: party, date, paidNow: paid, lines: [{ productId: prod, unitId: piece, qtyMilli: 1000, unitPrice: amount }] });
const out = async (id: number) => (await S.getInvoiceState(db, id))!.outstanding;
beforeEach(setup);

describe('domain: allocateFifo', () => {
  it('fills oldest first and reports leftover', () => {
    expect(allocateFifo([{ key: 'a', outstanding: 150 }, { key: 'b', outstanding: 150 }], 200)).toEqual({ applied: [{ key: 'a', amount: 150 }, { key: 'b', amount: 50 }], leftover: 0 });
    expect(allocateFifo([{ key: 'a', outstanding: 150 }], 400)).toEqual({ applied: [{ key: 'a', amount: 150 }], leftover: 250 });
    expect(allocateFifo([], 100)).toEqual({ applied: [], leftover: 100 });
  });
});

describe('payments cover the oldest bill first', () => {
  it('the owner\'s example: two 150 invoices, customer pays 200 -> oldest paid, newest shows 100', async () => {
    const a = await sale(15000, day(1)); const b = await sale(15000, day(2));
    const r = await S.recordPayment(db, { partyId: cust, amount: 20000, date: day(3) });
    expect(r).toMatchObject({ appliedToInvoices: 20000, advance: 0 });
    expect(await out(a.id)).toBe(0); expect(await out(b.id)).toBe(10000);
    expect(await S.getPartyBalance(db, cust)).toBe(10000);
  });
  it('a smaller payment only dents the oldest; later payments continue', async () => {
    const a = await sale(15000, day(1)); const b = await sale(15000, day(2));
    await S.recordPayment(db, { partyId: cust, amount: 10000, date: day(3) });
    expect([await out(a.id), await out(b.id)]).toEqual([5000, 15000]);
    await S.recordPayment(db, { partyId: cust, amount: 7000, date: day(4) });
    expect([await out(a.id), await out(b.id)]).toEqual([0, 13000]);
  });
  it('same for suppliers', async () => {
    const s2 = await S.createParty(db, { kind: 'supplier', name: 'مورد جديد' });
    const a = await buy(15000, day(1), 0, s2); const b = await buy(15000, day(2), 0, s2);
    await S.recordPayment(db, { partyId: s2, amount: 20000, date: day(3) });
    expect([await out(a.id), await out(b.id)]).toEqual([0, 10000]);
    expect(await S.getPartyBalance(db, s2)).toBe(-10000);
    expect((await S.cashTotals(db, day(3), day(3))).paid).toBe(20000);
  });
  it('ordering is by invoice date, not by when it was entered', async () => {
    const newer = await sale(15000, day(9)); const older = await sale(15000, day(2));
    await S.recordPayment(db, { partyId: cust, amount: 15000, date: day(10) });
    expect(await out(older.id)).toBe(0); expect(await out(newer.id)).toBe(15000);
  });
  it('the carried-in opening balance is the oldest bill', async () => {
    const c = await S.createParty(db, { kind: 'customer', name: 'عليه رصيد سابق', openingBalance: 10000, openingDate: day(20) });
    const inv = await sale(15000, day(1), c);
    const r = await S.recordPayment(db, { partyId: c, amount: 12000, date: day(21) });
    expect(r).toMatchObject({ appliedToOpening: 10000, appliedToInvoices: 2000, advance: 0 });
    expect(await S.openingOutstanding(db, c)).toBe(0); expect(await out(inv.id)).toBe(13000);
    expect(await S.getPartyBalance(db, c)).toBe(13000);
  });
  it('choosing an invoice pays it first, the rest continues oldest-first', async () => {
    const a = await sale(15000, day(1)); const b = await sale(15000, day(2));
    await S.recordPayment(db, { partyId: cust, amount: 20000, date: day(3), invoiceId: b.id });
    expect([await out(a.id), await out(b.id)]).toEqual([10000, 0]);
  });
  it('more than owed is kept as credit and absorbed by the next invoice automatically', async () => {
    const a = await sale(15000, day(1));
    const r = await S.recordPayment(db, { partyId: cust, amount: 20000, date: day(2) });
    expect(r).toMatchObject({ appliedToInvoices: 15000, advance: 5000 });
    expect(await S.getPartyBalance(db, cust)).toBe(-5000); expect(await out(a.id)).toBe(0);
    const n = await sale(15000, day(3));
    expect(await out(n.id)).toBe(10000);
    expect(await S.getPartyBalance(db, cust)).toBe(10000); expect(await S.poolCredit(db, cust)).toBe(0);
  });
  it('an overpayment made while posting an invoice pays older bills too', async () => {
    const old = await sale(15000, day(1));
    const n = await sale(10000, day(2), cust, 12000);          // pays the new 100 and 20 more
    expect(await out(n.id)).toBe(0); expect(await out(old.id)).toBe(13000);
    expect(await S.getPartyBalance(db, cust)).toBe(13000);
  });
  it('previewPayment describes what will happen without saving anything', async () => {
    const a = await sale(15000, day(1)); const b = await sale(15000, day(2));
    const p = await S.previewPayment(db, cust, 20000);
    expect(p.totalDue).toBe(30000); expect(p.advance).toBe(0);
    expect(p.lines.map(l => [l.ref, l.applied, l.remainingAfter, l.fullyPaid])).toEqual([[a.ref, 15000, 0, true], [b.ref, 5000, 10000, false]]);
    expect((await S.previewPayment(db, cust, 40000)).advance).toBe(10000);
    expect(await S.getPartyBalance(db, cust)).toBe(30000);
  });
});

describe('returns and cancellations keep the bills consistent', () => {
  it('a return on a paid invoice frees money that pays the next bill', async () => {
    const a = await sale(15000, day(1), cust, 15000); const b = await sale(15000, day(2));
    const line = (await S.getInvoiceDetail(db, a.id))!.lines[0]!.id as number;
    // return 1/3 of invoice A (value 50) -> A is overpaid by 50 -> flows to B
    await S.postReturn(db, { invoiceId: a.id, date: day(3), lines: [{ invoiceLineId: line, qtyMilli: 333 }] });
    const ret = (await S.getInvoiceState(db, a.id))!.returned;
    expect(await out(a.id)).toBe(0); expect(await out(b.id)).toBe(15000 - ret);
    expect(await S.getPartyBalance(db, cust)).toBe(15000 - ret);
  });
  it('cancelling an invoice paid by a payment that also paid another bill keeps that payment', async () => {
    const a = await sale(15000, day(1)); const b = await sale(15000, day(2));
    const pay = await S.recordPayment(db, { partyId: cust, amount: 20000, date: day(3) });
    await S.cancelInvoice(db, a.id);                                   // no confirmation needed: the payment is not lost
    expect(await out(b.id)).toBe(0);                                   // the freed 150 pays the other bill (100 left of it)
    expect(await S.poolCredit(db, cust)).toBe(5000);
    expect(await S.getPartyBalance(db, cust)).toBe(-5000);
    expect((await S.cashTotals(db, day(3), day(3))).received).toBe(20000);
    expect(pay.id).toBeGreaterThan(0);
  });
  it('a payment made only for one invoice is still cancelled with it, after confirmation', async () => {
    const a = await sale(15000, day(1), cust, 15000);
    await expect(S.cancelInvoice(db, a.id)).rejects.toMatchObject({ code: 'HAS_PAYMENTS' });
    await S.cancelInvoice(db, a.id, { cancelPayments: true });
    expect(await S.getPartyBalance(db, cust)).toBe(0); expect((await S.cashTotals(db, day(1), day(1))).received).toBe(0);
  });
  it('cancelling a payment re-opens the bills it paid', async () => {
    const a = await sale(15000, day(1));
    const r = await S.recordPayment(db, { partyId: cust, amount: 15000, date: day(2) });
    expect(await out(a.id)).toBe(0);
    await S.cancelPayment(db, r.id);
    expect(await out(a.id)).toBe(15000); expect(await S.getPartyBalance(db, cust)).toBe(15000);
  });
  it('backups made before schema v3 restore with invoice allocations intact', async () => {
    const a = await sale(15000, day(1)); await S.recordPayment(db, { partyId: cust, amount: 5000, date: day(2) });
    const { text } = await S.createBackup(db);
    const old = JSON.parse(text); old.schemaVersion = 2;
    const t = old.data.payment_allocations; const ki = t.columns.indexOf('kind');
    t.columns.splice(ki, 1); t.rows.forEach((r: unknown[]) => r.splice(ki, 1));
    old.checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(old.data))))].map(b => b.toString(16).padStart(2, '0')).join('');
    const target = await SqlJsDb.open(); await migrate(target, MIGRATIONS);
    await S.restoreBackup(target, JSON.stringify(old), async () => {});
    expect((await S.getInvoiceState(target, a.id))!.outstanding).toBe(10000);
    expect(await S.poolCredit(target, cust)).toBe(0);
  });
});

describe('randomized consistency (invariants after every operation)', () => {
  it('balances, bills and unapplied credit always agree', async () => {
    let seed = 12345; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const customers = [cust, await S.createParty(db, { kind: 'customer', name: 'ع٢' }), await S.createParty(db, { kind: 'customer', name: 'ع٣', openingBalance: 7000, openingDate: day(1) })];
    const suppliers = [supp, await S.createParty(db, { kind: 'supplier', name: 'م٢', openingBalance: -9000, openingDate: day(1) })];
    const all = [...customers, ...suppliers];

    const check = async (label: string) => {
      for (const pid of all) {
        const p = (await S.getParty(db, pid))!; const items = await S.listOpenItems(db, pid); const pool = await S.poolCredit(db, pid);
        const due = items.reduce((s, i) => s + i.outstanding, 0);
        const bal = p.kind === 'customer' ? p.balance : -p.balance;
        if (bal !== due - pool) throw new Error(`${label}: party ${pid} balance ${bal} != due ${due} - credit ${pool}`);
        if (pool > 0 && items.length > 0) throw new Error(`${label}: party ${pid} has credit ${pool} AND open items`);
      }
      const bad = await db.all("SELECT p.id FROM payments p WHERE p.cancelled_at IS NULL AND p.amount <> (SELECT COALESCE(SUM(amount),0) FROM payment_allocations a WHERE a.payment_id = p.id)");
      if (bad.length) throw new Error(`${label}: payment allocations do not add up`);
      const neg = await db.all("SELECT 1 FROM payment_allocations WHERE amount <= 0"); if (neg.length) throw new Error(`${label}: non-positive allocation`);
    };
    await check('start');
    for (let i = 0; i < 160; i++) {
      const op = rnd(10); const label = `op#${i} (${op})`;
      try {
        if (op <= 2) await S.postInvoice(db, { kind: 'sale', partyId: customers[rnd(3)]!, date: day(1 + rnd(25)), paidNow: rnd(3) === 0 ? rnd(20000) : 0, allowNegativeStock: true, lines: [{ productId: prod, unitId: piece, qtyMilli: 1000 * (1 + rnd(5)), unitPrice: 500 + rnd(5000) }] });
        else if (op === 3) await S.postInvoice(db, { kind: 'purchase', partyId: suppliers[rnd(2)]!, date: day(1 + rnd(25)), paidNow: rnd(3) === 0 ? rnd(20000) : 0, lines: [{ productId: prod, unitId: piece, qtyMilli: 1000 * (1 + rnd(5)), unitPrice: 300 + rnd(3000) }] });
        else if (op <= 6) {
          const pid = all[rnd(all.length)]!; const items = await S.listOpenItems(db, pid);
          const inv = items.filter(x => x.invoiceId); const pick = rnd(3) === 0 && inv.length ? inv[rnd(inv.length)]!.invoiceId : undefined;
          await S.recordPayment(db, { partyId: pid, amount: 1 + rnd(30000), date: day(1 + rnd(28)), invoiceId: pick });
        } else if (op === 7) {
          const invs = await S.listInvoices(db, {}); if (!invs.length) continue; const inv = invs[rnd(invs.length)]!;
          const lines = (await S.getInvoiceDetail(db, inv.id))!.lines; const l = lines[0]!;
          await S.postReturn(db, { invoiceId: inv.id, date: day(26 + rnd(3)), lines: [{ invoiceLineId: l.id as number, qtyMilli: 1 + rnd(Number(l.qty_milli)) }] });
        } else if (op === 8) {
          const invs = await S.listInvoices(db, {}); if (!invs.length) continue;
          await S.cancelInvoice(db, invs[rnd(invs.length)]!.id, { cancelPayments: rnd(2) === 0 });
        } else {
          const pays = await db.all<{ id: number }>('SELECT id FROM payments WHERE cancelled_at IS NULL'); if (!pays.length) continue;
          await S.cancelPayment(db, pays[rnd(pays.length)]!.id);
        }
      } catch (e) { if (!(e instanceof S.ServiceError)) throw e; /* a refused operation must leave everything consistent */ }
      await check(label);
    }
  });
});
