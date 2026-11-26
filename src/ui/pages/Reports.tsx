import { useState } from 'react';
import { exportReportPdf } from '../../export/documentExport';
import { useReadyDb } from '../DbProvider';
import { errText } from '../kit';
import { ar } from '../../i18n/ar';
import { buildReport, productReport, type ProductReportRow } from '../../services';
import type { Change } from '../../domain/metrics';
import { addDays } from '../../domain/dates';
import { useLoad } from '../hooks';
import { Empty, ErrorBox, Field } from '../kit';
import { money, monthStartIso, qty, todayIso } from '../format';

function ChangeBadge({ c }: { c: Change }) {
  if (c.kind === 'none') return <span className="muted small">{ar.reports.noChange}</span>;
  if (c.kind === 'new') return <span className="chip">{ar.reports.newActivity}</span>;
  const up = c.value >= 0;
  return <span className={`small ${up ? 'amt-in' : 'amt-out'}`} dir="ltr">{up ? '▲' : '▼'} {Math.abs(c.value).toLocaleString('ar-EG')}٪</span>;
}
function Metric({ label, value, change, hint }: { label: string; value: string; change?: Change; hint?: string }) {
  return <div className="stat"><span className="muted small">{label}</span><strong>{value}</strong>{change && <ChangeBadge c={change} />}{hint && <span className="muted small">{hint}</span>}</div>;
}
function ProductList({ title, rows, right, note }: { title: string; rows: ProductReportRow[]; right: (r: ProductReportRow) => string; note?: string }) {
  return (
    <section className="card"><h3>{title}</h3>{note && <p className="muted small">{note}</p>}
      {rows.length === 0 ? <p className="muted">{ar.reports.none}</p> : <ul className="list tight">{rows.map(r => <li key={r.productId} className="row static"><span>{r.name}</span><strong className="small">{right(r)}</strong></li>)}</ul>}
    </section>
  );
}

