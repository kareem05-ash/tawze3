import { useEffect, useState } from 'react';
import { Home, ReceiptText, ShoppingCart, Users, Menu, Moon, Sun, type LucideIcon } from 'lucide-react';
import { ar } from '../i18n/ar';
import { useTheme } from './theme';
import { useDb } from './DbProvider';

type Tab = 'home' | 'sales' | 'purchases' | 'parties' | 'more';
const TABS: { id: Tab; icon: LucideIcon }[] = [
  { id: 'home', icon: Home }, { id: 'sales', icon: ReceiptText }, { id: 'purchases', icon: ShoppingCart },
  { id: 'parties', icon: Users }, { id: 'more', icon: Menu },
];
const isTab = (v: string): v is Tab => TABS.some(t => t.id === v);
const fromHash = (): Tab => { const h = location.hash.replace('#', ''); return isTab(h) ? h : 'home'; };

export function Shell() {
  const [tab, setTab] = useState<Tab>(fromHash);
  const { theme, toggle } = useTheme();
  const dbState = useDb();
  useEffect(() => { const f = () => setTab(fromHash()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);

  return (
    <div className="app">
      <header className="topbar">
        <h1>{ar.pages[tab]}</h1>
        <button className="icon-btn" onClick={toggle} aria-label={ar.theme.toggle} title={theme === 'dark' ? ar.theme.light : ar.theme.dark}>
          {theme === 'dark' ? <Sun size={22} /> : <Moon size={22} />}
        </button>
      </header>
      <main className="content">
        <section className="card">
          <h2>{ar.empty.title}</h2>
          <p className="muted">{ar.empty.soon}</p>
          {tab === 'home' && dbState.status === 'ready' && (
            <p className="badge">{ar.db.ready} · {ar.db.version}: {dbState.version.toLocaleString('ar-EG')}</p>
          )}
        </section>
      </main>
      <nav className="bottom-nav" aria-label="التنقل الرئيسي">
        {TABS.map(({ id, icon: Icon }) => (
          <a key={id} href={`#${id}`} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined}>
            <Icon size={22} /><span>{ar.nav[id]}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
