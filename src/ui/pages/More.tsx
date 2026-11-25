import { useEffect, useState } from 'react';
import { ar } from '../../i18n/ar';
import { createBackup, getSetting, lastBackupAt, markBackupDone, restoreBackup, setSetting, validateBackup } from '../../services';
import { useReadyDb } from '../DbProvider';
import { ConfirmDialog, ErrorBox, Field, errText } from '../kit';
import { useLoad } from '../hooks';
import { dateLabel } from '../format';
import { useTheme } from '../theme';

export function MorePage() {
  return (
    <ul className="list">
      <li><a className="row" href="#more/products">{ar.more.products}</a></li>
      <li><a className="row" href="#more/settings">{ar.more.settings}</a></li>
      <li><a className="row" href="#more/backup">{ar.more.backup}</a></li>
      <li><a className="row" href="#more/reports">{ar.more.reports}</a></li>
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

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

export function BackupPage() {
  const { db } = useReadyDb();
  const last = useLoad(d => lastBackupAt(d), []);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [pending, setPending] = useState<{ text: string; when: string } | null>(null);
  const backupNow = async () => {
    setErr(''); setMsg('');
    try { const { text } = await createBackup(db); download(`tawze3-backup-${stamp()}.json`, text); await markBackupDone(db); setMsg(ar.backup.done); last.reload(); } catch (e) { setErr(errText(e)); }
  };
  const pick = async (f: File | undefined) => {
    setErr(''); setMsg('');
    if (!f) return;
    try { const text = await f.text(); const { summary } = await validateBackup(db, text); setPending({ text, when: dateLabel(summary.createdAt.slice(0, 10)) }); } catch (e) { setErr(errText(e)); }
  };
  return (
    <section className="card">
      <h2>{ar.backup.title}</h2>
      <p className="notice">{ar.backup.warn}</p>
      <p>{ar.backup.last}: <strong>{last.data ? dateLabel(last.data.slice(0, 10)) : ar.backup.never}</strong></p>
      <div className="actions"><button className="btn" onClick={() => void backupNow()}>{ar.backup.now}</button></div>
      <hr />
      <Field label={ar.backup.restore}><input type="file" accept=".json,application/json" aria-label={ar.backup.pick} onChange={e => void pick(e.target.files?.[0])} /></Field>
      <ErrorBox message={err} />{msg && <p className="amt-in">{msg}</p>}
      {pending && <ConfirmDialog title={ar.backup.restore} danger confirmLabel={ar.backup.confirmRestore} message={`${ar.backup.restoreAsk} (${ar.backup.contains}: ${pending.when})`}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          try { await restoreBackup(db, pending.text, async safety => { download(`tawze3-before-restore-${stamp()}.json`, safety); }); setPending(null); setMsg(ar.backup.restoreOk); last.reload(); }
          catch (e) { setPending(null); setErr(errText(e)); }
        }} />}
    </section>
  );
}
