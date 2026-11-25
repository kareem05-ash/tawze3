import { useState } from 'react';
import { ar } from '../../i18n/ar';
import { archiveParty, createParty, getInvoiceState, getParty, listInvoices, listParties, partyStatement, updateParty, type PartyRow } from '../../services';
import type { PartyKind } from '../../domain/ledger';
import { useReadyDb } from '../DbProvider';
import { useLoad, go } from '../hooks';
import { BalanceTag, ConfirmDialog, Empty, ErrorBox, Fab, Field, Segmented, Sheet, errText } from '../kit';
import { dateLabel, money, monthStartIso, toMinor, todayIso } from '../format';
import { PaymentSheet } from './PaymentSheet';

function PartyForm({ kind, existing, onDone, onClose }: { kind: PartyKind; existing?: PartyRow; onDone: () => void; onClose: () => void }) {
  const { db } = useReadyDb();
  const [name, setName] = useState(existing?.name ?? ''); const [phone, setPhone] = useState(existing?.phone ?? '');
  const [address, setAddress] = useState(existing?.address ?? ''); const [notes, setNotes] = useState(existing?.notes ?? '');
  const [open, setOpen] = useState(''); const [dir, setDir] = useState<'owes_us' | 'we_owe'>(kind === 'customer' ? 'owes_us' : 'we_owe');
  const [openDate, setOpenDate] = useState(todayIso()); const [err, setErr] = useState('');
  const save = async () => {
    try {
      if (existing) await updateParty(db, existing.id, { name, phone, address, notes });
      else {
        const v = open.trim() ? toMinor(open) : 0;
        if (v === null || v < 0) { setErr(ar.common.amount); return; }
        await createParty(db, { kind, name, phone, address, notes, openingBalance: dir === 'owes_us' ? v : -v, openingDate: openDate });
      }
      onDone();
    } catch (e) { setErr(errText(e)); }
  };
  return (
    <Sheet title={existing ? ar.party.editTitle : kind === 'customer' ? ar.party.addCustomer : ar.party.addSupplier} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>{ar.common.cancel}</button><button className="btn" onClick={() => void save()}>{ar.common.save}</button></>}>
      <Field label={ar.common.name}><input autoFocus value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label={ar.common.phone}><input inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} /></Field>
      <Field label={ar.common.address}><input value={address} onChange={e => setAddress(e.target.value)} /></Field>
      <Field label={ar.common.notes}><input value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      {!existing && (
        <fieldset className="group"><legend>{ar.party.opening}</legend>
          <Field label={ar.common.amount}><input inputMode="decimal" placeholder="0" value={open} onChange={e => setOpen(e.target.value)} /></Field>
          <Segmented value={dir} onChange={setDir} options={[{ id: 'owes_us', label: ar.party.openingOwesUs }, { id: 'we_owe', label: ar.party.openingWeOwe }]} />
          <Field label={ar.party.openingDate}><input type="date" value={openDate} onChange={e => setOpenDate(e.target.value)} /></Field>
        </fieldset>
      )}
      <ErrorBox message={err} />
    </Sheet>
  );
}

