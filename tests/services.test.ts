import { describe, it, expect, beforeEach } from 'vitest';
import { SqlJsDb } from './helpers/sqljsDb';
import type { Db, RunResult, SqlParam } from '../src/db/types';
import { migrate } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import * as S from '../src/services';
import { ServiceError } from '../src/services';

const D = '2026-11-20';
let db: SqlJsDb; let piece: number; let carton: number; let kg: number; let prod: number; let cust: number; let supp: number;

async function setup() {
  db = await SqlJsDb.open();
  await migrate(db, MIGRATIONS);
  piece = await S.createUnit(db, 'قطعة'); carton = await S.createUnit(db, 'كرتونة'); kg = await S.createUnit(db, 'كيلو');
  const cat = await S.createCategory(db, 'شيبسي');
  prod = await S.createProduct(db, { name: 'شيبسي كبير', categoryId: cat, baseUnitId: piece, buyPrice: 500, sellPrice: 700, lowStockMilli: 10000, extraUnits: [{ unitId: carton, factorToBase: 24 }] });
  cust = await S.createParty(db, { kind: 'customer', name: 'سوبر ماركت النور' });
  supp = await S.createParty(db, { kind: 'supplier', name: 'شركة الأمل' });
}
const buy = (qty: number, price = 500, paidNow = 0, extra: Partial<S.InvoiceIn> = {}) => S.postInvoice(db, { kind: 'purchase', partyId: supp, date: D, paidNow, lines: [{ productId: prod, unitId: piece, qtyMilli: qty * 1000, unitPrice: price }], ...extra });
const sell = (qty: number, paidNow = 0, extra: Partial<S.InvoiceIn> = {}, lineDiscount = 0) => S.postInvoice(db, { kind: 'sale', partyId: cust, date: D, paidNow, lines: [{ productId: prod, unitId: piece, qtyMilli: qty * 1000, unitPrice: 700, lineDiscount }], ...extra });
const stock = () => S.getStock(db, prod);
const bal = (p: number) => S.getPartyBalance(db, p);
const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e instanceof ServiceError ? e.code : 'OTHER:' + String(e); } return 'NO_ERROR'; };

beforeEach(setup);

