import { describe, it, expect } from 'vitest';
import { SqlJsDb } from './helpers/sqljsDb';
import { migrate, currentVersion } from '../src/db/migrate';
import { MIGRATIONS, LATEST_VERSION, type Migration } from '../src/db/migrations';

const seed = async (db: SqlJsDb) => {
  await db.run("INSERT INTO units(name) VALUES ('قطعة')");
  await db.run("INSERT INTO products(name, base_unit_id) VALUES ('شيبسي', 1)");
};

describe('migrations', () => {
  it('applies the real schema from scratch and is idempotent', async () => {
    const db = await SqlJsDb.open();
    expect(await migrate(db, MIGRATIONS)).toBe(LATEST_VERSION);
    expect(await migrate(db, MIGRATIONS)).toBe(LATEST_VERSION);
    const t = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
    for (const n of ['products', 'parties', 'invoices', 'invoice_lines', 'payments', 'ledger_entries', 'stock_movements', 'returns'])
      expect(t.map(x => x.name)).toContain(n);
    expect((await db.all("SELECT * FROM schema_migrations")).length).toBe(MIGRATIONS.length);
  });

  it('upgrade preserves existing records', async () => {
    const db = await SqlJsDb.open();
    await migrate(db, MIGRATIONS);
    await seed(db);
    const m2: Migration = { version: LATEST_VERSION + 1, name: 'test-add-col', sql: 'ALTER TABLE products ADD COLUMN extra TEXT;' };
    await migrate(db, [...MIGRATIONS, m2]);
    expect(await currentVersion(db)).toBe(LATEST_VERSION + 1);
    expect((await db.all<{ name: string }>('SELECT name FROM products'))[0]?.name).toBe('شيبسي');
  });

  it('a failing migration rolls back fully and leaves the version unchanged', async () => {
    const db = await SqlJsDb.open();
    await migrate(db, MIGRATIONS);
    const bad: Migration = { version: LATEST_VERSION + 1, name: 'bad', sql: 'CREATE TABLE ok_tbl(x); INSERT INTO missing_tbl VALUES (1);' };
    await expect(migrate(db, [...MIGRATIONS, bad])).rejects.toThrow();
    expect(await currentVersion(db)).toBe(LATEST_VERSION);
    expect(await db.all("SELECT name FROM sqlite_master WHERE name='ok_tbl'")).toHaveLength(0);
  });

  it('refuses a database newer than the app', async () => {
    const db = await SqlJsDb.open();
    await migrate(db, MIGRATIONS);
    await db.run("INSERT INTO schema_migrations VALUES (999, 'x')");
    await expect(migrate(db, MIGRATIONS)).rejects.toThrow(/أحدث من التطبيق/);
  });
});

describe('upgrade from schema v1', () => {
  it('v1 data survives the v2 migration', async () => {
    const db = await SqlJsDb.open();
    await migrate(db, MIGRATIONS.slice(0, 1));
    await seed(db);
    await db.run("INSERT INTO parties(kind,name) VALUES ('customer','عميل قديم')");
    await db.run("INSERT INTO invoices(kind,ref,party_id,date,subtotal,total) VALUES ('sale','S-000001',1,'2026-01-01',500,500)");
    await db.run("INSERT INTO invoice_lines(invoice_id,product_id,unit_id,qty_milli,base_qty_milli,unit_price,line_total) VALUES (1,1,1,1000,1000,500,500)");
    expect(await migrate(db, MIGRATIONS)).toBe(LATEST_VERSION);
    expect(await db.all<{ ref: string; negative_stock_override: number }>('SELECT ref, negative_stock_override FROM invoices')).toEqual([{ ref: 'S-000001', negative_stock_override: 0 }]);
    expect((await db.all<{ cost_total: number | null }>('SELECT cost_total FROM invoice_lines'))[0]?.cost_total).toBeNull();
  });
});

describe('persistence & integrity', () => {
  it('records survive a simulated restart (export, reopen)', async () => {
    const a = await SqlJsDb.open();
    await migrate(a, MIGRATIONS); await seed(a);
    const b = await SqlJsDb.open(a.export());
    expect(await migrate(b, MIGRATIONS)).toBe(LATEST_VERSION);
    expect((await b.all('SELECT * FROM products')).length).toBe(1);
  });

  it('multi-row transaction is atomic', async () => {
    const db = await SqlJsDb.open();
    await migrate(db, MIGRATIONS); await seed(db);
    await db.run("INSERT INTO parties(kind,name) VALUES ('customer','سوبر ماركت النور')");
    await expect(db.transaction(async tx => {
      await tx.run("INSERT INTO invoices(kind,ref,party_id,date,subtotal,total) VALUES ('sale','S-1',1,'2026-11-25',1000,1000)");
      await tx.run("INSERT INTO ledger_entries(party_id,type,delta,date) VALUES (1,'sale',1000,'2026-11-25')");
      throw new Error('simulated crash');
    })).rejects.toThrow('simulated crash');
    expect(await db.all('SELECT * FROM invoices')).toHaveLength(0);
    expect(await db.all('SELECT * FROM ledger_entries')).toHaveLength(0);
  });

  it('foreign keys and constraints reject bad data', async () => {
    const db = await SqlJsDb.open();
    await migrate(db, MIGRATIONS);
    await expect(db.run("INSERT INTO invoices(kind,ref,party_id,date,subtotal,total) VALUES ('sale','S-9',42,'2026-11-25',1,1)")).rejects.toThrow();
    await expect(db.run("INSERT INTO parties(kind,name) VALUES ('alien','x')")).rejects.toThrow();
  });
});
