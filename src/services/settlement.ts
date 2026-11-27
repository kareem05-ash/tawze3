import type { Db } from '../db/types';
import { allocateFifo } from '../domain/payments';
import { invoiceStatus } from '../domain/invoice';
import { one } from './common';

/**
 * Oldest-bill-first settlement.
 *
 * What a party owes is a list of OPEN ITEMS, oldest first: the opening balance carried in from before the app (always oldest), then
 * invoices by date. Payments carry allocations: kind 'invoice' (to an invoice), 'opening', or 'advance' (credit not yet applied).
 * `settleParty` keeps one invariant: a party never has unapplied credit AND open items at the same time. So a payment with no invoice
 * chosen covers the oldest bills first, a prepayment is absorbed by the next invoice, and money freed by a return flows to the next bill.
 * The party balance itself always comes from the ledger and is never touched here.
 */
export interface OpenItem { key: string; kind: 'opening' | 'invoice'; invoiceId?: number; ref?: string; date?: string; outstanding: number }

async function partyKind(db: Db, partyId: number) { return (await one<{ kind: 'customer' | 'supplier' }>(db, 'SELECT kind FROM parties WHERE id = ?', [partyId]))?.kind; }

export async function openingOutstanding(db: Db, partyId: number): Promise<number> {
  const kind = await partyKind(db, partyId); if (!kind) return 0;
  const o = (await one<{ s: number }>(db, "SELECT COALESCE(SUM(delta),0) AS s FROM ledger_entries WHERE party_id = ? AND type = 'opening'", [partyId]))?.s ?? 0;
  const debt = kind === 'customer' ? Math.max(0, o) : Math.max(0, -o);   // a carried-in balance in the other direction is credit, shown in the balance only
  const paid = (await one<{ s: number }>(db, "SELECT COALESCE(SUM(a.amount),0) AS s FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE p.party_id = ? AND p.cancelled_at IS NULL AND a.kind = 'opening'", [partyId]))?.s ?? 0;
  return Math.max(0, debt - paid);
}
export async function poolCredit(db: Db, partyId: number): Promise<number> {
  return (await one<{ s: number }>(db, "SELECT COALESCE(SUM(a.amount),0) AS s FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE p.party_id = ? AND p.cancelled_at IS NULL AND a.kind = 'advance'", [partyId]))?.s ?? 0;
}

interface InvRow { id: number; ref: string; date: string; total: number; paid: number; returned: number }
async function partyInvoices(db: Db, partyId: number, kind: 'customer' | 'supplier'): Promise<InvRow[]> {
  return db.all<InvRow>(
    `SELECT i.id, i.ref, i.date, i.total,
       COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE a.invoice_id = i.id AND a.kind = 'invoice' AND p.cancelled_at IS NULL),0) AS paid,
       COALESCE((SELECT SUM(r.total) FROM returns r WHERE r.invoice_id = i.id),0) AS returned
     FROM invoices i WHERE i.party_id = ? AND i.cancelled_at IS NULL AND i.kind = ? ORDER BY i.date, i.id`, [partyId, kind === 'customer' ? 'sale' : 'purchase']);
}

/** Oldest first: opening balance, then invoices by date. Only items with something outstanding. */
export async function listOpenItems(db: Db, partyId: number): Promise<OpenItem[]> {
  const kind = await partyKind(db, partyId); if (!kind) return [];
  const items: OpenItem[] = []; const open = await openingOutstanding(db, partyId);
  if (open > 0) items.push({ key: 'opening', kind: 'opening', outstanding: open });
  for (const r of await partyInvoices(db, partyId, kind)) {
    const out = invoiceStatus(r.total, r.returned, r.paid).outstanding;
    if (out > 0) items.push({ key: `inv:${r.id}`, kind: 'invoice', invoiceId: r.id, ref: r.ref, date: r.date, outstanding: out });
  }
  return items;
}

/** Allocation row helpers. A row is identified by (payment, invoice or null, kind); amounts stay > 0 (rows are deleted at zero). */
export async function addAllocation(tx: Db, paymentId: number, invoiceId: number | null, kind: 'invoice' | 'opening' | 'advance', amount: number) {
  if (amount <= 0) return;
  const r = await tx.run('UPDATE payment_allocations SET amount = amount + ? WHERE payment_id = ? AND kind = ? AND invoice_id IS ?', [amount, paymentId, kind, invoiceId]);
  if (r.changes === 0) await tx.run('INSERT INTO payment_allocations(payment_id, invoice_id, amount, kind) VALUES (?,?,?,?)', [paymentId, invoiceId, amount, kind]);
}
export async function reduceAllocation(tx: Db, paymentId: number, invoiceId: number | null, kind: 'invoice' | 'opening' | 'advance', amount: number) {
  const row = await one<{ amount: number }>(tx, 'SELECT amount FROM payment_allocations WHERE payment_id = ? AND kind = ? AND invoice_id IS ?', [paymentId, kind, invoiceId]);
  if (!row) return;
  if (row.amount <= amount) await tx.run('DELETE FROM payment_allocations WHERE payment_id = ? AND kind = ? AND invoice_id IS ?', [paymentId, kind, invoiceId]);
  else await tx.run('UPDATE payment_allocations SET amount = amount - ? WHERE payment_id = ? AND kind = ? AND invoice_id IS ?', [amount, paymentId, kind, invoiceId]);
}

