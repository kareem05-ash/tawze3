// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SqlJsDb } from '../src/db/sqljsAdapter';
import { migrate } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import * as S from '../src/services';
import { DbProvider } from '../src/ui/DbProvider';
import { ThemeProvider } from '../src/ui/theme';
import { Shell } from '../src/ui/Shell';
import { ConfirmDialog, Sheet } from '../src/ui/kit';
import { MAX_VISIBLE, TOAST_MS, LOADING_DELAY_MS, ToastProvider, useToast, type ToastApi } from '../src/ui/toast';
import { ar } from '../src/i18n/ar';

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
const wasm = readFileSync('node_modules/sql.js/dist/sql-wasm.wasm');
const mockMotion = (reduce: boolean) => { window.matchMedia = ((q: string) => ({ matches: q.includes('reduced-motion') ? reduce : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as unknown as typeof matchMedia; };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); location.hash = ''; delete (window as { matchMedia?: unknown }).matchMedia; });

let api: ToastApi;
function Probe() { api = useToast(); return null; }
const mount = () => render(<ToastProvider><Probe /></ToastProvider>);

describe('toast system', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  it('success auto-dismisses after a few seconds; error stays longer and can be closed by hand', () => {
    mount();
    act(() => { api.success('تم'); api.error('فشل'); });
    expect(screen.getByRole('status').textContent).toContain('تم'); expect(screen.getByRole('alert').textContent).toContain('فشل');
    act(() => { vi.advanceTimersByTime(TOAST_MS.success + 50); });
    expect(screen.queryByText('تم')).toBeNull(); expect(screen.getByText('فشل')).toBeTruthy();
    act(() => { screen.getByRole('button', { name: ar.toast.dismiss }).click(); });
    expect(screen.queryByText('فشل')).toBeNull();
    expect(TOAST_MS.error).toBeGreaterThan(TOAST_MS.success);
  });
  it('announces calmly (polite) or urgently (assertive) via live regions', () => {
    const { container } = mount();
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy(); expect(container.querySelector('[aria-live="assertive"]')).toBeTruthy();
    act(() => { api.warning('انتبه'); }); expect(container.querySelector('[aria-live="assertive"] [role="alert"]')?.textContent).toContain('انتبه');
    act(() => { api.info('معلومة'); }); expect(container.querySelector('[aria-live="polite"] [role="status"]')?.textContent).toContain('معلومة');
  });
  it('identical messages do not stack; the repeat restarts the timer', () => {
    mount();
    act(() => { api.success('تم'); }); act(() => { vi.advanceTimersByTime(3000); }); act(() => { api.success('تم'); });
    expect(screen.getAllByText('تم')).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(3000); }); expect(screen.getByText('تم')).toBeTruthy();   // would be gone without the restart
    act(() => { vi.advanceTimersByTime(1000); }); expect(screen.queryByText('تم')).toBeNull();
  });
  it('never shows more than MAX_VISIBLE at once (oldest dropped)', () => {
    mount(); act(() => { for (let i = 0; i < 6; i++) api.info(`رسالة ${i}`); });
    expect(screen.getAllByRole('status')).toHaveLength(MAX_VISIBLE); expect(screen.getByText('رسالة 5')).toBeTruthy(); expect(screen.queryByText('رسالة 0')).toBeNull();
  });
  it('loading stays until replaced; a replacement with the same id takes its slot', () => {
    mount(); let id = '';
    act(() => { id = api.loading('جارٍ'); }); act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText('جارٍ')).toBeTruthy(); expect(screen.queryByRole('button', { name: ar.toast.dismiss })).toBeNull();
    act(() => { api.success('انتهى', { id }); }); expect(screen.queryByText('جارٍ')).toBeNull(); expect(screen.getByText('انتهى')).toBeTruthy();
  });
  it('run(): success toast only after the task resolved; quick tasks show no loading flash', async () => {
    mount(); let res!: (v: number) => void;
    const p = api.run(() => new Promise<number>(r => { res = r; }), { loading: 'جارٍ', success: v => `تم ${v}` });
    expect(screen.queryByText(/تم/)).toBeNull();
    await act(async () => { res(7); await p; });
    expect(screen.getByText('تم 7')).toBeTruthy(); expect(screen.queryByText('جارٍ')).toBeNull();
  });
  it('run(): slow task shows loading, then the failure with its reason — never a success', async () => {
    mount(); let rej!: (e: unknown) => void;
    const p = api.run(() => new Promise<void>((_, r) => { rej = r; }), { loading: 'جارٍ', success: 'تم', error: 'تعذّر الحفظ' });
    await act(async () => { vi.advanceTimersByTime(LOADING_DELAY_MS + 10); });
    expect(screen.getByText('جارٍ')).toBeTruthy();
    let r: Awaited<typeof p> | undefined;
    await act(async () => { rej(new Error('سبب عربي')); r = await p; });
    expect(r?.ok).toBe(false); expect(screen.queryByText('تم')).toBeNull(); expect(screen.queryByText('جارٍ')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('تعذّر الحفظ: سبب عربي');
  });
  it('run(): unexpected English errors are replaced by the generic Arabic message (and logged)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); mount();
    await act(async () => { await api.run(async () => { throw new Error('SQLITE_BUSY'); }, { error: 'تعذّر' }); });
    expect(screen.getByRole('alert').textContent).toContain(ar.common.unexpected); expect(screen.queryByText(/SQLITE_BUSY/)).toBeNull();
  });
  it('useToast outside a provider fails loudly instead of silently swallowing feedback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); expect(() => render(<Probe />)).toThrow(/ToastProvider/);
  });
});

