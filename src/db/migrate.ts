import type { Db } from './types';
import type { Migration } from './migrations';

export async function currentVersion(db: Db): Promise<number> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const r = await db.all<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations');
  return r[0]?.v ?? 0;
}

/** Applies pending migrations, each in its own transaction. Refuses to run on a DB newer than this app. */
export async function migrate(db: Db, migrations: Migration[]): Promise<number> {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const latest = sorted.at(-1)?.version ?? 0;
  const cur = await currentVersion(db);
  if (cur > latest) throw new Error(`قاعدة البيانات (الإصدار ${cur}) أحدث من التطبيق (الإصدار ${latest}). حدّث التطبيق.`);
  for (const m of sorted) {
    if (m.version <= cur) continue;
    await db.transaction(async tx => {
      await tx.exec(m.sql);
      await tx.run("INSERT INTO schema_migrations(version, applied_at) VALUES (?, datetime('now'))", [m.version]);
    });
  }
  return latest;
}