describe('sales', () => {
  it('cash sale: stock down, balance 0, receipt recorded as cash received', async () => {
    await buy(100);
    const r = await sell(10, 7000);
    expect(r).toMatchObject({ total: 7000, paid: 7000, outstanding: 0, advance: 0 });
    expect(await stock()).toBe(90000);
    expect(await bal(cust)).toBe(0);
    expect(await S.cashTotals(db, D, D)).toEqual({ received: 7000, paid: 0, net: 7000 });
    expect(r.ref).toBe('S-000001');
  });
  it('credit and partial sale; payments against invoice vs general account', async () => {
    await buy(100);
    const r = await sell(10, 2000);
    expect(await bal(cust)).toBe(5000);
    await S.recordPayment(db, { partyId: cust, amount: 1500, date: D, invoiceId: r.id });
    expect(await bal(cust)).toBe(3500);
    expect((await S.getInvoiceState(db, r.id))?.outstanding).toBe(3500);
    await S.recordPayment(db, { partyId: cust, amount: 500, date: D }); // general: balance only
    expect(await bal(cust)).toBe(3000);
    expect((await S.getInvoiceState(db, r.id))?.outstanding).toBe(3500);
    const over = await S.recordPayment(db, { partyId: cust, amount: 5000, date: D, invoiceId: r.id });
    expect(over).toMatchObject({ appliedToInvoice: 3500, advance: 1500 });
    expect(await bal(cust)).toBe(-2000); // advance: business now owes the customer
    expect(await code(S.recordPayment(db, { partyId: cust, amount: 1, date: D, invoiceId: r.id }))).toBe('NOTHING_OUTSTANDING');
    expect((await S.cashTotals(db, D, D)).received).toBe(2000 + 1500 + 500 + 5000);
  });
  it('immediate overpayment becomes an advance with the opposite balance sign', async () => {
    await buy(100);
    const r = await sell(10, 8000);
    expect(r).toMatchObject({ paid: 7000, outstanding: 0, advance: 1000 });
    expect(await bal(cust)).toBe(-1000);
  });
  it('blocks overselling with available qty, allows an explicit override and flags it', async () => {
    await buy(100);
    const err = (await sell(150).then(() => null, e => e)) as ServiceError;
    expect(err.code).toBe('INSUFFICIENT_STOCK');
    expect((err.details.shortages as { available: number }[])[0]?.available).toBe(100000);
    expect(await stock()).toBe(100000);
    const ok = await sell(150, 0, { allowNegativeStock: true });
    expect(ok.negativeStockOverride).toBe(true);
    expect(await stock()).toBe(-50000);
    expect((await S.getInvoiceDetail(db, ok.id))?.invoice.negative_stock_override).toBe(1);
  });
  it('rejects wrong party kind, archived party/product, undefined unit', async () => {
    await buy(100);
    expect(await code(S.postInvoice(db, { kind: 'sale', partyId: supp, date: D, lines: [{ productId: prod, unitId: piece, qtyMilli: 1000, unitPrice: 1 }] }))).toBe('PARTY_KIND');
    expect(await code(S.postInvoice(db, { kind: 'sale', partyId: cust, date: D, lines: [{ productId: prod, unitId: kg, qtyMilli: 1000, unitPrice: 1 }] }))).toBe('UNIT_NOT_ALLOWED');
    await S.archiveProduct(db, prod);
    expect(await code(sell(1))).toBe('PRODUCT_ARCHIVED');
    await S.archiveProduct(db, prod, false); await S.archiveParty(db, cust);
    expect(await code(sell(1))).toBe('PARTY_ARCHIVED');
  });
  it('invoice-level and line discounts reach totals and the ledger', async () => {
    await buy(100);
    const r = await sell(10, 0, { invoiceDiscount: 300 }, 700);
    expect(r.total).toBe(6000);
    expect(await bal(cust)).toBe(6000);
  });
});

describe('purchases & unit conversion', () => {
  it('credit purchase: stock up, supplier balance negative, partial payments move toward zero', async () => {
    const p = await buy(100, 500, 20000);
    expect(await stock()).toBe(100000);
    expect(await bal(supp)).toBe(-30000);
    await S.recordPayment(db, { partyId: supp, amount: 10000, date: D, invoiceId: p.id });
    expect(await bal(supp)).toBe(-20000);
    expect((await S.getInvoiceState(db, p.id))?.outstanding).toBe(20000);
    expect(await S.cashTotals(db, D, D)).toEqual({ received: 0, paid: 30000, net: -30000 });
  });
  it('cartons convert to base pieces consistently', async () => {
    await S.postInvoice(db, { kind: 'purchase', partyId: supp, date: D, lines: [{ productId: prod, unitId: carton, qtyMilli: 2000, unitPrice: 12000 }] });
    expect(await stock()).toBe(48000);
    expect(await bal(supp)).toBe(-24000);
    await sell(5);
    expect(await stock()).toBe(43000);
    expect(await code(S.updateProduct(db, prod, { baseUnitId: kg }))).toBe('BASE_UNIT_LOCKED');
  });
  it('weighted-average cost is recorded on sale lines (and null without purchase history)', async () => {
    await buy(10, 500); await buy(10, 700);
    const r = await sell(4);
    expect((await S.getInvoiceDetail(db, r.id))?.lines[0]?.cost_total).toBe(2400);
    const c2 = await S.createProduct(db, { name: 'بدون تكلفة', baseUnitId: piece, buyPrice: 0, sellPrice: 100, lowStockMilli: 0 });
    await S.recordStockAdjustment(db, { productId: c2, qtyMilli: 5000, date: D, reason: 'correction' });
    const r2 = await S.postInvoice(db, { kind: 'sale', partyId: cust, date: D, lines: [{ productId: c2, unitId: piece, qtyMilli: 1000, unitPrice: 100 }] });
    expect((await S.getInvoiceDetail(db, r2.id))?.lines[0]?.cost_total).toBeNull();
  });
});

