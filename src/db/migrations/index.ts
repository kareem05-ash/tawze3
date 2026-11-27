import m001 from './001_init.sql?raw';
import m002 from './002_phase3.sql?raw';
import m003 from './003_allocation_kind.sql?raw';
export interface Migration { version: number; name: string; sql: string }
/** Append-only. Never edit or reorder a released migration; add a new one. */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'init', sql: m001 },
  { version: 2, name: 'phase3', sql: m002 },
  { version: 3, name: 'allocation_kind', sql: m003 },
];
export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
