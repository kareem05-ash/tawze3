import { useState } from 'react';
import { ar } from '../../i18n/ar';
import { recordPayment } from '../../services';
import type { PartyKind } from '../../domain/ledger';
import { useReadyDb } from '../DbProvider';
import { ErrorBox, Field, Sheet, errText } from '../kit';
import { minorToInput, money, toMinor, todayIso } from '../format';

export function PaymentSheet({ partyId, kind, invoiceId, suggested, invoices, onDone, onClose }: {
  partyId: number; kind: PartyKind; invoiceId?: number; suggested?: number;
  invoices?: { id: number; ref: string; outstanding: number }[]; onDone: () => void; onClose: () => void;
}) {
  const { db } = useReadyDb();
  const [amount, setAmount] = useState(suggested ? minorToInput(suggested) : '');
  const [date, setDate] = useState(todayIso());
  const [inv, setInv] = useState<string>(invoiceId ? String(invoiceId) : '');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    const a = toMinor(amount);
    if (a === null || a <= 0) { setErr(ar.common.required + ': ' + ar.common.amount); return; }
    setBusy(true);
    try { await recordPayment(db, { partyId, amount: a, date, invoiceId: inv ? Number(inv) : undefined, notes: notes || undefined }); onDone(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet title={kind === 'customer' ? ar.payment.receiveTitle : ar.payment.payTitle} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>{ar.common.cancel}</button><button className="btn" disabled={busy} onClick={() => void save()}>{ar.common.save}</button></>}>
      <Field label={ar.common.amount}><input inputMode="decimal" autoFocus value={amount} onChange={e => setAmount(e.target.value)} /></Field>
      <Field label={ar.common.date}><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      {(invoices?.length ?? 0) > 0 && (
        <Field label={ar.payment.against} hint={ar.payment.advanceNote}>
          <select value={inv} onChange={e => setInv(e.target.value)}>
            <option value="">{ar.payment.general}</option>
            {invoices!.map(i => <option key={i.id} value={i.id}>{i.ref} — {ar.invoice.outstanding} {money(i.outstanding)}</option>)}
          </select>
        </Field>
      )}
      <Field label={ar.common.notes}><input value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      <ErrorBox message={err} />
    </Sheet>
  );
}
