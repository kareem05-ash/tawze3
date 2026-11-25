import type { Db } from '../db/types';
import { addDays, lastNDays, previousPeriod } from '../domain/dates';
import { actualProfit, idealProfit, payablesFrom, percentChange, receivablesFrom, type Change } from '../domain/metrics';
import type { Minor } from '../domain/money';
import { assertIsoDate, ServiceError } from './common';
import { cashTotals } from './queries';

const sumOf = async (db: Db, sql: string, p: (string | number)[]) => (await db.all<{ s: number }>(sql, p))[0]?.s ?? 0;

/** Net of invoice-level and line discounts (invoices.total), cancelled invoices excluded. */
const invoiceTotal = (db: Db, kind: 'sale' | 'purchase', from: string, to: string) =>
  sumOf(db, "SELECT COALESCE(SUM(total),0) AS s FROM invoices WHERE kind = ? AND cancelled_at IS NULL AND date >= ? AND date <= ?", [kind, from, to]);
const returnsTotal = (db: Db, kind: 'customer' | 'supplier', from: string, to: string) =>
  sumOf(db, "SELECT COALESCE(SUM(total),0) AS s FROM returns WHERE kind = ? AND date >= ? AND date <= ?", [kind, from, to]);

/** Receivables = positive customer balances, payables = |negative| supplier balances, as of END of `date` (opening balances + all posted entries). */
export async function closingPositions(db: Db, date: string): Promise<{ receivables: Minor; payables: Minor }> {
  const rows = await db.all<{ kind: 'customer' | 'supplier'; bal: number }>(
    'SELECT p.kind AS kind, COALESCE(SUM(l.delta),0) AS bal FROM parties p LEFT JOIN ledger_entries l ON l.party_id = p.id AND l.date <= ? GROUP BY p.id', [date]);
  return { receivables: receivablesFrom(rows.filter(r => r.kind === 'customer').map(r => r.bal)), payables: payablesFrom(rows.filter(r => r.kind === 'supplier').map(r => r.bal)) };
}

interface Agg { soldBase: number; revenue: number; cost: number; lines: number; linesWithCost: number; revWithCost: number; retBase: number; retRevenue: number; retCost: number; retRevWithCost: number }
const emptyAgg = (): Agg => ({ soldBase: 0, revenue: 0, cost: 0, lines: 0, linesWithCost: 0, revWithCost: 0, retBase: 0, retRevenue: 0, retCost: 0, retRevWithCost: 0 });

async function salesAggregates(db: Db, from: string, to: string): Promise<Map<number, Agg>> {
  const m = new Map<number, Agg>(); const get = (id: number) => { let a = m.get(id); if (!a) { a = emptyAgg(); m.set(id, a); } return a; };
  const lines = await db.all<{ product_id: number; base: number; line_total: number; cost_total: number | null; itotal: number; isub: number }>(
    `SELECT il.product_id, il.base_qty_milli AS base, il.line_total, il.cost_total, i.total AS itotal, i.subtotal AS isub
     FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id WHERE i.kind = 'sale' AND i.cancelled_at IS NULL AND i.date >= ? AND i.date <= ?`, [from, to]);
  for (const l of lines) {
    const a = get(l.product_id); const rev = l.isub > 0 ? Math.round((l.line_total * l.itotal) / l.isub) : 0;
    a.soldBase += l.base; a.revenue += rev; a.lines++;
    if (l.cost_total !== null) { a.linesWithCost++; a.cost += l.cost_total; a.revWithCost += rev; }
  }
  const rets = await db.all<{ product_id: number; rbase: number; rvalue: number; usable: number; base: number; cost_total: number | null }>(
    `SELECT rl.product_id, rl.base_qty_milli AS rbase, rl.line_total AS rvalue, rl.usable, il.base_qty_milli AS base, il.cost_total
     FROM return_lines rl JOIN returns r ON r.id = rl.return_id JOIN invoice_lines il ON il.id = rl.invoice_line_id
     WHERE r.kind = 'customer' AND r.date >= ? AND r.date <= ?`, [from, to]);
  for (const r of rets) {
    const a = get(r.product_id); a.retBase += r.rbase; a.retRevenue += r.rvalue;
    if (r.cost_total !== null) { a.retRevWithCost += r.rvalue; if (r.usable) a.retCost += Math.round((r.cost_total * r.rbase) / r.base); } // usable goods go back to stock, so their cost reverses
  }
  return m;
}
const marginOf = (a: Agg) => (a.revWithCost - a.retRevWithCost) - (a.cost - a.retCost);

