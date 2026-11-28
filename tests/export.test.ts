import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { SqlJsDb } from './helpers/sqljsDb';
import { migrate } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import * as S from '../src/services';
import { buildReceiptModel } from '../src/export/receiptModel';
import { renderReceipt } from '../src/export/renderReceipt';
import { jpegToPdf } from '../src/export/pdf';
import { waChatUrl, waDigits } from '../src/export/phone';

const F = 'node_modules/@fontsource/cairo/files';
let db: SqlJsDb; let saleId: number; let purchaseId: number;
const OUT = process.env.EXPORT_OUT ?? '/tmp/tawze3-export';

beforeAll(async () => {
  for (const f of ['arabic-400', 'arabic-600', 'arabic-700', 'latin-400', 'latin-600', 'latin-700']) GlobalFonts.registerFromPath(`${F}/cairo-${f}-normal.woff2`, 'Cairo');
  mkdirSync(OUT, { recursive: true });
  db = await SqlJsDb.open(); await migrate(db, MIGRATIONS);
  const piece = await S.createUnit(db, 'قطعة'); const carton = await S.createUnit(db, 'كرتونة');
  const p1 = await S.createProduct(db, { name: 'شيبسي كبير بنكهة الجبنة والخل', baseUnitId: piece, buyPrice: 500, sellPrice: 700, lowStockMilli: 0, extraUnits: [{ unitId: carton, factorToBase: 24 }] });
  const p2 = await S.createProduct(db, { name: 'عصير مانجو', baseUnitId: piece, buyPrice: 300, sellPrice: 450, lowStockMilli: 0 });
  await S.setSetting(db, 'business_name', 'توزيع الأمل للمواد الغذائية');
  const supp = await S.createParty(db, { kind: 'supplier', name: 'شركة النيل للتوريدات', phone: '01012345678' });
  const cust = await S.createParty(db, { kind: 'customer', name: 'سوبر ماركت النور', phone: '٠١١١٢٢٣٣٤٤٥' });
  const pu = await S.postInvoice(db, { kind: 'purchase', partyId: supp, date: '2026-11-20', paidNow: 20000, notes: 'استلام البضاعة في المخزن الرئيسي', lines: [{ productId: p1, unitId: carton, qtyMilli: 10000, unitPrice: 12000 }, { productId: p2, unitId: piece, qtyMilli: 100000, unitPrice: 300 }] });
  const sa = await S.postInvoice(db, { kind: 'sale', partyId: cust, date: '2026-11-25', paidNow: 5000, externalRef: '١٢٣٤', invoiceDiscount: 500, notes: 'التسليم يوم الخميس', lines: [{ productId: p1, unitId: piece, qtyMilli: 48000, unitPrice: 700, lineDiscount: 1000 }, { productId: p2, unitId: piece, qtyMilli: 12500, unitPrice: 450 }] });
  purchaseId = pu.id; saleId = sa.id;
});

describe('receipt model', () => {
  it('formats Arabic labels, amounts, balance meaning and share text', async () => {
    const m = await buildReceiptModel(db, saleId);
    expect(m.typeLabel).toBe('فاتورة بيع'); expect(m.ref).toBe('S-000001'); expect(m.partyName).toBe('سوبر ماركت النور');
    expect(m.lines).toHaveLength(2); expect(m.lines[0]?.discount).toContain('خصم');
    expect(m.account?.tone).toBe('owes'); expect(m.account?.label).toContain('مستحق لنا');
    expect(m.phone).toBe('٠١١١٢٢٣٣٤٤٥'); expect(m.shareText).toContain('S-000001');
    const p = await buildReceiptModel(db, purchaseId);
    expect(p.partyLabel).toBe('المورد'); expect(p.account?.tone).toBe('we');
  });
});

