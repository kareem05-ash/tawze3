import { useEffect, useState } from 'react';
import { ar } from '../../i18n/ar';
import { getSetting, setSetting } from '../../services';
import { useReadyDb } from '../DbProvider';
import { Field } from '../kit';
import { useTheme } from '../theme';

export function MorePage() {
  return (
    <ul className="list">
      <li><a className="row" href="#more/products">{ar.more.products}</a></li>
      <li><a className="row" href="#more/settings">{ar.more.settings}</a></li>
      <li><div className="row static dim"><span>{ar.more.reports}</span><span className="chip">{ar.more.soon}</span></div></li>
      <li><div className="row static dim"><span>{ar.more.backup}</span><span className="chip">{ar.more.soon}</span></div></li>
    </ul>
  );
}
export function SettingsPage() {
  const { db } = useReadyDb(); const { theme, toggle } = useTheme();
  const [biz, setBiz] = useState(''); const [saved, setSaved] = useState(false);
  useEffect(() => { void getSetting(db, 'business_name').then(v => setBiz(v ?? '')); }, [db]);
  return (
    <section className="card">
      <h2>{ar.settings.title}</h2>
      <Field label={ar.settings.business}><input value={biz} onChange={e => { setBiz(e.target.value); setSaved(false); }} /></Field>
      <button className="btn" onClick={async () => { await setSetting(db, 'business_name', biz.trim()); setSaved(true); }}>{ar.common.save}</button>{saved && <span className="muted"> {ar.settings.saved}</span>}
      <hr /><p>{ar.settings.theme}</p><button className="btn ghost" onClick={toggle}>{theme === 'dark' ? ar.theme.light : ar.theme.dark}</button>
    </section>
  );
}