export interface PeriodReport {
  from: string; to: string;
  sales: { gross: Minor; returns: Minor; net: Minor }; purchases: { gross: Minor; returns: Minor; net: Minor };
  cash: { received: Minor; paid: Minor; net: Minor };
  receivables: { opening: Minor; closing: Minor; movement: Minor }; payables: { opening: Minor; closing: Minor; movement: Minor };
  /** User-defined metrics (see domain/metrics.ts): actual = sales - purchases; ideal adds closing receivables and subtracts closing payables. */
  custom: { actualProfit: Minor; idealProfit: Minor };
  /** Conventional estimate: net sales minus weighted-average cost of goods sold. `complete` is false when some sold lines have no cost history. */
  margin: { revenue: Minor; cost: Minor; margin: Minor; coverage: number | null; complete: boolean };
}

export async function periodReport(db: Db, from: string, to: string): Promise<PeriodReport> {
  assertIsoDate(from, 'تاريخ البداية'); assertIsoDate(to, 'تاريخ النهاية');
  if (from > to) throw new ServiceError('INVALID_RANGE', 'تاريخ البداية بعد تاريخ النهاية');
  const [sg, sr, pg, pr, cash, open, close, agg] = await Promise.all([
    invoiceTotal(db, 'sale', from, to), returnsTotal(db, 'customer', from, to), invoiceTotal(db, 'purchase', from, to), returnsTotal(db, 'supplier', from, to),
    cashTotals(db, from, to), closingPositions(db, addDays(from, -1)), closingPositions(db, to), salesAggregates(db, from, to)]);
  const netSales = sg - sr, netPurchases = pg - pr;
  let revWith = 0, rev = 0, cost = 0, margin = 0;
  for (const a of agg.values()) { rev += a.revenue - a.retRevenue; revWith += a.revWithCost - a.retRevWithCost; cost += a.cost - a.retCost; margin += marginOf(a); }
  const inputs = { netSales, netPurchases, receivables: close.receivables, payables: close.payables };
  return {
    from, to, sales: { gross: sg, returns: sr, net: netSales }, purchases: { gross: pg, returns: pr, net: netPurchases }, cash,
    receivables: { opening: open.receivables, closing: close.receivables, movement: close.receivables - open.receivables },
    payables: { opening: open.payables, closing: close.payables, movement: close.payables - open.payables },
    custom: { actualProfit: actualProfit(inputs), idealProfit: idealProfit(inputs) },
    margin: { revenue: revWith, cost, margin, coverage: rev > 0 ? revWith / rev : null, complete: rev === revWith },
  };
}

export type ReportChanges = Record<'sales' | 'purchases' | 'received' | 'paid' | 'netCash' | 'actualProfit' | 'idealProfit', Change>;
/** Current period vs the previous period of equal length. Zero baselines give 'new'/'none', never Infinity/NaN. */
export async function buildReport(db: Db, from: string, to: string) {
  const current = await periodReport(db, from, to);
  const pp = previousPeriod(from, to);
  const previous = await periodReport(db, pp.from, pp.to);
  const changes: ReportChanges = {
    sales: percentChange(current.sales.net, previous.sales.net), purchases: percentChange(current.purchases.net, previous.purchases.net),
    received: percentChange(current.cash.received, previous.cash.received), paid: percentChange(current.cash.paid, previous.cash.paid),
    netCash: percentChange(current.cash.net, previous.cash.net),
    actualProfit: percentChange(current.custom.actualProfit, previous.custom.actualProfit), idealProfit: percentChange(current.custom.idealProfit, previous.custom.idealProfit),
  };
  return { current, previous, changes };
}

export interface DayPoint { date: string; sales: Minor; purchases: Minor; received: Minor; paid: Minor }
/** One row per day (zeros included) for the dashboard bar chart; sales/purchases are net of returns dated that day. */
export async function dailySeries(db: Db, end: string, days = 7): Promise<DayPoint[]> {
  const dates = lastNDays(end, days); const from = dates[0]!;
  const [inv, ret, pay] = await Promise.all([
    db.all<{ d: string; kind: string; s: number }>("SELECT date AS d, kind, SUM(total) AS s FROM invoices WHERE cancelled_at IS NULL AND date >= ? AND date <= ? GROUP BY date, kind", [from, end]),
    db.all<{ d: string; kind: string; s: number }>("SELECT date AS d, kind, SUM(total) AS s FROM returns WHERE date >= ? AND date <= ? GROUP BY date, kind", [from, end]),
    db.all<{ d: string; direction: string; s: number }>("SELECT date AS d, direction, SUM(amount) AS s FROM payments WHERE cancelled_at IS NULL AND date >= ? AND date <= ? GROUP BY date, direction", [from, end]),
  ]);
  const g = (rows: { d: string; kind?: string; direction?: string; s: number }[], d: string, k: string) => rows.find(r => r.d === d && (r.kind ?? r.direction) === k)?.s ?? 0;
  return dates.map(date => ({
    date, sales: g(inv, date, 'sale') - g(ret, date, 'customer'), purchases: g(inv, date, 'purchase') - g(ret, date, 'supplier'),
    received: g(pay, date, 'in'), paid: g(pay, date, 'out'),
  }));
}

