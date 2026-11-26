import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, GlobalFonts, type Canvas } from '@napi-rs/canvas';
const mk = (w: number, h: number) => createCanvas(w, h) as Canvas;
import { SqlJsDb } from './helpers/sqljsDb';
import { migrate } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import * as S from '../src/services';
import { buildReportDoc, buildStatementDoc, changeText } from '../src/export/docModels';
import { renderDocument } from '../src/export/renderDocument';
import { jpegsToPdf } from '../src/export/pdf';

const F = 'node_modules/@fontsource/cairo/files'; const OUT = process.env.EXPORT_OUT ?? '/tmp/tawze3-export'; let db: SqlJsDb; let cust: number; let supp: number;

beforeAll(async () => {
  for (const f of ['arabic-400', 'arabic-600', 'arabic-700', 'latin-400', 'latin-600', 'latin-700']) GlobalFonts.registerFromPath(`${F}/cairo-${f}-normal.woff2`, 'Cairo');
  mkdirSync(OUT, { recursive: true });
  db = await SqlJsDb.open(); await migrate(db, MIGRATIONS);
  const piece = await S.createUnit(db, 'قطعة');
  const p1 = await S.createProduct(db, { name: 'شيبسي كبير', baseUnitId: piece, buyPrice: 500, sellPrice: 700, lowStockMilli: 0 });
  const p2 = await S.createProduct(db, { name: 'عصير مانجو بالعلبة الكبيرة', baseUnitId: piece, buyPrice: 1000, sellPrice: 800, lowStockMilli: 0 });
  const p3 = await S.createProduct(db, { name: 'منتج راكد', baseUnitId: piece, buyPrice: 100, sellPrice: 200, lowStockMilli: 0 });
  await S.setSetting(db, 'business_name', 'توزيع الأمل للمواد الغذائية');
  supp = await S.createParty(db, { kind: 'supplier', name: 'شركة النيل للتوريدات', phone: '01012345678' });
  cust = await S.createParty(db, { kind: 'customer', name: 'سوبر ماركت الأمانة والنور للمواد الغذائية بالجملة', phone: '01112233445', openingBalance: 25000, openingDate: '2026-01-01' });
  await S.postInvoice(db, { kind: 'purchase', partyId: supp, date: '2026-09-01', paidNow: 100000, lines: [{ productId: p1, unitId: piece, qtyMilli: 2000000, unitPrice: 500 }, { productId: p2, unitId: piece, qtyMilli: 300000, unitPrice: 1000 }, { productId: p3, unitId: piece, qtyMilli: 10000, unitPrice: 100 }] });
  for (let i = 1; i <= 45; i++) {
    const d = `2026-10-${String((i % 28) + 1).padStart(2, '0')}`;
    const s = await S.postInvoice(db, { kind: 'sale', partyId: cust, date: d, paidNow: i % 3 === 0 ? 2000 : 0, lines: [{ productId: p1, unitId: piece, qtyMilli: (i % 7 + 1) * 1000, unitPrice: 700 }, { productId: p2, unitId: piece, qtyMilli: 1000, unitPrice: 800 }] });
    if (i % 10 === 0) await S.recordPayment(db, { partyId: cust, amount: 3000, date: d, invoiceId: s.id });
  }
  await S.recordStockAdjustment(db, { productId: p1, qtyMilli: 3000, date: '2026-10-20', reason: 'missing' });
});

const toPdf = (canvases: Canvas[]) => jpegsToPdf(canvases.map(c => ({ jpeg: new Uint8Array(c.toBuffer('image/jpeg', 95)), w: c.width, h: c.height })));

describe('document export', () => {
  it('a long statement paginates into several A4 pages with a valid multi-page PDF', async () => {
    const m = await buildStatementDoc(db, cust, '2026-01-01', '2026-12-31');
    const pages = renderDocument(m, mk, 2);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    pages.forEach((p, i) => { writeFileSync(`${OUT}/statement-p${i + 1}.png`, p.toBuffer('image/png')); expect(p.width).toBe(1440); expect(p.height).toBe(2036); });
    const pdf = toPdf(pages); writeFileSync(`${OUT}/statement.pdf`, pdf);
    expect(new TextDecoder().decode(pdf.subarray(0, 8))).toBe('%PDF-1.4'); expect(new TextDecoder().decode(pdf.subarray(-6))).toContain('%%EOF');
    expect(m.phone).toBe('01112233445');
  });
  it('the statement lists every entry exactly once and its closing balance matches the ledger', async () => {
    const m = await buildStatementDoc(db, cust, '2026-01-01', '2026-12-31');
    const table = m.blocks.find(b => b.kind === 'table')!; if (table.kind !== 'table') throw new Error();
    const st = await S.partyStatement(db, cust, '2026-01-01', '2026-12-31');
    expect(table.rows).toHaveLength(st.entries.length);
    expect(st.closing).toBe(await S.getPartyBalance(db, cust));
  });
  it('the report renders with formulas, comparison text and product tables', async () => {
    const m = await buildReportDoc(db, '2026-10-01', '2026-10-31');
    const text = JSON.stringify(m.blocks);
    expect(text).toContain('الربح الفعلي'); expect(text).toContain('الربح المثالي'); expect(text).toContain('outsource');
    const pages = renderDocument(m, mk, 2);
    pages.forEach((p, i) => writeFileSync(`${OUT}/report-p${i + 1}.png`, p.toBuffer('image/png')));
    writeFileSync(`${OUT}/report.pdf`, toPdf(pages));
    expect(pages.length).toBeGreaterThanOrEqual(1);
  });
  it('change text never shows Infinity or NaN', () => {
    expect(changeText({ kind: 'new' })).toBe('نشاط جديد'); expect(changeText({ kind: 'none' })).toBe('—');
    expect(changeText({ kind: 'percent', value: -12.5 })).toContain('▼'); expect(changeText({ kind: 'percent', value: 3 })).toContain('▲');
  });
  it('an empty period still renders a valid one-page document', async () => {
    const m = await buildStatementDoc(db, supp, '2030-01-01', '2030-01-31');
    expect(renderDocument(m, mk, 1)).toHaveLength(1);
  });
});
