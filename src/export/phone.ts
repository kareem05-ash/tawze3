const AR = '٠١٢٣٤٥٦٧٨٩';
/** Digits for wa.me links. Egyptian local numbers (01xxxxxxxxx) become 20 1xxxxxxxxx; 00/+ international prefixes are respected. */
export function waDigits(raw?: string | null): string | null {
  if (!raw) return null;
  let d = raw.replace(/[٠-٩]/g, c => String(AR.indexOf(c))).replace(/[^\d+]/g, '');
  const plus = d.startsWith('+'); d = d.replace(/\+/g, '');
  if (!plus) { if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('0')) d = `20${d.slice(1)}`; }
  return d.length >= 8 && d.length <= 15 ? d : null;
}
/** Chat link (with a number) or the WhatsApp contact picker (without). */
export function waChatUrl(digits: string | null, text?: string): string {
  const q = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${digits ?? ''}${q}`;
}
