import type { Db } from '../db/types';
import { computeInvoice, splitPayment } from '../domain/invoice';
import { checkSale, makeMovement, toBaseQty } from '../domain/inventory';
import { entryDelta } from '../domain/ledger';
import { lineTotal, type Minor, type QtyMilli } from '../domain/money';
import { ServiceError, assertInt, assertIsoDate, nextRef, one } from './common';
import { cancelPaymentTx, insertPayment } from './payments';
import { getStock } from './queries';

export interface InvoiceLineIn { productId: number; unitId: number; qtyMilli: QtyMilli; unitPrice: Minor; lineDiscount?: Minor }
export interface InvoiceIn {
  kind: 'sale' | 'purchase'; partyId: number; date: string; lines: InvoiceLineIn[];
  invoiceDiscount?: Minor; paidNow?: Minor; externalRef?: string; notes?: string;
  /** Explicit user confirmation to sell more than the available stock. Recorded on the invoice. */
  allowNegativeStock?: boolean; replacesId?: number;
}
export interface PostedInvoice { id: number; ref: string; total: Minor; paid: Minor; outstanding: Minor; advance: Minor; negativeStockOverride: boolean }

const qtyText = (milli: number) => (milli / 1000).toLocaleString('ar-EG');

export async function postInvoiceTx(tx: Db, input: InvoiceIn): Promise<PostedInvoice> {
  assertIsoDate(input.date);
  if (input.lines.length === 0) throw new ServiceError('NO_LINES', 'أضف صنفاً واحداً على الأقل');
  const paidNow = input.paidNow ?? 0;
  assertInt(paidNow, 'المبلغ المدفوع', { min: 0 });
  const party = await one<{ kind: string; archived: number }>(tx, 'SELECT kind, archived FROM parties WHERE id = ?', [input.partyId]);
  if (!party) throw new ServiceError('PARTY_NOT_FOUND', 'الحساب غير موجود');
  if (party.kind !== (input.kind === 'sale' ? 'customer' : 'supplier')) throw new ServiceError('PARTY_KIND', input.kind === 'sale' ? 'يجب اختيار عميل لفاتورة البيع' : 'يجب اختيار مورد لفاتورة الشراء');
  if (party.archived) throw new ServiceError('PARTY_ARCHIVED', 'هذا الحساب مؤرشف');

  const resolved: (InvoiceLineIn & { lineDiscount: Minor; name: string; base: QtyMilli })[] = [];
  for (const l of input.lines) {
    assertInt(l.qtyMilli, 'الكمية', { min: 1 });
    assertInt(l.unitPrice, 'السعر', { min: 0 });
    const ld = l.lineDiscount ?? 0;
    assertInt(ld, 'خصم الصنف', { min: 0 });
    const prod = await one<{ name: string; archived: number }>(tx, 'SELECT name, archived FROM products WHERE id = ?', [l.productId]);
    if (!prod) throw new ServiceError('PRODUCT_NOT_FOUND', 'الصنف غير موجود');
    if (prod.archived) throw new ServiceError('PRODUCT_ARCHIVED', `الصنف «${prod.name}» مؤرشف`);
    const pu = await one<{ factor_to_base: number }>(tx, 'SELECT factor_to_base FROM product_units WHERE product_id = ? AND unit_id = ?', [l.productId, l.unitId]);
    if (!pu) throw new ServiceError('UNIT_NOT_ALLOWED', `الوحدة المختارة غير معرّفة للصنف «${prod.name}»`);
    resolved.push({ ...l, lineDiscount: ld, name: prod.name, base: toBaseQty(l.qtyMilli, { id: String(l.unitId), factorToBase: pu.factor_to_base }) });
  }
  const totals = computeInvoice(resolved.map(r => ({ qty: r.qtyMilli, unitPrice: r.unitPrice, lineDiscount: r.lineDiscount })), input.invoiceDiscount ?? 0);

  let override = false;
  if (input.kind === 'sale') {
    const need = new Map<number, { name: string; base: number }>();
    for (const r of resolved) need.set(r.productId, { name: r.name, base: (need.get(r.productId)?.base ?? 0) + r.base });
    const shortages: { productId: number; name: string; available: number; requested: number }[] = [];
    for (const [productId, v] of need) {
      const c = checkSale(await getStock(tx, productId), v.base);
      if (!c.ok) shortages.push({ productId, name: v.name, available: c.available, requested: v.base });
    }
    if (shortages.length) {
      if (!input.allowNegativeStock) throw new ServiceError('INSUFFICIENT_STOCK', shortages.map(s => `المتاح من «${s.name}»: ${qtyText(s.available)} فقط`).join('، '), { shortages });
      override = true;
    }
  }

  const ref = await nextRef(tx, input.kind === 'sale' ? 'S' : 'P');
  const net = totals.subtotal - totals.lineDiscounts;
  const id = (await tx.run(
    'INSERT INTO invoices(kind, ref, party_id, date, subtotal, discount, total, notes, external_ref, negative_stock_override, replaces_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [input.kind, ref, input.partyId, input.date, net, totals.invoiceDiscount, totals.total, input.notes ?? null, input.externalRef ?? null, override ? 1 : 0, input.replacesId ?? null])).lastId;

  for (const r of resolved) {
    let cost: number | null = null;
    if (input.kind === 'sale') {
      // Weighted-average purchase cost per base unit over all non-cancelled purchases posted so far (an estimate; null when no history).
      const h = await one<{ v: number; q: number }>(tx,
        `SELECT COALESCE(SUM(il.line_total),0) AS v, COALESCE(SUM(il.base_qty_milli),0) AS q FROM invoice_lines il
         JOIN invoices i ON i.id = il.invoice_id WHERE i.kind = 'purchase' AND i.cancelled_at IS NULL AND il.product_id = ?`, [r.productId]);
      if (h && h.q > 0) cost = Math.round((r.base * h.v) / h.q);
    }
    await tx.run(
      'INSERT INTO invoice_lines(invoice_id, product_id, unit_id, qty_milli, base_qty_milli, unit_price, line_discount, line_total, cost_total) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, r.productId, r.unitId, r.qtyMilli, r.base, r.unitPrice, r.lineDiscount, lineTotal(r.qtyMilli, r.unitPrice) - r.lineDiscount, cost]);
    const mv = makeMovement(input.kind === 'sale' ? 'sale' : 'purchase', r.base);
    await tx.run("INSERT INTO stock_movements(product_id, type, base_qty_milli, date, source_table, source_id) VALUES (?,?,?,?, 'invoices', ?)", [r.productId, mv.type, mv.baseQty, input.date, id]);
  }
  await tx.run("INSERT INTO ledger_entries(party_id, type, delta, date, source_table, source_id) VALUES (?,?,?,?, 'invoices', ?)",
    [input.partyId, input.kind, entryDelta({ type: input.kind, amount: totals.total, date: input.date }), input.date, id]);

  const split = splitPayment(totals.total, paidNow);
  if (paidNow > 0) {
    await insertPayment(tx, { partyId: input.partyId, direction: input.kind === 'sale' ? 'in' : 'out', amount: paidNow, date: input.date, method: 'cash',
      allocations: [{ invoiceId: id, amount: split.paid }, { invoiceId: null, amount: split.overpaymentAdvance }] });
  }
  return { id, ref, total: totals.total, paid: split.paid, outstanding: split.outstanding, advance: split.overpaymentAdvance, negativeStockOverride: override };
}
export const postInvoice = (db: Db, input: InvoiceIn) => db.transaction(tx => postInvoiceTx(tx, input));

export interface CancelOptions { cancelPayments?: boolean; skipStockCheck?: boolean }
/** Voids an invoice via reversal rows (stock + ledger), dated like the original so history stays consistent. Nothing is deleted. */
export async function cancelInvoiceTx(tx: Db, id: number, opts: CancelOptions = {}): Promise<void> {
  const inv = await one<{ cancelled_at: string | null; kind: string }>(tx, 'SELECT cancelled_at, kind FROM invoices WHERE id = ?', [id]);
  if (!inv) throw new ServiceError('NOT_FOUND', 'الفاتورة غير موجودة');
  if (inv.cancelled_at) throw new ServiceError('ALREADY_CANCELLED', 'الفاتورة ملغاة بالفعل');
  const rets = await one<{ n: number }>(tx, 'SELECT COUNT(*) AS n FROM returns WHERE invoice_id = ?', [id]);
  if ((rets?.n ?? 0) > 0) throw new ServiceError('HAS_RETURNS', 'لا يمكن إلغاء فاتورة لها مرتجعات');
  const pays = await tx.all<{ id: number }>(
    'SELECT DISTINCT p.id FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE a.invoice_id = ? AND p.cancelled_at IS NULL', [id]);
  if (pays.length && !opts.cancelPayments) throw new ServiceError('HAS_PAYMENTS', 'عليها دفعات مسجلة. أكّد إلغاء الدفعات معها.', { paymentIds: pays.map(p => p.id) });
  for (const p of pays) await cancelPaymentTx(tx, p.id);

  const moves = await tx.all<{ id: number; product_id: number; base_qty_milli: number; date: string }>(
    "SELECT id, product_id, base_qty_milli, date FROM stock_movements WHERE source_table = 'invoices' AND source_id = ? AND reverses_id IS NULL", [id]);
  if (inv.kind === 'purchase' && !opts.skipStockCheck) {
    const per = new Map<number, number>();
    for (const m of moves) per.set(m.product_id, (per.get(m.product_id) ?? 0) + m.base_qty_milli);
    for (const [pid, q] of per) {
      if ((await getStock(tx, pid)) - q < 0) {
        const n = await one<{ name: string }>(tx, 'SELECT name FROM products WHERE id = ?', [pid]);
        throw new ServiceError('STOCK_WOULD_GO_NEGATIVE', `لا يمكن إلغاء الفاتورة: جزء من «${n?.name ?? ''}» تم بيعه بالفعل`, { productId: pid });
      }
    }
  }
  for (const m of moves) await tx.run("INSERT INTO stock_movements(product_id, type, base_qty_milli, date, source_table, source_id, reverses_id) VALUES (?, 'reversal', ?, ?, 'invoices', ?, ?)", [m.product_id, -m.base_qty_milli, m.date, id, m.id]);
  const led = await tx.all<{ id: number; party_id: number; type: string; delta: number; date: string }>(
    "SELECT id, party_id, type, delta, date FROM ledger_entries WHERE source_table = 'invoices' AND source_id = ? AND reverses_id IS NULL", [id]);
  for (const l of led) await tx.run("INSERT INTO ledger_entries(party_id, type, delta, date, source_table, source_id, reverses_id) VALUES (?,?,?,?, 'invoices', ?, ?)", [l.party_id, l.type, -l.delta, l.date, id, l.id]);
  await tx.run("UPDATE invoices SET cancelled_at = datetime('now') WHERE id = ?", [id]);
}
export const cancelInvoice = (db: Db, id: number, opts: CancelOptions = {}) => db.transaction(tx => cancelInvoiceTx(tx, id, opts));

/** Correct a mistake: void the old invoice (and its payments) and post the corrected one, atomically. Pass the new paidNow explicitly. */
export async function replaceInvoice(db: Db, oldId: number, input: Omit<InvoiceIn, 'replacesId'>): Promise<PostedInvoice> {
  return db.transaction(async tx => {
    const old = await one<{ kind: string }>(tx, 'SELECT kind FROM invoices WHERE id = ?', [oldId]);
    if (!old) throw new ServiceError('NOT_FOUND', 'الفاتورة غير موجودة');
    if (old.kind !== input.kind) throw new ServiceError('KIND_MISMATCH', 'لا يمكن تغيير نوع الفاتورة');
    const affected = (await tx.all<{ product_id: number }>("SELECT DISTINCT product_id FROM stock_movements WHERE source_table = 'invoices' AND source_id = ?", [oldId])).map(r => r.product_id);
    const before = new Map<number, number>();
    for (const p of [...affected, ...input.lines.map(l => l.productId)]) before.set(p, await getStock(tx, p));
    await cancelInvoiceTx(tx, oldId, { cancelPayments: true, skipStockCheck: true });
    const posted = await postInvoiceTx(tx, { ...input, replacesId: oldId });
    for (const [pid, b] of before) {
      const a = await getStock(tx, pid);
      if (a < 0 && a < b) throw new ServiceError('STOCK_WOULD_GO_NEGATIVE', 'التعديل سيجعل المخزون سالباً', { productId: pid });
    }
    return posted;
  });
}