describe('sheets, confirmation and motion', () => {
  it('a destructive confirm disables both buttons while running and fires once even on double click', async () => {
    let finish!: () => void; const onConfirm = vi.fn(() => new Promise<void>(r => { finish = r; }));
    render(<ToastProvider><ConfirmDialog title="t" message="m" danger confirmLabel="نفّذ" onConfirm={onConfirm} onCancel={() => {}} /></ToastProvider>);
    const btn = screen.getByText('نفّذ');
    await userEvent.dblClick(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect((btn as HTMLButtonElement).disabled).toBe(true); expect((screen.getByText(ar.common.cancel) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish(); }); await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
  });
  it('closing a sheet plays the exit animation first (class "closing"), then calls onClose', async () => {
    mockMotion(false); vi.useFakeTimers(); const onClose = vi.fn();
    const { container } = render(<Sheet title="t" onClose={onClose}>x</Sheet>);
    act(() => { screen.getByRole('button', { name: ar.common.close }).click(); });
    expect(container.querySelector('.sheet-back.closing')).toBeTruthy(); expect(onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(250); }); expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('with prefers-reduced-motion the sheet closes immediately, with no exit animation', () => {
    mockMotion(true); const onClose = vi.fn();
    const { container } = render(<Sheet title="t" onClose={onClose}>x</Sheet>);
    act(() => { screen.getByRole('button', { name: ar.common.close }).click(); });
    expect(onClose).toHaveBeenCalledTimes(1); expect(container.querySelector('.closing')).toBeNull();
  });
  it('the stylesheet disables every animation and transition under prefers-reduced-motion, as its last rule', () => {
    const css = readFileSync('src/styles.css', 'utf8'); const i = css.lastIndexOf('@media (prefers-reduced-motion:reduce)');
    expect(i).toBeGreaterThan(0); const tail = css.slice(i);
    expect(tail).toMatch(/animation:none!important/); expect(tail).toMatch(/transition:none!important/);
    expect(css.slice(0, i)).not.toMatch(/@media \(prefers-reduced-motion:no-preference\)\{[^}]*\}\s*$/);
    for (const m of css.matchAll(/transition:[^;}]*?\.(\d+)s/g)) expect(Number(`0.${m[1]}`)).toBeLessThanOrEqual(0.25 + 1e-9);
  });
});