describe('returns', () => {
  it('customer return: pro-rata value with line discount, stock up, balance down, cannot over-return', async () => {
    await buy(100);
    const s = await sell(10, 0, {}, 700); // net 6300
    const d = (await S.getInvoiceDetail(db, s.id))!; const lineId = d.lines[0]!.id as number;
    const r1 = await S.postReturn(db, { invoiceId: s.id, date: D, lines: [{ invoiceLineId: lineId, qtyMilli: 4000 }] });
    expect(r1.total).toBe(2520);
    expect(await stock()).toBe(94000);
    expect(await bal(cust)).toBe(3780);
    expect(await code(S.postReturn(db, { invoiceId: s.id, date: D, lines: [{ invoiceLineId: lineId, qtyMilli: 7000 }] }))).toBe('OVER_RETURN');
    const r2 = await S.postReturn(db, { invoiceId: s.id, date: D, lines: [{ invoiceLineId: lineId, qtyMilli: 6000 }] });
    expect(r2.total).toBe(3780); // remainder takes the rounding residue
    expect(await bal(cust)).toBe(0);
    expect(await stock()).toBe(100000);
    expect((await S.getInvoiceState(db, s.id))?.outstanding).toBe(0);
  });
  it('unusable customer return reduces the balance but does not re-enter stock', async () => {
    await buy(100);
    const s = await sell(10);
    const lineId = (await S.getInvoiceDetail(db, s.id))!.lines[0]!.id as number;
    await S.postReturn(db, { invoiceId: s.id, date: D, lines: [{ invoiceLineId: lineId, qtyMilli: 2000, usable: false }] });
    expect(await stock()).toBe(90000);
    expect(await bal(cust)).toBe(5600);
  });
  it('supplier return: stock down, supplier balance toward zero, needs stock on hand', async () => {
    const p = await buy(100);
    const lineId = (await S.getInvoiceDetail(db, p.id))!.lines[0]!.id as number;
    await sell(80);
    expect(await code(S.postReturn(db, { invoiceId: p.id, date: D, lines: [{ invoiceLineId: lineId, qtyMilli: 30000 }] }))).toBe('INSUFFICIENT_STOCK');
    const r = await S.postReturn(db, { invoiceId: p.id, date: D, lines: [{ invoiceLineId: lineId, qtyMilli: 20000 }] });
    expect(r.total).toBe(10000);
    expect(await stock()).toBe(0);
    expect(await bal(supp)).toBe(-40000);
  });
  it('returns do not count as sales/purchases in invoice totals', async () => {
    await buy(100); const s = await sell(10);
    const lineId = (await S.getInvoiceDetail(db, s.id))!.lines[0]!.id as number;
    await S.postReturn(db, { invoiceId: s.id, date: D, lines: [{ invoiceLineId: lineId, qtyMilli: 1000 }] });
    expect((await S.listInvoices(db, { kind: 'sale' })).map(i => i.total)).toEqual([7000]);
    expect(await db.all('SELECT 1 FROM invoices WHERE kind = ?', ['sale'])).toHaveLength(1);
  });
});

describe('missing / damaged stock', () => {
  it('reduces stock, is not a sale, requires a valid reason, cannot exceed stock', async () => {
    await buy(100);
    const r = await S.recordStockAdjustment(db, { productId: prod, qtyMilli: 5000, date: D, reason: 'missing', notes: 'جرد' });
    expect(r.stockAfter).toBe(95000);
    await S.recordStockAdjustment(db, { productId: prod, qtyMilli: 1000, unitId: carton, date: D, reason: 'damaged' });
    expect(await stock()).toBe(95000 - 24000);
    expect(await db.all("SELECT 1 FROM invoices WHERE kind='sale'")).toHaveLength(0);
    expect(await code(S.recordStockAdjustment(db, { productId: prod, qtyMilli: 1000, date: D, reason: '' as never }))).toBe('REASON_REQUIRED');
    expect(await code(S.recordStockAdjustment(db, { productId: prod, qtyMilli: 999000, date: D, reason: 'lost' }))).toBe('INSUFFICIENT_STOCK');
    await S.recordStockAdjustment(db, { productId: prod, qtyMilli: 3000, date: D, reason: 'correction' });
    expect(await stock()).toBe(95000 - 24000 + 3000);
  });
});

