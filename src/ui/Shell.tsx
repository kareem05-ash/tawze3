import { ArrowRight, Home, ReceiptText, ShoppingCart, Users, Menu, Moon, Sun, type LucideIcon } from 'lucide-react';
import { ar } from '../i18n/ar';
import { useTheme } from './theme';
import { useRoute } from './hooks';
import { Dashboard } from './pages/Dashboard';
import { InvoiceDetail, InvoiceForm, InvoiceList } from './pages/Invoices';
import { PartiesPage, PartyDetail } from './pages/Parties';
import { ProductsPage } from './pages/Products';
import { MorePage, SettingsPage } from './pages/More';

type Tab = 'home' | 'sales' | 'purchases' | 'parties' | 'more';
const TABS: { id: Tab; icon: LucideIcon }[] = [
  { id: 'home', icon: Home }, { id: 'sales', icon: ReceiptText }, { id: 'purchases', icon: ShoppingCart }, { id: 'parties', icon: Users }, { id: 'more', icon: Menu },
];
const num = (s?: string) => { const n = Number(s); return Number.isInteger(n) && n > 0 ? n : undefined; };

function Page({ route }: { route: string[] }) {
  const [a, b, c] = route;
  if (a === 'sales' || a === 'purchases') {
    const kind = a === 'sales' ? 'sale' : 'purchase';
    if (b === 'new') return <InvoiceForm key={`n${c}`} kind={kind} partyId={num(c)} />;
    if (b === 'edit' && num(c)) return <InvoiceForm key={`e${c}`} kind={kind} replaceId={num(c)} />;
    if (num(b)) return <InvoiceDetail key={b} id={num(b)!} kind={kind} />;
    return <InvoiceList kind={kind} />;
  }
  if (a === 'parties') return num(b) ? <PartyDetail key={b} id={num(b)!} /> : <PartiesPage />;
  if (a === 'more') return b === 'products' ? <ProductsPage /> : b === 'settings' ? <SettingsPage /> : <MorePage />;
  return <Dashboard />;
}

export function Shell() {
  const route = useRoute();
  const { theme, toggle } = useTheme();
  const tab: Tab = TABS.find(t => t.id === route[0])?.id ?? 'home';
  const back = () => { if (history.length > 1) history.back(); else location.hash = tab; };
  return (
    <div className="app">
      <header className="topbar">
        {route.length > 1 ? <button className="icon-btn" onClick={back} aria-label={ar.common.back}><ArrowRight size={22} /></button> : <span className="icon-btn" aria-hidden />}
        <h1>{ar.appName}</h1>
        <button className="icon-btn" onClick={toggle} aria-label={ar.theme.toggle} title={theme === 'dark' ? ar.theme.light : ar.theme.dark}>{theme === 'dark' ? <Sun size={22} /> : <Moon size={22} />}</button>
      </header>
      <main className="content"><Page route={route} /></main>
      <nav className="bottom-nav" aria-label="التنقل الرئيسي">
        {TABS.map(({ id, icon: Icon }) => (
          <a key={id} href={`#${id}`} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined}><Icon size={22} /><span>{ar.nav[id]}</span></a>
        ))}
      </nav>
    </div>
  );
}
