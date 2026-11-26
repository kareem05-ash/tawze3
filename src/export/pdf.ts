/**
 * Minimal single-page PDF that embeds one JPEG (the rendered receipt). No third-party PDF library needed.
 * Trade-off: the page is an image, so text is not selectable/searchable, but Arabic shaping is exactly what the browser drew.
 */
const enc = new TextEncoder();
export function jpegToPdf(jpeg: Uint8Array, pxW: number, pxH: number, pageWidthPt = 595.28): Uint8Array {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Not a JPEG');
  const w = pageWidthPt, h = Math.min(14400, (pageWidthPt * pxH) / pxW);
  const f = (n: number) => n.toFixed(2);
  const content = enc.encode(`q ${f(w)} 0 0 ${f(h)} 0 0 cm /Im0 Do Q`);
  const parts: Uint8Array[] = []; const offsets: number[] = []; let pos = 0;
  const push = (b: Uint8Array) => { parts.push(b); pos += b.length; };
  const str = (s: string) => push(enc.encode(s));
  const obj = (n: number, body: () => void) => { offsets[n] = pos; str(`${n} 0 obj\n`); body(); str('\nendobj\n'); };
  str('%PDF-1.4\n%âãÏÓ\n');
  obj(1, () => str('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => str('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, () => str(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(w)} ${f(h)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  obj(4, () => { str(`<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`); push(jpeg); str('\nendstream'); });
  obj(5, () => { str(`<< /Length ${content.length} >>\nstream\n`); push(content); str('\nendstream'); });
  const xref = pos;
  str(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map(n => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
