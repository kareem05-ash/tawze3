// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SqlJsDb } from '../src/db/sqljsAdapter';
import { migrate } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import * as P from '../src/security/pin';
import * as S from '../src/services';
import { DbProvider } from '../src/ui/DbProvider';
import { ThemeProvider } from '../src/ui/theme';
import { Shell } from '../src/ui/Shell';
import { LockGate, AUTOLOCK_MS } from '../src/ui/Lock';
import { ar } from '../src/i18n/ar';

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
const wasm = readFileSync('node_modules/sql.js/dist/sql-wasm.wasm');
let db: SqlJsDb;
const app = () => render(<ThemeProvider><DbProvider open={async () => ({ db, version: MIGRATIONS.length })}><LockGate><Shell /></LockGate></DbProvider></ThemeProvider>);
const tap = async (pin: string) => { for (const d of pin) await userEvent.click(screen.getByRole('button', { name: d })); };

beforeEach(async () => {
  db = await SqlJsDb.open(undefined, { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer });
  await migrate(db, MIGRATIONS); location.hash = '';
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('app lock screen', () => {
  it('shows only the lock screen while locked, then unlocks with the right PIN', async () => {
    await P.setPin(db, '2468', 1000);
    app();
    expect(await screen.findByRole('dialog', { name: ar.lock.title })).toBeTruthy();
    expect(screen.queryByRole('banner')).toBeNull();           // no app content is rendered behind the lock
    await tap('2468');
    await screen.findByRole('banner');
    expect(screen.queryByRole('dialog', { name: ar.lock.title })).toBeNull();
  });
  it('wrong PIN keeps it locked and shows the remaining attempts', async () => {
    await P.setPin(db, '2468', 1000);
    app(); await screen.findByRole('dialog');
    await tap('1111');
    expect((await screen.findByRole('alert')).textContent).toContain(ar.lock.wrong);
    expect(screen.queryByRole('banner')).toBeNull();
    expect((await P.verifyPin(db, '0000')).attemptsLeft).toBe(3);   // 1 UI failure + this one = 2 failures
  });
  it('locks out after 5 failures and disables the keypad', async () => {
    await P.setPin(db, '2468', 1000);
    app(); await screen.findByRole('dialog');
    for (let i = 0; i < 5; i++) { await tap('1111'); await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy()); }
    await waitFor(() => expect((screen.getByRole('button', { name: '5' }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(new RegExp(ar.lock.waitFor))).toBeTruthy();
  });
  it('no PIN set: the app opens directly', async () => {
    app(); await screen.findByRole('banner'); expect(screen.queryByRole('dialog', { name: ar.lock.title })).toBeNull();
  });
  it('locks again when the app returns after more than 30 seconds in the background', async () => {
    await P.setPin(db, '2468', 1000);
    app(); await screen.findByRole('dialog'); await tap('2468'); await screen.findByRole('banner');
    const t0 = Date.now(); const spy = vi.spyOn(Date, 'now');
    const vis = (state: 'hidden' | 'visible') => { Object.defineProperty(document, 'visibilityState', { value: state, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); };
    spy.mockReturnValue(t0); act(() => vis('hidden'));
    spy.mockReturnValue(t0 + 5_000); act(() => vis('visible'));
    expect(screen.queryByRole('dialog', { name: ar.lock.title })).toBeNull();           // short absence: stays open
    spy.mockReturnValue(t0 + 10_000); act(() => vis('hidden'));
    spy.mockReturnValue(t0 + 10_000 + AUTOLOCK_MS + 1000); act(() => vis('visible'));
    expect(await screen.findByRole('dialog', { name: ar.lock.title })).toBeTruthy();
  });
});

describe('PIN settings', () => {
  it('enables the lock from Settings, then requires the current PIN to disable it', async () => {
    location.hash = '#more/settings';
    app(); await screen.findByText(ar.lock.section);
    await userEvent.click(screen.getByText(ar.lock.enable));
    const dlg = await screen.findByRole('dialog');
    const [a, b] = within(dlg).getAllByLabelText(/الرمز|أعد/);
    await userEvent.type(a!, '1357'); await userEvent.type(b!, '9999');
    await userEvent.click(within(dlg).getByText(ar.common.save));
    expect((await within(dlg).findByRole('alert')).textContent).toContain(ar.lock.mismatch);
    await userEvent.clear(b!); await userEvent.type(b!, '1357');
    await userEvent.click(within(dlg).getByText(ar.common.save));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await P.hasPin(db)).toBe(true);
    expect((await P.verifyPin(db, '1357')).ok).toBe(true);
    await userEvent.click(await screen.findByText(ar.lock.disable));
    const d2 = await screen.findByRole('dialog');
    await userEvent.type(within(d2).getAllByLabelText(ar.lock.current)[0]!, '0000');
    await userEvent.click(within(d2).getByText(ar.common.save));
    expect((await within(d2).findByRole('alert')).textContent).toContain('غير صحيح');
    expect(await P.hasPin(db)).toBe(true);
  });
});

describe('narrow-screen layout guards', () => {
  it('statement and report date pickers sit in the stacking .dates container', async () => {
    const cust = await S.createParty(db, { kind: 'customer', name: 'النور' });
    for (const hash of [`#parties/${cust}`, '#more/reports']) {
      location.hash = hash; const { container, unmount } = app();
      await waitFor(() => expect(container.querySelectorAll('.dates input[type=date]').length).toBe(2));
      unmount();
    }
  });
  it('stylesheet lets grid cells shrink and stacks the date pair on phones', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    expect(css).toMatch(/\.row2\{[^}]*minmax\(0,1fr\)/);
    expect(css).toMatch(/\.row2>\*,\.row3>\*[^{]*\{min-width:0\}/);
    expect(css).toMatch(/\.dates\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
    expect(css).toMatch(/@media \(min-width:560px\)\{\.dates/);
  });
});

describe('account list rows (long balance labels)', () => {
  it('keeps a long customer name whole and puts the balance meaning under the amount', async () => {
    const piece = await S.createUnit(db, 'قطعة');
    const prod = await S.createProduct(db, { name: 'صنف', baseUnitId: piece, buyPrice: 100, sellPrice: 200, lowStockMilli: 0 });
    const supp = await S.createParty(db, { kind: 'supplier', name: 'مورد' });
    const name = 'سوبر ماركت الأمانة والنور للمواد الغذائية بالجملة';
    const cust = await S.createParty(db, { kind: 'customer', name });
    await S.postInvoice(db, { kind: 'purchase', partyId: supp, date: '2026-11-01', lines: [{ productId: prod, unitId: piece, qtyMilli: 10000, unitPrice: 100 }] });
    const s = await S.postInvoice(db, { kind: 'sale', partyId: cust, date: '2026-11-02', paidNow: 1000, lines: [{ productId: prod, unitId: piece, qtyMilli: 5000, unitPrice: 200 }] });
    const line = (await S.getInvoiceDetail(db, s.id))!.lines[0]!.id as number;
    await S.postReturn(db, { invoiceId: s.id, date: '2026-11-03', lines: [{ invoiceLineId: line, qtyMilli: 5000 }] }); // customer is now owed money
    expect(await S.getPartyBalance(db, cust)).toBeLessThan(0);
    location.hash = '#parties'; const { container } = app();
    const row = await waitFor(() => { const r = container.querySelector('a.row'); if (!r) throw new Error('no row'); return r as HTMLElement; });
    expect(row.querySelector('.row-main strong')?.textContent).toBe(name);            // whole name in one text node
    const bal = row.querySelector('.row-end .balance')!;
    expect(bal.children[0]?.tagName).toBe('STRONG'); expect(bal.children[1]?.textContent).toContain('دفع مقدماً'); // amount first, long meaning below
  });
  it('stylesheet gives the name column priority and never breaks names at every character', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const rule = (sel: string) => (css.match(new RegExp(`${sel.replace(/[.]/g, '\\.')}\\{([^}]*)\\}`)) ?? [])[1] ?? '';
    expect(rule('.row-main')).toMatch(/flex:1 1 0/); expect(rule('.row-main')).toMatch(/min-width:0/); expect(rule('.row-main')).not.toMatch(/anywhere/);
    expect(rule('.row-end')).toMatch(/max-width:52%/);
    expect(css).not.toMatch(/\.row-main[^{]*\{[^}]*overflow-wrap:anywhere/);
  });
});

describe('backup page', () => {
  it('shows the automatic backup written on startup and restores from it (with a safety copy download)', async () => {
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => 'blob:x'); (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await S.createParty(db, { kind: 'customer', name: 'قبل النسخة' });
    location.hash = '#more/backup'; app();
    await waitFor(async () => expect(await S.getSetting(db, 'last_auto_backup_date')).toBeTruthy());       // AutoBackupRunner ran on open
    await S.createParty(db, { kind: 'customer', name: 'بعد النسخة' });
    const restoreBtn = await screen.findByText(ar.backup.restoreThis);
    await userEvent.click(restoreBtn);
    const dlg = await screen.findByRole('dialog'); await userEvent.click(within(dlg).getByText(ar.backup.confirmRestore));
    await waitFor(async () => expect((await S.listParties(db)).map(p => p.name)).toEqual(['قبل النسخة']));
    expect(click).toHaveBeenCalled();                                                                       // safety copy was handed over first
    expect(await screen.findByText(ar.backup.restoreOk)).toBeTruthy();
  });
});

vi.mock('../src/security/biometric', async () => {
  const actual = await vi.importActual<typeof import('../src/security/biometric')>('../src/security/biometric');
  return { ...actual, biometricAvailable: vi.fn(async () => true), biometricUnlock: vi.fn(async () => true) };
});
describe('biometric unlock (native-only feature, mocked here)', () => {
  it('prompts automatically when enabled, unlocks on success, and the PIN keypad remains available', async () => {
    await P.setPin(db, '2468', 1000);
    const bio = await import('../src/security/biometric'); await bio.setBiometricEnabled(db, true);
    app();
    await screen.findByRole('banner');                                  // biometric success opened the app
    expect(bio.biometricUnlock).toHaveBeenCalled();
  });
  it('on biometric failure the lock screen stays and the PIN still works', async () => {
    await P.setPin(db, '2468', 1000);
    const bio = await import('../src/security/biometric'); await bio.setBiometricEnabled(db, true);
    vi.mocked(bio.biometricUnlock).mockResolvedValue(false);
    app(); await screen.findByRole('dialog');
    expect(await screen.findByText(ar.lock.bioFailed)).toBeTruthy(); expect(screen.getByText(ar.lock.useBio)).toBeTruthy();
    await tap('2468'); await screen.findByRole('banner');
    vi.mocked(bio.biometricUnlock).mockResolvedValue(true);
  });
  it('removing the PIN also removes the biometric flag, and it is never in backups', async () => {
    await P.setPin(db, '2468', 1000);
    const bio = await import('../src/security/biometric'); await bio.setBiometricEnabled(db, true);
    expect((await S.createBackup(db)).text).not.toContain('pin_biometric');
    await P.disablePin(db, '2468');
    expect(await bio.biometricEnabled(db)).toBe(false);
  });
});
