import { describe, it, expect, beforeEach } from 'vitest';
import { SqlJsDb } from './helpers/sqljsDb';
import { migrate } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import * as S from '../src/services';
import { addDays, lastNDays, previousPeriod } from '../src/domain/dates';

let db: SqlJsDb; let piece: number; let p1: number; let supp: number; let A: number; let B: number;
const line = (productId: number, qty: number, price: number, lineDiscount = 0) => ({ productId, unitId: piece, qtyMilli: qty * 1000, unitPrice: price, lineDiscount });

beforeEach(async () => {
  db = await SqlJsDb.open(); await migrate(db, MIGRATIONS);
  piece = await S.createUnit(db, 'قطعة');
  p1 = await S.createProduct(db, { name: 'شيبسي', baseUnitId: piece, buyPrice: 500, sellPrice: 700, lowStockMilli: 0 });
  supp = await S.createParty(db, { kind: 'supplier', name: 'الأمل' });
  A = await S.createParty(db, { kind: 'customer', name: 'أ' }); B = await S.createParty(db, { kind: 'customer', name: 'ب' });
  await S.postInvoice(db, { kind: 'purchase', partyId: supp, date: '2026-11-01', paidNow: 20000, lines: [line(p1, 100, 500)] });
  const sa = await S.postInvoice(db, { kind: 'sale', partyId: A, date: '2026-11-02', paidNow: 2000, lines: [line(p1, 10, 700)] });
  await S.postInvoice(db, { kind: 'sale', partyId: B, date: '2026-11-03', invoiceDiscount: 400, lines: [line(p1, 20, 700)] });
  const lid = (await S.getInvoiceDetail(db, sa.id))!.lines[0]!.id as number;
  await S.postReturn(db, { invoiceId: sa.id, date: '2026-11-04', lines: [{ invoiceLineId: lid, qtyMilli: 2000 }] });
});

describe('date helpers', () => {
  it('are calendar-safe', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01'); expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(lastNDays('2026-11-04', 3)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
    expect(previousPeriod('2026-11-03', '2026-11-04')).toEqual({ from: '2026-11-01', to: '2026-11-02' });
  });
});

describe('period report', () => {
  it('sales/purchases net of returns+discounts, cash from payments, closing positions, custom metrics', async () => {
    const r = await S.periodReport(db, '2026-11-01', '2026-11-04');
    expect(r.sales).toEqual({ gross: 20600, returns: 1400, net: 19200 });
    expect(r.purchases).toEqual({ gross: 50000, returns: 0, net: 50000 });
    expect(r.cash).toEqual({ received: 2000, paid: 20000, net: -18000 });
    expect(r.receivables).toEqual({ opening: 0, closing: 17200, movement: 17200 }); // A 3600 + B 13600
    expect(r.payables).toEqual({ opening: 0, closing: 30000, movement: 30000 });
    expect(r.custom.actualProfit).toBe(19200 - 50000);
    expect(r.custom.idealProfit).toBe(19200 + 17200 - 50000 - 30000);
  });
  it('closing positions are as of the END date and opening is the day before the start', async () => {
    const r = await S.periodReport(db, '2026-11-03', '2026-11-03');
    expect(r.receivables.opening).toBe(5000);          // A after sale (7000) and receipt (-2000) on 11-02
    expect(r.receivables.closing).toBe(5000 + 13600);
    expect(r.receivables.movement).toBe(13600);
    expect(r.payables.closing).toBe(30000);
  });
  it('opening balances count in positions', async () => {
    await S.createParty(db, { kind: 'customer', name: 'قديم', openingBalance: 9000, openingDate: '2026-01-01' });
    expect((await S.periodReport(db, '2026-11-01', '2026-11-04')).receivables.closing).toBe(17200 + 9000);
  });
  it('estimated gross margin uses weighted-average cost and reverses usable returns', async () => {
    const m = (await S.periodReport(db, '2026-11-01', '2026-11-04')).margin;
    expect(m).toEqual({ revenue: 19200, cost: 14000, margin: 5200, coverage: 1, complete: true });
  });
  it('flags incomplete cost data instead of inventing margins', async () => {
    const p2 = await S.createProduct(db, { name: 'بدون تكلفة', baseUnitId: piece, buyPrice: 0, sellPrice: 100, lowStockMilli: 0 });
    await S.recordStockAdjustment(db, { productId: p2, qtyMilli: 5000, date: '2026-11-02', reason: 'correction' });
    await S.postInvoice(db, { kind: 'sale', partyId: A, date: '2026-11-05', lines: [line(p2, 2, 100)] });
    const r = await S.periodReport(db, '2026-11-01', '2026-11-05');
    expect(r.margin.complete).toBe(false);
    expect(r.margin.coverage).toBeLessThan(1);
    const pr = await S.productReport(db, '2026-11-01', '2026-11-05');
    expect(pr.rows.find(x => x.productId === p2)).toMatchObject({ margin: null, costComplete: false });
  });
  it('cancelled invoices and payments disappear from every total', async () => {
    const inv = (await S.listInvoices(db, { kind: 'sale', partyId: B }))[0]!;
    await S.cancelInvoice(db, inv.id);
    const r = await S.periodReport(db, '2026-11-01', '2026-11-04');
    expect(r.sales.gross).toBe(7000);
    expect(r.receivables.closing).toBe(3600);
  });
  it('rejects bad ranges', async () => {
    await expect(S.periodReport(db, '2026-11-05', '2026-11-01')).rejects.toMatchObject({ code: 'INVALID_RANGE' });
    await expect(S.periodReport(db, 'x', '2026-11-01')).rejects.toMatchObject({ code: 'INVALID_DATE' });
  });
});

