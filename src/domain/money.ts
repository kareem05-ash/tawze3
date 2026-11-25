/** Money is stored as integer piasters (1 EGP = 100). Quantities as integer milli-units (1 unit = 1000). */
export type Minor = number;
export type QtyMilli = number;

export function egpToMinor(egp: number): Minor {
  return Math.round((egp + Number.EPSILON) * 100);
}
export function minorToEgp(m: Minor): number {
  return m / 100;
}
export function qtyToMilli(q: number): QtyMilli {
  return Math.round((q + Number.EPSILON) * 1000);
}
/** line total = qty * unit price, rounded half away from zero to whole piasters. */
export function lineTotal(qty: QtyMilli, unitPrice: Minor): Minor {
  const raw = (qty * unitPrice) / 1000;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}
export function formatEgp(m: Minor, locale = 'ar-EG'): string {
  const v = minorToEgp(m);
  const hasFraction = m % 100 !== 0;
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'EGP',
    minimumFractionDigits: hasFraction ? 2 : 0, maximumFractionDigits: 2,
  }).format(v);
}
