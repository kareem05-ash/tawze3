import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { ar } from '../i18n/ar';
import { errText } from './errors';
import { EXIT_MS, canAnimate } from './motion';
import { useToast } from './toast';
import { useGuard } from './hooks';
import { balanceLabelAr, balanceState, type PartyKind } from '../domain/ledger';
import { money } from './format';

export { errText };

const SheetCtx = createContext<() => void>(() => {});
/** Bottom sheet. User dismissals (X, backdrop, Esc, <CancelButton>) play a short exit animation first; a parent that closes it after a successful save simply unmounts it. */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const [closing, setClosing] = useState(false); const closeRef = useRef(onClose); closeRef.current = onClose;
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const requestClose = useCallback(() => {
    if (timer.current !== undefined) return;
    if (!canAnimate()) { closeRef.current(); return; }
    setClosing(true); timer.current = setTimeout(() => closeRef.current(), EXIT_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { const f = (e: KeyboardEvent) => e.key === 'Escape' && requestClose(); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, [requestClose]);
  return (
    <SheetCtx.Provider value={requestClose}>
      <div className={`sheet-back${closing ? ' closing' : ''}`} onClick={requestClose}>
        <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
          <div className="sheet-head"><h2>{title}</h2><button className="icon-btn" onClick={requestClose} aria-label={ar.common.close}><X size={22} /></button></div>
          <div className="sheet-body">{children}</div>
          {footer && <div className="sheet-foot">{footer}</div>}
        </div>
      </div>
    </SheetCtx.Provider>
  );
}
/** Cancel button for sheet footers: closes with the same exit animation as the X button. */
export function CancelButton({ disabled }: { disabled?: boolean }) { const close = useContext(SheetCtx); return <button type="button" className="btn ghost" disabled={disabled} onClick={close}>{ar.common.cancel}</button>; }

/** Labelled input. `error` is shown right under the control that needs correcting. */
export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string }) {
  return <label className={`field${error ? ' invalid' : ''}`}><span className="field-label">{label}</span>{children}{hint && <span className="muted small">{hint}</span>}{error && <span className="field-error" role="alert">{error}</span>}</label>;
}
export function ErrorBox({ message }: { message?: string }) { return message ? <div className="error-box reveal" role="alert">{message}</div> : null; }

/** Confirmation before destructive/irreversible actions. While onConfirm is running both buttons are disabled, so it cannot be submitted twice. */
export function ConfirmDialog({ title, message, confirmLabel = ar.common.confirm, danger, onConfirm, onCancel }:
  { title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void | Promise<void>; onCancel: () => void }) {
  const { busy, guard } = useGuard();
  return (
    <Sheet title={title} onClose={onCancel} footer={<><CancelButton disabled={busy} /><button className={`btn ${danger ? 'danger' : ''}`} disabled={busy} onClick={() => void guard(async () => onConfirm())}>{confirmLabel}</button></>}>
      <p>{message}</p>
    </Sheet>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return <div className="segmented" role="tablist">{options.map(o => <button key={o.id} role="tab" aria-selected={o.id === value} className={o.id === value ? 'on' : ''} onClick={() => onChange(o.id)}>{o.label}</button>)}</div>;
}
export function Empty({ title, hint }: { title: string; hint?: string }) { return <div className="empty"><strong>{title}</strong>{hint && <span className="muted">{hint}</span>}</div>; }
export function Fab({ label, onClick }: { label: string; onClick: () => void }) { return <button className="fab" onClick={onClick} aria-label={label}>＋</button>; }

/** Balance with sign meaning spelled out (positive = party owes us). */
export function BalanceTag({ kind, balance }: { kind: PartyKind; balance: number }) {
  const s = balanceState(balance);
  const cls = s === 'settled' ? 'muted' : s === 'owes_us' ? 'amt-in' : 'amt-out';
  // amount on its own line, meaning below it: a long label wraps under the amount instead of squeezing the party name
  return <span className={`balance ${cls}`}>{s !== 'settled' && <strong>{money(Math.abs(balance))}</strong>}<span className="small">{balanceLabelAr(kind, balance)}</span></span>;
}

/** Small inline "create new" control used for categories, units and parties without leaving the form. */
export function InlineAdd({ placeholder, onCreate, successMessage }: { placeholder: string; onCreate: (name: string) => Promise<void>; successMessage?: string }) {
  const toast = useToast(); const { busy, guard } = useGuard();
  const [open, setOpen] = useState(false); const [v, setV] = useState(''); const [err, setErr] = useState(''); const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  if (!open) return <button type="button" className="link" onClick={() => setOpen(true)}>{ar.common.newItem}</button>;
  const submit = () => guard(async () => { try { await onCreate(v); setV(''); setOpen(false); setErr(''); if (successMessage) toast.success(successMessage); } catch (e) { setErr(errText(e)); } });
  return (
    <div className="inline-add reveal">
      <input ref={ref} value={v} placeholder={placeholder} onChange={e => setV(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), void submit())} />
      <button type="button" className="btn small" disabled={busy} onClick={() => void submit()}>{ar.common.add}</button>
      <button type="button" className="btn ghost small" onClick={() => setOpen(false)}>{ar.common.cancel}</button>
      <ErrorBox message={err} />
    </div>
  );
}

/** Animated show/hide for a block that is always mounted (grid-rows 0fr -> 1fr). Hidden content is inert, so it cannot be focused or read out. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return <div className={`collapse${open ? ' open' : ''}`} {...(open ? {} : ({ inert: '' } as object))}><div className="collapse-inner">{children}</div></div>;
}
