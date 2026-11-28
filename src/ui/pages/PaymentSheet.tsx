import { useState } from 'react';
import { ar } from '../../i18n/ar';
import { previewPayment, recordPayment } from '../../services';
import type { PartyKind } from '../../domain/ledger';
import { useReadyDb } from '../DbProvider';
import { useLoad } from '../hooks';
import { CancelButton, ErrorBox, Field, Sheet, errText } from '../kit';
import { useGuard } from '../hooks';
import { dateLabel, minorToInput, money, toMinor, todayIso } from '../format';

/**
 * One amount, one button. The money covers the OLDEST open bills first (the sheet shows exactly which ones before saving).
 * Opened from an invoice, that invoice is paid first and the rest continues oldest-first.
 */
export function PaymentSheet({ partyId, kind, invoiceId, suggested, onDone, onClose }: {
  partyId: number; kind: PartyKind; invoiceId?: number; suggested?: number; onDone: (message: string) => void; onClose: () => void;
}) {
  const { db } = useReadyDb();
  const [amount, setAmount] = useState(suggested ? minorToInput(suggested) : '');
  const [date, setDate] = useState(todayIso()); const [editDate, setEditDate] = useState(false);
  const [notes, setNotes] = useState(''); const [editNotes, setEditNotes] = useState(false);
  const [err, setErr] = useState(''); const [amountErr, setAmountErr] = useState(''); const { busy, guard } = useGuard();
  const minor = amount.trim() ? toMinor(amount) : 0;
  const valid = minor !== null && minor > 0;
  const preview = useLoad(d => previewPayment(d, partyId, valid ? minor : 0, invoiceId), [partyId, valid ? minor : 0, invoiceId]);
  const pv = preview.data;

  const save = () => guard(async () => {
    if (!valid) { setAmountErr(`${ar.common.required}: ${ar.common.amount}`); return; }
    setErr('');
    try {
      const r = await recordPayment(db, { partyId, amount: minor, date, invoiceId, notes: notes.trim() || undefined });
      onDone(`${ar.payment.done} (${r.ref})${r.advance > 0 ? ` · ${money(r.advance)} ${ar.payment.savedAdvance}` : ''}`);
    } catch (e) { setErr(errText(e)); }
  });
  return (
    <Sheet title={kind === 'customer' ? ar.payment.receiveTitle : ar.payment.payTitle} onClose={onClose}
      footer={<><CancelButton disabled={busy} /><button className="btn" disabled={busy || !valid} onClick={() => void save()}>{kind === 'customer' ? ar.payment.receiveBtn : ar.payment.payBtn}</button></>}>
      <Field label={ar.common.amount} error={amountErr}>
        <input className="amount-input" inputMode="decimal" autoFocus placeholder="0" value={amount} onChange={e => { setAmount(e.target.value); setErr(''); setAmountErr(''); }} onKeyDown={e => e.key === 'Enter' && void save()} />
      </Field>
      {pv && pv.totalDue > 0 && (
        <p className="due-row"><span>{ar.payment.due}: <strong>{money(pv.totalDue)}</strong></span>
          <button type="button" className="link" onClick={() => setAmount(minorToInput(pv.totalDue))}>{ar.payment.payAll}</button></p>
      )}
      {invoiceId !== undefined && <p className="muted small">{ar.payment.forInvoice}</p>}
      {valid && pv && (
        <div className="preview reveal" aria-label={ar.payment.order}>
          {pv.lines.length === 0 && <p className="muted small">{ar.payment.nothingDue}</p>}
          {pv.lines.map((l, i) => (
            <div key={i} className="kv"><span>{l.kind === 'opening' ? ar.payment.opening : `${ar.payment.invoiceWord} ${l.ref}`}</span>
              <strong className={l.fullyPaid ? 'amt-in' : ''}>{money(l.applied)} · {l.fullyPaid ? ar.payment.fullyPaid : `${ar.payment.left} ${money(l.remainingAfter)}`}</strong></div>
          ))}
          {pv.advance > 0 && pv.lines.length > 0 && <p className="muted small">{ar.payment.advance} {money(pv.advance)}: {ar.payment.advanceNote}</p>}
        </div>
      )}
      <div className="quiet-row">
        {editDate ? <div className="reveal"><Field label={ar.common.date}><input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} /></Field></div>
          : <span className="muted">{ar.common.date}: {date === todayIso() ? ar.payment.today : dateLabel(date)} <button type="button" className="link" onClick={() => setEditDate(true)}>{ar.payment.change}</button></span>}
      </div>
      <div className="quiet-row">
        {editNotes ? <div className="reveal"><Field label={ar.common.notes}><input value={notes} onChange={e => setNotes(e.target.value)} /></Field></div>
          : <button type="button" className="link" onClick={() => setEditNotes(true)}>{ar.payment.addNote}</button>}
      </div>
      <ErrorBox message={err} />
    </Sheet>
  );
}
