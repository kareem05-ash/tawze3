import type { Db } from '../db/types';
import { invoiceStatus, type InvoiceStatus } from '../domain/invoice';
import { withRunningBalance } from '../domain/ledger';
import type { Minor } from '../domain/money';
import { one, escapeLike } from './common';

export async function getStock(db: Db, productId: number): Promise<number> {
  const r = await one<{ s: number }>(db, 'SELECT COALESCE(SUM(base_qty_milli),0) AS s FROM stock_movements WHERE product_id = ?', [productId]);
  return r?.s ?? 0;
}

/** Positive: party owes the business. Negative: the business owes the party. */
export async function getPartyBalance(db: Db, partyId: number): Promise<Minor> {
  const r = await one<{ s: number }>(db, 'SELECT COALESCE(SUM(delta),0) AS s FROM ledger_entries WHERE party_id = ?', [partyId]);
  return r?.s ?? 0;
}

export interface InvoiceState extends InvoiceStatus { id: number; kind: 'sale' | 'purchase'; partyId: number; total: Minor; returned: Minor; cancelled: boolean }
export async function getInvoiceState(db: Db, id: number): Promise<InvoiceState | undefined> {
  const r = await one<{ id: number; kind: 'sale' | 'purchase'; party_id: number; total: number; cancelled_at: string | null; paid: number; returned: number }>(db,
    `SELECT i.id, i.kind, i.party_id, i.total, i.cancelled_at,
       (SELECT COALESCE(SUM(a.amount),0) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
          WHERE a.invoice_id = i.id AND p.cancelled_at IS NULL) AS paid,
       (SELECT COALESCE(SUM(r.total),0) FROM returns r WHERE r.invoice_id = i.id) AS returned
     FROM invoices i WHERE i.id = ?`, [id]);
  if (!r) return undefined;
  return { id: r.id, kind: r.kind, partyId: r.party_id, total: r.total, returned: r.returned, cancelled: r.cancelled_at !== null, ...invoiceStatus(r.total, r.returned, r.paid) };
}

export interface InvoiceListRow { id: number; kind: string; ref: string; date: string; party_id: number; party_name: string; total: number; cancelled_at: string | null }
export async function listInvoices(db: Db, f: { kind?: 'sale' | 'purchase'; partyId?: number; from?: string; to?: string; search?: string; includeCancelled?: boolean } = {}): Promise<InvoiceListRow[]> {
  const where: string[] = []; const params: (string | number)[] = [];
  if (f.kind) { where.push('i.kind = ?'); params.push(f.kind); }
  if (f.partyId) { where.push('i.party_id = ?'); params.push(f.partyId); }
  if (f.from) { where.push('i.date >= ?'); params.push(f.from); }
  if (f.to) { where.push('i.date <= ?'); params.push(f.to); }
  if (f.search?.trim()) { where.push("(i.ref LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR i.external_ref LIKE ? ESCAPE '\\')"); const q = `%${escapeLike(f.search.trim())}%`; params.push(q, q, q); }
  if (!f.includeCancelled) where.push('i.cancelled_at IS NULL');
  return db.all<InvoiceListRow>(
    `SELECT i.id, i.kind, i.ref, i.date, i.party_id, p.name AS party_name, i.total, i.cancelled_at
     FROM invoices i JOIN parties p ON p.id = i.party_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY i.date DESC, i.id DESC`, params);
}

export interface InvoiceDetail {
  invoice: Record<string, unknown> & { id: number; ref: string; party_name: string };
  lines: (Record<string, unknown> & { product_name: string; unit_name: string })[];
  payments: { id: number; ref: string; date: string; amount: number; allocated: number; cancelled_at: string | null }[];
  state: InvoiceState;
}
/** Everything a receipt needs. */
export async function getInvoiceDetail(db: Db, id: number): Promise<InvoiceDetail | undefined> {
  const invoice = await one<InvoiceDetail['invoice']>(db, 'SELECT i.*, p.name AS party_name FROM invoices i JOIN parties p ON p.id = i.party_id WHERE i.id = ?', [id]);
  const state = await getInvoiceState(db, id);
  if (!invoice || !state) return undefined;
  const lines = await db.all<InvoiceDetail['lines'][number]>(
    `SELECT il.*, pr.name AS product_name, u.name AS unit_name FROM invoice_lines il
     JOIN products pr ON pr.id = il.product_id JOIN units u ON u.id = il.unit_id WHERE il.invoice_id = ? ORDER BY il.id`, [id]);
  const payments = await db.all<InvoiceDetail['payments'][number]>(
    `SELECT p.id, p.ref, p.date, p.amount, a.amount AS allocated, p.cancelled_at FROM payment_allocations a
     JOIN payments p ON p.id = a.payment_id WHERE a.invoice_id = ? ORDER BY p.date, p.id`, [id]);
  return { invoice, lines, payments, state };
}

export interface StatementEntry { id: number; type: string; delta: number; date: string; ref: string | null; reverses_id: number | null; source_table: string | null; source_id: number | null }
export async function partyStatement(db: Db, partyId: number, from: string, to: string) {
  const o = await one<{ s: number }>(db, 'SELECT COALESCE(SUM(delta),0) AS s FROM ledger_entries WHERE party_id = ? AND date < ?', [partyId, from]);
  const opening = o?.s ?? 0;
  const rows = await db.all<StatementEntry>(
    `SELECT l.id, l.type, l.delta, l.date, l.reverses_id, l.source_table, l.source_id, COALESCE(i.ref, p.ref, r.ref) AS ref
     FROM ledger_entries l
     LEFT JOIN invoices i ON l.source_table = 'invoices' AND i.id = l.source_id
     LEFT JOIN payments p ON l.source_table = 'payments' AND p.id = l.source_id
     LEFT JOIN returns r ON l.source_table = 'returns' AND r.id = l.source_id
     WHERE l.party_id = ? AND l.date >= ? AND l.date <= ? ORDER BY l.date, l.id`, [partyId, from, to]);
  const entries = withRunningBalance(opening, rows);
  const closing = entries.length ? entries[entries.length - 1]!.balance : opening;
  return { opening, entries, closing };
}

/** Cash movement from ACTUAL payment records only (cancelled payments excluded). */
export async function cashTotals(db: Db, from: string, to: string) {
  const rows = await db.all<{ direction: 'in' | 'out'; s: number }>(
    'SELECT direction, COALESCE(SUM(amount),0) AS s FROM payments WHERE cancelled_at IS NULL AND date >= ? AND date <= ? GROUP BY direction', [from, to]);
  const received = rows.find(r => r.direction === 'in')?.s ?? 0;
  const paid = rows.find(r => r.direction === 'out')?.s ?? 0;
  return { received, paid, net: received - paid };
}
