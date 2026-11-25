import type { Minor } from './money';

/**
 * Balance convention (business perspective), for customers AND suppliers:
 *   > 0 : party owes the business
 *   < 0 : business owes the party
 *   = 0 : settled
 */
export type PartyKind = 'customer' | 'supplier';
export type EntryType =
  | 'sale' | 'sale_return' | 'receipt'
  | 'purchase' | 'purchase_return' | 'payment'
  | 'opening' | 'adjustment';

export interface LedgerEntry {
  type: EntryType;
  amount: Minor;
  date: string;
  signedAmount?: Minor; // only for opening/adjustment
}

export function entryDelta(e: LedgerEntry): Minor {
  switch (e.type) {
    case 'sale': return e.amount;
    case 'sale_return': return -e.amount;
    case 'receipt': return -e.amount;
    case 'purchase': return -e.amount;
    case 'purchase_return': return e.amount;
    case 'payment': return e.amount;
    case 'opening':
    case 'adjustment': return e.signedAmount ?? 0;
  }
}

export function balanceAsOf(entries: LedgerEntry[], endDate: string): Minor {
  return entries.filter(e => e.date <= endDate).reduce((s, e) => s + entryDelta(e), 0);
}

export type BalanceState = 'owes_us' | 'we_owe' | 'settled';
export function balanceState(b: Minor): BalanceState {
  return b > 0 ? 'owes_us' : b < 0 ? 'we_owe' : 'settled';
}

export function balanceLabelAr(kind: PartyKind, b: Minor): string {
  const s = balanceState(b);
  if (s === 'settled') return 'الحساب مسوّى';
  if (kind === 'customer') return s === 'owes_us' ? 'مستحق لنا على العميل' : 'رصيد دائن للعميل (دفع مقدماً)';
  return s === 'we_owe' ? 'مستحق للمورد علينا' : 'رصيد مدين على المورد (دفعنا مقدماً)';
}
