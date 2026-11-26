import { useMemo, useState } from 'react';
import { ar } from '../../i18n/ar';
import {
  ServiceError, cancelInvoice, createParty, getInvoiceDetail, getInvoiceState, getSetting, listAllProductUnits, listInvoices, listParties, listProducts,
  postInvoice, postReturn, replaceInvoice, type InvoiceIn, type InvoiceLineIn,
} from '../../services';
import { computeInvoice } from '../../domain/invoice';
import { lineTotal } from '../../domain/money';
import { useReadyDb } from '../DbProvider';
import { useLoad, go } from '../hooks';
import { ConfirmDialog, Empty, ErrorBox, Fab, Field, InlineAdd, Sheet, errText } from '../kit';
import { dateLabel, milliToInput, minorToInput, money, qty, toMilli, toMinor, todayIso } from '../format';
import { exportReceipt, type ExportFormat } from '../../export/receiptExport';
import { PaymentSheet } from './PaymentSheet';
import { ProductForm } from './Products';

type Kind = 'sale' | 'purchase';
const route = (k: Kind) => (k === 'sale' ? 'sales' : 'purchases');

export function InvoiceList({ kind }: { kind: Kind }) {
  const [q, setQ] = useState('');
  const { data, error } = useLoad(async db => {
    const rows = (await listInvoices(db, { kind, search: q, includeCancelled: true })).slice(0, 200);
    return Promise.all(rows.map(async r => ({ r, s: await getInvoiceState(db, r.id) })));
  }, [kind, q]);
  return (
    <>
      <h2 className="page-title">{kind === 'sale' ? ar.invoice.sales : ar.invoice.purchases}</h2>
      <input className="search" type="search" placeholder={ar.common.search} value={q} onChange={e => setQ(e.target.value)} aria-label={ar.common.search} />
      <ErrorBox message={error} />
      {data && data.length === 0 && <Empty title={kind === 'sale' ? ar.invoice.emptySales : ar.invoice.emptyPurchases} hint={ar.invoice.emptyHint} />}
      <ul className="list">
        {data?.map(({ r, s }) => (
          <li key={r.id}><a className={`row ${r.cancelled_at ? 'dim' : ''}`} href={`#${route(kind)}/${r.id}`}>
            <span className="row-main"><strong>{r.party_name}</strong><span className="muted small">{r.ref} · {dateLabel(r.date)}</span></span>
            <span className="row-end"><strong>{money(r.total)}</strong>
              {r.cancelled_at ? <span className="chip bad">{ar.invoice.cancelled}</span> : s && s.outstanding > 0 ? <span className="chip warn">{ar.invoice.outstanding} {money(s.outstanding)}</span> : <span className="chip ok">{ar.invoice.paid}</span>}</span>
          </a></li>))}
      </ul>
      <Fab label={kind === 'sale' ? ar.invoice.newSale : ar.invoice.newPurchase} onClick={() => go(`${route(kind)}/new`)} />
    </>
  );
}

interface LineState { key: number; productId: string; unitId: string; qty: string; price: string; discount: string }
let lineKey = 1;
const blankLine = (): LineState => ({ key: lineKey++, productId: '', unitId: '', qty: '1', price: '', discount: '' });