describe('cancel & replace (reversals, no double counting)', () => {
  it('cancelling a sale restores stock and balance exactly once', async () => {
    await buy(100);
    const s = await sell(10, 7000);
    expect(await code(S.cancelInvoice(db, s.id))).toBe('HAS_PAYMENTS');
    await S.cancelInvoice(db, s.id, { cancelPayments: true });
    expect(await stock()).toBe(100000);
    expect(await bal(cust)).toBe(0);
    expect(await S.cashTotals(db, D, D)).toEqual({ received: 0, paid: 0, net: 0 });
    expect(await db.all("SELECT 1 FROM ledger_entries WHERE party_id = ?", [cust])).toHaveLength(4);
    expect(await code(S.cancelInvoice(db, s.id, { cancelPayments: true }))).toBe('ALREADY_CANCELLED');
    expect(await stock()).toBe(100000);
    expect(await S.listInvoices(db, { kind: 'sale' })).toHaveLength(0);
    expect(await S.listInvoices(db, { kind: 'sale', includeCancelled: true })).toHaveLength(1);
  });
  it('cannot cancel a purchase whose goods were sold, nor an invoice with returns', async () => {
    const p = await buy(100); const s = await sell(100);
    expect(await code(S.cancelInvoice(db, p.id))).toBe('STOCK_WOULD_GO_NEGATIVE');
    await buy(10);
    const lineId = (await S.getInvoiceDetail(db, s.id))!.lines[0]!.id as number;
    await S.postReturn(db, { invoiceId: s.id, date: D, lines: [{ invoiceLineId: lineId, qtyMilli: 1000 }] });
    expect(await code(S.cancelInvoice(db, s.id))).toBe('HAS_RETURNS');
  });
  it('replace corrects a sale atomically and links to the original', async () => {
    await buy(100);
    const s = await sell(10, 7000);
    const n = await S.replaceInvoice(db, s.id, { kind: 'sale', partyId: cust, date: D, paidNow: 5600, lines: [{ productId: prod, unitId: piece, qtyMilli: 8000, unitPrice: 700 }] });
    expect(await stock()).toBe(92000);
    expect(await bal(cust)).toBe(0);
    expect(n.ref).not.toBe(s.ref);
    expect((await S.getInvoiceDetail(db, n.id))?.invoice.replaces_id).toBe(s.id);
    expect((await S.cashTotals(db, D, D)).received).toBe(5600);
  });
});

describe('atomicity', () => {
  class FlakyDb implements Db {
    n = 0; failAt = Infinity;
    constructor(private inner: SqlJsDb) {}
    exec(sql: string) { return this.inner.exec(sql); }
    all<T>(sql: string, p?: SqlParam[]) { return this.inner.all<T>(sql, p); }
    async run(sql: string, p?: SqlParam[]): Promise<RunResult> { if (++this.n >= this.failAt) throw new Error('boom'); return this.inner.run(sql, p); }
    transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> { return this.inner.transaction(() => fn(this)); }
  }
  it('a failure part-way through posting a sale leaves no partial records and no consumed reference', async () => {
    await buy(100);
    const flaky = new FlakyDb(db);
    flaky.failAt = 5; // seq, invoice, line, movement, -> ledger insert fails
    await expect(S.postInvoice(flaky, { kind: 'sale', partyId: cust, date: D, paidNow: 7000, lines: [{ productId: prod, unitId: piece, qtyMilli: 10000, unitPrice: 700 }] })).rejects.toThrow('boom');
    expect(await db.all("SELECT 1 FROM invoices WHERE kind='sale'")).toHaveLength(0);
    expect(await stock()).toBe(100000);
    expect(await bal(cust)).toBe(0);
    expect((await sell(1)).ref).toBe('S-000001');
  });
});

