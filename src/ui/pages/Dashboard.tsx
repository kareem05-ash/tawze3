import { ar } from '../../i18n/ar';
import { cashTotals, listParties, listProducts } from '../../services';
import { payablesFrom, receivablesFrom } from '../../domain/metrics';
import { useLoad } from '../hooks';
import { Empty, ErrorBox } from '../kit';
import { dateLabel, money, qty, todayIso } from '../format';

export function Dashboard() {
  const today = todayIso();
  const { data, error } = useLoad(async db => {
    const [cash, customers, suppliers, products] = await Promise.all([cashTotals(db, today, today), listParties(db, { kind: 'customer', includeArchived: true }), listParties(db, { kind: 'supplier', includeArchived: true }), listProducts(db)]);
    return { cash, receivables: receivablesFrom(customers.map(c => c.balance)), payables: payablesFrom(suppliers.map(s => s.balance)), low: products.filter(p => p.low && p.stock_milli >= 0), neg: products.filter(p => p.stock_milli < 0) };
  }, [today]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <p className="muted">{ar.common.loading}</p>;
  return (
    <>
      <p className="muted">{ar.dash.today}: {dateLabel(today)}</p>
      <div className="stats">
        <div className="stat"><span className="muted small">{ar.dash.received}</span><strong className="amt-in">{money(data.cash.received)}</strong></div>
        <div className="stat"><span className="muted small">{ar.dash.paid}</span><strong className="amt-out">{money(data.cash.paid)}</strong></div>
        <div className="stat wide"><span className="muted small">{ar.dash.net}</span><strong>{money(data.cash.net)}</strong></div>
        <div className="stat"><span className="muted small">{ar.dash.receivables}</span><strong>{money(data.receivables)}</strong></div>
        <div className="stat"><span className="muted small">{ar.dash.payables}</span><strong>{money(data.payables)}</strong></div>
      </div>
      <section className="card"><h3>{ar.dash.quick}</h3>
        <div className="actions"><a className="btn" href="#purchases/new">{ar.invoice.newPurchase}</a><a className="btn" href="#sales/new">{ar.invoice.newSale}</a><a className="btn ghost" href="#parties">{ar.nav.parties}</a></div></section>
      <section className="card"><h3>{ar.dash.alerts}</h3>
        {data.low.length + data.neg.length === 0 && <Empty title={ar.dash.noAlerts} />}
        {data.neg.length > 0 && <><p className="small amt-out">{ar.dash.negStock}</p><ul className="list tight">{data.neg.map(p => <li key={p.id} className="row static"><span>{p.name}</span><strong>{qty(p.stock_milli)} {p.base_unit_name}</strong></li>)}</ul></>}
        {data.low.length > 0 && <><p className="small">{ar.dash.lowStock}</p><ul className="list tight">{data.low.map(p => <li key={p.id} className="row static"><span>{p.name}</span><strong>{qty(p.stock_milli)} {p.base_unit_name}</strong></li>)}</ul></>}
      </section>
      <p className="muted small">{ar.dash.note}</p>
    </>
  );
}
