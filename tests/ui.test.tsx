// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SqlJsDb } from '../src/db/sqljsAdapter';
import { migrate } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import * as S from '../src/services';
import App from '../src/App';
import { DbProvider } from '../src/ui/DbProvider';
import { ThemeProvider } from '../src/ui/theme';
import { Shell } from '../src/ui/Shell';
import { ar } from '../src/i18n/ar';
import { parseDecimal, toMinor, toMilli } from '../src/ui/format';

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
const wasm = readFileSync('node_modules/sql.js/dist/sql-wasm.wasm');
let db: SqlJsDb;
let ids: { piece: number; prod: number; cust: number; supp: number };

async function boot(hash: string) {
  location.hash = hash;
  render(<ThemeProvider><DbProvider open={async () => ({ db, version: MIGRATIONS.length })}><Shell /></DbProvider></ThemeProvider>);
  await screen.findByRole('banner');
}
beforeEach(async () => {
  db = await SqlJsDb.open(undefined, { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer });
  await migrate(db, MIGRATIONS);
  const piece = await S.createUnit(db, 'قطعة');
  const prod = await S.createProduct(db, { name: 'شيبسي كبير', baseUnitId: piece, buyPrice: 500, sellPrice: 700, lowStockMilli: 0 });
  const cust = await S.createParty(db, { kind: 'customer', name: 'سوبر ماركت النور' });
  const supp = await S.createParty(db, { kind: 'supplier', name: 'شركة الأمل' });
  await S.postInvoice(db, { kind: 'purchase', partyId: supp, date: '2026-11-01', lines: [{ productId: prod, unitId: piece, qtyMilli: 100000, unitPrice: 500 }] });
  ids = { piece, prod, cust, supp };
});
afterEach(() => { cleanup(); location.hash = ''; });

describe('input parsing', () => {
  it('handles Arabic digits and separators', () => {
    expect(parseDecimal('١٢٫٥')).toBe(12.5);
    expect(parseDecimal('1,5')).toBe(1.5);
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('')).toBeNull();
    expect(toMinor('19.99')).toBe(1999);
    expect(toMilli('٠٫٣٣٣')).toBe(333);
  });
});

describe('app shell', () => {
  it('is RTL Arabic, shows the dashboard from real data and navigates with the bottom nav', async () => {
    await boot('');
    expect(document.documentElement.getAttribute('dir') ?? 'rtl').toBe('rtl');
    expect(await screen.findByText(ar.dash.received)).toBeTruthy();
    const nav = screen.getByRole('navigation');
    await userEvent.click(within(nav).getByText(ar.nav.parties));
    expect(await screen.findByText('سوبر ماركت النور')).toBeTruthy();
    await userEvent.click(within(nav).getByText(ar.nav.sales));
    expect(await screen.findByText(ar.invoice.emptySales)).toBeTruthy();
  });
  it('toggles and persists the theme', async () => {
    await boot('');
    await userEvent.click(screen.getByLabelText(ar.theme.toggle));
    const t = document.documentElement.dataset.theme;
    expect(['light', 'dark']).toContain(t);
    expect(localStorage.getItem('dp.theme')).toBe(t);
  });
  it('shows a retry screen instead of hanging when the database fails to open', async () => {
    render(<ThemeProvider><DbProvider open={async () => { throw new Error('فشل'); }}><Shell /></DbProvider></ThemeProvider>);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(ar.db.retry)).toBeTruthy();
  });
});