export function ReportsPage() {
  const [from, setFrom] = useState(monthStartIso()); const [to, setTo] = useState(todayIso());
  const rep = useLoad(db => buildReport(db, from, to), [from, to]);
  const prod = useLoad(db => productReport(db, from, to), [from, to]);
  const { db } = useReadyDb(); const [busy, setBusy] = useState(false); const [note, setNote] = useState(''); const [xerr, setXerr] = useState('');
  const doExport = async (mode: 'save' | 'whatsapp') => { setBusy(true); setXerr(''); setNote(ar.share.preparing); try { const r = await exportReportPdf(db, from, to, mode); setNote(r.kind === 'whatsapp-opened' ? ar.share.waOpened : r.kind === 'downloaded' ? ar.share.downloaded : r.kind === 'shared' ? ar.share.shared : ''); } catch (e) { setNote(''); setXerr(ar.share.failed + ': ' + errText(e)); } finally { setBusy(false); } };
  const t = todayIso();
  const presets: { label: string; f: string; to: string }[] = [
    { label: ar.reports.today, f: t, to: t }, { label: ar.reports.yesterday, f: addDays(t, -1), to: addDays(t, -1) },
    { label: ar.reports.last7, f: addDays(t, -6), to: t }, { label: ar.reports.month, f: monthStartIso(), to: t },
  ];
  const r = rep.data?.current; const ch = rep.data?.changes;
  return (
    <>
      <h2 className="page-title">{ar.reports.title}</h2>
      <div className="actions">{presets.map(p => <button key={p.label} className={`btn small ${from === p.f && to === p.to ? '' : 'ghost'}`} onClick={() => { setFrom(p.f); setTo(p.to); }}>{p.label}</button>)}</div>
      <div className="dates"><Field label={ar.common.from}><input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} /></Field><Field label={ar.common.to}><input type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} /></Field></div>
      <div className="actions"><button className="btn ghost" disabled={busy} onClick={() => void doExport('save')}>{ar.reports.exportPdf}</button><button className="btn wa" disabled={busy} onClick={() => void doExport('whatsapp')}>{ar.share.whatsapp}</button></div>
      {note && <p className="muted" role="status">{note}</p>}<ErrorBox message={xerr} />
      <ErrorBox message={rep.error ?? prod.error} />
      {r && ch && (
        <>
          <p className="muted small">{ar.reports.vsPrev}</p>
          <div className="stats">
            <Metric label={ar.reports.sales} value={money(r.sales.net)} change={ch.sales} hint={ar.reports.returnsNote} />
            <Metric label={ar.reports.purchases} value={money(r.purchases.net)} change={ch.purchases} hint={ar.reports.returnsNote} />
            <Metric label={ar.reports.received} value={money(r.cash.received)} change={ch.received} />
            <Metric label={ar.reports.paid} value={money(r.cash.paid)} change={ch.paid} />
            <div className="stat wide"><span className="muted small">{ar.reports.netCash}</span><strong>{money(r.cash.net)}</strong><ChangeBadge c={ch.netCash} /></div>
          </div>
          <section className="card">
            <div className="kv"><span>{ar.reports.receivables}</span><strong>{money(r.receivables.closing)}</strong></div>
            <p className="muted small">{ar.reports.opening}: {money(r.receivables.opening)} · {ar.reports.movement}: {money(r.receivables.movement)}</p>
            <div className="kv"><span>{ar.reports.payables}</span><strong>{money(r.payables.closing)}</strong></div>
            <p className="muted small">{ar.reports.opening}: {money(r.payables.opening)} · {ar.reports.movement}: {money(r.payables.movement)}</p>
          </section>
          <section className="card" aria-label={ar.reports.customTitle}>
            <h3>{ar.reports.customTitle}</h3>
            <div className="kv"><span>{ar.reports.actual}</span><strong className={r.custom.actualProfit < 0 ? 'amt-out' : 'amt-in'}>{money(r.custom.actualProfit)}</strong></div>
            <p className="muted small">{ar.reports.actualFormula}</p><ChangeBadge c={ch.actualProfit} />
            <div className="kv"><span>{ar.reports.ideal}</span><strong className={r.custom.idealProfit < 0 ? 'amt-out' : 'amt-in'}>{money(r.custom.idealProfit)}</strong></div>
            <p className="muted small">{ar.reports.idealFormula}</p><ChangeBadge c={ch.idealProfit} />
            <p className="notice">{ar.reports.customNote}</p>
          </section>
          <section className="card" aria-label={ar.reports.margin}>
            <h3>{ar.reports.margin}</h3>
            {r.margin.coverage === null ? <p className="muted">{ar.reports.marginNone}</p> : (<>
              <div className="kv"><span>{ar.reports.margin1}</span><strong>{money(r.margin.margin)}</strong></div>
              {!r.margin.complete && <p className="notice">{ar.reports.marginPartial} {Math.round(r.margin.coverage * 100).toLocaleString('ar-EG')}٪ {ar.reports.marginCoverageEnd}</p>}
            </>)}
            <p className="muted small">{ar.reports.marginNote}</p>
          </section>
        </>
      )}
      {prod.data && (
        <>
          <h2 className="page-title">{ar.reports.products}</h2>
          {prod.data.rows.length === 0 && <Empty title={ar.product.empty} />}
          <ProductList title={ar.reports.best} rows={prod.data.bestSelling} right={x => `${qty(x.netSoldBase)} ${x.unit} · ${money(x.revenue)}`} />
          <ProductList title={ar.reports.highMargin} rows={prod.data.highestMargin} right={x => `${money(x.margin ?? 0)}${x.marginPct !== null ? ` (${x.marginPct.toLocaleString('ar-EG')}٪)` : ''}`} />
          <ProductList title={ar.reports.negMargin} rows={prod.data.negativeMargin} right={x => money(x.margin ?? 0)} />
          <ProductList title={ar.reports.slow} note={ar.reports.slowRule} rows={prod.data.slowMoving} right={x => `${ar.reports.stock}: ${qty(x.stock)} ${x.unit}`} />
          <ProductList title={ar.reports.missing} rows={prod.data.missingDamaged} right={x => `${ar.reports.missingQty} ${qty(x.missingBase)} · ${ar.reports.damagedQty} ${qty(x.damagedBase)} ${x.unit}`} />
        </>
      )}
    </>
  );
}
