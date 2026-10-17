import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Task } from '../../lib/types';
import { addDays, localISO } from '../../lib/dates';
import { label } from '../../components/TaskCard';

const STATUS_COLORS: Record<string, string> = { not_started: '#94a3b8', in_progress: '#6366f1', on_hold: '#f59e0b', completed: '#10b981', cancelled: '#cbd5e1', overdue: '#ef4444' };
const PRIO_COLORS: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#0ea5e9', low: '#94a3b8' };
const tip = { contentStyle: { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: 12, fontSize: 12, color: 'rgb(var(--fg))' } };
const axis = { fontSize: 11, fill: 'rgb(100 116 139)' };

export default function ProjectAnalytics({ tasks }: { tasks: Task[] }) {
  const { status, prio, trend } = useMemo(() => {
    const sc: Record<string, number> = {}, pc: Record<string, number> = {};
    tasks.forEach((t) => { sc[t.effective_status] = (sc[t.effective_status] ?? 0) + 1; pc[t.priority] = (pc[t.priority] ?? 0) + 1; });
    const today = localISO();
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
    let cum = 0;
    const base = tasks.filter((t) => t.completed_at && t.completed_at.slice(0, 10) < days[0]).length;
    cum = base;
    const trend = days.map((d) => { const n = tasks.filter((t) => t.completed_at?.slice(0, 10) === d).length; cum += n; return { date: d.slice(5), done: n, total: cum }; });
    return {
      status: Object.entries(sc).map(([k, v]) => ({ key: k, name: label(k), value: v })),
      prio: ['critical', 'high', 'medium', 'low'].map((k) => ({ key: k, name: label(k), value: pc[k] ?? 0 })),
      trend,
    };
  }, [tasks]);
  if (tasks.length === 0) return <p className="card p-6 text-center text-sm text-fg-muted">Add tasks to see analytics for this project.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card p-4" aria-label="Status distribution"><h3 className="mb-2 text-sm font-semibold">Status distribution</h3>
        <div className="h-60"><ResponsiveContainer width="100%" height="100%"><PieChart>
          <Pie data={status} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2} stroke="none">{status.map((s) => <Cell key={s.key} fill={STATUS_COLORS[s.key] ?? '#94a3b8'} />)}</Pie>
          <Tooltip {...tip} /></PieChart></ResponsiveContainer></div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">{status.map((s) => <li key={s.key} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLORS[s.key] }} />{s.name} {s.value}</li>)}</ul></section>
      <section className="card p-4" aria-label="Priority distribution"><h3 className="mb-2 text-sm font-semibold">Priority distribution</h3>
        <div className="h-60"><ResponsiveContainer width="100%" height="100%"><BarChart data={prio}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(100 116 139 / .2)" vertical={false} /><XAxis dataKey="name" tick={axis} tickLine={false} /><YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} width={28} />
          <Tooltip {...tip} cursor={{ fill: 'rgb(100 116 139 / .1)' }} /><Bar dataKey="value" name="Tasks" radius={[6, 6, 0, 0]}>{prio.map((s) => <Cell key={s.key} fill={PRIO_COLORS[s.key]} />)}</Bar></BarChart></ResponsiveContainer></div></section>
      <section className="card p-4 lg:col-span-2" aria-label="Completion trend"><h3 className="mb-2 text-sm font-semibold">Completion trend (last 14 days)</h3>
        <div className="h-60"><ResponsiveContainer width="100%" height="100%"><LineChart data={trend}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(100 116 139 / .2)" vertical={false} /><XAxis dataKey="date" tick={axis} tickLine={false} /><YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} width={28} />
          <Tooltip {...tip} /><Line type="monotone" dataKey="total" name="Total completed" stroke="#6366f1" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="done" name="Completed that day" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} /></LineChart></ResponsiveContainer></div></section>
    </div>
  );
}
