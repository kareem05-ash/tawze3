import type { Db, SqlParam } from '../db/types';
import type { Minor, QtyMilli } from '../domain/money';
import { ServiceError, assertInt, escapeLike, one, requireText } from './common';

/** Returns the existing id when the name already exists (so forms can create-on-the-fly safely). Re-activates an archived one. */
async function upsertNamed(db: Db, table: 'categories' | 'units', rawName: string): Promise<number> {
  const name = requireText(rawName, 'الاسم');
  return db.transaction(async tx => {
    const ex = await one<{ id: number }>(tx, `SELECT id FROM ${table} WHERE name = ?`, [name]);
    if (ex) { if (table === 'categories') await tx.run('UPDATE categories SET archived = 0 WHERE id = ?', [ex.id]); return ex.id; }
    return (await tx.run(`INSERT INTO ${table}(name) VALUES (?)`, [name])).lastId;
  });
}
export const createCategory = (db: Db, name: string) => upsertNamed(db, 'categories', name);
export const createUnit = (db: Db, name: string) => upsertNamed(db, 'units', name);
export const listCategories = (db: Db) => db.all<{ id: number; name: string }>('SELECT id, name FROM categories WHERE archived = 0 ORDER BY name');
export const listUnits = (db: Db) => db.all<{ id: number; name: string }>('SELECT id, name FROM units ORDER BY name');
export async function archiveCategory(db: Db, id: number, archived = true) { await db.run('UPDATE categories SET archived = ? WHERE id = ?', [archived ? 1 : 0, id]); }

export interface UnitFactor { unitId: number; factorToBase: number }
export interface ProductInput {
  name: string; description?: string; notes?: string; categoryId?: number | null;
  baseUnitId: number; buyPrice: Minor; sellPrice: Minor; lowStockMilli: QtyMilli;
  /** Additional units, e.g. carton = 24 base pieces. The base unit (factor 1) is added automatically. */
  extraUnits?: UnitFactor[];
}

function checkUnits(baseUnitId: number, extra: UnitFactor[]) {
  const seen = new Set<number>([baseUnitId]);
  for (const u of extra) {
    if (!(u.factorToBase > 0) || !Number.isFinite(u.factorToBase)) throw new ServiceError('INVALID_FACTOR', 'معامل التحويل يجب أن يكون أكبر من صفر');
    if (seen.has(u.unitId)) throw new ServiceError('DUPLICATE_UNIT', 'الوحدة مكررة أو هي الوحدة الأساسية');
    seen.add(u.unitId);
  }
}

async function writeUnits(tx: Db, productId: number, baseUnitId: number, extra: UnitFactor[]) {
  await tx.run('DELETE FROM product_units WHERE product_id = ?', [productId]);
  await tx.run('INSERT INTO product_units(product_id, unit_id, factor_to_base) VALUES (?, ?, 1)', [productId, baseUnitId]);
  for (const u of extra) await tx.run('INSERT INTO product_units(product_id, unit_id, factor_to_base) VALUES (?, ?, ?)', [productId, u.unitId, u.factorToBase]);
}

export async function createProduct(db: Db, input: ProductInput): Promise<number> {
  const name = requireText(input.name, 'اسم الصنف');
  assertInt(input.buyPrice, 'سعر الشراء', { min: 0 });
  assertInt(input.sellPrice, 'سعر البيع', { min: 0 });
  assertInt(input.lowStockMilli, 'حد التنبيه', { min: 0 });
  const extra = input.extraUnits ?? [];
  checkUnits(input.baseUnitId, extra);
  return db.transaction(async tx => {
    const id = (await tx.run(
      'INSERT INTO products(name, description, notes, category_id, base_unit_id, buy_price, sell_price, low_stock_milli) VALUES (?,?,?,?,?,?,?,?)',
      [name, input.description ?? null, input.notes ?? null, input.categoryId ?? null, input.baseUnitId, input.buyPrice, input.sellPrice, input.lowStockMilli])).lastId;
    await writeUnits(tx, id, input.baseUnitId, extra);
    return id;
  });
}

