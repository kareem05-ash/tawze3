import type { QtyMilli } from './money';

export interface UnitDef { id: string; factorToBase: number }
export function toBaseQty(qty: QtyMilli, unit: UnitDef): QtyMilli {
  if (!(unit.factorToBase > 0)) throw new Error('معامل تحويل الوحدة غير صالح');
  return Math.round(qty * unit.factorToBase);
}
export type MovementType = 'purchase' | 'sale' | 'sale_return' | 'purchase_return' | 'missing' | 'damaged' | 'adjustment' | 'reversal';
export interface Movement { type: MovementType; baseQty: QtyMilli } // signed

export const stockSign = {
  purchase: 1, sale: -1, sale_return: 1, purchase_return: -1, missing: -1, damaged: -1,
} as const;

export function makeMovement(type: keyof typeof stockSign, absBaseQty: QtyMilli): Movement {
  if (absBaseQty <= 0) throw new Error('الكمية يجب أن تكون أكبر من صفر');
  return { type, baseQty: stockSign[type] * absBaseQty };
}
export function stockOf(movements: Movement[]): QtyMilli {
  return movements.reduce((s, m) => s + m.baseQty, 0);
}
export interface SaleCheck { ok: boolean; available: QtyMilli; shortfall: QtyMilli }
export function checkSale(current: QtyMilli, requestedBase: QtyMilli): SaleCheck {
  const shortfall = Math.max(0, requestedBase - current);
  return { ok: shortfall === 0, available: current, shortfall };
}
export function reverse(m: Movement): Movement { return { type: 'reversal', baseQty: -m.baseQty }; }