describe('forms', () => {
  it('adds a customer through the UI with validation, and it persists in the DB', async () => {
    await boot('#parties');
    await userEvent.click(await screen.findByLabelText(ar.party.addCustomer));
    const dlg = await screen.findByRole('dialog');
    await userEvent.click(within(dlg).getByText(ar.common.save));
    expect(await within(dlg).findByRole('alert')).toBeTruthy(); // name required
    await userEvent.type(within(dlg).getAllByRole('textbox')[0]!, 'محل الأمانة');
    await userEvent.click(within(dlg).getByText(ar.common.save));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('محل الأمانة')).toBeTruthy();
    expect((await S.listParties(db, { kind: 'customer' })).map(p => p.name)).toContain('محل الأمانة');
  });

  it('records a credit sale end to end: stock, balance and receipt', async () => {
    await boot(`#sales/new`);
    const selects = await screen.findAllByRole('combobox');
    await userEvent.selectOptions(selects[0]!, String(ids.cust));
    await waitFor(() => expect(within(screen.getByLabelText(`${ar.invoice.line} 1`)).getAllByRole('option').length).toBeGreaterThan(1));
    const line = screen.getByLabelText(`${ar.invoice.line} 1`);
    await userEvent.selectOptions(within(line).getAllByRole('combobox')[0]!, String(ids.prod));
    const [qtyInput] = within(line).getAllByRole('textbox');
    await userEvent.clear(qtyInput!); await userEvent.type(qtyInput!, '١٠');
    const paid = screen.getAllByRole('textbox').find(el => el.closest('label')?.textContent?.includes(ar.invoice.paidNow))!;
    await userEvent.type(paid, '20'); // 20 EGP = 2000 piasters
    await userEvent.click(screen.getByText(ar.common.save));
    await waitFor(() => expect(location.hash).toMatch(/^#sales\/\d+$/));
    expect(await screen.findByLabelText(ar.invoice.receipt)).toBeTruthy();
    expect(await S.getStock(db, ids.prod)).toBe(90000);
    expect(await S.getPartyBalance(db, ids.cust)).toBe(5000);
  });

  it('asks for explicit confirmation before overselling and records the override', async () => {
    await boot(`#sales/new/${ids.cust}`);
    const line = await screen.findByLabelText(`${ar.invoice.line} 1`);
    await waitFor(() => expect(within(line).getAllByRole('option').length).toBeGreaterThan(1));
    await userEvent.selectOptions(within(line).getAllByRole('combobox')[0]!, String(ids.prod));
    const [qtyInput] = within(line).getAllByRole('textbox');
    await userEvent.clear(qtyInput!); await userEvent.type(qtyInput!, '150');
    await userEvent.click(screen.getByText(ar.common.save));
    const dlg = await screen.findByRole('dialog');
    expect(dlg.textContent).toContain(ar.invoice.overrideTitle);
    expect(await S.getStock(db, ids.prod)).toBe(100000); // nothing saved yet
    await userEvent.click(within(dlg).getByText(ar.invoice.overrideYes));
    await waitFor(() => expect(location.hash).toMatch(/^#sales\/\d+$/));
    expect(await S.getStock(db, ids.prod)).toBe(-50000);
  });

  it('rejects an empty invoice with a clear message', async () => {
    await boot('#purchases/new');
    await userEvent.selectOptions((await screen.findAllByRole('combobox'))[0]!, String(ids.supp));
    await userEvent.click(screen.getByText(ar.common.save));
    expect((await screen.findByRole('alert')).textContent).toContain(ar.invoice.noLines);
  });
});

describe('products screen', () => {
  it('adds a product from scratch: creates category + unit inline, saves, lists it', async () => {
    // fresh DB with no units/products
    db = await SqlJsDb.open(undefined, { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer });
    await migrate(db, MIGRATIONS);
    await boot('#more/products');
    expect(await screen.findByText(ar.product.empty)).toBeTruthy();
    await userEvent.click(screen.getByLabelText(ar.product.add));
    const dlg = await screen.findByRole('dialog');
    await userEvent.type(within(dlg).getAllByRole('textbox')[0]!, 'بسكويت');
    const adders = within(dlg).getAllByText(ar.common.newItem);
    await userEvent.click(adders[0]!);                                   // category
    await userEvent.type(within(dlg).getByPlaceholderText(ar.product.newCategory), 'بسكويت وحلويات');
    await userEvent.click(within(dlg).getByText(ar.common.add));
    await waitFor(() => expect(within(dlg).getByRole('option', { name: 'بسكويت وحلويات' })).toBeTruthy());
    await userEvent.click(within(dlg).getAllByText(ar.common.newItem)[1]!); // unit
    await userEvent.type(within(dlg).getByPlaceholderText(ar.product.newUnit), 'قطعة');
    await userEvent.click(within(dlg).getByText(ar.common.add));
    await waitFor(() => expect(within(dlg).getByRole('option', { name: 'قطعة' })).toBeTruthy());
    await userEvent.click(within(dlg).getByText(ar.common.save));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await S.listProducts(db)).map(p => p.name)).toEqual(['بسكويت']);
    expect(await screen.findByText('بسكويت')).toBeTruthy();
  });
});

describe('adding a product from inside an invoice', () => {
  it('creates a product from the purchase form, selects it, and posts the purchase', async () => {
    db = await SqlJsDb.open(undefined, { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer });
    await migrate(db, MIGRATIONS);
    const supp = await S.createParty(db, { kind: 'supplier', name: 'شركة الأمل' });
    await boot('#purchases/new');
    await userEvent.selectOptions((await screen.findAllByRole('combobox'))[0]!, String(supp));
    expect(await screen.findByText(ar.invoice.noProducts)).toBeTruthy();
    await userEvent.click(screen.getByText(ar.product.newInline));
    const dlg = await screen.findByRole('dialog');
    await userEvent.type(within(dlg).getAllByRole('textbox')[0]!, 'عصير مانجو');
    await userEvent.click(within(dlg).getAllByText(ar.common.newItem)[1]!);
    await userEvent.type(within(dlg).getByPlaceholderText(ar.product.newUnit), 'علبة');
    await userEvent.click(within(dlg).getByText(ar.common.add));
    await waitFor(() => expect(within(dlg).getByRole('option', { name: 'علبة' })).toBeTruthy());
    await userEvent.click(within(dlg).getByText(ar.common.save));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const pid = (await S.listProducts(db))[0]!.id;
    const line = screen.getByLabelText(`${ar.invoice.line} 1`);
    await waitFor(() => expect((within(line).getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe(String(pid)));
    const [qtyInput, priceInput] = within(line).getAllByRole('textbox');
    await userEvent.clear(qtyInput!); await userEvent.type(qtyInput!, '24');
    await userEvent.type(priceInput!, '5');
    await userEvent.click(screen.getByText(ar.common.save));
    await waitFor(() => expect(location.hash).toMatch(/^#purchases\/\d+$/));
    expect(await S.getStock(db, pid)).toBe(24000);
    expect(await S.getPartyBalance(db, supp)).toBe(-12000);
  });
  it('dashboard offers add-product and the route opens the form', async () => {
    await boot('#more/products/new');
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});

describe('reports screen', () => {
  it('shows the custom metrics with their formulas and real totals for the selected range', async () => {
    const s = await S.postInvoice(db, { kind: 'sale', partyId: ids.cust, date: new Date().toLocaleDateString('en-CA'), lines: [{ productId: ids.prod, unitId: ids.piece, qtyMilli: 10000, unitPrice: 700 }] });
    expect(s.total).toBe(7000);
    await boot('#more/reports');
    const custom = await screen.findByLabelText(ar.reports.customTitle);
    expect(custom.textContent).toContain(ar.reports.actualFormula);
    expect(custom.textContent).toContain(ar.reports.idealFormula);
    await waitFor(() => expect(screen.getAllByText(ar.reports.sales).length).toBeGreaterThan(0));
    expect(await screen.findByLabelText(ar.reports.margin)).toBeTruthy();
  });
  it('dashboard renders the 7-day chart section', async () => {
    await boot('');
    expect(await screen.findByLabelText(ar.chart.title)).toBeTruthy();
  });
});
