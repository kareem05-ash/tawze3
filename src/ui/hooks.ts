import { useCallback, useEffect, useRef, useState } from 'react';
import type { Db } from '../db/types';
import { useReadyDb } from './DbProvider';
import { errText } from './errors';

export function useLoad<T>(fn: (db: Db) => Promise<T>, deps: unknown[] = []) {
  const { db } = useReadyDb();
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  useEffect(() => {
    let alive = true;
    run(db).then(data => alive && setState({ data, loading: false }), e => alive && setState({ error: errText(e), loading: false }));
    return () => { alive = false; };
  }, [db, run, tick]);
  return { ...state, reload: () => setTick(t => t + 1) };
}

export function useRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [r, setR] = useState(read);
  useEffect(() => { const f = () => setR(read()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return r;
}
export const go = (path: string) => { location.hash = path; };

/** Runs one async action at a time: `busy` disables submit buttons, and a second call while one is running is ignored (double-tap safe). */
export function useGuard() {
  const running = useRef(false); const alive = useRef(true); const [busy, setBusy] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (running.current) return undefined;
    running.current = true; setBusy(true);
    try { return await fn(); } finally { running.current = false; if (alive.current) setBusy(false); }
  }, []);
  return { busy, guard };
}
