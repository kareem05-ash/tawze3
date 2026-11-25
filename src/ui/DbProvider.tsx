import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Db } from '../db/types';
import { migrate } from '../db/migrate';
import { MIGRATIONS } from '../db/migrations';
import { openCapacitorDb } from '../db/capacitorAdapter';
import { ar } from '../i18n/ar';

type State = { status: 'loading' } | { status: 'ready'; db: Db; version: number } | { status: 'error'; message: string };
const Ctx = createContext<State>({ status: 'loading' });
export const useDb = () => useContext(Ctx);

export function DbProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const open = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const db = await openCapacitorDb();
      const version = await migrate(db, MIGRATIONS);
      setState({ status: 'ready', db, version });
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => { void open(); }, [open, attempt]);

  if (state.status === 'loading') return <div className="center muted" role="status">{ar.db.loading}</div>;
  if (state.status === 'error') return (
    <div className="center" role="alert">
      <h2>{ar.db.failed}</h2><p className="muted">{state.message}</p>
      <button className="btn" onClick={() => setAttempt(a => a + 1)}>{ar.db.retry}</button>
    </div>
  );
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