export type ProductPatch = Partial<Omit<ProductInput, 'baseUnitId'>> & { baseUnitId?: number };
/** Changing prices later never touches historical invoice lines (they store their own price). */
export async function updateProduct(db: Db, id: number, patch: ProductPatch): Promise<void> {
  await db.transaction(async tx => {
    const cur = await one<{ base_unit_id: number }>(tx, 'SELECT base_unit_id FROM products WHERE id = ?', [id]);
    if (!cur) throw new ServiceError('NOT_FOUND', 'الصنف غير موجود');
    const baseUnitId = patch.baseUnitId ?? cur.base_unit_id;
    if (baseUnitId !== cur.base_unit_id) {
      const used = await one<{ n: number }>(tx, 'SELECT COUNT(*) AS n FROM stock_movements WHERE product_id = ?', [id]);
      if ((used?.n ?? 0) > 0) throw new ServiceError('BASE_UNIT_LOCKED', 'لا يمكن تغيير الوحدة الأساسية بعد وجود حركات مخزون لهذا الصنف');
    }
    const sets: string[] = []; const params: SqlParam[] = [];
    const add = (col: string, v: SqlParam) => { sets.push(`${col} = ?`); params.push(v); };
    if (patch.name !== undefined) add('name', requireText(patch.name, 'اسم الصنف'));
    if (patch.description !== undefined) add('description', patch.description);
    if (patch.notes !== undefined) add('notes', patch.notes);
    if (patch.categoryId !== undefined) add('category_id', patch.categoryId);
    if (patch.buyPrice !== undefined) { assertInt(patch.buyPrice, 'سعر الشراء', { min: 0 }); add('buy_price', patch.buyPrice); }
    if (patch.sellPrice !== undefined) { assertInt(patch.sellPrice, 'سعر البيع', { min: 0 }); add('sell_price', patch.sellPrice); }
    if (patch.lowStockMilli !== undefined) { assertInt(patch.lowStockMilli, 'حد التنبيه', { min: 0 }); add('low_stock_milli', patch.lowStockMilli); }
    if (baseUnitId !== cur.base_unit_id) add('base_unit_id', baseUnitId);
    if (sets.length) await tx.run(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    if (patch.extraUnits !== undefined || baseUnitId !== cur.base_unit_id) {
      const extra = patch.extraUnits ?? (await tx.all<{ unit_id: number; factor_to_base: number }>(
        'SELECT unit_id, factor_to_base FROM product_units WHERE product_id = ? AND unit_id <> ?', [id, cur.base_unit_id]))
        .map(r => ({ unitId: r.unit_id, factorToBase: r.factor_to_base })).filter(u => u.unitId !== baseUnitId);
      checkUnits(baseUnitId, extra);
      await writeUnits(tx, id, baseUnitId, extra);
    }
  });
}

/** Products are archived, never deleted, so history stays intact. */
export async function archiveProduct(db: Db, id: number, archived = true) { await db.run('UPDATE products SET archived = ? WHERE id = ?', [archived ? 1 : 0, id]); }

export interface ProductRow {
  id: number; name: string; description: string | null; notes: string | null; category_id: number | null; category_name: string | null;
  base_unit_id: number; base_unit_name: string; buy_price: number; sell_price: number; low_stock_milli: number; archived: number; stock_milli: number;
}
export async function listProducts(db: Db, f: { search?: string; includeArchived?: boolean; categoryId?: number } = {}): Promise<(ProductRow & { low: boolean })[]> {
  const where: string[] = []; const params: SqlParam[] = [];
  if (!f.includeArchived) where.push('p.archived = 0');
  if (f.categoryId) { where.push('p.category_id = ?'); params.push(f.categoryId); }
  if (f.search?.trim()) { where.push("p.name LIKE ? ESCAPE '\\'"); params.push(`%${escapeLike(f.search.trim())}%`); }
  const rows = await db.all<ProductRow>(
    `SELECT p.id, p.name, p.description, p.notes, p.category_id, c.name AS category_name, p.base_unit_id, u.name AS base_unit_name,
            p.buy_price, p.sell_price, p.low_stock_milli, p.archived,
            COALESCE((SELECT SUM(m.base_qty_milli) FROM stock_movements m WHERE m.product_id = p.id), 0) AS stock_milli
     FROM products p LEFT JOIN categories c ON c.id = p.category_id JOIN units u ON u.id = p.base_unit_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name`, params);
  return rows.map(r => ({ ...r, low: r.low_stock_milli > 0 && r.stock_milli <= r.low_stock_milli }));
}
export const getProductUnits = (db: Db, productId: number) => db.all<{ unit_id: number; unit_name: string; factor_to_base: number }>(
  'SELECT pu.unit_id, u.name AS unit_name, pu.factor_to_base FROM product_units pu JOIN units u ON u.id = pu.unit_id WHERE pu.product_id = ? ORDER BY pu.factor_to_base', [productId]);
