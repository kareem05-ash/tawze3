import type { Db } from '../db/types';
import { balanceLabelAr, balanceState } from '../domain/ledger';
import { ar } from '../i18n/ar';
import { getInvoiceDetail, getParty, getSetting } from '../services';
import { dateLabel, money, qty } from '../ui/format';

export interface ReceiptLine { name: string; qty: string; unit: string; price: string; total: string; discount?: string }
export interface ReceiptModel {
  business: string; typeLabel: string; ref: string; partyLabel: string; partyName: string; date: string; externalRef?: string;
  lines: ReceiptLine[];
  subtotal: string; invoiceDiscount?: string; total: string; returned?: string; paid: string; outstanding: string; outstandingPositive: boolean; credit?: string;
  account?: { amount: string; label: string; tone: 'owes' | 'we' | 'settled' };
  notes?: string; cancelled: boolean; filename: string; phone: string | null; shareText: string;
}

/** Everything the image/PDF needs, already formatted in Arabic. Pure data: the renderer only draws it. */
export async function buildReceiptModel(db: Db, invoiceId: number): Promise<ReceiptModel> {
  const det = await getInvoiceDetail(db, invoiceId);
  if (!det) throw new Error('الفاتورة غير موجودة');
  const inv = det.invoice as Record<string, unknown>; const st = det.state; const sale = st.kind === 'sale';
  const party = await getParty(db, st.partyId);
  const business = (await getSetting(db, 'business_name')) || ar.appName;
  const typeLabel = sale ? ar.invoice.saleType : ar.invoice.purchaseType; const ref = String(inv.ref);
  const bal = party?.balance ?? 0; const s = balanceState(bal);
  return {
    business, typeLabel, ref, partyLabel: sale ? ar.invoice.customer : ar.invoice.supplier, partyName: det.invoice.party_name, date: dateLabel(String(inv.date)),
    externalRef: inv.external_ref ? String(inv.external_ref) : undefined,
    lines: det.lines.map(l => ({ name: l.product_name, qty: qty(Number(l.qty_milli)), unit: l.unit_name, price: money(Number(l.unit_price)), total: money(Number(l.line_total)),
      discount: Number(l.line_discount) > 0 ? `${ar.invoice.lineDiscount}: ${money(Number(l.line_discount))}` : undefined })),
    subtotal: money(Number(inv.subtotal)), invoiceDiscount: Number(inv.discount) > 0 ? money(Number(inv.discount)) : undefined, total: money(Number(inv.total)),
    returned: st.returned > 0 ? money(st.returned) : undefined, paid: money(st.paid), outstanding: money(st.outstanding), outstandingPositive: st.outstanding > 0,
    credit: st.credit > 0 ? money(st.credit) : undefined,
    account: party ? { amount: money(Math.abs(bal)), label: balanceLabelAr(party.kind, bal), tone: s === 'owes_us' ? 'owes' : s === 'we_owe' ? 'we' : 'settled' } : undefined,
    notes: inv.notes ? String(inv.notes) : undefined, cancelled: st.cancelled, filename: ref, phone: party?.phone ?? null,
    shareText: `${typeLabel} ${ref} — ${det.invoice.party_name} — ${money(Number(inv.total))}`,
  };
}