describe('comparison with previous period', () => {
  it('percent changes with correct signs', async () => {
    const { current, previous, changes } = await S.buildReport(db, '2026-11-03', '2026-11-04');
    expect(previous.from).toBe('2026-11-01');
    expect(current.sales.net).toBe(13600 - 1400);
    expect(changes.sales).toEqual({ kind: 'percent', value: 74.3 });   // (12200-7000)/7000
    expect(changes.purchases).toEqual({ kind: 'percent', value: -100 });
    expect(changes.netCash).toEqual({ kind: 'percent', value: 100 });   // 0 vs -18000
  });
  it('zero baseline never yields Infinity/NaN', async () => {
    const { changes } = await S.buildReport(db, '2026-11-01', '2026-11-04'); // previous period is empty
    expect(changes.sales).toEqual({ kind: 'new' });
    expect(changes.received).toEqual({ kind: 'new' });
    const empty = await S.buildReport(db, '2026-01-10', '2026-01-12');
    expect(empty.changes.sales).toEqual({ kind: 'none' });
    expect(JSON.stringify(empty.changes)).not.toMatch(/Infinity|NaN|null/);
  });
});

describe('daily series', () => {
  it('has one point per day including zero days', async () => {
    const s = await S.dailySeries(db, '2026-11-04', 7);
    expect(s.map(x => x.date)[0]).toBe('2026-10-29'); expect(s).toHaveLength(7);
    expect(s.find(x => x.date === '2026-11-01')).toMatchObject({ purchases: 50000, paid: 20000, sales: 0 });
    expect(s.find(x => x.date === '2026-11-02')).toMatchObject({ sales: 7000, received: 2000 });
    expect(s.find(x => x.date === '2026-11-04')).toMatchObject({ sales: -1400 }); // return dated that day
    expect(s.find(x => x.date === '2026-10-30')).toEqual({ date: '2026-10-30', sales: 0, purchases: 0, received: 0, paid: 0 });
  });
});

describe('product analytics', () => {
  it('best sellers, margins, negative margin, slow movers, missing/damaged', async () => {
    const p2 = await S.createProduct(db, { name: 'راكد', baseUnitId: piece, buyPrice: 100, sellPrice: 200, lowStockMilli: 0 });
    await S.postInvoice(db, { kind: 'purchase', partyId: supp, date: '2026-09-01', lines: [line(p2, 10, 100)] });
    const p3 = await S.createProduct(db, { name: 'خسارة', baseUnitId: piece, buyPrice: 1000, sellPrice: 800, lowStockMilli: 0 });
    await S.postInvoice(db, { kind: 'purchase', partyId: supp, date: '2026-11-01', lines: [line(p3, 10, 1000)] });
    await S.postInvoice(db, { kind: 'sale', partyId: A, date: '2026-11-03', lines: [line(p3, 5, 800)] });
    await S.recordStockAdjustment(db, { productId: p1, qtyMilli: 3000, date: '2026-11-04', reason: 'missing' });
    await S.recordStockAdjustment(db, { productId: p1, qtyMilli: 2000, date: '2026-11-04', reason: 'damaged' });
    const r = await S.productReport(db, '2026-11-01', '2026-11-30');
    const row = r.rows.find(x => x.productId === p1)!;
    expect(row).toMatchObject({ soldBase: 30000, netSoldBase: 28000, revenue: 19200, margin: 5200, missingBase: 3000, damagedBase: 2000 });
    expect(r.bestSelling[0]?.productId).toBe(p1);
    expect(r.highestMargin.map(x => x.productId)).toEqual([p1]);
    expect(r.negativeMargin.map(x => x.productId)).toEqual([p3]);
    expect(r.negativeMargin[0]?.margin).toBe(4000 - 5000);
    expect(r.slowMoving.map(x => x.productId)).toEqual([p2]);   // stocked Sep 1, never sold; p1/p3 sold recently
    expect(r.missingDamaged.map(x => x.productId)).toEqual([p1]);
  });
});