describe('settings page feedback + version', () => {
  let db: SqlJsDb;
  const boot = async (hash = 'more/settings') => {
    location.hash = hash;
    render(<ThemeProvider><DbProvider open={async () => ({ db, version: MIGRATIONS.length })}><Shell /></DbProvider></ThemeProvider>);
    await screen.findByRole('banner');
  };
  beforeEach(async () => {
    db = await SqlJsDb.open(undefined, { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer });
    await migrate(db, MIGRATIONS);
  });
  it('shows the development label when no release version is baked in', async () => {
    await boot(); expect((await screen.findByLabelText(ar.settings.version)).textContent).toContain(ar.settings.versionDev);
  });
  it('shows vX.Y.Z from VITE_APP_VERSION', async () => {
    vi.stubEnv('VITE_APP_VERSION', '0.1.3'); await boot();
    const row = await screen.findByLabelText(ar.settings.version); expect(row.textContent).toContain('v0.1.3'); expect(row.textContent).not.toContain('vv');
  });
  it('saving the business name shows success only after it was stored', async () => {
    await boot(); const input = await screen.findByLabelText(ar.settings.business);
    await userEvent.clear(input); await userEvent.type(input, 'مخازن النور'); await userEvent.click(screen.getByText(ar.common.save));
    expect((await screen.findByRole('status')).textContent).toContain(ar.settings.saved);
    expect(await S.getSetting(db, 'business_name')).toBe('مخازن النور');
  });
  it('a failing write shows an error toast and no success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await boot(); await screen.findByLabelText(ar.settings.business);
    const spy = vi.spyOn(db, 'run').mockRejectedValue(new Error('disk full'));
    await userEvent.click(screen.getByText(ar.common.save));
    const alert = await screen.findByRole('alert'); expect(alert.textContent).toContain(ar.settings.saveFailed);
    expect(screen.queryByText(ar.settings.saved)).toBeNull(); spy.mockRestore();
  });
  it('adding a customer: empty name is flagged next to the field; success toast after saving', async () => {
    await boot('parties'); await userEvent.click(await screen.findByRole('button', { name: ar.party.addCustomer }));
    const dlg = await screen.findByRole('dialog'); await userEvent.click(within(dlg).getByText(ar.common.save));
    const field = (await within(dlg).findByRole('alert')); expect(field.className).toContain('field-error'); expect(field.closest('label')?.textContent).toContain(ar.common.name);
    await userEvent.type(within(dlg).getByLabelText(new RegExp(ar.common.name)), 'محل الأمانة'); await userEvent.click(within(dlg).getByText(ar.common.save));
    expect((await screen.findByRole('status')).textContent).toContain(ar.fb.partyAdded); expect(await screen.findByText('محل الأمانة')).toBeTruthy();
  });
  it('archiving a product asks first, then confirms with a toast', async () => {
    const u = await S.createUnit(db, 'قطعة'); await S.createProduct(db, { name: 'صنف للأرشفة', baseUnitId: u, buyPrice: 100, sellPrice: 200, lowStockMilli: 0 });
    await boot('more/products'); await userEvent.click(await screen.findByText('صنف للأرشفة'));
    await userEvent.click(await screen.findByRole('button', { name: ar.common.archive }));
    const dlg = await screen.findByRole('dialog', { name: ar.common.archive }); expect(within(dlg).getByText(ar.product.archiveConfirm)).toBeTruthy();
    expect((await S.listProducts(db, {})).length).toBe(1);   // nothing happened yet
    await userEvent.click(within(dlg).getByText(ar.common.confirm));
    expect((await screen.findByText(ar.fb.productArchived))).toBeTruthy(); expect((await S.listProducts(db, {})).length).toBe(0);
  });
});
