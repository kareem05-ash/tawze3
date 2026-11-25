import type { Db, SqlParam } from '../db/types';
import type { Minor } from '../domain/money';
import type { PartyKind } from '../domain/ledger';
import { ServiceError, assertInt, assertIsoDate, escapeLike, one, requireText } from './common';

export interface PartyInput { kind: PartyKind; name: string; phone?: string; address?: string; notes?: string;
  /** Balance carried in from before using the app (positive = party owes you). */
  openingBalance?: Minor; openingDate?: string }

export async function createParty(db: Db, input: PartyInput): Promise<number> {
  const name = requireText(input.name, 'الاسم');
  if (input.kind !== 'customer' && input.kind !== 'supplier') throw new ServiceError('INVALID_KIND', 'نوع الحساب غير صالح');
  const opening = input.openingBalance ?? 0;
  assertInt(opening, 'الرصيد الافتتاحي');
  if (opening !== 0) assertIsoDate(input.openingDate, 'تاريخ الرصيد الافتتاحي');
  return db.transaction(async tx => {
    const id = (await tx.run('INSERT INTO parties(kind, name, phone, address, notes) VALUES (?,?,?,?,?)',
      [input.kind, name, input.phone ?? null, input.address ?? null, input.notes ?? null])).lastId;
    if (opening !== 0) await tx.run("INSERT INTO ledger_entries(party_id, type, delta, date, source_table) VALUES (?, 'opening', ?, ?, 'parties')", [id, opening, input.openingDate as string]);
    return id;
  });
}

export async function updateParty(db: Db, id: number, patch: Partial<Pick<PartyInput, 'name' | 'phone' | 'address' | 'notes'>>): Promise<void> {
  const sets: string[] = []; const params: SqlParam[] = [];
  if (patch.name !== undefined) { sets.push('name = ?'); params.push(requireText(patch.name, 'الاسم')); }
  for (const k of ['phone', 'address', 'notes'] as const) if (patch[k] !== undefined) { sets.push(`${k} = ?`); params.push(patch[k] ?? null); }
  if (!sets.length) return;
  const r = await db.run(`UPDATE parties SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  if (r.changes === 0) throw new ServiceError('NOT_FOUND', 'الحساب غير موجود');
}

/** Parties are archived, never deleted: their ledger still counts in balances and reports. */
export async function archiveParty(db: Db, id: number, archived = true) { await db.run('UPDATE parties SET archived = ? WHERE id = ?', [archived ? 1 : 0, id]); }

export interface PartyRow { id: number; kind: PartyKind; name: string; phone: string | null; address: string | null; notes: string | null; archived: number; balance: number }
export async function listParties(db: Db, f: { kind?: PartyKind; search?: string; includeArchived?: boolean } = {}): Promise<PartyRow[]> {
  const where: string[] = []; const params: SqlParam[] = [];
  if (f.kind) { where.push('p.kind = ?'); params.push(f.kind); }
  if (!f.includeArchived) where.push('p.archived = 0');
  if (f.search?.trim()) { where.push("(p.name LIKE ? ESCAPE '\\' OR p.phone LIKE ? ESCAPE '\\')"); const q = `%${escapeLike(f.search.trim())}%`; params.push(q, q); }
  return db.all<PartyRow>(
    `SELECT p.id, p.kind, p.name, p.phone, p.address, p.notes, p.archived,
       COALESCE((SELECT SUM(l.delta) FROM ledger_entries l WHERE l.party_id = p.id), 0) AS balance
     FROM parties p ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name`, params);
}
export const getParty = (db: Db, id: number) => one<PartyRow>(db,
  `SELECT p.id, p.kind, p.name, p.phone, p.address, p.notes, p.archived,
     COALESCE((SELECT SUM(l.delta) FROM ledger_entries l WHERE l.party_id = p.id), 0) AS balance FROM parties p WHERE p.id = ?`, [id]);
