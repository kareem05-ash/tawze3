import type { Minor } from './money';

/** CENTRAL formula definitions (user's custom metrics). Change here + tests only.
 *  outsource = net sales; income = net purchases;
 *  receivables = sum of positive customer balances at period end;
 *  payables = sum of |negative| supplier balances at period end. */
export interface PeriodInputs { netSales: Minor; netPurchases: Minor; receivables: Minor; payables: Minor }
export const actualProfit = (p: PeriodInputs): Minor => p.netSales - p.netPurchases;
export const idealProfit = (p: PeriodInputs): Minor => p.netSales + p.receivables - p.netPurchases - p.payables;

export const receivablesFrom = (customerBalances: Minor[]): Minor =>
  customerBalances.reduce((s, b) => s + (b > 0 ? b : 0), 0);
export const payablesFrom = (supplierBalances: Minor[]): Minor =>
  supplierBalances.reduce((s, b) => s + (b < 0 ? -b : 0), 0);

export const cashNet = (received: Minor, paid: Minor): Minor => received - paid;

export type Change = { kind: 'percent'; value: number } | { kind: 'new' } | { kind: 'none' };
export function percentChange(current: number, previous: number): Change {
  if (previous === 0) return current === 0 ? { kind: 'none' } : { kind: 'new' };
  return { kind: 'percent', value: Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10 };
}
