import type { Db } from '../db/types';
import { toBaseQty } from '../domain/inventory';
import type { QtyMilli } from '../domain/money';
import { ServiceError, assertInt, assertIsoDate, one } from './common';
import { getStock } from './queries';

export type AdjustReason = 'missing' | 'lost' | 'damaged' | 'correction';
export interface AdjustIn {
  productId: number; qtyMilli: QtyMilli; unitId?: number; date: string; reason: AdjustReason; notes?: string; allowNegativeStock?: boolean;
}
const TYPE: Record<AdjustReason, 'missing' | 'damaged' | 'adjustment'> = { missing: 'missing', lost: 'missing', damaged: 'damaged', correction: 'adjustment' };

/** Missing/lost/damaged stock reduces inventory and is NEVER recorded as a sale or revenue. `correction` may be +/- (stock count fix). */
export async function recordStockAdjustment(db: Db, input: AdjustIn): Promise<{ id: number; stockAfter: number }> {
  assertIsoDate(input.date);
  if (!(input.reason in TYPE)) throw new ServiceError('REASON_REQUIRED', 'سبب التعديل مطلوب');
  assertInt(input.qtyMilli, 'الكمية');
  if (input.qtyMilli === 0 || (input.reason !== 'correction' && input.qtyMilli < 0)) throw new ServiceError('INVALID_NUMBER', 'الكمية غير صالحة');
  return db.transaction(async tx => {
    const p = await one<{ base_unit_id: number }>(tx, 'SELECT base_unit_id FROM products WHERE id = ?', [input.productId]);
    if (!p) throw new ServiceError('PRODUCT_NOT_FOUND', 'الصنف غير موجود');
    const unitId = input.unitId ?? p.base_unit_id;
    const pu = await one<{ factor_to_base: number }>(tx, 'SELECT factor_to_base FROM product_units WHERE product_id = ? AND unit_id = ?', [input.productId, unitId]);
    if (!pu) throw new ServiceError('UNIT_NOT_ALLOWED', 'الوحدة غير معرّفة لهذا الصنف');
    const mag = toBaseQty(Math.abs(input.qtyMilli), { id: String(unitId), factorToBase: pu.factor_to_base });
    const signed = input.reason === 'correction' ? Math.sign(input.qtyMilli) * mag : -mag;
    const stock = await getStock(tx, input.productId);
    if (stock + signed < 0 && !input.allowNegativeStock) throw new ServiceError('INSUFFICIENT_STOCK', `المتاح: ${(stock / 1000).toLocaleString('ar-EG')} فقط`, { available: stock });
    const id = (await tx.run("INSERT INTO stock_movements(product_id, type, base_qty_milli, date, reason, notes, source_table) VALUES (?,?,?,?,?,?, 'adjustment')",
      [input.productId, TYPE[input.reason], signed, input.date, input.reason, input.notes ?? null])).lastId;
    return { id, stockAfter: stock + signed };
  });
}
