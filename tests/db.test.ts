import { describe, it, expect } from 'vitest';
import { SqlJsDb } from './helpers/sqljsDb';
import { migrate, currentVersion } from '../src/db/migrate';
import { MIGRATIONS, type Migration } from '../src/db/migrations';

const seed = async (db: SqlJsDb) => {
  await db.run("INSERT INTO units(name) VALUES ('قطعة')");
  await db.run("INSERT INTO products(name, base_unit_id) VALUES ('شيبسي', 1)");
};

describe('migrations', () => {
  it('applies the real schema from scratch and is idempotent', async () => {
    const db = await SqlJsDb.open();
    expect(await migrate(db, MIGRATIONS)).toBe(1);
    expect(await migrate(db, MIGRATIONS)).toBe(1);
    const t = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
    for (const n of ['products', 'parties', 'invoices', 'invoice_lines', 'payments', 'ledger_entries', 'stock_movements', 'returns'])
      expect(t.map(x => x.name)).toContain(n);
    expect((await db.all("SELECT * FROM schema_migrations")).length).toBe(1);
  });

  it('upgrade preserves existing records', async () => {
    const db = await SqlJsDb.open();
    await migrate(db, MIGRATIONS);
    await seed(db);
    const m2: Migration = { version: 2, name: 'test-add-col', sql: 'ALTER TABLE products ADD COLUMN extra TEXT;' };
    await migrate(db, [...MIGRATIONS, m2]);
    expect(await currentVersion(db)).toBe(2);
    expect((await db.all<{ name: string }>('SELECT name FROM products'))[0]?.name).toBe('شيبسي');
  });

  it('a failing migration rolls back fully and leaves the version unchanged', async () => {
    const db = await SqlJsDb.open();
    await migrate(db, MIGRATIONS);
    const bad: Migration = { version: 2, name: 'bad', sql: 'CREATE TABLE ok_tbl(x); INSERT INTO missing_tbl VALUES (1);' };
    await expect(migrate(db, [...MIGRATIONS, bad])).rejects.toThrow();
    expect(await currentVersion(db)).toBe(1);
    expect(await db.all("SELECT name FROM sqlite_master WHERE name='ok_tbl'")).toHaveLength(0);
  });

  it('refuses a database newer than the app', async () => {
    const db = await SqlJsDb.open();
    await migrate(db, MIGRATIONS);
    await db.run("INSERT INTO schema_migrations VALUES (99, 'x')");
    await expect(migrate(db, MIGRATIONS)).rejects.toThrow(/أحدث من التطبيق/);
  });
});

describe('persistence & integrity', () => {
  it('records survive a simulated restart (export, reopen)', async () => {
    const a = await SqlJsDb.open();
    await migrate(a, MIGRATIONS); await seed(a);
    const b = await SqlJsDb.open(a.export());
    expect(await migrate(b, MIGRATIONS)).toBe(1);
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
