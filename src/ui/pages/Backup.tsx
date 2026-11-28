import { useState } from 'react';
import { ar } from '../../i18n/ar';
import { getBackupStore } from '../../db/backupStores';
import { downloadBlob } from '../../export/deliver';
import {
  autoBackupEnabled, createBackupFile, getSetting, lastBackupAt, markBackupDone, openBackupText, restoreBackup, setAutoBackupEnabled, validateBackup,
} from '../../services';
import { useReadyDb } from '../DbProvider';
import { useLoad } from '../hooks';
import { Collapse, ConfirmDialog, ErrorBox, Field, errText } from '../kit';
import { useGuard } from '../hooks';
import { useToast } from '../toast';
import { dateLabel } from '../format';

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const save = (name: string, text: string) => downloadBlob(new Blob([text], { type: 'application/json' }), name);

export function BackupPage() {
  const { db } = useReadyDb(); const store = getBackupStore();
  const info = useLoad(async d => ({ last: await lastBackupAt(d), auto: await getSetting(d, 'last_auto_backup_at'), err: await getSetting(d, 'auto_backup_error'), on: await autoBackupEnabled(d), files: (await store.list()).filter(f => f.name.startsWith('auto-')).sort((a, b) => b.name.localeCompare(a.name)) }), []);
  const toast = useToast(); const now = useGuard(); const prep = useGuard(); const auto = useGuard();
  const [pass, setPass] = useState(''); const [err, setErr] = useState('');
  const [needPass, setNeedPass] = useState<string | null>(null); const [restorePass, setRestorePass] = useState('');
  const [pending, setPending] = useState<{ text: string; when: string } | null>(null);

  const backupNow = () => now.guard(async () => {
    setErr('');
    const r = await toast.run(async () => { const { text, encrypted } = await createBackupFile(db, { passphrase: pass || undefined }); save(`tawze3-backup-${stamp()}${encrypted ? '.enc' : ''}.json`, text); await markBackupDone(db); },
      { loading: ar.fb.backupCreating, success: ar.backup.done, error: ar.fb.backupFailed });
    if (r.ok) info.reload();
  });
  const toggleAuto = (on: boolean) => auto.guard(async () => {
    const r = await toast.run(() => setAutoBackupEnabled(db, on), { success: on ? ar.fb.autoBackupOn : ar.fb.autoBackupOff, error: ar.fb.autoBackupFailed });
    info.reload(); return r;
  });
  const prepare = (raw: string, passphrase?: string) => prep.guard(async () => {
    setErr('');
    try {
      const text = await openBackupText(raw, passphrase);
      const { summary } = await validateBackup(db, text); setNeedPass(null); setPending({ text, when: dateLabel(summary.createdAt.slice(0, 10)) });
    } catch (e) {
      if (e instanceof Error && 'code' in e && (e as { code: string }).code === 'BACKUP_NEEDS_PASSPHRASE') setNeedPass(raw); else setErr(errText(e));
    }
  });
  const pick = async (f: File | undefined) => { if (f) await prepare(await f.text()); };
  const fromAuto = async (name: string) => { const t = await store.get(name); if (t) await prepare(t); };
  const exportAuto = async (name: string) => { await toast.run(async () => { const t = await store.get(name); if (t) save(name, t); }, { success: ar.share.downloaded, error: ar.share.failed }); };

  return (
    <>
      <section className="card">
        <h2>{ar.backup.title}</h2>
        <p className="notice">{ar.backup.warn}</p>
        <p>{ar.backup.lastExported}: <strong>{info.data?.last ? dateLabel(info.data.last.slice(0, 10)) : ar.backup.never}</strong></p>
        <Field label={ar.backup.passTitle} hint={ar.backup.passHint}><input type="password" autoComplete="new-password" value={pass} onChange={e => setPass(e.target.value)} /></Field>
        <div className="actions"><button className="btn" disabled={now.busy} onClick={() => void backupNow()}>{ar.backup.now}</button></div>
        <hr />
        <Field label={ar.backup.restore}><input type="file" accept=".json,application/json" aria-label={ar.backup.pick} onChange={e => void pick(e.target.files?.[0])} /></Field>
        <Collapse open={needPass !== null}><p className="notice">{ar.backup.passNeeded}</p>
          <Field label={ar.backup.passRestore}><input type="password" value={restorePass} onChange={e => setRestorePass(e.target.value)} /></Field>
          <button className="btn" disabled={prep.busy} onClick={() => needPass !== null && void prepare(needPass, restorePass)}>{ar.backup.cont}</button></Collapse>
        <ErrorBox message={err} />
      </section>
      <section className="card">
        <h3>{ar.backup.autoTitle}</h3>
        <label className="check"><input type="checkbox" checked={info.data?.on ?? true} disabled={auto.busy} onChange={e => void toggleAuto(e.target.checked)} /> {ar.backup.autoOn}</label>
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
          const r = await toast.run(() => restoreBackup(db, pending.text, async safety => { save(`tawze3-before-restore-${stamp()}.json`, safety); }),
            { loading: ar.fb.restoring, success: ar.backup.restoreOk, error: ar.fb.restoreFailed });
          setPending(null); if (r.ok) info.reload();
        }} />}
    </>
  );
}
