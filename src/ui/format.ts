import { formatEgp, type Minor } from '../domain/money';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
/** Accepts Arabic-Indic or Latin digits, ٫ or , or . as decimal mark. Returns null when empty/invalid. */
export function parseDecimal(raw: string): number | null {
  const s = raw.trim().replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d))).replace(/[٬\s]/g, '').replace(/[٫,]/g, '.');
  if (s === '' || !/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
export const toMinor = (raw: string): Minor | null => { const n = parseDecimal(raw); return n === null ? null : Math.round(n * 100 + 1e-9 * Math.sign(n)); };
export const toMilli = (raw: string): number | null => { const n = parseDecimal(raw); return n === null ? null : Math.round(n * 1000 + 1e-9 * Math.sign(n)); };
export const money = (m: Minor) => formatEgp(m);
export const qty = (milli: number) => (milli / 1000).toLocaleString('ar-EG', { maximumFractionDigits: 3 });
export const editNum = (n: number) => String(n);                 // for pre-filling inputs
export const minorToInput = (m: Minor) => (m % 100 === 0 ? String(m / 100) : (m / 100).toFixed(2));
export const milliToInput = (m: number) => String(m / 1000);
export const todayIso = () => new Date().toLocaleDateString('en-CA');
export const monthStartIso = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA'); };
export const dateLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
