import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { ar } from '../i18n/ar';
import { ServiceError } from '../services/common';
import { balanceLabelAr, balanceState, type PartyKind } from '../domain/ledger';
import { money } from './format';

export function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.message;
  if (e instanceof Error && /[\u0600-\u06FF]/.test(e.message)) return e.message; // domain validation messages are already Arabic
  console.error(e);
  return ar.common.unexpected;
}

export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => { const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, [onClose]);
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="sheet-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label={ar.common.close}><X size={22} /></button></div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="muted small">{hint}</span>}</label>;
}
export function ErrorBox({ message }: { message?: string }) { return message ? <div className="error-box" role="alert">{message}</div> : null; }

export function ConfirmDialog({ title, message, confirmLabel = ar.common.confirm, danger, onConfirm, onCancel }:
  { title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Sheet title={title} onClose={onCancel} footer={<><button className="btn ghost" onClick={onCancel}>{ar.common.cancel}</button><button className={`btn ${danger ? 'danger' : ''}`} onClick={onConfirm}>{confirmLabel}</button></>}>
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
export function InlineAdd({ placeholder, onCreate }: { placeholder: string; onCreate: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false); const [v, setV] = useState(''); const [err, setErr] = useState(''); const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  if (!open) return <button type="button" className="link" onClick={() => setOpen(true)}>{ar.common.newItem}</button>;
  const submit = async () => { try { await onCreate(v); setV(''); setOpen(false); setErr(''); } catch (e) { setErr(errText(e)); } };
  return (
    <div className="inline-add">
      <input ref={ref} value={v} placeholder={placeholder} onChange={e => setV(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), void submit())} />
      <button type="button" className="btn small" onClick={() => void submit()}>{ar.common.add}</button>
      <button type="button" className="btn ghost small" onClick={() => setOpen(false)}>{ar.common.cancel}</button>
      <ErrorBox message={err} />
    </div>
  );
}
