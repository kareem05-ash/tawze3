import type { Db } from '../db/types';
import { entryDelta } from '../domain/ledger';
import { makeMovement } from '../domain/inventory';
import type { Minor, QtyMilli } from '../domain/money';
import { ServiceError, assertInt, assertIsoDate, nextRef, one } from './common';
import { getStock } from './queries';
import { settleParty } from './settlement';

export interface ReturnLineIn { invoiceLineId: number; qtyMilli: QtyMilli; usable?: boolean }
export interface ReturnIn { invoiceId: number; date: string; lines: ReturnLineIn[]; notes?: string }

/**
 * Customer return (against a sale) or supplier return (against a purchase). Explicit linked records:
 * never an ordinary sale/purchase, so revenue, purchase totals and balances stay undistorted.
 * Value = the line's net price (incl. its share of the invoice discount) pro rata; the final remainder takes the rounding residue.
 */
export async function postReturn(db: Db, input: ReturnIn): Promise<{ id: number; ref: string; total: Minor }> {
  assertIsoDate(input.date);
  if (input.lines.length === 0) throw new ServiceError('NO_LINES', 'اختر صنفاً واحداً على الأقل');
  return db.transaction(async tx => {
    const inv = await one<{ kind: 'sale' | 'purchase'; party_id: number; date: string; subtotal: number; total: number; cancelled_at: string | null }>(tx,
      'SELECT kind, party_id, date, subtotal, total, cancelled_at FROM invoices WHERE id = ?', [input.invoiceId]);
    if (!inv) throw new ServiceError('NOT_FOUND', 'الفاتورة غير موجودة');
    if (inv.cancelled_at) throw new ServiceError('INVOICE_CANCELLED', 'الفاتورة ملغاة');
    if (input.date < inv.date) throw new ServiceError('INVALID_DATE', 'تاريخ المرتجع قبل تاريخ الفاتورة');
    if (new Set(input.lines.map(l => l.invoiceLineId)).size !== input.lines.length) throw new ServiceError('DUPLICATE_LINE', 'الصنف مكرر في المرتجع');

    const prepared: { il: { id: number; product_id: number; unit_price: number }; qty: number; base: number; value: number; usable: boolean }[] = [];
    for (const l of input.lines) {
      assertInt(l.qtyMilli, 'الكمية', { min: 1 });
      const il = await one<{ id: number; product_id: number; qty_milli: number; base_qty_milli: number; unit_price: number; line_total: number }>(tx,
        'SELECT id, product_id, qty_milli, base_qty_milli, unit_price, line_total FROM invoice_lines WHERE id = ? AND invoice_id = ?', [l.invoiceLineId, input.invoiceId]);
      if (!il) throw new ServiceError('LINE_NOT_FOUND', 'بند غير موجود في هذه الفاتورة');
      const done = (await one<{ q: number; b: number; v: number }>(tx,
        'SELECT COALESCE(SUM(qty_milli),0) AS q, COALESCE(SUM(base_qty_milli),0) AS b, COALESCE(SUM(line_total),0) AS v FROM return_lines WHERE invoice_line_id = ?', [il.id]))!;
      const remaining = il.qty_milli - done.q;
      if (l.qtyMilli > remaining) throw new ServiceError('OVER_RETURN', `الكمية المتاحة للإرجاع من هذا البند: ${(remaining / 1000).toLocaleString('ar-EG')}`, { remaining });
      const lineShare = inv.subtotal > 0 ? Math.round((il.line_total * inv.total) / inv.subtotal) : 0;
      const full = l.qtyMilli === remaining;
      prepared.push({
        il, qty: l.qtyMilli, usable: l.usable ?? true,
        base: full ? il.base_qty_milli - done.b : Math.round((il.base_qty_milli * l.qtyMilli) / il.qty_milli),
        value: Math.max(0, full ? lineShare - done.v : Math.round((lineShare * l.qtyMilli) / il.qty_milli)),
      });
    }

    const isCustomer = inv.kind === 'sale';
    if (!isCustomer) { // supplier return removes goods from stock: it must be physically there
      const per = new Map<number, number>();
      for (const p of prepared) per.set(p.il.product_id, (per.get(p.il.product_id) ?? 0) + p.base);
      for (const [pid, q] of per) {
        const avail = await getStock(tx, pid);
        if (avail < q) throw new ServiceError('INSUFFICIENT_STOCK', `المتاح للإرجاع للمورد: ${(avail / 1000).toLocaleString('ar-EG')} فقط`, { productId: pid, available: avail });
      }
    }
    const total = prepared.reduce((s, p) => s + p.value, 0);
    const ref = await nextRef(tx, isCustomer ? 'SR' : 'PR');
    const id = (await tx.run('INSERT INTO returns(kind, ref, invoice_id, party_id, date, total, notes) VALUES (?,?,?,?,?,?,?)',
      [isCustomer ? 'customer' : 'supplier', ref, input.invoiceId, inv.party_id, input.date, total, input.notes ?? null])).lastId;
    for (const p of prepared) {
      await tx.run('INSERT INTO return_lines(return_id, product_id, base_qty_milli, unit_price, line_total, usable, invoice_line_id, qty_milli) VALUES (?,?,?,?,?,?,?,?)',
        [id, p.il.product_id, p.base, p.il.unit_price, p.value, p.usable ? 1 : 0, p.il.id, p.qty]);
      if (!isCustomer || p.usable) { // unusable customer returns do not re-enter stock
        const mv = makeMovement(isCustomer ? 'sale_return' : 'purchase_return', p.base);
        await tx.run("INSERT INTO stock_movements(product_id, type, base_qty_milli, date, source_table, source_id) VALUES (?,?,?,?, 'returns', ?)", [p.il.product_id, mv.type, mv.baseQty, input.date, id]);
      }
    }
    const type = isCustomer ? 'sale_return' : 'purchase_return';
    await tx.run("INSERT INTO ledger_entries(party_id, type, delta, date, source_table, source_id) VALUES (?,?,?,?, 'returns', ?)",
      [inv.party_id, type, entryDelta({ type, amount: total, date: input.date }), input.date, id]);
    await settleParty(tx, inv.party_id); // a return on a paid invoice frees money that now pays the next bill
    return { id, ref, total };
  });
}
