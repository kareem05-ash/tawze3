import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ar } from '../i18n/ar';
import { hasPin, pinLength, verifyPin, setPin, changePin, disablePin, isValidPin, normalizePin } from '../security/pin';
import { useReadyDb } from './DbProvider';
import { ErrorBox, Field, Sheet, errText } from './kit';

export const AUTOLOCK_MS = 30_000; // lock again when the app comes back after >30s in the background
const Ctx = createContext<{ lockNow: () => void; refresh: () => void; enabled: boolean }>({ lockNow: () => {}, refresh: () => {}, enabled: false });
export const useLock = () => useContext(Ctx);
const AR = '٠١٢٣٤٥٦٧٨٩';

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { db } = useReadyDb();
  const [len, setLen] = useState(4); const [digits, setDigits] = useState(''); const typed = useRef(''); const [msg, setMsg] = useState(''); const [until, setUntil] = useState(0); const [now, setNow] = useState(Date.now()); const [busy, setBusy] = useState(false);
  useEffect(() => { void pinLength(db).then(setLen); }, [db]);
  useEffect(() => { if (until <= Date.now()) return; const t = setInterval(() => { setNow(Date.now()); if (Date.now() >= until) { setUntil(0); setMsg(''); } }, 500); return () => clearInterval(t); }, [until]);
  const waiting = until > now;

  const submit = useCallback(async (pin: string) => {
    setBusy(true);
    try {
      const r = await verifyPin(db, pin);
      if (r.ok) { onUnlock(); return; }
      typed.current = ''; setDigits('');
      if (r.lockedUntil) { setUntil(r.lockedUntil); setNow(Date.now()); setMsg(''); }
      else setMsg(`${ar.lock.wrong} · ${ar.lock.left}: ${(r.attemptsLeft ?? 0).toLocaleString('ar-EG')}`);
    } finally { setBusy(false); }
  }, [db, onUnlock]);
  const press = useCallback((d: string) => {
    if (busy || waiting) return;
    setMsg('');
    const next = (typed.current + d).slice(0, len); typed.current = next; setDigits(next);   // ref, not a state updater: submit must run exactly once
    if (next.length === len) void submit(next);
  }, [busy, waiting, len, submit]);
  const erase = () => { typed.current = typed.current.slice(0, -1); setDigits(typed.current); };
  useEffect(() => { const f = (e: KeyboardEvent) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') erase(); }; addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, [press]);

  return (
    <div className="lock" role="dialog" aria-modal="true" aria-label={ar.lock.title}>
      <h1>{ar.appName}</h1>
      <p className="muted">{waiting ? `${ar.lock.waitFor} ${Math.ceil((until - now) / 1000).toLocaleString('ar-EG')} ${ar.lock.seconds}` : ar.lock.enter}</p>
      <div className="dots" aria-hidden>{Array.from({ length: len }, (_, i) => <span key={i} className={`dot ${i < digits.length ? 'on' : ''}`} />)}</div>
      <p className="amt-out small" role="alert" style={{ minHeight: '1.4em' }}>{msg}</p>
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => <button key={d} className="key" aria-label={d} disabled={waiting} onClick={() => press(d)}>{AR[Number(d)]}</button>)}
        <span /><button className="key" aria-label="0" disabled={waiting} onClick={() => press('0')}>{AR[0]}</button>
        <button className="key plain" onClick={erase}>{ar.lock.del}</button>
      </div>
    </div>
  );
}

/** Wraps the app: shows only the lock screen (nothing else is rendered) while locked. */
export function LockGate({ children }: { children: ReactNode }) {
  const { db } = useReadyDb();
  const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking'); const [enabled, setEnabled] = useState(false);
  const hiddenAt = useRef<number | null>(null);
  const refresh = useCallback(() => { void hasPin(db).then(setEnabled); }, [db]);
  useEffect(() => { void hasPin(db).then(h => { setEnabled(h); setState(h ? 'locked' : 'open'); }); }, [db]);
  useEffect(() => {
    const f = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (hiddenAt.current !== null && Date.now() - hiddenAt.current > AUTOLOCK_MS) { hiddenAt.current = null; void hasPin(db).then(h => h && setState('locked')); }
    };
    document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f);
  }, [db]);
  if (state === 'checking') return <div className="center muted" role="status">{ar.db.loading}</div>;
  if (state === 'locked') return <LockScreen onUnlock={() => setState('open')} />;
  return <Ctx.Provider value={{ lockNow: () => setState('locked'), refresh, enabled }}>{children}</Ctx.Provider>;
}

export function PinSheet({ mode, onDone, onClose }: { mode: 'set' | 'change' | 'disable'; onDone: (msg: string) => void; onClose: () => void }) {
  const { db } = useReadyDb();
  const [cur, setCur] = useState(''); const [a, setA] = useState(''); const [b, setB] = useState(''); const [err, setErr] = useState('');
  const save = async () => {
    try {
      if (mode !== 'disable') { if (!isValidPin(a)) { setErr('الرمز يجب أن يكون من ٤ إلى ٨ أرقام'); return; } if (normalizePin(a) !== normalizePin(b)) { setErr(ar.lock.mismatch); return; } }
      if (mode === 'set') await setPin(db, a); else if (mode === 'change') await changePin(db, cur, a); else await disablePin(db, cur);
      onDone(mode === 'disable' ? ar.lock.removed : ar.lock.done);
    } catch (e) { setErr(errText(e)); }
  };
  const pinInput = (v: string, set: (s: string) => void, label: string, focus = false) => <Field label={label}><input type="password" inputMode="numeric" autoComplete="off" maxLength={8} autoFocus={focus} value={v} onChange={e => set(e.target.value)} /></Field>;
  return (
    <Sheet title={mode === 'set' ? ar.lock.enable : mode === 'change' ? ar.lock.change : ar.lock.disable} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>{ar.common.cancel}</button><button className="btn" onClick={() => void save()}>{ar.common.save}</button></>}>
      {mode !== 'set' && pinInput(cur, setCur, ar.lock.current, true)}
      {mode !== 'disable' && <>{pinInput(a, setA, ar.lock.newPin, mode === 'set')}{pinInput(b, setB, ar.lock.repeat)}</>}
      <ErrorBox message={err} />
    </Sheet>
  );
}
