/**
 * Minimal single-page PDF that embeds one JPEG (the rendered receipt). No third-party PDF library needed.
 * Trade-off: the page is an image, so text is not selectable/searchable, but Arabic shaping is exactly what the browser drew.
 */
const enc = new TextEncoder();
export interface PdfPage { jpeg: Uint8Array; w: number; h: number }
const isJpeg = (b: Uint8Array) => b.length >= 4 && b[0] === 0xff && b[1] === 0xd8;

/** One page per JPEG; each page is `pageWidthPt` wide with the image's aspect ratio. */
export function jpegsToPdf(pages: PdfPage[], pageWidthPt = 595.28): Uint8Array {
  if (pages.length === 0 || !pages.every(p => isJpeg(p.jpeg))) throw new Error('Not a JPEG');
  const f = (n: number) => n.toFixed(2);
  const parts: Uint8Array[] = []; const offsets: number[] = []; let pos = 0;
  const push = (b: Uint8Array) => { parts.push(b); pos += b.length; };
  const str = (t: string) => push(enc.encode(t));
  const obj = (n: number, body: () => void) => { offsets[n] = pos; str(`${n} 0 obj\n`); body(); str('\nendobj\n'); };
  const pageObj = (i: number) => 3 + i * 3; // page, image, content
  str('%PDF-1.4\n%âãÏÓ\n');
  obj(1, () => str('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => str(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`));
  pages.forEach((p, i) => {
    const w = pageWidthPt, h = Math.min(14400, (pageWidthPt * p.h) / p.w); const content = enc.encode(`q ${f(w)} 0 0 ${f(h)} 0 0 cm /Im0 Do Q`);
    obj(pageObj(i), () => str(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(w)} ${f(h)}] /Resources << /XObject << /Im0 ${pageObj(i) + 1} 0 R >> >> /Contents ${pageObj(i) + 2} 0 R >>`));
    obj(pageObj(i) + 1, () => { str(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`); push(p.jpeg); str('\nendstream'); });
    obj(pageObj(i) + 2, () => { str(`<< /Length ${content.length} >>\nstream\n`); push(content); str('\nendstream'); });
  });
  const total = 3 + pages.length * 3; const xref = pos;
  str(`xref\n0 ${total}\n0000000000 65535 f \n${Array.from({ length: total - 1 }, (_, k) => `${String(offsets[k + 1]).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
/** Single-page convenience wrapper. */
export function jpegToPdf(jpeg: Uint8Array, pxW: number, pxH: number, pageWidthPt = 595.28): Uint8Array { return jpegsToPdf([{ jpeg, w: pxW, h: pxH }], pageWidthPt); }