describe('rendering', () => {
  const make = async (id: number, name: string) => {
    const model = await buildReceiptModel(db, id);
    const canvas = renderReceipt(model, (w, h) => createCanvas(w, h), 2);
    const png = canvas.toBuffer('image/png'); const jpg = canvas.toBuffer('image/jpeg', 95);
    writeFileSync(`${OUT}/${name}.png`, png);
    const pdf = jpegToPdf(new Uint8Array(jpg), canvas.width, canvas.height); writeFileSync(`${OUT}/${name}.pdf`, pdf);
    return { canvas, png, jpg, pdf };
  };
  it('produces a valid PNG and a well-formed PDF for a sale and a purchase', async () => {
    for (const [id, name] of [[saleId, 'sale'], [purchaseId, 'purchase']] as const) {
      const { canvas, png, pdf } = await make(id, name);
      expect(canvas.width).toBe(1440); expect(canvas.height).toBeGreaterThan(1200);
      expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      expect(new TextDecoder().decode(pdf.subarray(0, 8))).toBe('%PDF-1.4');
      expect(new TextDecoder().decode(pdf.subarray(pdf.length - 6))).toContain('%%EOF');
    }
  });
  it('renders a cancelled invoice (watermark) without error', async () => {
    const piece = (await S.listUnits(db))[0]!.id; const prod = (await S.listProducts(db))[0]!.id; const cust = (await S.listParties(db, { kind: 'customer' }))[0]!.id;
    await S.postInvoice(db, { kind: 'purchase', partyId: (await S.listParties(db, { kind: 'supplier' }))[0]!.id, date: '2026-11-26', lines: [{ productId: prod, unitId: piece, qtyMilli: 5000, unitPrice: 500 }] });
    const x = await S.postInvoice(db, { kind: 'sale', partyId: cust, date: '2026-11-26', lines: [{ productId: prod, unitId: piece, qtyMilli: 1000, unitPrice: 700 }] });
    await S.cancelInvoice(db, x.id);
    const { png } = await make(x.id, 'cancelled'); expect(png.length).toBeGreaterThan(5000);
  });
  it('rejects non-JPEG input to the PDF writer', () => { expect(() => jpegToPdf(new Uint8Array([1, 2, 3, 4]), 10, 10)).toThrow(); });
});

describe('whatsapp helpers', () => {
  it('normalizes Egyptian and international numbers', () => {
    expect(waDigits('01012345678')).toBe('201012345678'); expect(waDigits('٠١١١٢٢٣٣٤٤٥')).toBe('201112233445');
    expect(waDigits('+20 100 123 4567')).toBe('201001234567'); expect(waDigits('0020 100 123 4567')).toBe('201001234567');
    expect(waDigits('+966 50 123 4567')).toBe('966501234567'); expect(waDigits('123')).toBeNull(); expect(waDigits(null)).toBeNull(); expect(waDigits('')).toBeNull();
  });
  it('builds chat or contact-picker links', () => {
    expect(waChatUrl('201012345678')).toBe('https://wa.me/201012345678');
    expect(waChatUrl(null, 'فاتورة')).toBe(`https://wa.me/?text=${encodeURIComponent('فاتورة')}`);
  });
});

import type { ReceiptModel } from '../src/export/receiptModel';
import { MAX_PIXELS } from '../src/export/renderReceipt';
describe('very long invoices', () => {
  it('stay under the canvas pixel cap by lowering the scale', () => {
    const lines = Array.from({ length: 220 }, (_, i) => ({ name: `صنف رقم ${i + 1} بإسم طويل نسبياً لاختبار الالتفاف`, qty: '١٠', unit: 'قطعة', price: '٧ ج.م.', total: '٧٠ ج.م.' }));
    const m: ReceiptModel = { business: 'توزيع', typeLabel: 'فاتورة بيع', ref: 'S-000009', partyLabel: 'العميل', partyName: 'عميل', date: '٢٥ نوفمبر ٢٠٢٦', lines, subtotal: '١ ج.م.', total: '١ ج.م.', paid: '٠', outstanding: '١ ج.م.', outstandingPositive: true, cancelled: false, filename: 'S-000009', phone: null, shareText: 'x' };
    const c = renderReceipt(m, (w, h) => createCanvas(w, h), 2);
    expect(c.width * c.height).toBeLessThanOrEqual(MAX_PIXELS * 1.01);
    expect(c.width).toBeGreaterThanOrEqual(720);
  });
});