export function InvoiceForm({ kind, partyId, replaceId }: { kind: Kind; partyId?: number; replaceId?: number }) {
  const { db } = useReadyDb();
  const parties = useLoad(d => listParties(d, { kind: kind === 'sale' ? 'customer' : 'supplier' }), [kind]);
  const products = useLoad(d => listProducts(d), []);
  const unitsAll = useLoad(d => listAllProductUnits(d), []);
  const [party, setParty] = useState(partyId ? String(partyId) : ''); const [date, setDate] = useState(todayIso());
  const [lines, setLines] = useState<LineState[]>([blankLine()]); const [disc, setDisc] = useState(''); const [paid, setPaid] = useState('');
  const [ext, setExt] = useState(''); const [notes, setNotes] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState<number | null>(null); const [override, setOverride] = useState<string | null>(null); const [prefilled, setPrefilled] = useState(!replaceId);

  useLoad(async d => {
    if (!replaceId) return 0;
    const det = await getInvoiceDetail(d, replaceId);
    if (!det) return 0;
    const inv = det.invoice as Record<string, unknown>;
    setParty(String(inv.party_id)); setDate(String(inv.date)); setDisc(inv.discount ? minorToInput(Number(inv.discount)) : '');
    setExt(String(inv.external_ref ?? '')); setNotes(String(inv.notes ?? '')); setPaid(det.state.paid ? minorToInput(det.state.paid) : '');
    setLines(det.lines.map(l => ({ key: lineKey++, productId: String(l.product_id), unitId: String(l.unit_id), qty: milliToInput(Number(l.qty_milli)), price: minorToInput(Number(l.unit_price)), discount: Number(l.line_discount) ? minorToInput(Number(l.line_discount)) : '' })));
    setPrefilled(true); return 1;
  }, [replaceId]);

  const unitsOf = (pid: string) => unitsAll.data?.filter(u => String(u.product_id) === pid) ?? [];
  const defaultPrice = (pid: string, uid: string) => {
    const p = products.data?.find(x => String(x.id) === pid); const f = unitsOf(pid).find(u => String(u.unit_id) === uid)?.factor_to_base ?? 1;
    return p ? minorToInput(Math.round((kind === 'sale' ? p.sell_price : p.buy_price) * f)) : '';
  };
  const setLine = (key: number, patch: Partial<LineState>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const pickProduct = (key: number, pid: string) => { const p = products.data?.find(x => String(x.id) === pid); const uid = p ? String(p.base_unit_id) : ''; setLine(key, { productId: pid, unitId: uid, price: pid ? defaultPrice(pid, uid) : '' }); };

  const onProductCreated = async (key: number, id: number) => {
    const p = (await listProducts(db)).find(x => x.id === id);
    products.reload(); unitsAll.reload(); setQuick(null);
    if (p) setLine(key, { productId: String(id), unitId: String(p.base_unit_id), price: minorToInput(kind === 'sale' ? p.sell_price : p.buy_price) });
  };

  const parsed = useMemo(() => {
    const out: InvoiceLineIn[] = [];
    for (const l of lines) {
      if (!l.productId) continue;
      const q = toMilli(l.qty), p = toMinor(l.price || '0'), d = l.discount.trim() ? toMinor(l.discount) : 0;
      if (q === null || q <= 0 || p === null || p < 0 || d === null || d < 0 || !l.unitId) return { error: ar.common.qty + ' / ' + ar.common.price };
      out.push({ productId: Number(l.productId), unitId: Number(l.unitId), qtyMilli: q, unitPrice: p, lineDiscount: d });
    }
    const idisc = disc.trim() ? toMinor(disc) : 0; if (idisc === null || idisc < 0) return { error: ar.invoice.invoiceDiscount };
    if (out.length === 0) return { error: ar.invoice.noLines };
    try { return { lines: out, idisc, totals: computeInvoice(out.map(o => ({ qty: o.qtyMilli, unitPrice: o.unitPrice, lineDiscount: o.lineDiscount })), idisc) }; }
    catch (e) { return { error: errText(e) }; }
  }, [lines, disc]);

  const total = 'totals' in parsed && parsed.totals ? parsed.totals.total : null;
  const paidMinor = paid.trim() ? toMinor(paid) : 0;

  const submit = async (allowNegativeStock = false) => {
    if (!party) { setErr(ar.invoice.needParty); return; }
    if (!('lines' in parsed) || !parsed.lines) { setErr(parsed.error ?? ''); return; }
    if (paidMinor === null || paidMinor < 0) { setErr(ar.invoice.paidNow); return; }
    setBusy(true); setErr('');
    const input: InvoiceIn = { kind, partyId: Number(party), date, lines: parsed.lines, invoiceDiscount: parsed.idisc, paidNow: paidMinor, externalRef: ext || undefined, notes: notes || undefined, allowNegativeStock };
    try {
      const r = replaceId ? await replaceInvoice(db, replaceId, input) : await postInvoice(db, input);
      go(`${route(kind)}/${r.id}`);
    } catch (e) {
      if (e instanceof ServiceError && e.code === 'INSUFFICIENT_STOCK' && kind === 'sale') setOverride(e.message); else setErr(errText(e));
    } finally { setBusy(false); }
  };

  if (!prefilled) return <p className="muted">{ar.common.loading}</p>;
  const title = replaceId ? (kind === 'sale' ? ar.invoice.editSale : ar.invoice.editPurchase) : kind === 'sale' ? ar.invoice.newSale : ar.invoice.newPurchase;
  return (
    <>
      <h2 className="page-title">{title}</h2>
      {replaceId && <p className="notice">{ar.invoice.replacedNote}</p>}
      <section className="card">
        <Field label={kind === 'sale' ? ar.invoice.customer : ar.invoice.supplier}>
          <div className="with-add"><select value={party} onChange={e => setParty(e.target.value)}><option value="">{ar.invoice.pickParty}</option>{parties.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <InlineAdd placeholder={ar.invoice.newPartyName} onCreate={async n => { const id = await createParty(db, { kind: kind === 'sale' ? 'customer' : 'supplier', name: n }); parties.reload(); setParty(String(id)); }} /></div>
        </Field>
        <Field label={ar.common.date}><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      </section>
      {lines.map((l, i) => {
        const p = products.data?.find(x => String(x.id) === l.productId);
        const q = toMilli(l.qty), pr = toMinor(l.price || '0');
        return (
          <section className="card line" key={l.key} aria-label={`${ar.invoice.line} ${i + 1}`}>
            <Field label={ar.common.product}>
              <select value={l.productId} onChange={e => pickProduct(l.key, e.target.value)}><option value="">{ar.invoice.pickProduct}</option>{products.data?.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            </Field>
            <button type="button" className="link" onClick={() => setQuick(l.key)}>{ar.product.newInline}</button>
            {p && kind === 'sale' && <p className="muted small">{ar.invoice.available}: {qty(p.stock_milli)} {p.base_unit_name}</p>}
            <div className="row3">
              <Field label={ar.common.qty}><input inputMode="decimal" value={l.qty} onChange={e => setLine(l.key, { qty: e.target.value })} /></Field>
              <Field label={ar.common.unit}><select value={l.unitId} onChange={e => setLine(l.key, { unitId: e.target.value, price: defaultPrice(l.productId, e.target.value) })}>{unitsOf(l.productId).map(u => <option key={u.unit_id} value={u.unit_id}>{u.unit_name}</option>)}</select></Field>
              <Field label={ar.common.price}><input inputMode="decimal" value={l.price} onChange={e => setLine(l.key, { price: e.target.value })} /></Field>
            </div>
            <div className="row2"><Field label={ar.invoice.lineDiscount}><input inputMode="decimal" value={l.discount} onChange={e => setLine(l.key, { discount: e.target.value })} /></Field>
              <div className="line-total"><span className="muted small">{ar.common.total}</span><strong>{q && pr !== null ? money(lineTotal(q, pr) - (toMinor(l.discount || '0') ?? 0)) : '—'}</strong></div></div>
            {lines.length > 1 && <button className="link" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}>{ar.common.cancel}</button>}
          </section>
        );
      })}
      {products.data?.length === 0 && <p className="notice">{ar.invoice.noProducts}</p>}
      <button className="btn ghost block" onClick={() => setLines([...lines, blankLine()])}>＋ {ar.invoice.addLine}</button>
      <section className="card">
        <div className="row2"><Field label={ar.invoice.invoiceDiscount}><input inputMode="decimal" value={disc} onChange={e => setDisc(e.target.value)} /></Field><Field label={ar.invoice.paidNow}><input inputMode="decimal" value={paid} onChange={e => setPaid(e.target.value)} /></Field></div>
        <Field label={ar.invoice.extRef}><input value={ext} onChange={e => setExt(e.target.value)} /></Field>
        <Field label={ar.common.notes}><input value={notes} onChange={e => setNotes(e.target.value)} /></Field>
        <div className="totals">
          <div><span>{ar.common.total}</span><strong className="big">{total === null ? '—' : money(total)}</strong></div>
          {total !== null && paidMinor !== null && <div><span>{ar.invoice.remaining}</span><strong>{money(Math.max(0, total - paidMinor))}</strong></div>}
        </div>
        <ErrorBox message={err} />
        <button className="btn block" disabled={busy} onClick={() => void submit()}>{ar.common.save}</button>
      </section>
      {quick !== null && <ProductForm onClose={() => setQuick(null)} onDone={id => void onProductCreated(quick, id)} />}
      {override && <ConfirmDialog title={ar.invoice.overrideTitle} message={`${override}. ${ar.invoice.overrideAsk}`} confirmLabel={ar.invoice.overrideYes} danger onCancel={() => setOverride(null)} onConfirm={() => { setOverride(null); void submit(true); }} />}
    </>
  );
}

function ReturnSheet({ invoiceId, kind, onDone, onClose }: { invoiceId: number; kind: Kind; onDone: () => void; onClose: () => void }) {
  const { db } = useReadyDb();
  const lines = useLoad(async d => {
    const det = await getInvoiceDetail(d, invoiceId);
    const rem = await Promise.all((det?.lines ?? []).map(async l => {
      const r = await d.all<{ q: number }>('SELECT COALESCE(SUM(qty_milli),0) AS q FROM return_lines WHERE invoice_line_id = ?', [Number(l.id)]);
      return { id: Number(l.id), name: l.product_name, unit: l.unit_name, remaining: Number(l.qty_milli) - (r[0]?.q ?? 0) };
    }));
    return rem.filter(x => x.remaining > 0);
  }, [invoiceId]);
  const [vals, setVals] = useState<Record<number, string>>({}); const [unusable, setUnusable] = useState<Record<number, boolean>>({});
  const [date, setDate] = useState(todayIso()); const [err, setErr] = useState('');
  const save = async () => {
    const picked = (lines.data ?? []).map(l => ({ l, q: vals[l.id]?.trim() ? toMilli(vals[l.id]!) : 0 })).filter(x => x.q !== 0);
    if (picked.some(x => x.q === null || (x.q ?? 0) < 0)) { setErr(ar.common.qty); return; }
    try { await postReturn(db, { invoiceId, date, lines: picked.map(x => ({ invoiceLineId: x.l.id, qtyMilli: x.q as number, usable: !unusable[x.l.id] })) }); onDone(); } catch (e) { setErr(errText(e)); }
  };
  return (
    <Sheet title={kind === 'sale' ? ar.ret.customerTitle : ar.ret.supplierTitle} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>{ar.common.cancel}</button><button className="btn" onClick={() => void save()}>{ar.common.save}</button></>}>
      {lines.data?.length === 0 && <p className="muted">{ar.ret.none}</p>}
      {lines.data?.map(l => (
        <div className="card line" key={l.id}><strong>{l.name}</strong><span className="muted small">{ar.ret.remaining}: {qty(l.remaining)} {l.unit}</span>
          <Field label={ar.common.qty}><input inputMode="decimal" value={vals[l.id] ?? ''} onChange={e => setVals({ ...vals, [l.id]: e.target.value })} /></Field>
          {kind === 'sale' && <label className="check"><input type="checkbox" checked={!unusable[l.id]} onChange={e => setUnusable({ ...unusable, [l.id]: !e.target.checked })} /> {ar.ret.usable}</label>}
        </div>))}
      <Field label={ar.common.date}><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <ErrorBox message={err} />
    </Sheet>
  );
}

export function InvoiceDetail({ id, kind }: { id: number; kind: Kind }) {
  const { db } = useReadyDb();
  const [sheet, setSheet] = useState<'pay' | 'ret' | 'cancel' | null>(null); const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const { data, error, reload } = useLoad(async d => ({ det: await getInvoiceDetail(d, id), biz: (await getSetting(d, 'business_name')) ?? ar.appName }), [id]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <p className="muted">{ar.common.loading}</p>;
  if (!data.det) return <ErrorBox message="—" />;
  const { det, biz } = data; const inv = det.invoice as Record<string, unknown>; const st = det.state;
  const activePays = det.payments.filter(p => !p.cancelled_at);
  const done = () => { setSheet(null); reload(); };
  const doExport = async (f: ExportFormat) => {
    setBusy(true); setErr(''); setNote(ar.share.preparing);
    try {
      const r = await exportReceipt(db, id, f);
      setNote(r.kind === 'whatsapp-opened' ? ar.share.waOpened : r.kind === 'downloaded' ? ar.share.downloaded : r.kind === 'shared' ? ar.share.shared : '');
    } catch (e) { setNote(''); setErr(ar.share.failed + ': ' + errText(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <section className="card receipt" aria-label={ar.invoice.receipt}>
        <div className="receipt-head"><h2>{biz}</h2><span className="muted">{kind === 'sale' ? ar.invoice.saleType : ar.invoice.purchaseType} · {String(inv.ref)}</span>
          {st.cancelled && <span className="chip bad">{ar.invoice.cancelled}</span>}{Number(inv.negative_stock_override) === 1 && <span className="chip warn">{ar.invoice.negativeStock}</span>}</div>
        <div className="kv"><span>{kind === 'sale' ? ar.invoice.customer : ar.invoice.supplier}</span><strong>{det.invoice.party_name}</strong></div>
        <div className="kv"><span>{ar.common.date}</span><strong>{dateLabel(String(inv.date))}</strong></div>
        {inv.external_ref ? <div className="kv"><span>{ar.invoice.extRef}</span><strong>{String(inv.external_ref)}</strong></div> : null}
        <div className="table-wrap"><table className="lines"><thead><tr><th>{ar.common.product}</th><th>{ar.common.qty}</th><th>{ar.common.price}</th><th>{ar.common.total}</th></tr></thead>
          <tbody>{det.lines.map(l => <tr key={String(l.id)}><td>{l.product_name}</td><td>{qty(Number(l.qty_milli))} {l.unit_name}</td><td>{money(Number(l.unit_price))}</td><td>{money(Number(l.line_total))}</td></tr>)}</tbody></table></div>
        <div className="kv"><span>{ar.invoice.subtotal}</span><strong>{money(Number(inv.subtotal))}</strong></div>
        {Number(inv.discount) > 0 && <div className="kv"><span>{ar.invoice.invoiceDiscount}</span><strong>−{money(Number(inv.discount))}</strong></div>}
        <div className="kv big"><span>{ar.common.total}</span><strong>{money(Number(inv.total))}</strong></div>
        {st.returned > 0 && <div className="kv"><span>{ar.invoice.returned}</span><strong>−{money(st.returned)}</strong></div>}
        <div className="kv"><span>{ar.invoice.paid}</span><strong>{money(st.paid)}</strong></div>
        <div className="kv"><span>{ar.invoice.remaining}</span><strong className={st.outstanding > 0 ? 'amt-out' : ''}>{money(st.outstanding)}</strong></div>
        {st.credit > 0 && <div className="kv"><span>{ar.invoice.credit}</span><strong>{money(st.credit)}</strong></div>}
        {inv.notes ? <p className="muted">{String(inv.notes)}</p> : null}
      </section>
      {activePays.length > 0 && <section className="card"><h3>{ar.invoice.payments}</h3><ul className="list tight">{activePays.map(p => <li key={p.id} className="row static"><span>{p.ref} · {dateLabel(p.date)}</span><strong>{money(p.allocated)}</strong></li>)}</ul></section>}
      <div className="actions" role="group" aria-label={ar.share.title}>
        <button className="btn ghost" disabled={busy} onClick={() => void doExport('pdf')}>{ar.share.pdf}</button>
        <button className="btn ghost" disabled={busy} onClick={() => void doExport('png')}>{ar.share.png}</button>
        <button className="btn wa" disabled={busy} onClick={() => void doExport('whatsapp')}>{ar.share.whatsapp}</button>
      </div>
      {note && <p className="muted" role="status">{note}</p>}
      <ErrorBox message={err} />
      {!st.cancelled && (
        <div className="actions">
          {st.outstanding > 0 && <button className="btn" onClick={() => setSheet('pay')}>{ar.invoice.addPayment}</button>}
          <button className="btn ghost" onClick={() => setSheet('ret')}>{ar.invoice.doReturn}</button>
          {st.returned === 0 && <button className="btn ghost" onClick={() => go(`${route(kind)}/edit/${id}`)}>{ar.common.edit}</button>}
          {st.returned === 0 && <button className="btn danger ghost" onClick={() => setSheet('cancel')}>{ar.invoice.cancel}</button>}
        </div>)}
      {sheet === 'pay' && <PaymentSheet partyId={st.partyId} kind={kind === 'sale' ? 'customer' : 'supplier'} invoiceId={id} suggested={st.outstanding} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === 'ret' && <ReturnSheet invoiceId={id} kind={kind} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === 'cancel' && <ConfirmDialog title={ar.invoice.cancel} danger message={`${ar.invoice.cancelConfirm}${activePays.length ? ' ' + ar.invoice.cancelWithPayments : ''}`}
        onCancel={() => setSheet(null)} onConfirm={async () => { try { await cancelInvoice(db, id, { cancelPayments: true }); done(); } catch (e) { setSheet(null); setErr(errText(e)); } }} />}
    </>
  );
}
