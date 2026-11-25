/** ISO yyyy-mm-dd date helpers, calendar-safe (UTC arithmetic, no DST surprises). */
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
export const isoOf = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => isoOf(new Date(parse(s).getTime() + n * 86400000));
export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
export const lastNDays = (end: string, n: number) => Array.from({ length: n }, (_, i) => addDays(end, i - (n - 1)));
/** The period of equal length immediately before [from, to]. */
export function previousPeriod(from: string, to: string) {
  const len = daysBetween(from, to) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}
export const monthStart = (s: string) => `${s.slice(0, 7)}-01`;
