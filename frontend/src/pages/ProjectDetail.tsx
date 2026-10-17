import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Plus, Trash2, Check, CalendarClock, ListChecks, Flame, Flag } from 'lucide-react';
import { api } from '../lib/api';
import type { Milestone, Project, Task } from '../lib/types';
import { fmtDate, localISO } from '../lib/dates';
import TaskCard from '../components/TaskCard';
import TaskModal from '../components/TaskModal';
import ConfirmDialog from '../components/ConfirmDialog';
import ErrorBanner from '../components/ErrorBanner';
import EmptyState from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { ProjectForm } from './Projects';
import { KanbanBoard } from './Kanban';
import { ProgressRing, STATUS_BADGE, projectStats } from '../features/projects/ui';

const ProjectAnalytics = lazy(() => import('../features/projects/Analytics'));
const asArr = (r: unknown): Task[] => Array.isArray(r) ? r as Task[] : ((r as { items?: Task[] })?.items ?? []);
const TABS = ['Overview', 'Milestones', 'Tasks', 'Board', 'Analytics'] as const;
type Tab = typeof TABS[number];
const msSchema = z.object({ title: z.string().trim().min(1, 'Title is required').max(200), due_date: z.string().optional() });
type MsVals = z.infer<typeof msSchema>;

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string | number; tone?: string }) {
  return (<div className="card p-4"><div className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 ${tone ?? 'text-accent'}`}>{icon}</div>
    <div className="text-section font-semibold tabular-nums">{value}</div><div className="text-xs text-fg-muted">{label}</div></div>);
}

export default function ProjectDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('Overview');
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [taskModal, setTaskModal] = useState<{ task?: Task | null } | null>(null);
  const [msEdit, setMsEdit] = useState<Milestone | null>(null);
  const [msDel, setMsDel] = useState<Milestone | null>(null);
  const msForm = useForm<MsVals>({ resolver: zodResolver(msSchema), defaultValues: { title: '', due_date: '' } });

  const p = useQuery({ queryKey: ['project', id], queryFn: () => api.get<Project>(`/api/projects/${id}`), refetchInterval: 30000 });
  const tasks = useQuery({ queryKey: ['project-tasks', id], queryFn: async () => asArr(await api.get('/api/tasks', { project_id: id, limit: 200 })), refetchInterval: 30000 });
  const err = (e: unknown) => toast(e instanceof Error ? e.message : 'Action failed', 'error');
  const ok = (m: string) => () => { qc.invalidateQueries(); toast(m); };
  const addMs = useMutation({ mutationFn: (v: MsVals) => api.post(`/api/projects/${id}/milestones`, { title: v.title.trim(), due_date: v.due_date || null }), onSuccess: () => { msForm.reset(); ok('Milestone added')(); }, onError: err });
  const updMs = useMutation({ mutationFn: (v: { id: number; b: Record<string, unknown> }) => api.patch(`/api/milestones/${v.id}`, v.b), onSuccess: () => { setMsEdit(null); ok('Milestone updated')(); }, onError: err });
  const delMs = useMutation({ mutationFn: (mid: number) => api.del(`/api/milestones/${mid}`), onSuccess: () => { setMsDel(null); ok('Milestone deleted')(); }, onError: err });
  const delProject = useMutation({ mutationFn: () => api.del(`/api/projects/${id}`), onSuccess: () => { qc.invalidateQueries(); toast('Project deleted'); nav('/projects'); }, onError: err });

  const taskList = tasks.data ?? [];
  const upcoming = useMemo(() => {
    const today = localISO();
    const fromTasks = taskList.filter((t) => t.due_date && t.status !== 'completed' && t.status !== 'cancelled').map((t) => ({ k: `t${t.id}`, title: t.title, date: t.due_date as string, kind: 'Task', late: t.effective_status === 'overdue' }));
    const fromMs = (p.data?.milestones ?? []).filter((m) => m.due_date && !m.done).map((m) => ({ k: `m${m.id}`, title: m.title, date: m.due_date as string, kind: 'Milestone', late: (m.due_date as string) < today }));
    return [...fromTasks, ...fromMs].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  }, [taskList, p.data]);

  if (p.isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-40 w-full rounded-2xl" /></div>;
  if (p.error || !p.data) return <div className="space-y-3"><Link to="/projects" className="btn-ghost"><ArrowLeft size={16} />Projects</Link><ErrorBanner error={p.error ?? new Error('Project not found')} onRetry={() => p.refetch()} /></div>;
  const proj = p.data;
  const s = projectStats(proj);
  const col = proj.color || '#6366f1';
  const badge = STATUS_BADGE[s.status];
  const milestones = [...(proj.milestones ?? [])].sort((a, b) => String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999')));
  const overdue = taskList.filter((t) => t.effective_status === 'overdue').length;

  return (
    <div className="space-y-5">
      <Link to="/projects" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-accent"><ArrowLeft size={14} />All projects</Link>
      <header className="card relative overflow-hidden p-5">
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: col }} />
        <div className="flex flex-wrap items-center gap-4">
          <ProgressRing pct={s.pct} size={72} stroke={6} color={col} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-page font-semibold">{proj.name}</h1><span className={`rounded-full px-2 py-0.5 text-caption font-medium ${badge.cls}`}>{badge.label}</span></div>
            {proj.description && <p className="mt-1 text-sm text-fg-muted">{proj.description}</p>}
          </div>
          <div className="flex flex-wrap gap-2"><button className="btn-ghost" onClick={() => setEditing(true)}><Pencil size={15} />Edit</button>
            <button className="btn-ghost" onClick={() => setConfirmDel(true)}><Trash2 size={15} />Delete</button>
            <button className="btn-primary" onClick={() => setTaskModal({})}><Plus size={15} />Add task</button></div>
        </div>
      </header>

      <div role="tablist" aria-label="Project sections" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <button key={t} role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} onClick={() => setTab(t)}
            onKeyDown={(e) => { const i = TABS.indexOf(t); if (e.key === 'ArrowRight') setTab(TABS[(i + 1) % TABS.length]); if (e.key === 'ArrowLeft') setTab(TABS[(i + TABS.length - 1) % TABS.length]); }}
            tabIndex={tab === t ? 0 : -1}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition ${tab === t ? 'border-accent text-accent' : 'border-transparent text-fg-muted hover:text-fg'}`}>{t}</button>))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'Overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat icon={<ListChecks size={16} />} label="Total tasks" value={s.total} />
              <Stat icon={<Check size={16} />} label="Completed" value={s.done} tone="text-success" />
              <Stat icon={<Flame size={16} />} label="In progress" value={s.active} tone="text-warning" />
              <Stat icon={<Flag size={16} />} label="Overdue" value={overdue} tone="text-danger" />
            </div>
            <section className="card p-5" aria-label="Progress"><div className="mb-2 flex justify-between text-sm"><span className="font-medium">Overall progress</span><span className="tabular-nums text-fg-muted">{s.pct}%</span></div>
              <div className="h-2.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${s.pct}%`, background: col }} /></div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">{Object.entries(s.counts).map(([k, v]) => <span key={k}>{k.replace(/_/g, ' ')}: {String(v)}</span>)}</div></section>
            <section className="card p-5" aria-label="Upcoming deadlines"><h2 className="mb-3 text-section font-semibold">Upcoming deadlines</h2>
              {upcoming.length === 0 ? <p className="text-sm text-fg-muted">No upcoming deadlines.</p> :
                <ul className="divide-y divide-line">{upcoming.map((u) => (
                  <li key={u.k} className="flex items-center gap-3 py-2 text-sm"><CalendarClock size={15} className={u.late ? 'text-danger' : 'text-fg-muted'} />
                    <span className="min-w-0 flex-1 truncate">{u.title}</span><span className="chip">{u.kind}</span>
                    <span className={`text-xs tabular-nums ${u.late ? 'text-danger' : 'text-fg-muted'}`}>{fmtDate(u.date)}</span></li>))}</ul>}</section>
          </div>)}

        {tab === 'Milestones' && (
          <section className="card p-5">
            <form onSubmit={msForm.handleSubmit((v) => addMs.mutate(v))} noValidate className="mb-5 flex flex-wrap items-start gap-2">
              <div className="min-w-[12rem] flex-1 sm:max-w-xs"><input className="input" placeholder="New milestone" aria-label="Milestone title" aria-invalid={!!msForm.formState.errors.title} {...msForm.register('title')} />
                {msForm.formState.errors.title && <p className="mt-1 text-xs text-danger">{msForm.formState.errors.title.message}</p>}</div>
              <input type="date" className="input max-w-[11rem]" aria-label="Milestone due date" {...msForm.register('due_date')} />
              <button className="btn-primary" disabled={addMs.isPending}><Plus size={15} />Add</button>
            </form>
            {milestones.length === 0 ? <EmptyState title="No milestones yet" hint="Break the project into key checkpoints." /> :
              <ol className="relative ml-3 space-y-5 border-l-2 border-line">{milestones.map((m) => (
                <li key={m.id} className="relative pl-6">
                  <button aria-label={m.done ? 'Mark milestone not done' : 'Mark milestone done'} onClick={() => updMs.mutate({ id: m.id, b: { done: !m.done } })}
                    className={`absolute -left-[13px] top-0 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-surface transition ${m.done ? 'border-success bg-success text-white' : 'border-line text-transparent hover:border-success hover:text-success'}`}><Check size={13} /></button>
                  {msEdit?.id === m.id ? (
                    <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!msEdit.title.trim()) return; updMs.mutate({ id: m.id, b: { title: msEdit.title.trim(), due_date: msEdit.due_date || null } }); }}>
                      <input className="input max-w-xs" aria-label="Title" value={msEdit.title} onChange={(e) => setMsEdit({ ...msEdit, title: e.target.value })} />
                      <input type="date" className="input max-w-[11rem]" aria-label="Due date" value={msEdit.due_date ?? ''} onChange={(e) => setMsEdit({ ...msEdit, due_date: e.target.value })} />
                      <button className="btn-primary">Save</button><button type="button" className="btn-ghost" onClick={() => setMsEdit(null)}>Cancel</button></form>
                  ) : (
                    <div className="flex items-start gap-2"><div className="min-w-0 flex-1">
                      <div className={`font-medium ${m.done ? 'text-fg-muted line-through' : ''}`}>{m.title}</div>
                      {m.due_date && <div className={`text-xs ${!m.done && m.due_date < localISO() ? 'text-danger' : 'text-fg-muted'}`}>{fmtDate(m.due_date)}</div>}</div>
                      <button className="icon-btn" aria-label="Edit milestone" onClick={() => setMsEdit(m)}><Pencil size={15} /></button>
                      <button className="icon-btn" aria-label="Delete milestone" onClick={() => setMsDel(m)}><Trash2 size={15} /></button></div>)}
                </li>))}</ol>}
          </section>)}

        {tab === 'Tasks' && (<section>
          {tasks.error && <ErrorBanner error={tasks.error} onRetry={() => tasks.refetch()} />}
          {tasks.isLoading ? <Skeleton className="h-24 w-full" /> : taskList.length === 0 ? <EmptyState title="No tasks in this project" action={<button className="btn-primary" onClick={() => setTaskModal({})}>Add task</button>} />
            : <div className="space-y-2">{taskList.map((t) => <TaskCard key={t.id} task={t} onEdit={(x) => setTaskModal({ task: x })} />)}</div>}
        </section>)}

        {tab === 'Board' && <KanbanBoard projectId={id} compact />}

        {tab === 'Analytics' && (tasks.isLoading ? <Skeleton className="h-64 w-full rounded-2xl" /> : <Suspense fallback={<Skeleton className="h-64 w-full rounded-2xl" />}><ProjectAnalytics tasks={taskList} /></Suspense>)}
      </div>

      {editing && <ProjectForm project={proj} onClose={() => setEditing(false)} />}
      {taskModal && <TaskModal open onClose={() => setTaskModal(null)} task={taskModal.task ?? null} defaults={{ project_id: proj.id }} onSaved={() => qc.invalidateQueries()} />}
      <ConfirmDialog open={confirmDel} title="Delete project" message={`Delete "${proj.name}"?`} busy={delProject.isPending} onConfirm={() => delProject.mutate()} onCancel={() => setConfirmDel(false)} />
      <ConfirmDialog open={!!msDel} title="Delete milestone" message={`Delete "${msDel?.title}"?`} busy={delMs.isPending} onConfirm={() => msDel && delMs.mutate(msDel.id)} onCancel={() => setMsDel(null)} />
    </div>
  );
}
