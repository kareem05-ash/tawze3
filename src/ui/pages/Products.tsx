import { useState } from 'react';
import { ar } from '../../i18n/ar';
import { archiveProduct, createCategory, createProduct, createUnit, getProductUnits, listCategories, listProducts, listUnits, recordStockAdjustment, updateProduct, type AdjustReason, type ProductRow } from '../../services';
import { useReadyDb } from '../DbProvider';
import { useLoad } from '../hooks';
import { ConfirmDialog, Empty, ErrorBox, Fab, Field, InlineAdd, Sheet, errText } from '../kit';
import { milliToInput, minorToInput, money, qty, toMilli, toMinor, todayIso } from '../format';

export function ProductForm({ existing, onDone, onClose }: { existing?: ProductRow; onDone: (id: number) => void; onClose: () => void }) {
  const { db } = useReadyDb();
  const cats = useLoad(listCategories); const units = useLoad(listUnits);
  const [name, setName] = useState(existing?.name ?? ''); const [desc, setDesc] = useState(existing?.description ?? ''); const [notes, setNotes] = useState(existing?.notes ?? '');
  const [cat, setCat] = useState(existing?.category_id ? String(existing.category_id) : ''); const [base, setBase] = useState(existing ? String(existing.base_unit_id) : '');
  const [buy, setBuy] = useState(existing ? minorToInput(existing.buy_price) : ''); const [sell, setSell] = useState(existing ? minorToInput(existing.sell_price) : '');
  const [low, setLow] = useState(existing ? milliToInput(existing.low_stock_milli) : '');
  const [extra, setExtra] = useState<{ unitId: string; factor: string }[]>([]);
  const [err, setErr] = useState(''); const [loaded, setLoaded] = useState(!existing);
  useLoad(async d => { if (existing) { const u = await getProductUnits(d, existing.id); setExtra(u.filter(x => x.unit_id !== existing.base_unit_id).map(x => ({ unitId: String(x.unit_id), factor: String(x.factor_to_base) }))); setLoaded(true); } return 0; }, [existing?.id]);
  const baseLocked = !!existing && existing.stock_milli !== 0; // base unit can't change once movements exist (service enforces this too)
  const save = async () => {
    try {
      const buyP = buy.trim() ? toMinor(buy) : 0, sellP = sell.trim() ? toMinor(sell) : 0, lowM = low.trim() ? toMilli(low) : 0;
      if (buyP === null || sellP === null || lowM === null) { setErr(ar.common.amount); return; }
      if (!base) { setErr(`${ar.common.required}: ${ar.product.baseUnit}`); return; }
      const extraUnits = extra.filter(x => x.unitId).map(x => ({ unitId: Number(x.unitId), factorToBase: Number(x.factor.replace(',', '.')) }));
      const common = { name, description: desc, notes, categoryId: cat ? Number(cat) : null, buyPrice: buyP, sellPrice: sellP, lowStockMilli: lowM, extraUnits };
      let id: number;
      if (existing) { await updateProduct(db, existing.id, { ...common, baseUnitId: Number(base) }); id = existing.id; } else id = await createProduct(db, { ...common, baseUnitId: Number(base) });
      onDone(id);
    } catch (e) { setErr(errText(e)); }
  };
  return (
    <Sheet title={existing ? ar.product.edit : ar.product.add} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>{ar.common.cancel}</button><button className="btn" disabled={!loaded} onClick={() => void save()}>{ar.common.save}</button></>}>
      <Field label={ar.product.name}><input autoFocus value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label={ar.product.category}>
        <div className="with-add"><select value={cat} onChange={e => setCat(e.target.value)}><option value="">{ar.common.none}</option>{cats.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <InlineAdd placeholder={ar.product.newCategory} onCreate={async n => { const id = await createCategory(db, n); cats.reload(); setCat(String(id)); }} /></div>
      </Field>
      <Field label={ar.product.baseUnit} hint={baseLocked ? ar.product.stock : undefined}>
        <div className="with-add"><select value={base} disabled={baseLocked} onChange={e => setBase(e.target.value)}><option value="">{ar.common.none}</option>{units.data?.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <InlineAdd placeholder={ar.product.newUnit} onCreate={async n => { const id = await createUnit(db, n); units.reload(); if (!baseLocked && !base) setBase(String(id)); }} /></div>
      </Field>
      <fieldset className="group"><legend>{ar.product.extraUnits}</legend>
        {extra.map((x, i) => (
          <div className="row2" key={i}>
            <select aria-label={ar.common.unit} value={x.unitId} onChange={e => setExtra(extra.map((y, j) => j === i ? { ...y, unitId: e.target.value } : y))}><option value="">{ar.common.none}</option>{units.data?.filter(u => String(u.id) !== base).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            <input aria-label={ar.product.factor} inputMode="decimal" placeholder={ar.product.factor} value={x.factor} onChange={e => setExtra(extra.map((y, j) => j === i ? { ...y, factor: e.target.value } : y))} />
            <button className="btn ghost small" onClick={() => setExtra(extra.filter((_, j) => j !== i))} aria-label={ar.common.cancel}>✕</button>
          </div>))}
        <button type="button" className="link" onClick={() => setExtra([...extra, { unitId: '', factor: '' }])}>{ar.product.addUnit}</button>
      </fieldset>
      <div className="row2"><Field label={ar.product.buyPrice}><input inputMode="decimal" value={buy} onChange={e => setBuy(e.target.value)} /></Field><Field label={ar.product.sellPrice}><input inputMode="decimal" value={sell} onChange={e => setSell(e.target.value)} /></Field></div>
      <Field label={ar.product.low}><input inputMode="decimal" value={low} onChange={e => setLow(e.target.value)} /></Field>
      <Field label={ar.product.description}><input value={desc} onChange={e => setDesc(e.target.value)} /></Field>
      <Field label={ar.common.notes}><input value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      <ErrorBox message={err} />
    </Sheet>
  );
}

function AdjustSheet({ product, onDone, onClose }: { product: ProductRow; onDone: () => void; onClose: () => void }) {
  const { db } = useReadyDb();
  const units = useLoad(d => getProductUnits(d, product.id), [product.id]);
  const [reason, setReason] = useState<AdjustReason>('missing'); const [q, setQ] = useState(''); const [unit, setUnit] = useState(String(product.base_unit_id));
  const [date, setDate] = useState(todayIso()); const [notes, setNotes] = useState(''); const [err, setErr] = useState('');
  const save = async () => {
    const m = toMilli(q); if (m === null || m === 0) { setErr(ar.common.qty); return; }
    try { await recordStockAdjustment(db, { productId: product.id, qtyMilli: m, unitId: Number(unit), date, reason, notes: notes || undefined }); onDone(); } catch (e) { setErr(errText(e)); }
  };
  return (
    <Sheet title={`${ar.product.adjustTitle}: ${product.name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>{ar.common.cancel}</button><button className="btn" onClick={() => void save()}>{ar.common.save}</button></>}>
      <p className="muted">{ar.product.stock}: {qty(product.stock_milli)} {product.base_unit_name}</p>
      <Field label={ar.product.reason}><select value={reason} onChange={e => setReason(e.target.value as AdjustReason)}>{(Object.keys(ar.product.reasons) as AdjustReason[]).map(r => <option key={r} value={r}>{ar.product.reasons[r]}</option>)}</select></Field>
      <div className="row2"><Field label={ar.common.qty}><input inputMode="decimal" value={q} onChange={e => setQ(e.target.value)} /></Field>
        <Field label={ar.common.unit}><select value={unit} onChange={e => setUnit(e.target.value)}>{units.data?.map(u => <option key={u.unit_id} value={u.unit_id}>{u.unit_name}</option>)}</select></Field></div>
      <Field label={ar.common.date}><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label={ar.common.notes}><input value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      <ErrorBox message={err} />
    </Sheet>
  );
}

export function ProductsPage({ autoNew = false }: { autoNew?: boolean }) {
  const { db } = useReadyDb();
  const [q, setQ] = useState(''); const [arch, setArch] = useState(false); const [sheet, setSheet] = useState<{ kind: 'form' | 'adjust' | 'archive'; p?: ProductRow } | null>(autoNew ? { kind: 'form' } : null);
  const { data, error, reload } = useLoad(d => listProducts(d, { search: q, includeArchived: arch }), [q, arch]);
  const done = () => { setSheet(null); reload(); };
  return (
    <>
      <h2 className="page-title">{ar.product.title}</h2>
      <input className="search" type="search" placeholder={ar.common.search} value={q} onChange={e => setQ(e.target.value)} aria-label={ar.common.search} />
      <label className="check"><input type="checkbox" checked={arch} onChange={e => setArch(e.target.checked)} /> {ar.common.showArchived}</label>
      <ErrorBox message={error} />
      {data && data.length === 0 && <Empty title={ar.product.empty} hint={ar.product.emptyHint} />}
      <ul className="list">
        {data?.map(p => (
          <li key={p.id}>
            <div className="row static">
              <button className="row-main linkish" onClick={() => setSheet({ kind: 'form', p })}>
                <strong>{p.name}{p.archived ? <span className="chip">{ar.common.archived}</span> : null}</strong>
                <span className="muted small">{[p.category_name, `${ar.product.sellPrice} ${money(p.sell_price)}`].filter(Boolean).join(' · ')}</span>
              </button>
              <span className="row-end"><strong className={p.stock_milli < 0 ? 'amt-out' : ''}>{qty(p.stock_milli)} {p.base_unit_name}</strong>
                {p.stock_milli < 0 ? <span className="chip bad">{ar.product.negBadge}</span> : p.low ? <span className="chip warn">{ar.product.lowBadge}</span> : null}
                <button className="link small" onClick={() => setSheet({ kind: 'adjust', p })}>{ar.product.adjust}</button></span>
            </div>
          </li>))}
      </ul>
      <Fab label={ar.product.add} onClick={() => setSheet({ kind: 'form' })} />
      {sheet?.kind === 'form' && <><ProductForm existing={sheet.p} onClose={() => setSheet(null)} onDone={done} />{sheet.p && <ArchiveBar p={sheet.p} onClick={() => setSheet({ kind: 'archive', p: sheet.p })} />}</>}
      {sheet?.kind === 'adjust' && sheet.p && <AdjustSheet product={sheet.p} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === 'archive' && sheet.p && <ConfirmDialog title={sheet.p.archived ? ar.common.restore : ar.common.archive} message={sheet.p.archived ? ar.common.restore : ar.product.archiveConfirm} danger={!sheet.p.archived}
        onCancel={() => setSheet(null)} onConfirm={async () => { await archiveProduct(db, sheet.p!.id, !sheet.p!.archived); done(); }} />}
    </>
  );
}
function ArchiveBar({ p, onClick }: { p: ProductRow; onClick: () => void }) { return <button className="archive-float btn ghost small" onClick={onClick}>{p.archived ? ar.common.restore : ar.common.archive}</button>; }
