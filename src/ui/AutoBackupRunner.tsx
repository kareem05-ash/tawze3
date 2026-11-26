import { useEffect } from 'react';
import { getBackupStore } from '../db/backupStores';
import { runAutoBackupIfDue } from '../services';
import { useReadyDb } from './DbProvider';
import { todayIso } from './format';

/** Attempts the daily automatic backup on start, whenever the app becomes visible again, and hourly while it stays open. Renders nothing. */
export function AutoBackupRunner() {
  const { db } = useReadyDb();
  useEffect(() => {
    const store = getBackupStore(); let running = false;
    const attempt = () => { if (running) return; running = true; void runAutoBackupIfDue(db, store, todayIso()).finally(() => { running = false; }); };
    attempt();
    const vis = () => { if (document.visibilityState === 'visible') attempt(); };
    document.addEventListener('visibilitychange', vis); const t = setInterval(attempt, 60 * 60 * 1000);
    return () => { document.removeEventListener('visibilitychange', vis); clearInterval(t); };
  }, [db]);
  return null;
}