describe('receipt: previous balance and this invoice shown separately', () => {
  const mkdb = async () => {
    const d = await SqlJsDb.open(); await migrate(d, MIGRATIONS);
    const piece = await S.createUnit(d, 'قطعة'); const p = await S.createProduct(d, { name: 'صنف', baseUnitId: piece, buyPrice: 100, sellPrice: 12000, lowStockMilli: 0 });
    const supp = await S.createParty(d, { kind: 'supplier', name: 'مورد' });
    await S.postInvoice(d, { kind: 'purchase', partyId: supp, date: '2026-11-01', lines: [{ productId: p, unitId: piece, qtyMilli: 10000, unitPrice: 100 }] });
    return { d, piece, p };
  };
  const fmt = (n: number) => new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', minimumFractionDigits: n % 100 ? 2 : 0 }).format(n / 100);
  it('customer owes 40, new invoice 120, pays 60 -> previous 40 + this invoice 60 = 100', async () => {
    const { d, piece, p } = await mkdb();
    const c = await S.createParty(d, { kind: 'customer', name: 'عميل', openingBalance: 4000, openingDate: '2026-11-01' });
    const s = await S.postInvoice(d, { kind: 'sale', partyId: c, date: '2026-11-26', paidNow: 6000, lines: [{ productId: p, unitId: piece, qtyMilli: 1000, unitPrice: 12000 }] });
    const m = await buildReceiptModel(d, s.id);
    expect(m.account?.breakdown?.previous).toMatchObject({ amount: fmt(4000), tone: 'owes' });
    expect(m.account?.breakdown?.thisInvoice).toBe(fmt(6000));
    expect(m.account?.amount).toBe(fmt(10000));
    const png = renderReceipt(m, (w, h) => createCanvas(w, h), 2).toBuffer('image/png'); writeFileSync(`${OUT}/breakdown-customer.png`, png);
  });
  it('no previous balance -> single account line as before', async () => {
    const { d, piece, p } = await mkdb();
    const c = await S.createParty(d, { kind: 'customer', name: 'عميل جديد' });
    const s = await S.postInvoice(d, { kind: 'sale', partyId: c, date: '2026-11-26', paidNow: 6000, lines: [{ productId: p, unitId: piece, qtyMilli: 1000, unitPrice: 12000 }] });
    expect((await buildReceiptModel(d, s.id)).account?.breakdown).toBeUndefined();
  });
  it('fully paid invoice with an old balance -> no "remaining" split (nothing left of this invoice)', async () => {
    const { d, piece, p } = await mkdb();
    const c = await S.createParty(d, { kind: 'customer', name: 'عميل', openingBalance: 4000, openingDate: '2026-11-01' });
    const s = await S.postInvoice(d, { kind: 'sale', partyId: c, date: '2026-11-26', paidNow: 12000, lines: [{ productId: p, unitId: piece, qtyMilli: 1000, unitPrice: 12000 }] });
    const m = await buildReceiptModel(d, s.id);
    expect(m.account?.breakdown).toBeUndefined(); expect(m.account?.amount).toBe(fmt(4000));
  });
  it('supplier: we owed 40, new purchase 120, paid 60 -> previous 40 (we owe) + 60 = 100', async () => {
    const { d, piece, p } = await mkdb();
    const s2 = await S.createParty(d, { kind: 'supplier', name: 'مورد قديم', openingBalance: -4000, openingDate: '2026-11-01' });
    const inv = await S.postInvoice(d, { kind: 'purchase', partyId: s2, date: '2026-11-26', paidNow: 6000, lines: [{ productId: p, unitId: piece, qtyMilli: 1000, unitPrice: 12000 }] });
    const m = await buildReceiptModel(d, inv.id);
    expect(m.account?.breakdown?.previous).toMatchObject({ amount: fmt(4000), tone: 'we' }); expect(m.account?.breakdown?.previous.label).toContain('للمورد');
    expect(m.account?.breakdown?.thisInvoice).toBe(fmt(6000)); expect(m.account?.amount).toBe(fmt(10000));
  });
  it('customer prepaid 30 before, invoice 120 unpaid -> previous is a credit of 30, this invoice 120, total 90', async () => {
    const { d, piece, p } = await mkdb();
    const c = await S.createParty(d, { kind: 'customer', name: 'دفع مقدماً', openingBalance: -3000, openingDate: '2026-11-01' });
    const s = await S.postInvoice(d, { kind: 'sale', partyId: c, date: '2026-11-26', lines: [{ productId: p, unitId: piece, qtyMilli: 1000, unitPrice: 12000 }] });
    const b = (await buildReceiptModel(d, s.id)).account!;
    expect(b.breakdown?.previous).toMatchObject({ amount: fmt(3000), tone: 'we' }); expect(b.breakdown?.thisInvoice).toBe(fmt(12000)); expect(b.amount).toBe(fmt(9000));
  });
  it('a cancelled invoice does not claim a remaining amount', async () => {
    const { d, piece, p } = await mkdb();
    const c = await S.createParty(d, { kind: 'customer', name: 'عميل', openingBalance: 4000, openingDate: '2026-11-01' });
    const s = await S.postInvoice(d, { kind: 'sale', partyId: c, date: '2026-11-26', lines: [{ productId: p, unitId: piece, qtyMilli: 1000, unitPrice: 12000 }] });
    await S.cancelInvoice(d, s.id);
    expect((await buildReceiptModel(d, s.id)).account?.breakdown).toBeUndefined();
  });
});
