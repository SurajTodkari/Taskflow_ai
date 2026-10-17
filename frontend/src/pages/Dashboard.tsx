import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListChecks, CheckCircle2, Clock, Loader, AlertTriangle, TrendingUp, Plus, ArrowLeft, Sun, Sunrise, CalendarClock, Hourglass, History } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { motion, useReducedMotion } from 'motion/react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Dashboard as D, Task } from '../lib/types';
import StatCard from '../components/StatCard';
import TaskSection from '../components/TaskSection';
import TaskModal from '../components/TaskModal';
import ErrorBanner from '../components/ErrorBanner';
import { Skeleton } from '../components/Skeleton';
import { fmtDate } from '../lib/dates';

type Filter = 'total' | 'completed' | 'pending' | 'in_progress' | 'overdue' | 'productivity';

function greeting(h: number) { return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening'; }

function summary(d: D) {
  const { total, completed, pending, overdue, productivity } = d.today;
  if (total === 0 && overdue === 0) return 'Nothing is scheduled today. A clear day to plan ahead.';
  const parts: string[] = [];
  if (total > 0) parts.push(completed === total ? `All ${total} tasks done today. Nice work!` : `You've completed ${completed} of ${total} tasks today (${Math.round(productivity)}% productivity)${pending ? `, ${pending} to go` : ''}.`);
  if (overdue > 0) parts.push(`${overdue} overdue ${overdue === 1 ? 'task needs' : 'tasks need'} attention.`);
  return parts.join(' ');
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <div className="mb-1 font-semibold text-fg">{label}</div>
      {payload.map((p: any) => <div key={p.dataKey} className="flex items-center gap-2 text-fg-muted"><span className="h-2 w-2 rounded-full" style={{ background: p.fill }} />{p.name}: <span className="font-medium text-fg">{p.value}</span></div>)}
    </div>
  );
}

