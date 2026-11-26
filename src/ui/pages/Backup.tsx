import { useState } from 'react';
import { ar } from '../../i18n/ar';
import { getBackupStore } from '../../db/backupStores';
import { downloadBlob } from '../../export/deliver';
import {
  autoBackupEnabled, createBackupFile, getSetting, lastBackupAt, markBackupDone, openBackupText, restoreBackup, setAutoBackupEnabled, validateBackup,
} from '../../services';
import { useReadyDb } from '../DbProvider';
import { useLoad } from '../hooks';
import { ConfirmDialog, ErrorBox, Field, errText } from '../kit';
import { dateLabel } from '../format';

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const save = (name: string, text: string) => downloadBlob(new Blob([text], { type: 'application/json' }), name);

export function BackupPage() {
  const { db } = useReadyDb(); const store = getBackupStore();
  const info = useLoad(async d => ({ last: await lastBackupAt(d), auto: await getSetting(d, 'last_auto_backup_at'), err: await getSetting(d, 'auto_backup_error'), on: await autoBackupEnabled(d), files: (await store.list()).filter(f => f.name.startsWith('auto-')).sort((a, b) => b.name.localeCompare(a.name)) }), []);
  const [pass, setPass] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [needPass, setNeedPass] = useState<string | null>(null); const [restorePass, setRestorePass] = useState('');
  const [pending, setPending] = useState<{ text: string; when: string } | null>(null);

  const backupNow = async () => {
    setErr(''); setMsg('');
    try { const { text, encrypted } = await createBackupFile(db, { passphrase: pass || undefined }); save(`tawze3-backup-${stamp()}${encrypted ? '.enc' : ''}.json`, text); await markBackupDone(db); setMsg(ar.backup.done); info.reload(); }
    catch (e) { setErr(errText(e)); }
  };
  const prepare = async (raw: string, passphrase?: string) => {
    setErr(''); setMsg('');
    try {
      const text = await openBackupText(raw, passphrase);
      const { summary } = await validateBackup(db, text); setNeedPass(null); setPending({ text, when: dateLabel(summary.createdAt.slice(0, 10)) });
    } catch (e) {
      if (e instanceof Error && 'code' in e && (e as { code: string }).code === 'BACKUP_NEEDS_PASSPHRASE') setNeedPass(raw); else setErr(errText(e));
    }
  };
  const pick = async (f: File | undefined) => { if (f) await prepare(await f.text()); };
  const fromAuto = async (name: string) => { const t = await store.get(name); if (t) await prepare(t); };
  const exportAuto = async (name: string) => { const t = await store.get(name); if (t) save(name, t); };

  return (
    <>
      <section className="card">
        <h2>{ar.backup.title}</h2>
        <p className="notice">{ar.backup.warn}</p>
        <p>{ar.backup.lastExported}: <strong>{info.data?.last ? dateLabel(info.data.last.slice(0, 10)) : ar.backup.never}</strong></p>
        <Field label={ar.backup.passTitle} hint={ar.backup.passHint}><input type="password" autoComplete="new-password" value={pass} onChange={e => setPass(e.target.value)} /></Field>
        <div className="actions"><button className="btn" onClick={() => void backupNow()}>{ar.backup.now}</button></div>
        <hr />
        <Field label={ar.backup.restore}><input type="file" accept=".json,application/json" aria-label={ar.backup.pick} onChange={e => void pick(e.target.files?.[0])} /></Field>
        {needPass !== null && (<><p className="notice">{ar.backup.passNeeded}</p>
          <Field label={ar.backup.passRestore}><input type="password" value={restorePass} onChange={e => setRestorePass(e.target.value)} /></Field>
          <button className="btn" onClick={() => void prepare(needPass, restorePass)}>{ar.backup.cont}</button></>)}
        <ErrorBox message={err} />{msg && <p className="amt-in" role="status">{msg}</p>}
      </section>
      <section className="card">
        <h3>{ar.backup.autoTitle}</h3>
        <label className="check"><input type="checkbox" checked={info.data?.on ?? true} onChange={async e => { await setAutoBackupEnabled(db, e.target.checked); info.reload(); }} /> {ar.backup.autoOn}</label>
        <p>{ar.backup.lastAuto}: <strong>{info.data?.auto ? dateLabel(info.data.auto.slice(0, 10)) : ar.backup.never}</strong></p>
        {info.data?.err ? <ErrorBox message={`${ar.backup.autoError}: ${info.data.err}`} /> : null}
        <ul className="list tight">
          {info.data?.files.length === 0 && <li className="muted center-text">{ar.backup.autoNone}</li>}
          {info.data?.files.map(f => (
            <li key={f.name} className="row static"><span className="row-main"><strong>{dateLabel(f.name.slice(5, 15))}</strong><span className="muted small">{Math.max(1, Math.round(f.size / 1024)).toLocaleString('ar-EG')} ك.ب</span></span>
              <span className="actions"><button className="btn ghost small" onClick={() => void exportAuto(f.name)}>{ar.backup.export}</button><button className="btn ghost small" onClick={() => void fromAuto(f.name)}>{ar.backup.restoreThis}</button></span></li>))}
        </ul>
        <p className="muted small">{ar.backup.autoNote}</p>
      </section>
      {pending && <ConfirmDialog title={ar.backup.restore} danger confirmLabel={ar.backup.confirmRestore} message={`${ar.backup.restoreAsk} (${ar.backup.contains}: ${pending.when})`}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          try { await restoreBackup(db, pending.text, async safety => { save(`tawze3-before-restore-${stamp()}.json`, safety); }); setPending(null); setMsg(ar.backup.restoreOk); info.reload(); }
          catch (e) { setPending(null); setErr(errText(e)); }
        }} />}
    </>
  );
}
