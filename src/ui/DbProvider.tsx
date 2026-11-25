import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Db } from '../db/types';
import { initDb, type OpenedDb } from '../db/openDb';
import { ar } from '../i18n/ar';

type State = { status: 'loading' } | { status: 'ready'; db: Db; version: number } | { status: 'error'; message: string };
const Ctx = createContext<State>({ status: 'loading' });
export const useDb = () => useContext(Ctx);
export function useReadyDb(): { db: Db; version: number } {
  const s = useContext(Ctx);
  if (s.status !== 'ready') throw new Error('Database not ready');
  return s;
}

export function DbProvider({ children, open: openFn = initDb }: { children: ReactNode; open?: () => Promise<OpenedDb> }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const { db, version } = await openFn();
      setState({ status: 'ready', db, version });
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [openFn]);
  useEffect(() => { void load(); }, [load, attempt]);

  if (state.status === 'loading') return <div className="center muted" role="status">{ar.db.loading}</div>;
  if (state.status === 'error') return (
    <div className="center" role="alert">
      <h2>{ar.db.failed}</h2><p className="muted">{state.message}</p>
      <button className="btn" onClick={() => setAttempt(a => a + 1)}>{ar.db.retry}</button>
    </div>
  );
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