export default function Dashboard() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<D>('/api/dashboard'), refetchInterval: 30000 });
  const { user } = useAuth();
  const reduce = useReducedMotion();
  const [edit, setEdit] = useState<Task | null>(null);
  const [create, setCreate] = useState(false);
  const d = q.data;
  const [filter, setFilter] = useState<Filter | null>(null);
  const toggle = (f: Filter) => setFilter((cur) => (cur === f ? null : f));
  const OPEN = ['not_started', 'in_progress', 'on_hold'];
  const first = (user?.name || '').trim().split(/\s+/)[0];
  const filtered = (): { title: string; tasks: Task[]; empty: string } | null => {
    if (!d || !filter) return null;
    const t = d.tasks_today;
    switch (filter) {
      case 'total': return { title: "All Tasks Today", tasks: t, empty: 'No tasks scheduled for today' };
      case 'completed': return { title: 'Completed Tasks', tasks: t.filter((x) => x.status === 'completed'), empty: 'Nothing completed yet today' };
      case 'pending': return { title: 'Pending Tasks', tasks: t.filter((x) => OPEN.includes(x.status)), empty: 'No pending tasks' };
      case 'in_progress': return { title: 'In Progress Tasks', tasks: t.filter((x) => x.status === 'in_progress'), empty: 'No tasks in progress' };
      case 'overdue': return { title: 'Overdue Tasks', tasks: d.overdue, empty: 'No overdue tasks' };
      case 'productivity': return { title: 'Completed Today (productivity)', tasks: t.filter((x) => x.status === 'completed'), empty: 'Nothing completed yet today' };
    }
  };
  const view = filtered();
  const chip = (f: Filter, text: string, n: number, icon: React.ReactNode, cls: string) => (
    <button type="button" onClick={() => toggle(f)} aria-pressed={filter === f}
      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition hover:bg-surface-2 ${filter === f ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}>
      <span className={cls} aria-hidden>{icon}</span><span className="tabular-nums text-fg">{n}</span><span className="text-fg-muted">{text}</span>
    </button>
  );
  const tomorrowTasks = d ? [...d.tomorrow.planned, ...d.tomorrow.carried] : [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-fg-muted">{d ? new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          <h1 className="text-page text-fg sm:text-display">{greeting(new Date().getHours())}{first ? `, ${first}` : ''}!</h1>
          <div className="mt-1 max-w-2xl text-sm text-fg-muted">{d ? summary(d) : <Skeleton className="mt-2 h-4 w-72" />}</div>
        </div>
      </header>
      {q.isError && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading && (
        <div className="space-y-6" role="status" aria-label="Loading dashboard">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
          <div className="grid gap-5 lg:grid-cols-12"><Skeleton className="h-72 rounded-2xl lg:col-span-8" /><Skeleton className="h-72 rounded-2xl lg:col-span-4" /></div>
        </div>
      )}
      {d && (
        <>
          <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-3">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard onClick={() => toggle('total')} active={filter === 'total'} label="Today's Tasks" value={d.today.total} icon={<ListChecks size={20} />} tone="brand" />
              <StatCard onClick={() => toggle('completed')} active={filter === 'completed'} label="Completed" value={d.today.completed} icon={<CheckCircle2 size={20} />} tone="green" />
              <StatCard onClick={() => toggle('pending')} active={filter === 'pending'} label="Pending" value={d.today.pending} icon={<Clock size={20} />} tone="amber" />
              <StatCard onClick={() => toggle('productivity')} active={filter === 'productivity'} label="Productivity Score" value={Math.round(d.today.productivity)} suffix="%" ring={d.today.productivity} icon={<TrendingUp size={16} />} tone="brand" />
            </div>
            <div className="flex flex-wrap gap-2">
              {chip('in_progress', 'In progress', d.today.in_progress, <Loader size={15} />, 'text-accent')}
              {chip('overdue', 'Overdue', d.today.overdue, <AlertTriangle size={15} />, d.today.overdue ? 'text-danger' : 'text-fg-muted')}
            </div>
          </motion.div>

          {view ? (
            <div className="space-y-3">
              <button className="btn-ghost text-sm" onClick={() => setFilter(null)}><ArrowLeft size={15} />Show full dashboard</button>
              <TaskSection id="sec-filtered" title={view.title} tasks={view.tasks} onEdit={setEdit} carry={filter === 'overdue'} tone={filter === 'overdue' ? 'quiet' : 'default'} empty={view.empty} />
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-12">
              <div className="space-y-5 lg:col-span-8">
                <TaskSection id="sec-today" icon={<Sun size={16} />} title="My Today's Work" tasks={d.tasks_today} onEdit={setEdit} empty="No tasks scheduled for today" hint="Add a task to plan your day."
                  action={<button className="btn-ghost !py-1.5 text-xs" onClick={() => setCreate(true)}><Plus size={14} />Add</button>} />
                <TaskSection id="sec-carried" icon={<History size={16} />} title="Carried Forward" subtitle="Unfinished from earlier days" tasks={d.carried_forward} onEdit={setEdit} carry tone="quiet" empty="No carried-forward tasks" hint="Unfinished tasks from earlier days appear here." />
                <TaskSection id="sec-overdue" icon={<Hourglass size={16} />} title="Overdue Tasks" subtitle="Past their due date" tasks={d.overdue} onEdit={setEdit} carry tone="quiet" empty="No overdue tasks" hint="You're all caught up." />
              </div>
              <div className="space-y-5 lg:col-span-4">
                <TaskSection id="sec-tomorrow" icon={<Sunrise size={16} />} title="Tomorrow's Preview" subtitle={`${fmtDate(d.tomorrow.date)} · ${d.tomorrow.planned.length} planned, ${d.tomorrow.carried.length} carried forward`} tasks={tomorrowTasks} onEdit={setEdit} empty="Nothing planned for tomorrow yet" hint={`Plan for ${fmtDate(d.tomorrow.date)}.`} />
                <TaskSection id="sec-deadlines" icon={<CalendarClock size={16} />} title="Upcoming Deadlines" tasks={d.upcoming_deadlines} onEdit={setEdit} tone="deadline" empty="No upcoming deadlines" />
              </div>
              <section aria-labelledby="sec-weekly" className="card p-4 sm:p-5 lg:col-span-12">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 id="sec-weekly" className="text-section text-fg">Weekly Productivity</h2>
                  <div className="flex items-center gap-4 text-caption text-fg-muted">
                    <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-line" />Scheduled</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent" />Completed</span>
                  </div>
                </div>
                {d.weekly.every((w) => w.total === 0) ? (
                  <p className="py-10 text-center text-sm text-fg-muted">No activity recorded this week yet.</p>
                ) : (
                  <div className="h-60" role="img" aria-label={`Bar chart of tasks completed versus scheduled per day. ${d.weekly.map((w) => `${fmtDate(w.date)}: ${w.completed} of ${w.total} completed`).join('; ')}`}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={d.weekly.map((w) => ({ ...w, day: fmtDate(w.date) }))} barGap={4} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="rgb(var(--line))" />
                        <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'rgb(var(--fg-muted))' }} />
                        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'rgb(var(--fg-muted))' }} />
                        <Tooltip content={<ChartTip />} cursor={{ fill: 'rgb(var(--surface-2))' }} />
                        <Bar dataKey="total" name="Scheduled" fill="rgb(var(--line))" radius={[6, 6, 0, 0]} maxBarSize={28} isAnimationActive={!reduce} animationDuration={700} />
                        <Bar dataKey="completed" name="Completed" fill="rgb(var(--accent))" radius={[6, 6, 0, 0]} maxBarSize={28} isAnimationActive={!reduce} animationDuration={900} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <ul className="sr-only">{d.weekly.map((w) => <li key={w.date}>{fmtDate(w.date)}: {Math.round(w.productivity)}% productivity</li>)}</ul>
              </section>
            </div>
          )}
        </>
      )}
      <TaskModal open={create} onClose={() => setCreate(false)} />
      <TaskModal open={!!edit} task={edit} onClose={() => setEdit(null)} />
    </div>
  );
}
