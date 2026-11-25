import { describe, it, expect } from 'vitest';
import { egpToMinor, lineTotal, qtyToMilli } from '../src/domain/money';
import { balanceAsOf, balanceState, balanceLabelAr, type LedgerEntry } from '../src/domain/ledger';
import { computeInvoice, splitPayment } from '../src/domain/invoice';
import { checkSale, makeMovement, reverse, stockOf, toBaseQty } from '../src/domain/inventory';
import { actualProfit, idealProfit, payablesFrom, receivablesFrom, percentChange, cashNet } from '../src/domain/metrics';

describe('money', () => {
  it('rounds without float drift', () => {
    expect(egpToMinor(0.1 + 0.2)).toBe(30);
    expect(egpToMinor(19.99)).toBe(1999);
    expect(lineTotal(qtyToMilli(3), egpToMinor(12.5))).toBe(3750);
    expect(lineTotal(qtyToMilli(0.333), 100)).toBe(33);   // 33.3 -> 33
    expect(lineTotal(qtyToMilli(0.335), 100)).toBe(34);   // 33.5 -> 34 (half up)
  });
});

describe('invoices & payments', () => {
  const lines = [{ qty: qtyToMilli(10), unitPrice: 500, lineDiscount: 100 }, { qty: qtyToMilli(2), unitPrice: 2500 }];
  it('computes totals with line and invoice discounts', () => {
    const t = computeInvoice(lines, 400);
    expect(t).toEqual({ subtotal: 10000, lineDiscounts: 100, invoiceDiscount: 400, total: 9500 });
  });
  it('rejects bad input', () => {
    expect(() => computeInvoice([{ qty: 0, unitPrice: 1 }])).toThrow();
    expect(() => computeInvoice(lines, 99999)).toThrow();
  });
  it('cash / partial / credit / overpayment', () => {
    expect(splitPayment(9500, 9500)).toEqual({ paid: 9500, outstanding: 0, overpaymentAdvance: 0 });
    expect(splitPayment(9500, 4000)).toEqual({ paid: 4000, outstanding: 5500, overpaymentAdvance: 0 });
    expect(splitPayment(9500, 0).outstanding).toBe(9500);
    expect(splitPayment(9500, 10000)).toEqual({ paid: 9500, outstanding: 0, overpaymentAdvance: 500 });
  });
});

describe('party balances', () => {
  const cust: LedgerEntry[] = [
    { type: 'opening', amount: 0, signedAmount: 1000, date: '2026-01-01' },
    { type: 'sale', amount: 5000, date: '2026-02-01' },
    { type: 'receipt', amount: 2000, date: '2026-02-05' },
    { type: 'sale_return', amount: 500, date: '2026-02-10' },
  ];
  const supp: LedgerEntry[] = [
    { type: 'purchase', amount: 8000, date: '2026-02-01' },
    { type: 'payment', amount: 3000, date: '2026-02-03' },
  ];
  it('customer: credit sale positive, receipt/return reduce', () => {
    expect(balanceAsOf(cust, '2026-02-01')).toBe(6000);
    expect(balanceAsOf(cust, '2026-12-31')).toBe(3500);
  });
  it('supplier: credit purchase negative, payment moves toward zero', () => {
    expect(balanceAsOf(supp, '2026-02-01')).toBe(-8000);
    expect(balanceAsOf(supp, '2026-02-28')).toBe(-5000);
  });
  it('overpayment produces opposite sign with correct labels', () => {
    const over = [...supp, { type: 'payment' as const, amount: 6000, date: '2026-03-01' }];
    const b = balanceAsOf(over, '2026-03-31');
    expect(b).toBe(1000);
    expect(balanceState(b)).toBe('owes_us');
    expect(balanceLabelAr('supplier', b)).toContain('دفعنا مقدماً');
    expect(balanceLabelAr('customer', 500)).toContain('مستحق لنا');
    expect(balanceLabelAr('customer', 0)).toContain('مسوّى');
  });
  it('opening balance respects range end', () => {
    expect(balanceAsOf(cust, '2025-12-31')).toBe(0);
  });
});

describe('inventory', () => {
  it('purchase/sale/returns/missing net correctly', () => {
    const m = [makeMovement('purchase', 100000), makeMovement('sale', 30000), makeMovement('sale_return', 5000),
      makeMovement('purchase_return', 10000), makeMovement('missing', 2000)];
    expect(stockOf(m)).toBe(63000);
  });
  it('unit conversion', () => {
    expect(toBaseQty(qtyToMilli(2), { id: 'carton', factorToBase: 24 })).toBe(48000);
    expect(() => toBaseQty(1000, { id: 'x', factorToBase: 0 })).toThrow();
  });
  it('blocks oversell and reports available', () => {
    expect(checkSale(10000, 12000)).toEqual({ ok: false, available: 10000, shortfall: 2000 });
    expect(checkSale(10000, 10000).ok).toBe(true);
  });
  it('reversal cancels the original exactly once', () => {
    const orig = makeMovement('sale', 4000);
    expect(stockOf([makeMovement('purchase', 10000), orig, reverse(orig)])).toBe(10000);
  });
});

describe('custom metrics', () => {
  it('actual & ideal profit use documented mapping', () => {
    const p = { netSales: 100000, netPurchases: 70000, receivables: 25000, payables: 15000 };
    expect(actualProfit(p)).toBe(30000);
    expect(idealProfit(p)).toBe(40000);
  });
  it('receivables/payables ignore opposite-sign balances', () => {
    expect(receivablesFrom([500, -200, 300])).toBe(800);
    expect(payablesFrom([-700, 100, -50])).toBe(750);
  });
  it('cash net', () => expect(cashNet(9000, 4000)).toBe(5000));
  it('percent change handles zero baseline', () => {
    expect(percentChange(150, 100)).toEqual({ kind: 'percent', value: 50 });
    expect(percentChange(50, 100)).toEqual({ kind: 'percent', value: -50 });
    expect(percentChange(10, 0)).toEqual({ kind: 'new' });
    expect(percentChange(0, 0)).toEqual({ kind: 'none' });
  });
});
