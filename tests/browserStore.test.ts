import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { SqlJsDb } from '../src/db/sqljsAdapter';
import { loadBytes, saveBytes } from '../src/db/browserStore';
import { migrate } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import { createParty, listParties } from '../src/services';

describe('browser dev persistence (IndexedDB)', () => {
  it('starts empty, saves after writes, and a reopened DB sees the data and keeps foreign keys on', async () => {
    expect(await loadBytes()).toBeUndefined();
    const a = await SqlJsDb.open(undefined, { persist: saveBytes, persistDelayMs: 5 });
    await migrate(a, MIGRATIONS);
    await createParty(a, { kind: 'customer', name: 'سوبر ماركت النور' });
    await a.flush();
    const bytes = await loadBytes();
    expect(bytes?.length).toBeGreaterThan(1000);
    const b = await SqlJsDb.open(bytes, { persist: saveBytes });
    expect(await migrate(b, MIGRATIONS)).toBe(MIGRATIONS.length);
    expect((await listParties(b)).map(p => p.name)).toEqual(['سوبر ماركت النور']);
    await expect(b.run("INSERT INTO invoices(kind,ref,party_id,date,subtotal,total) VALUES ('sale','X',999,'2026-01-01',1,1)")).rejects.toThrow();
    // export() must not disable foreign keys
    b.export();
    await expect(b.run("INSERT INTO invoices(kind,ref,party_id,date,subtotal,total) VALUES ('sale','Y',999,'2026-01-01',1,1)")).rejects.toThrow();
  });
  it('never snapshots mid-transaction', async () => {
    const saved: number[] = [];
    const a = await SqlJsDb.open(undefined, { persist: async b => { saved.push(b.length); }, persistDelayMs: 1 });
    await migrate(a, MIGRATIONS);
    await a.flush(); saved.length = 0;
    await expect(a.transaction(async tx => {
      await tx.run("INSERT INTO units(name) VALUES ('x')");
      await new Promise(r => setTimeout(r, 30)); // timer would fire here
      throw new Error('abort');
    })).rejects.toThrow('abort');
    await new Promise(r => setTimeout(r, 30)); await a.flush();
    expect(await a.all('SELECT 1 FROM units')).toHaveLength(0);
    // whatever was saved must not contain the rolled-back row
    const copy = await SqlJsDb.open(a.export());
    expect(await copy.all('SELECT 1 FROM units')).toHaveLength(0);
  });
});
