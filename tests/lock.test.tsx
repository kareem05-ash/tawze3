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
