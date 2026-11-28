import { useEffect, useState } from 'react';
import { ar } from '../../i18n/ar';
import { getSetting, setSetting } from '../../services';
import { useReadyDb } from '../DbProvider';
import { Field } from '../kit';
import { useGuard } from '../hooks';
import { useToast } from '../toast';
import { appVersionLabel } from '../../version';
import { biometricAvailable, biometricEnabled, biometricUnlock, setBiometricEnabled } from '../../security/biometric';
import { useTheme } from '../theme';
import { PinSheet, useLock } from '../Lock';

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
  const { db } = useReadyDb(); const { theme, toggle } = useTheme(); const toast = useToast();
  const lock = useLock(); const [pinMode, setPinMode] = useState<'set' | 'change' | 'disable' | null>(null);
  const [bioAvail, setBioAvail] = useState(false); const [bioOn, setBioOn] = useState(false);
  useEffect(() => { void biometricAvailable().then(setBioAvail); void biometricEnabled(db).then(setBioOn); }, [db, lock.enabled]);
  const [biz, setBiz] = useState(''); const save = useGuard(); const bio = useGuard();
  useEffect(() => { void getSetting(db, 'business_name').then(v => setBiz(v ?? '')); }, [db]);
  const saveBiz = () => save.guard(() => toast.run(() => setSetting(db, 'business_name', biz.trim()), { loading: ar.fb.saving, success: ar.settings.saved, error: ar.settings.saveFailed }));
  const toggleBio = (on: boolean) => bio.guard(async () => {
    if (on && !(await biometricUnlock(ar.lock.bioReason, ar.lock.bioCancel))) { toast.warning(ar.lock.bioFailed); return; }
    const r = await toast.run(() => setBiometricEnabled(db, on), { success: on ? ar.fb.bioOn : ar.fb.bioOff, error: ar.fb.bioFailed });
    if (r.ok) setBioOn(on);
  });
  return (
    <section className="card">
      <h2>{ar.settings.title}</h2>
      <Field label={ar.settings.business}><input value={biz} onChange={e => setBiz(e.target.value)} /></Field>
      <button className="btn" disabled={save.busy} onClick={() => void saveBiz()}>{ar.common.save}</button>
      <hr /><p>{ar.settings.theme}</p><button className="btn ghost" onClick={toggle}>{theme === 'dark' ? ar.theme.light : ar.theme.dark}</button>
      <hr /><h3>{ar.lock.section}</h3><p className="muted">{lock.enabled ? ar.lock.on : ar.lock.off}</p>
      <div className="actions">
        {!lock.enabled && <button className="btn" onClick={() => setPinMode('set')}>{ar.lock.enable}</button>}
        {lock.enabled && <><button className="btn ghost" onClick={() => setPinMode('change')}>{ar.lock.change}</button><button className="btn ghost" onClick={() => setPinMode('disable')}>{ar.lock.disable}</button><button className="btn" onClick={lock.lockNow}>{ar.lock.lockNow}</button></>}
      </div>
      {lock.enabled && bioAvail && <label className="check"><input type="checkbox" checked={bioOn} disabled={bio.busy} onChange={e => void toggleBio(e.target.checked)} /> {ar.lock.bioToggle}</label>}
      <p className="muted small">{ar.lock.note}</p>
      <hr />
      <div className="kv app-version" aria-label={ar.settings.version}><span className="muted">{ar.settings.version}</span><strong dir="ltr">{appVersionLabel() ?? ar.settings.versionDev}</strong></div>
      {pinMode && <PinSheet mode={pinMode} onClose={() => setPinMode(null)} onDone={m => { setPinMode(null); toast.success(m); lock.refresh(); }} />}
    </section>
  );
}
