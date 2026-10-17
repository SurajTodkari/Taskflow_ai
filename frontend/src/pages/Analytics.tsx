import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, Clock, AlertTriangle, Gauge, Info } from 'lucide-react';
import { api } from '../lib/api';
import type { Analytics as A } from '../lib/types';
import ErrorBanner from '../components/ErrorBanner';
import StatCard from '../components/StatCard';
import { Skeleton } from '../components/Skeleton';
import { ChartCard, ChartTooltip } from '../features/charts/ChartCard';
import { useChartColors } from '../features/charts/theme';
import { fmtDuration } from '../lib/dates';

const short = (d: string) => (d.length === 10 ? d.slice(5) : d);
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export default function Analytics() {
  const [range, setRange] = useState(30);
  const c = useChartColors();
  const q = useQuery({ queryKey: ['analytics', range], queryFn: () => api.get<A>('/api/analytics', { range }), refetchInterval: 60000 });
  const d = q.data;
  const def = (k: string) => d?.definitions?.[k];
  const PCOL: Record<string, string> = { critical: c.danger, high: c.warning, medium: c.accent, low: c.fg };
  const axis = { fontSize: 11, stroke: c['fg-muted'], tickLine: false, axisLine: false } as const;
  const grid = <CartesianGrid strokeDasharray="3 3" stroke={c.line} vertical={false} />;
  const tip = <Tooltip content={<ChartTooltip />} cursor={{ fill: c.line, opacity: 0.4 }} />;
  const legend = <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />;
  const anim = { isAnimationActive: true, animationDuration: 700 };
  const cvp = d ? [
    { name: 'Completed', value: d.completed_vs_pending.completed, c: c.success }, { name: 'Pending', value: d.completed_vs_pending.pending, c: c.accent },
    { name: 'Overdue', value: d.completed_vs_pending.overdue, c: c.danger }, { name: 'Cancelled', value: d.completed_vs_pending.cancelled, c: c['fg-muted'] },
  ] : [];
  const tot = d ? sum(d.daily.map((x) => x.total)) : 0;
  const done = d ? sum(d.daily.map((x) => x.completed)) : 0;
  const rate = tot ? Math.round((done / tot) * 100) : 0;
  const barMargin = { top: 4, right: 8, left: -16, bottom: 0 };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-page">Analytics</h1><p className="text-sm text-fg-muted">How your work is trending over the last {range} days.</p></div>
        <div className="inline-flex rounded-lg bg-surface-2 p-0.5" role="group" aria-label="Range">
          {[7, 30, 90].map((r) => <button key={r} aria-pressed={range === r} onClick={() => setRange(r)} className={`rounded-md px-3 py-1 text-sm transition ${range === r ? 'bg-surface font-medium shadow-sm' : 'text-fg-muted hover:text-fg'}`}>{r} days</button>)}
        </div>
      </div>
      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading && <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}</div>
        <div className="grid gap-4 lg:grid-cols-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-80 w-full rounded-2xl" />)}</div></>}
      {d && (<>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Completion rate" value={rate} suffix="%" tone="green" icon={<Gauge size={18} />} />
          <StatCard label="Tasks completed" value={d.completed_vs_pending.completed} tone="brand" icon={<CheckCircle2 size={18} />} />
          <StatCard label="Overdue now" value={d.completed_vs_pending.overdue} tone="red" icon={<AlertTriangle size={18} />} />
          <StatCard label="Time tracked" value={fmtDuration(sum(d.time_tracking.map((t) => t.seconds)))} tone="sky" icon={<Clock size={18} />} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Daily productivity (%)" def={def('productivity')} empty={!d.daily.length} summary={`Average ${d.daily.length ? Math.round(sum(d.daily.map((x) => x.productivity)) / d.daily.length) : 0} percent.`}>
            <ResponsiveContainer><LineChart data={d.daily} margin={barMargin}>{grid}<XAxis dataKey="date" tickFormatter={short} {...axis} minTickGap={24} /><YAxis domain={[0, 100]} {...axis} />{tip}
              <Line type="monotone" dataKey="productivity" stroke={c.accent} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} name="Productivity %" {...anim} /></LineChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Weekly completion" def={def('weekly')} empty={!d.weekly.length}>
            <ResponsiveContainer><BarChart data={d.weekly} margin={barMargin}>{grid}<XAxis dataKey="week" {...axis} /><YAxis allowDecimals={false} {...axis} />{tip}{legend}
              <Bar dataKey="total" fill={c['fg-muted']} fillOpacity={0.45} radius={[4, 4, 0, 0]} name="Total" {...anim} /><Bar dataKey="completed" fill={c.success} radius={[4, 4, 0, 0]} name="Completed" {...anim} /></BarChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Monthly progress" def={def('monthly')} empty={!d.monthly.length}>
            <ResponsiveContainer><BarChart data={d.monthly} margin={barMargin}>{grid}<XAxis dataKey="month" {...axis} /><YAxis allowDecimals={false} {...axis} />{tip}{legend}
              <Bar dataKey="total" fill={c['fg-muted']} fillOpacity={0.45} radius={[4, 4, 0, 0]} name="Total" {...anim} /><Bar dataKey="completed" fill={c.accent} radius={[4, 4, 0, 0]} name="Completed" {...anim} /></BarChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Completed vs pending" def={def('completed_vs_pending')} empty={cvp.every((x) => !x.value)} summary={cvp.map((x) => `${x.name} ${x.value}`).join(', ')}>
            <ResponsiveContainer><PieChart><Pie data={cvp.filter((x) => x.value)} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2} stroke={c.surface} {...anim}>{cvp.filter((x) => x.value).map((x) => <Cell key={x.name} fill={x.c} />)}</Pie>{tip}{legend}</PieChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Project-wise" def={def('by_project')} empty={!d.by_project.length}>
            <ResponsiveContainer><BarChart data={d.by_project} margin={barMargin}>{grid}<XAxis dataKey="project" {...axis} /><YAxis allowDecimals={false} {...axis} />{tip}{legend}
              <Bar dataKey="total" fill={c['fg-muted']} fillOpacity={0.45} radius={[4, 4, 0, 0]} name="Total" {...anim} /><Bar dataKey="completed" fill={c.success} radius={[4, 4, 0, 0]} name="Completed" {...anim} /></BarChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Priority distribution" def={def('priority_distribution')} empty={!d.priority_distribution.length} summary={d.priority_distribution.map((x) => `${x.priority} ${x.count}`).join(', ')}>
            <ResponsiveContainer><PieChart><Pie data={d.priority_distribution} dataKey="count" nameKey="priority" outerRadius={85} paddingAngle={2} stroke={c.surface} {...anim}>{d.priority_distribution.map((x) => <Cell key={x.priority} fill={PCOL[x.priority] ?? c['fg-muted']} />)}</Pie>{tip}{legend}</PieChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Overdue trend" def={def('overdue_trend')} empty={!d.overdue_trend.length}>
            <ResponsiveContainer><LineChart data={d.overdue_trend} margin={barMargin}>{grid}<XAxis dataKey="date" tickFormatter={short} {...axis} minTickGap={24} /><YAxis allowDecimals={false} {...axis} />{tip}
              <Line type="monotone" dataKey="count" stroke={c.danger} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} name="Overdue" {...anim} /></LineChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Workload (estimated minutes)" def={def('workload')} empty={!d.workload.length}>
            <ResponsiveContainer><BarChart data={d.workload} margin={barMargin}>{grid}<XAxis dataKey="date" tickFormatter={short} {...axis} minTickGap={24} /><YAxis {...axis} />{tip}{legend}
              <Bar dataKey="estimated_minutes" fill={c.warning} radius={[4, 4, 0, 0]} name="Minutes" {...anim} /><Bar dataKey="tasks" fill={c.accent} radius={[4, 4, 0, 0]} name="Tasks" {...anim} /></BarChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Time tracked (hours)" def={def('time_tracking')} empty={!d.time_tracking.length}>
            <ResponsiveContainer><BarChart data={d.time_tracking.map((t) => ({ date: t.date, hours: Math.round((t.seconds / 3600) * 100) / 100 }))} margin={barMargin}>{grid}<XAxis dataKey="date" tickFormatter={short} {...axis} minTickGap={24} /><YAxis {...axis} />{tip}
              <Bar dataKey="hours" fill={c.accent} radius={[4, 4, 0, 0]} name="Hours" {...anim} /></BarChart></ResponsiveContainer>
          </ChartCard>
        </div>
        {d.definitions && Object.keys(d.definitions).length > 0 && (
          <section className="card p-5" aria-labelledby="defs"><h2 id="defs" className="mb-3 flex items-center gap-2 text-section"><Info size={16} className="text-accent" />How these numbers are calculated</h2>
            <dl className="grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">{Object.entries(d.definitions).map(([k, v]) => <div key={k}><dt className="font-medium capitalize">{k.replace(/_/g, ' ')}</dt><dd className="text-fg-muted">{String(v)}</dd></div>)}</dl></section>)}
      </>)}
    </div>
  );
}
