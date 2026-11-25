import { lineTotal, type Minor, type QtyMilli } from './money';

export interface InvoiceLineInput { qty: QtyMilli; unitPrice: Minor; lineDiscount?: Minor }
export interface InvoiceTotals { subtotal: Minor; lineDiscounts: Minor; invoiceDiscount: Minor; total: Minor }

export function computeInvoice(lines: InvoiceLineInput[], invoiceDiscount: Minor = 0): InvoiceTotals {
  let gross = 0, ld = 0;
  for (const l of lines) {
    if (l.qty <= 0) throw new Error('الكمية يجب أن تكون أكبر من صفر');
    if (l.unitPrice < 0) throw new Error('السعر لا يمكن أن يكون سالباً');
    const g = lineTotal(l.qty, l.unitPrice);
    const d = l.lineDiscount ?? 0;
    if (d < 0 || d > g) throw new Error('خصم البند غير صالح');
    gross += g; ld += d;
  }
  const net = gross - ld;
  if (invoiceDiscount < 0 || invoiceDiscount > net) throw new Error('خصم الفاتورة غير صالح');
  return { subtotal: gross, lineDiscounts: ld, invoiceDiscount, total: net - invoiceDiscount };
}

export interface PaymentSplit { paid: Minor; outstanding: Minor; overpaymentAdvance: Minor }
/** Immediate payment above the total is kept as an advance on the party account, never lost. */
export function splitPayment(total: Minor, paidNow: Minor): PaymentSplit {
  if (paidNow < 0) throw new Error('المبلغ المدفوع لا يمكن أن يكون سالباً');
  const applied = Math.min(total, paidNow);
  return { paid: applied, outstanding: total - applied, overpaymentAdvance: paidNow - applied };
}