export interface ProductReportRow {
  productId: number; name: string; unit: string; stock: number; archived: boolean;
  soldBase: number; netSoldBase: number; revenue: Minor; purchasedBase: number; purchasedValue: Minor;
  margin: Minor | null; marginPct: number | null; costComplete: boolean; lastSaleDate: string | null; missingBase: number; damagedBase: number;
}
export const SLOW_DAYS = 30;
/** Slow-moving rule: active product holding stock, first stocked at least `slowDays` days before the period end, with no sale in the last `slowDays` days up to the period end. */
export async function productReport(db: Db, from: string, to: string, slowDays = SLOW_DAYS) {
  assertIsoDate(from); assertIsoDate(to);
  const [prods, agg, pur, purRet, miss, last, first] = await Promise.all([
    db.all<{ id: number; name: string; unit: string; archived: number; stock: number }>(
      `SELECT p.id, p.name, u.name AS unit, p.archived, COALESCE((SELECT SUM(base_qty_milli) FROM stock_movements m WHERE m.product_id = p.id AND m.date <= ?),0) AS stock
       FROM products p JOIN units u ON u.id = p.base_unit_id ORDER BY p.name`, [to]),
    salesAggregates(db, from, to),
    db.all<{ product_id: number; b: number; v: number }>("SELECT il.product_id, SUM(il.base_qty_milli) AS b, SUM(il.line_total) AS v FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id WHERE i.kind = 'purchase' AND i.cancelled_at IS NULL AND i.date >= ? AND i.date <= ? GROUP BY il.product_id", [from, to]),
    db.all<{ product_id: number; b: number; v: number }>("SELECT rl.product_id, SUM(rl.base_qty_milli) AS b, SUM(rl.line_total) AS v FROM return_lines rl JOIN returns r ON r.id = rl.return_id WHERE r.kind = 'supplier' AND r.date >= ? AND r.date <= ? GROUP BY rl.product_id", [from, to]),
    db.all<{ product_id: number; type: string; q: number }>("SELECT product_id, type, SUM(-base_qty_milli) AS q FROM stock_movements WHERE type IN ('missing','damaged') AND date >= ? AND date <= ? GROUP BY product_id, type", [from, to]),
    db.all<{ product_id: number; d: string }>("SELECT il.product_id, MAX(i.date) AS d FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id WHERE i.kind = 'sale' AND i.cancelled_at IS NULL AND i.date <= ? GROUP BY il.product_id", [to]),
    db.all<{ product_id: number; d: string }>("SELECT product_id, MIN(date) AS d FROM stock_movements WHERE base_qty_milli > 0 AND date <= ? GROUP BY product_id", [to]),
  ]);
  const threshold = addDays(to, -(slowDays - 1));
  const rows: ProductReportRow[] = prods.map(p => {
    const a = agg.get(p.id) ?? emptyAgg(); const pb = pur.find(x => x.product_id === p.id); const pr = purRet.find(x => x.product_id === p.id);
    const costComplete = a.lines > 0 && a.lines === a.linesWithCost; const margin = costComplete ? marginOf(a) : null; const netRev = a.revenue - a.retRevenue;
    return {
      productId: p.id, name: p.name, unit: p.unit, stock: p.stock, archived: p.archived === 1,
      soldBase: a.soldBase, netSoldBase: a.soldBase - a.retBase, revenue: netRev,
      purchasedBase: (pb?.b ?? 0) - (pr?.b ?? 0), purchasedValue: (pb?.v ?? 0) - (pr?.v ?? 0),
      margin, marginPct: margin !== null && a.revWithCost - a.retRevWithCost > 0 ? Math.round((margin / (a.revWithCost - a.retRevWithCost)) * 1000) / 10 : null, costComplete,
      lastSaleDate: last.find(x => x.product_id === p.id)?.d ?? null,
      missingBase: miss.find(x => x.product_id === p.id && x.type === 'missing')?.q ?? 0, damagedBase: miss.find(x => x.product_id === p.id && x.type === 'damaged')?.q ?? 0,
    };
  });
  const firstOf = (id: number) => first.find(x => x.product_id === id)?.d;
  return {
    rows,
    bestSelling: rows.filter(r => r.netSoldBase > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    highestMargin: rows.filter(r => r.margin !== null && r.margin > 0).sort((a, b) => (b.margin as number) - (a.margin as number)).slice(0, 10),
    negativeMargin: rows.filter(r => r.margin !== null && r.margin < 0).sort((a, b) => (a.margin as number) - (b.margin as number)),
    slowMoving: rows.filter(r => !r.archived && r.stock > 0 && (firstOf(r.productId) ?? '9999') <= threshold && (r.lastSaleDate === null || r.lastSaleDate < threshold)),
    missingDamaged: rows.filter(r => r.missingBase > 0 || r.damagedBase > 0),
  };
}