describe('history, archiving, statements', () => {
  it('price changes and archiving never rewrite history', async () => {
    await buy(100);
    const s = await sell(10);
    await S.updateProduct(db, prod, { sellPrice: 999, buyPrice: 1 });
    await S.archiveProduct(db, prod); await S.archiveParty(db, cust);
    const d = (await S.getInvoiceDetail(db, s.id))!;
    expect(d.lines[0]?.unit_price).toBe(700);
    expect(await bal(cust)).toBe(7000);
    expect((await S.listParties(db, { kind: 'customer', includeArchived: true }))[0]?.balance).toBe(7000);
    expect(await S.listParties(db, { kind: 'customer' })).toHaveLength(0);
  });
  it('statement: opening balance, range rows with running balance, closing', async () => {
    const c = await S.createParty(db, { kind: 'customer', name: 'محل الأمانة', openingBalance: 1000, openingDate: '2026-01-01' });
    await buy(100);
    await S.postInvoice(db, { kind: 'sale', partyId: c, date: '2026-02-01', lines: [{ productId: prod, unitId: piece, qtyMilli: 5000, unitPrice: 1000 }] });
    await S.recordPayment(db, { partyId: c, amount: 2000, date: '2026-02-05' });
    const st = await S.partyStatement(db, c, '2026-02-02', '2026-02-28');
    expect(st.opening).toBe(6000);
    expect(st.entries.map(e => [e.type, e.delta, e.balance])).toEqual([['receipt', -2000, 4000]]);
    expect(st.entries[0]?.ref).toMatch(/^RC-/);
    expect(st.closing).toBe(4000);
    expect((await S.partyStatement(db, c, '2026-01-01', '2026-12-31')).closing).toBe(4000);
  });
  it('search and stock alerts', async () => {
    await buy(5);
    expect((await S.listProducts(db, { search: 'شيبسي' }))).toHaveLength(1);
    expect((await S.listProducts(db, { search: 'xyz' }))).toHaveLength(0);
    expect((await S.listProducts(db))[0]?.low).toBe(true);
    expect((await S.listParties(db, { search: 'النور' }))).toHaveLength(1);
    expect((await S.listInvoices(db, { search: 'P-0000' }))).toHaveLength(1);
  });
  it('categories/units can be created inline and are idempotent; validation errors are clear', async () => {
    expect(await S.createCategory(db, 'شيبسي')).toBe(await S.createCategory(db, 'شيبسي'));
    expect(await code(S.createCategory(db, '  '))).toBe('REQUIRED');
    expect(await code(S.createParty(db, { kind: 'customer', name: '' }))).toBe('REQUIRED');
    expect(await code(buy(1, 500, 0, { date: '2026-13-40' }))).toBe('INVALID_DATE');
    expect(await code(S.createProduct(db, { name: 'x', baseUnitId: piece, buyPrice: 0, sellPrice: 0, lowStockMilli: 0, extraUnits: [{ unitId: carton, factorToBase: 0 }] }))).toBe('INVALID_FACTOR');
  });
});

describe('backup-style round trip', () => {
  it('exported DB reopens with identical stock and balances', async () => {
    await buy(100, 500, 10000); await sell(10, 3000);
    const copy = await SqlJsDb.open(db.export());
    await migrate(copy, MIGRATIONS);
    expect(await S.getStock(copy, prod)).toBe(await stock());
    expect(await S.getPartyBalance(copy, cust)).toBe(await bal(cust));
    expect(await S.getPartyBalance(copy, supp)).toBe(await bal(supp));
  });
});
