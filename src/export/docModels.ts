import type { Db } from '../db/types';
import { balanceLabelAr } from '../domain/ledger';
import type { Change } from '../domain/metrics';
import { ar } from '../i18n/ar';
import { buildReport, getParty, getSetting, partyStatement, productReport } from '../services';
import { dateLabel, money, qty } from '../ui/format';
import type { Block, DocModel } from './renderDocument';

export function changeText(c: Change): string {
  if (c.kind === 'none') return ar.reports.noChange;
  if (c.kind === 'new') return ar.reports.newActivity;
  return `${c.value >= 0 ? '▲' : '▼'} ${Math.abs(c.value).toLocaleString('ar-EG')}٪`;
}
const biz = async (db: Db) => (await getSetting(db, 'business_name')) || ar.appName;
const range = (from: string, to: string) => (from === to ? dateLabel(from) : `${dateLabel(from)} — ${dateLabel(to)}`);

export async function buildReportDoc(db: Db, from: string, to: string): Promise<DocModel> {
  const { current: r, previous: p, changes: ch } = await buildReport(db, from, to);
  const prod = await productReport(db, from, to);
  const R = ar.reports;
  const withChange = (v: string, c: Change) => `${v}   (${changeText(c)})`;
  const blocks: Block[] = [
    { kind: 'kv', rows: [{ label: R.periodLabel, value: range(from, to) }, { label: R.prevPeriodLabel, value: range(p.from, p.to), tone: 'muted' }] },
    { kind: 'heading', text: R.summary },
    { kind: 'kv', rows: [
      { label: R.sales, value: withChange(money(r.sales.net), ch.sales) }, { label: R.purchases, value: withChange(money(r.purchases.net), ch.purchases) },
      { label: R.received, value: withChange(money(r.cash.received), ch.received) }, { label: R.paid, value: withChange(money(r.cash.paid), ch.paid) },
      { label: R.netCash, value: withChange(money(r.cash.net), ch.netCash), strong: true } ] },
    { kind: 'note', text: R.returnsNote },
    { kind: 'kv', rows: [
      { label: R.receivables, value: money(r.receivables.closing) }, { label: `${R.opening} / ${R.movement}`, value: `${money(r.receivables.opening)} / ${money(r.receivables.movement)}`, tone: 'muted' },
      { label: R.payables, value: money(r.payables.closing) }, { label: `${R.opening} / ${R.movement}`, value: `${money(r.payables.opening)} / ${money(r.payables.movement)}`, tone: 'muted' } ] },
    { kind: 'heading', text: R.customTitle },
    { kind: 'kv', rows: [{ label: R.actual, value: money(r.custom.actualProfit), strong: true, tone: r.custom.actualProfit < 0 ? 'bad' : 'good' }] },
    { kind: 'note', text: R.actualFormula },
    { kind: 'kv', rows: [{ label: R.ideal, value: money(r.custom.idealProfit), strong: true, tone: r.custom.idealProfit < 0 ? 'bad' : 'good' }] },
    { kind: 'note', text: R.idealFormula },
    { kind: 'note', text: R.customNote },
    { kind: 'heading', text: R.margin },
    r.margin.coverage === null ? { kind: 'note', text: R.marginNone } : { kind: 'kv', rows: [{ label: R.margin1, value: money(r.margin.margin), strong: true }] },
    ...(r.margin.coverage !== null && !r.margin.complete ? [{ kind: 'note', tone: 'bad', text: `${R.marginPartial} ${Math.round(r.margin.coverage * 100).toLocaleString('ar-EG')}٪ ${R.marginCoverageEnd}` } as Block] : []),
    { kind: 'note', text: R.marginNote },
    { kind: 'heading', text: R.best }, { kind: 'table', head: [ar.common.product, ar.common.qty, R.revenue], widths: [296, 180, 180], rows: prod.bestSelling.map(x => [x.name, `${qty(x.netSoldBase)} ${x.unit}`, money(x.revenue)]) },
    { kind: 'heading', text: R.highMargin }, { kind: 'table', head: [ar.common.product, R.margin1, '٪'], widths: [296, 180, 180], rows: prod.highestMargin.map(x => [x.name, money(x.margin ?? 0), x.marginPct === null ? '—' : `${x.marginPct.toLocaleString('ar-EG')}٪`]) },
    { kind: 'heading', text: R.negMargin }, { kind: 'table', head: [ar.common.product, R.margin1], widths: [396, 260], rows: prod.negativeMargin.map(x => [x.name, money(x.margin ?? 0)]) },
    { kind: 'heading', text: R.slow }, { kind: 'note', text: R.slowRule }, { kind: 'table', head: [ar.common.product, R.stock], widths: [396, 260], rows: prod.slowMoving.map(x => [x.name, `${qty(x.stock)} ${x.unit}`]) },
    { kind: 'heading', text: R.missing }, { kind: 'table', head: [ar.common.product, R.missingQty, R.damagedQty], widths: [296, 180, 180], rows: prod.missingDamaged.map(x => [x.name, `${qty(x.missingBase)} ${x.unit}`, `${qty(x.damagedBase)} ${x.unit}`]) },
  ];
  const title = `${R.docTitle}`;
  return { business: await biz(db), title, subtitle: range(from, to), blocks, filename: `report-${from}_${to}`, phone: null, shareText: `${title}: ${range(from, to)}` };
}

