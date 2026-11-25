import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ar } from '../../i18n/ar';
import { dailySeries } from '../../services';
import { useLoad } from '../hooks';
import { ErrorBox, Segmented } from '../kit';
import { money } from '../format';
import { useTheme } from '../theme';

/** Last-7-days bars from stored records. RTL: oldest day on the right, values on the right axis. */
export default function DailyChart({ end }: { end: string }) {
  const [mode, setMode] = useState<'value' | 'cash'>('value');
  const { theme } = useTheme();
  const { data, error } = useLoad(db => dailySeries(db, end, 7), [end]);
  const c1 = theme === 'dark' ? '#2dd4bf' : '#0f766e', c2 = theme === 'dark' ? '#fbbf24' : '#b45309', axis = theme === 'dark' ? '#94a3b8' : '#64748b';
  const rows = (data ?? []).map(d => ({ day: new Date(`${d.date}T00:00:00`).toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' }),
    a: (mode === 'value' ? d.sales : d.received) / 100, b: (mode === 'value' ? d.purchases : d.paid) / 100 }));
  const nameA = mode === 'value' ? ar.chart.sales : ar.chart.received, nameB = mode === 'value' ? ar.chart.purchases : ar.chart.paid;
  return (
    <section className="card" aria-label={ar.chart.title}>
      <h3>{ar.chart.title}</h3>
      <Segmented value={mode} onChange={setMode} options={[{ id: 'value', label: ar.chart.value }, { id: 'cash', label: ar.chart.cash }]} />
      <ErrorBox message={error} />
      <div style={{ width: '100%', height: 220, direction: 'ltr' }}>
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={axis} strokeOpacity={0.25} />
            <XAxis dataKey="day" reversed tick={{ fill: axis, fontSize: 11 }} />
            <YAxis orientation="right" width={52} tick={{ fill: axis, fontSize: 11 }} tickFormatter={v => Number(v).toLocaleString('ar-EG', { notation: 'compact' })} />
            <Tooltip formatter={v => money(Math.round(Number(v) * 100))} />
            <Legend />
            <Bar dataKey="a" name={nameA} fill={c1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="b" name={nameB} fill={c2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
