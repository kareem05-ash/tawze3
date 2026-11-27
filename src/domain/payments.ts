import type { Minor } from './money';

export interface OpenItem { key: string; outstanding: Minor }
export interface Applied { key: string; amount: Minor }

/** Oldest-first allocation: items must already be ordered oldest to newest. Whatever is left over is unapplied credit. */
export function allocateFifo(items: OpenItem[], amount: Minor): { applied: Applied[]; leftover: Minor } {
  let left = amount; const applied: Applied[] = [];
  for (const it of items) {
    if (left <= 0) break;
    const t = Math.min(left, it.outstanding);
    if (t > 0) { applied.push({ key: it.key, amount: t }); left -= t; }
  }
  return { applied, leftover: left };
}