export async function buildStatementDoc(db: Db, partyId: number, from: string, to: string): Promise<DocModel> {
  const party = await getParty(db, partyId); if (!party) throw new Error('الحساب غير موجود');
  const st = await partyStatement(db, partyId, from, to);
  const balText = (b: number) => (b === 0 ? money(0) : `${money(Math.abs(b))} ${b > 0 ? ar.reports.debit : ar.reports.credit}`);
  const label = (t: string, rev: boolean) => `${(ar.entry as Record<string, string>)[t] ?? t}${rev ? ` (${ar.entry.reversal})` : ''}`;
  const blocks: Block[] = [
    { kind: 'kv', rows: [{ label: party.kind === 'customer' ? ar.invoice.customer : ar.invoice.supplier, value: party.name, strong: true }, { label: ar.reports.periodLabel, value: range(from, to) }, { label: ar.party.openingRow, value: balText(st.opening) }] },
    { kind: 'table', head: [ar.reports.date1, ar.reports.desc, ar.reports.debit, ar.reports.credit, ar.reports.balance1], widths: [112, 204, 112, 112, 116],
      rows: st.entries.map(e => [dateLabel(e.date), `${label(e.type, e.reverses_id !== null)}${e.ref ? ` ${e.ref}` : ''}`, e.delta > 0 ? money(e.delta) : '', e.delta < 0 ? money(-e.delta) : '', balText(e.balance)]), empty: ar.party.noEntries },
    { kind: 'heading', text: ar.party.closingRow },
    { kind: 'kv', rows: [{ label: ar.party.balance, value: balText(st.closing), strong: true, tone: st.closing === 0 ? 'normal' : st.closing > 0 ? 'bad' : 'good' }, { label: '', value: balanceLabelAr(party.kind, st.closing), tone: 'muted' }] },
    { kind: 'note', text: `${ar.reports.debit}: ${party.kind === 'customer' ? 'مبالغ مستحقة لنا' : 'مبالغ مستحقة لنا على المورد'} · ${ar.reports.credit}: مبالغ مستحقة للطرف علينا` },
  ];
  return { business: await biz(db), title: `${ar.reports.stmtTitle} — ${party.name}`, subtitle: range(from, to), blocks, filename: `statement-${party.name.replace(/\s+/g, '_')}-${from}_${to}`, phone: party.phone, shareText: `${ar.reports.stmtTitle} ${party.name}: ${range(from, to)}` };
}
