import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { canAnimate } from './motion';
export type Theme = 'light' | 'dark';
const KEY = 'dp.theme'; // UI preference only (not business data), so localStorage is acceptable here.
const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} });

function initial(): Theme {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark') return v; } catch { /* ignore */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);
  // Short colour cross-fade while switching (not on first load); skipped entirely under prefers-reduced-motion.
  const toggle = useCallback(() => {
    if (canAnimate()) { const el = document.documentElement; el.classList.add('theme-anim'); setTimeout(() => el.classList.remove('theme-anim'), 320); }
    setTheme(t => (t === 'light' ? 'dark' : 'light'));
  }, []);
  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}
export const useTheme = () => useContext(Ctx);