export function PartiesPage() {
  const [kind, setKind] = useState<PartyKind>('customer'); const [q, setQ] = useState(''); const [adding, setAdding] = useState(false);
  const { data, error, reload } = useLoad(db => listParties(db, { kind, search: q }), [kind, q]);
  return (
    <>
      <Segmented value={kind} onChange={setKind} options={[{ id: 'customer', label: ar.party.customers }, { id: 'supplier', label: ar.party.suppliers }]} />
      <input className="search" type="search" placeholder={ar.common.search} value={q} onChange={e => setQ(e.target.value)} aria-label={ar.common.search} />
      <ErrorBox message={error} />
      {data && data.length === 0 && <Empty title={kind === 'customer' ? ar.party.emptyCustomers : ar.party.emptySuppliers} hint={ar.party.emptyHint} />}
      <ul className="list">
        {data?.map(p => (
          <li key={p.id}><a className="row" href={`#parties/${p.id}`}><span className="row-main"><strong>{p.name}</strong>{p.phone && <span className="muted small">{p.phone}</span>}</span><BalanceTag kind={p.kind} balance={p.balance} /></a></li>
        ))}
      </ul>
      <Fab label={kind === 'customer' ? ar.party.addCustomer : ar.party.addSupplier} onClick={() => setAdding(true)} />
      {adding && <PartyForm kind={kind} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
    </>
  );
}

export function PartyDetail({ id }: { id: number }) {
  const [from, setFrom] = useState(monthStartIso()); const [to, setTo] = useState(todayIso());
  const [sheet, setSheet] = useState<'pay' | 'edit' | 'archive' | null>(null);
  const { db } = useReadyDb();
  const party = useLoad(db => getParty(db, id), [id]);
  const stmt = useLoad(db => partyStatement(db, id, from, to), [id, from, to]);
  const open = useLoad(async db => {
    const inv = await listInvoices(db, { partyId: id });
    const states = await Promise.all(inv.slice(0, 100).map(async i => ({ i, s: await getInvoiceState(db, i.id) })));
    return states.filter(x => x.s && x.s.outstanding > 0).map(x => ({ id: x.i.id, ref: x.i.ref, outstanding: x.s!.outstanding }));
  }, [id]);
  const refresh = () => { party.reload(); stmt.reload(); open.reload(); };
  const p = party.data;
  if (party.error) return <ErrorBox message={party.error} />;
  if (!p) return <p className="muted">{ar.common.loading}</p>;
  const route = p.kind === 'customer' ? 'sales' : 'purchases';
  const typeLabel = (t: string, rev: boolean) => `${(ar.entry as Record<string, string>)[t] ?? t}${rev ? ` (${ar.entry.reversal})` : ''}`;
  return (
    <>
      <section className="card hero">
        <h2>{p.name}{p.archived ? <span className="chip">{ar.common.archived}</span> : null}</h2>
        {(p.phone || p.address) && <p className="muted small">{[p.phone, p.address].filter(Boolean).join(' · ')}</p>}
        <p className="muted small">{ar.party.balance}</p>
        <div className="big"><BalanceTag kind={p.kind} balance={p.balance} /></div>
        <div className="actions">
          <button className="btn" onClick={() => setSheet('pay')}>{p.kind === 'customer' ? ar.payment.receive : ar.payment.pay}</button>
          <button className="btn ghost" onClick={() => go(`${route}/new/${p.id}`)}>{p.kind === 'customer' ? ar.party.newSale : ar.party.newPurchase}</button>
          <button className="btn ghost" onClick={() => setSheet('edit')}>{ar.common.edit}</button>
          <button className="btn ghost" onClick={() => setSheet('archive')}>{p.archived ? ar.common.restore : ar.common.archive}</button>
        </div>
      </section>
      <section className="card">
        <h3>{ar.party.statement}</h3>
        <div className="row2"><Field label={ar.common.from}><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field><Field label={ar.common.to}><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field></div>
        <ErrorBox message={stmt.error} />
        {stmt.data && (
          <ul className="list tight">
            <li className="row static"><span>{ar.party.openingRow}</span><strong>{money(stmt.data.opening)}</strong></li>
            {stmt.data.entries.length === 0 && <li className="muted center-text">{ar.party.noEntries}</li>}
            {stmt.data.entries.map(e => {
              const inner = (<><span className="row-main"><span>{typeLabel(e.type, e.reverses_id !== null)}</span><span className="muted small">{dateLabel(e.date)}{e.ref ? ` · ${e.ref}` : ''}</span></span>
                <span className="row-end"><span className={e.delta >= 0 ? 'amt-in' : 'amt-out'}>{money(e.delta)}</span><span className="muted small">{money(e.balance)}</span></span></>);
              return <li key={e.id}>{e.source_table === 'invoices' && e.source_id ? <a className="row" href={`#${e.type === 'sale' ? 'sales' : 'purchases'}/${e.source_id}`}>{inner}</a> : <div className="row static">{inner}</div>}</li>;
            })}
            <li className="row static"><span>{ar.party.closingRow}</span><strong>{money(stmt.data.closing)}</strong></li>
          </ul>
        )}
      </section>
      {sheet === 'pay' && <PaymentSheet partyId={p.id} kind={p.kind} invoices={open.data} onClose={() => setSheet(null)} onDone={() => { setSheet(null); refresh(); }} />}
      {sheet === 'edit' && <PartyForm kind={p.kind} existing={p} onClose={() => setSheet(null)} onDone={() => { setSheet(null); refresh(); }} />}
      {sheet === 'archive' && <ConfirmDialog title={p.archived ? ar.common.restore : ar.common.archive} message={p.archived ? ar.common.restore : ar.party.archiveConfirm} danger={!p.archived}
        onCancel={() => setSheet(null)} onConfirm={async () => { await archiveParty(db, p.id, !p.archived); setSheet(null); refresh(); }} />}
    </>
  );
}