/** Moves up to `amount` of an invoice's allocations (newest payment first) back to unapplied credit. Returns what was moved. */
export async function releaseFromInvoice(tx: Db, invoiceId: number, amount: number): Promise<number> {
  const rows = await tx.all<{ payment_id: number; amount: number }>(
    "SELECT a.payment_id, a.amount FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE a.invoice_id = ? AND a.kind = 'invoice' AND p.cancelled_at IS NULL ORDER BY p.date DESC, p.id DESC", [invoiceId]);
  let left = amount;
  for (const r of rows) {
    if (left <= 0) break; const t = Math.min(left, r.amount);
    await reduceAllocation(tx, r.payment_id, invoiceId, 'invoice', t); await addAllocation(tx, r.payment_id, null, 'advance', t); left -= t;
  }
  return amount - left;
}

async function applyPool(tx: Db, partyId: number, target: { invoiceId: number | null; kind: 'invoice' | 'opening' }, amount: number) {
  const rows = await tx.all<{ payment_id: number; amount: number }>(
    "SELECT a.payment_id, a.amount FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE p.party_id = ? AND p.cancelled_at IS NULL AND a.kind = 'advance' ORDER BY p.date, p.id", [partyId]);
  let left = amount;
  for (const r of rows) {
    if (left <= 0) break; const t = Math.min(left, r.amount);
    await reduceAllocation(tx, r.payment_id, null, 'advance', t); await addAllocation(tx, r.payment_id, target.invoiceId, target.kind, t); left -= t;
  }
}

/** Call after anything that can change what is owed or paid: posting an invoice or payment, a return, a cancellation. Idempotent. */
export async function settleParty(tx: Db, partyId: number): Promise<void> {
  const kind = await partyKind(tx, partyId); if (!kind) return;
  // 1. an invoice paid beyond its net value (after a return) frees the excess as credit
  for (const r of await partyInvoices(tx, partyId, kind)) {
    const st = invoiceStatus(r.total, r.returned, r.paid);
    if (st.credit > 0) await releaseFromInvoice(tx, r.id, st.credit);
  }
  // 2. unapplied credit pays the oldest open items
  const pool = await poolCredit(tx, partyId); if (pool <= 0) return;
  const items = await listOpenItems(tx, partyId); if (items.length === 0) return;
  const { applied } = allocateFifo(items.map(i => ({ key: i.key, outstanding: i.outstanding })), pool);
  for (const a of applied) {
    const it = items.find(i => i.key === a.key)!;
    await applyPool(tx, partyId, it.kind === 'opening' ? { invoiceId: null, kind: 'opening' } : { invoiceId: it.invoiceId!, kind: 'invoice' }, a.amount);
  }
}

export interface PaymentPreview {
  totalDue: number;
  lines: { kind: 'opening' | 'invoice'; invoiceId?: number; ref?: string; applied: number; remainingAfter: number; fullyPaid: boolean }[];
  advance: number;
}
/** What a payment of `amount` would do, without saving anything. With `invoiceId` that invoice is paid first, the rest goes oldest-first. */
export async function previewPayment(db: Db, partyId: number, amount: number, invoiceId?: number): Promise<PaymentPreview> {
  let items = await listOpenItems(db, partyId);
  const totalDue = items.reduce((s, i) => s + i.outstanding, 0);
  if (invoiceId !== undefined) { const first = items.find(i => i.invoiceId === invoiceId); if (first) items = [first, ...items.filter(i => i !== first)]; }
  const { applied, leftover } = allocateFifo(items.map(i => ({ key: i.key, outstanding: i.outstanding })), Math.max(0, amount));
  return {
    totalDue, advance: leftover,
    lines: applied.map(a => { const it = items.find(i => i.key === a.key)!; return { kind: it.kind, invoiceId: it.invoiceId, ref: it.ref, applied: a.amount, remainingAfter: it.outstanding - a.amount, fullyPaid: it.outstanding - a.amount === 0 }; }),
  };
}
