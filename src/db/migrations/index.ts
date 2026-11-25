import m001 from './001_init.sql?raw';
export interface Migration { version: number; name: string; sql: string }
/** Append-only. Never edit or reorder a released migration; add a new one. */
export const MIGRATIONS: Migration[] = [{ version: 1, name: 'init', sql: m001 }];
