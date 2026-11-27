import type { Db } from '../db/types';
import { entryDelta } from '../domain/ledger';
import type { Minor } from '../domain/money';
import { ServiceError, assertInt, assertIsoDate, nextRef, one } from './common';
import { getInvoiceState } from './queries';
import { settleParty } from './settlement';

export interface PaymentInsert {
  partyId: number; direction: 'in' | 'out'; amount: Minor; date: string; method?: string; notes?: string | null;
  allocations: { invoiceId: number | null; amount: Minor }[]; // invoiceId null = unapplied credit; settleParty then applies it oldest-bill-first
}

/** One payment = one payment row + ONE ledger entry. Allocations are informational splits, so nothing is counted twice. */
export async function insertPayment(tx: Db, p: PaymentInsert): Promise<{ id: number; ref: string }> {
  if (p.allocations.reduce((s, a) => s + a.amount, 0) !== p.amount) throw new ServiceError('ALLOCATION_MISMATCH', 'توزيع الدفعة لا يساوي المبلغ');
  const ref = await nextRef(tx, p.direction === 'in' ? 'RC' : 'PM');
  const id = (await tx.run('INSERT INTO payments(ref, party_id, direction, amount, method, date, notes) VALUES (?,?,?,?,?,?,?)',
    [ref, p.partyId, p.direction, p.amount, p.method ?? 'cash', p.date, p.notes ?? null])).lastId;
  for (const a of p.allocations) if (a.amount > 0) await tx.run('INSERT INTO payment_allocations(payment_id, invoice_id, amount, kind) VALUES (?,?,?,?)', [id, a.invoiceId, a.amount, a.invoiceId === null ? 'advance' : 'invoice']);
  const type = p.direction === 'in' ? 'receipt' : 'payment';
  await tx.run('INSERT INTO ledger_entries(party_id, type, delta, date, source_table, source_id) VALUES (?,?,?,?,?,?)',
    [p.partyId, type, entryDelta({ type, amount: p.amount, date: p.date }), p.date, 'payments', id]);
  return { id, ref };
}

export interface RecordPaymentInput { partyId: number; amount: Minor; date: string; invoiceId?: number; method?: string; notes?: string }
/**
 * Customer -> money received. Supplier -> money paid.
 * Without `invoiceId` the money covers the OLDEST open bills first (opening balance, then invoices by date); anything beyond what is owed is kept as
 * credit and is applied automatically to the next invoice. With `invoiceId` that invoice is paid first and the rest continues oldest-first.
 */
export async function recordPayment(db: Db, input: RecordPaymentInput) {
  assertInt(input.amount, 'المبلغ', { min: 1 });
  assertIsoDate(input.date);
  return db.transaction(async tx => {
    const party = await one<{ kind: string }>(tx, 'SELECT kind FROM parties WHERE id = ?', [input.partyId]);
    if (!party) throw new ServiceError('PARTY_NOT_FOUND', 'الحساب غير موجود');
    const direction = party.kind === 'customer' ? 'in' : 'out';
    let first = 0;
    const allocations: PaymentInsert['allocations'] = [];
    if (input.invoiceId !== undefined) {
      const st = await getInvoiceState(tx, input.invoiceId);
      if (!st || st.partyId !== input.partyId) throw new ServiceError('INVOICE_MISMATCH', 'الفاتورة لا تخص هذا الحساب');
      if (st.cancelled) throw new ServiceError('INVOICE_CANCELLED', 'الفاتورة ملغاة');
      if (st.outstanding === 0) throw new ServiceError('NOTHING_OUTSTANDING', 'هذه الفاتورة مسددة بالكامل');
      first = Math.min(input.amount, st.outstanding);
      allocations.push({ invoiceId: input.invoiceId, amount: first });
    }
    if (input.amount - first > 0) allocations.push({ invoiceId: null, amount: input.amount - first });
    const { id, ref } = await insertPayment(tx, { partyId: input.partyId, direction, amount: input.amount, date: input.date, method: input.method, notes: input.notes, allocations });
    await settleParty(tx, input.partyId);
    const split = await tx.all<{ kind: string; s: number }>('SELECT kind, SUM(amount) AS s FROM payment_allocations WHERE payment_id = ? GROUP BY kind', [id]);
    const sum = (k: string) => split.find(x => x.kind === k)?.s ?? 0;
    return { id, ref, appliedToInvoices: sum('invoice'), appliedToOpening: sum('opening'), advance: sum('advance') };
  });
}

/** Voids a payment: the row stays (audit), a reversing ledger entry is added with the same date, and it is excluded from cash totals. */
export async function cancelPaymentTx(tx: Db, id: number): Promise<void> {
  const pay = await one<{ cancelled_at: string | null }>(tx, 'SELECT cancelled_at FROM payments WHERE id = ?', [id]);
  if (!pay) throw new ServiceError('NOT_FOUND', 'الدفعة غير موجودة');
  if (pay.cancelled_at) throw new ServiceError('ALREADY_CANCELLED', 'الدفعة ملغاة بالفعل');
  const led = await tx.all<{ id: number; party_id: number; type: string; delta: number; date: string }>(
    "SELECT id, party_id, type, delta, date FROM ledger_entries WHERE source_table = 'payments' AND source_id = ? AND reverses_id IS NULL", [id]);
  for (const l of led) await tx.run("INSERT INTO ledger_entries(party_id, type, delta, date, source_table, source_id, reverses_id) VALUES (?,?,?,?, 'payments', ?, ?)", [l.party_id, l.type, -l.delta, l.date, id, l.id]);
  await tx.run("UPDATE payments SET cancelled_at = datetime('now') WHERE id = ?", [id]);
}
export const cancelPayment = (db: Db, id: number) => db.transaction(async tx => {
  const p = await one<{ party_id: number }>(tx, 'SELECT party_id FROM payments WHERE id = ?', [id]);
  await cancelPaymentTx(tx, id);
  if (p) await settleParty(tx, p.party_id); // credit from other payments may now cover the bills this one used to pay
});
