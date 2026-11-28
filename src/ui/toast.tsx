import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle, type LucideIcon } from 'lucide-react';
import { ar } from '../i18n/ar';
import { errText } from './errors';
import { EXIT_MS, canAnimate } from './motion';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';
export interface ToastOpts { /** Same id = same slot: a later toast with this id replaces the earlier one (e.g. loading -> success). */ id?: string; /** ms; 0 = stays until dismissed. */ duration?: number }
interface ToastItem { id: string; type: ToastType; message: string; duration: number; leaving: boolean }

/** Routine confirmations vanish quickly; problems stay long enough to read (and can always be closed by hand). */
export const TOAST_MS: Record<ToastType, number> = { success: 3500, info: 4000, warning: 7000, error: 9000, loading: 0 };
export const MAX_VISIBLE = 3;
/** A loading toast only appears if the task is still running after this long, so quick operations do not flash one. */
export const LOADING_DELAY_MS = 350;

export type RunResult<T> = { ok: true; value: T } | { ok: false; error: unknown };
export interface RunOpts<T> { loading?: string; success?: string | ((v: T) => string); /** Prefix for the failure message: "<error>: <reason>". */ error?: string }
export interface ToastApi {
  success(message: string, o?: ToastOpts): string;
  error(message: string, o?: ToastOpts): string;
  warning(message: string, o?: ToastOpts): string;
  info(message: string, o?: ToastOpts): string;
  loading(message: string, o?: ToastOpts): string;
  dismiss(id?: string): void;
  /** Runs an operation with consistent feedback. Never throws: success toast only after it resolved, error toast (with the reason) if it failed. */
  run<T>(task: () => Promise<T>, o?: RunOpts<T>): Promise<RunResult<T>>;
}

const Ctx = createContext<ToastApi | null>(null);
const ItemsCtx = createContext<ToastItem[]>([]);
export function useToast(): ToastApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}

const ICONS: Record<ToastType, LucideIcon> = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info, loading: Loader2 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const seq = useRef(0);

  const clear = useCallback((id: string) => { const t = timers.current.get(id); if (t !== undefined) { clearTimeout(t); timers.current.delete(id); } }, []);
  const dismiss = useCallback((id?: string) => {
    if (id === undefined) { for (const k of [...timers.current.keys()]) clear(k); setItems([]); return; }
    clear(id);
    if (!canAnimate()) { setItems(xs => xs.filter(x => x.id !== id)); return; }
    setItems(xs => xs.map(x => (x.id === id ? { ...x, leaving: true } : x)));
    // only remove if it is still the leaving one: a re-shown toast with the same id must survive
    setTimeout(() => setItems(xs => xs.filter(x => !(x.id === id && x.leaving))), EXIT_MS);
  }, [clear]);
  const show = useCallback((type: ToastType, message: string, o: ToastOpts = {}) => {
    const id = o.id ?? `${type}:${message}`; // identical message = same slot, so repeats refresh instead of piling up
    const duration = o.duration ?? TOAST_MS[type];
    setItems(xs => {
      const item: ToastItem = { id, type, message, duration, leaving: false };
      const i = xs.findIndex(x => x.id === id);
      const next = i >= 0 ? xs.map((x, j) => (j === i ? item : x)) : [...xs, item];
      while (next.filter(x => !x.leaving).length > MAX_VISIBLE) { // flood control: drop the oldest, keeping in-progress ones if possible
        const k = next.findIndex(x => !x.leaving && x.type !== 'loading' && x.id !== id);
        const j = k >= 0 ? k : next.findIndex(x => !x.leaving && x.id !== id);
        if (j < 0) break; next.splice(j, 1);
      }
      return next;
    });
    clear(id);
    if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
    return id;
  }, [clear, dismiss]);

  const run = useCallback(async <T,>(task: () => Promise<T>, o: RunOpts<T> = {}): Promise<RunResult<T>> => {
    const id = `run:${++seq.current}`; let shown = false;
    const t = o.loading ? setTimeout(() => { shown = true; show('loading', o.loading!, { id }); }, LOADING_DELAY_MS) : undefined;
    try {
      const value = await task(); clearTimeout(t);
      const msg = typeof o.success === 'function' ? o.success(value) : o.success;
      if (shown) dismiss(id);
      if (msg) show('success', msg); // default id = type + text, so repeating the same result refreshes one toast instead of stacking copies
      return { ok: true, value };
    } catch (e) {
      clearTimeout(t);
      const reason = errText(e);
      if (shown) dismiss(id);
      show('error', o.error ? `${o.error}: ${reason}` : reason);
      return { ok: false, error: e };
    }
  }, [show, dismiss]);

  useEffect(() => { const m = timers.current; return () => { for (const t of m.values()) clearTimeout(t); m.clear(); }; }, []);

  // The api object never changes, so components that only call toasts do not re-render when a toast appears.
  const api = useMemo<ToastApi>(() => ({
    success: (m, o) => show('success', m, o), error: (m, o) => show('error', m, o), warning: (m, o) => show('warning', m, o),
    info: (m, o) => show('info', m, o), loading: (m, o) => show('loading', m, o), dismiss, run,
  }), [show, dismiss, run]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <ItemsCtx.Provider value={items}><ToastViewport onDismiss={dismiss} /></ItemsCtx.Provider>
    </Ctx.Provider>
  );
}

const ToastCard = memo(function ToastCard({ t, onDismiss }: { t: ToastItem; onDismiss: (id: string) => void }) {
  const Icon = ICONS[t.type]; const urgent = t.type === 'error' || t.type === 'warning';
  return (
    <div className={`toast ${t.type}${t.leaving ? ' leaving' : ''}`} role={urgent ? 'alert' : 'status'}>
      <Icon size={20} aria-hidden className={t.type === 'loading' ? 'spin' : undefined} />
      <span className="toast-msg">{t.message}</span>
      {t.type !== 'loading' && <button type="button" className="icon-btn toast-x" onClick={() => onDismiss(t.id)} aria-label={ar.toast.dismiss}><X size={18} /></button>}
    </div>
  );
});

/** Two always-mounted live regions: calm messages are announced politely, problems assertively. Sits under the top bar, clear of the bottom nav and FAB. */
function ToastViewport({ onDismiss }: { onDismiss: (id?: string) => void }) {
  const items = useContext(ItemsCtx);
  const calm = items.filter(t => t.type === 'success' || t.type === 'info' || t.type === 'loading');
  const urgent = items.filter(t => t.type === 'error' || t.type === 'warning');
  return (
    <div className="toasts" aria-label={ar.toast.region}>
      <div aria-live="polite" aria-atomic="false">{calm.map(t => <ToastCard key={t.id} t={t} onDismiss={onDismiss} />)}</div>
      <div aria-live="assertive" aria-atomic="false">{urgent.map(t => <ToastCard key={t.id} t={t} onDismiss={onDismiss} />)}</div>
    </div>
  );
}
