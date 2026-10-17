import { useEffect, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { Plus, Search, ChevronLeft, ChevronRight, X, Check, Pencil, Copy, Trash2, SunMedium, CalendarClock, Rows3, Rows2, SlidersHorizontal, ArrowUpDown } from 'lucide-react';
import { api, type TaskQuery } from '../lib/api';
import { PRIORITIES, STATUSES, type Project, type Task } from '../lib/types';
import { fmtDate, fmtTime, localISO, addDays } from '../lib/dates';
import { useTaskActions } from '../lib/useTaskActions';
import TaskCard from '../components/TaskCard';
import TaskModal from '../components/TaskModal';
import ErrorBanner from '../components/ErrorBanner';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import Modal from '../components/Modal';
import { Skeleton } from '../components/Skeleton';

const PAGE = 15;
const cap = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const PRI_CLS: Record<string, string> = { critical: 'bg-danger/10 text-danger', high: 'bg-warning/15 text-warning', medium: 'bg-accent-soft text-accent', low: 'bg-surface-2 text-fg-muted' };
const STAT_CLS: Record<string, string> = { completed: 'bg-success/10 text-success', overdue: 'bg-danger/10 text-danger', in_progress: 'bg-accent-soft text-accent', on_hold: 'bg-warning/15 text-warning', cancelled: 'bg-surface-2 text-fg-muted', not_started: 'bg-surface-2 text-fg-muted' };

export function TaskRow({ task, onEdit, compact }: { task: Task; onEdit: (t: Task) => void; compact?: boolean }) {
  const a = useTaskActions();
  const [confirm, setConfirm] = useState(false);
  const [resched, setResched] = useState(false);
  const [date, setDate] = useState(addDays(localISO(), 1));
  const closed = task.status === 'completed' || task.status === 'cancelled';
  const overdue = task.effective_status === 'overdue';
  const time = task.start_time ? `${fmtTime(task.start_time)}${task.end_time ? '-' + fmtTime(task.end_time) : ''}` : '';
  return (
    <div className={`group grid grid-cols-[auto_1fr_5.5rem_6.5rem_5rem_9.5rem] items-center gap-3 border-b border-line px-4 transition-colors last:border-0 hover:bg-surface-2/60 ${compact ? 'py-1.5' : 'py-3'}`}>
      <button type="button" disabled={closed || a.complete.isPending} onClick={() => a.complete.mutate(task)} aria-label={closed ? 'Completed' : `Mark "${task.title}" complete`}
        className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition ${task.status === 'completed' ? 'border-success bg-success text-white' : 'border-line text-transparent hover:border-success hover:text-success'}`}><Check size={12} /></button>
      <button type="button" onClick={() => onEdit(task)} className="min-w-0 text-left">
        <span className={`block truncate text-sm font-medium ${closed ? 'text-fg-muted line-through' : ''}`}>{task.title}</span>
        {!compact && (task.project_name || task.tags.length > 0 || time) && (
          <span className="mt-0.5 flex items-center gap-2 text-caption text-fg-muted">
            {task.project_name && <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: task.project_color || 'currentColor' }} />{task.project_name}</span>}
            {time && <span>{time}</span>}
            {task.tags.slice(0, 3).map((t) => <span key={t}>#{t}</span>)}
          </span>
        )}
      </button>
      <span className={`chip ${PRI_CLS[task.priority]}`}>{cap(task.priority)}</span>
      <span className={`chip ${STAT_CLS[task.effective_status] || ''}`}>{cap(task.effective_status)}</span>
      <span className={`text-sm tabular-nums ${overdue ? 'font-medium text-danger' : 'text-fg-muted'}`}>{task.due_date ? fmtDate(task.due_date) : '-'}</span>
      <div className="flex w-[9.5rem] items-center justify-end opacity-70 transition group-hover:opacity-100 focus-within:opacity-100">
        {!closed && <button className="icon-btn" title="Reschedule" aria-label={`Reschedule ${task.title}`} onClick={() => setResched(true)}><CalendarClock size={15} /></button>}
        {!closed && <button className="icon-btn" title="Add to today" aria-label={`Add ${task.title} to today`} disabled={a.addToToday.isPending} onClick={() => a.addToToday.mutate(task)}><SunMedium size={15} /></button>}
        <button className="icon-btn" title="Edit" aria-label={`Edit ${task.title}`} onClick={() => onEdit(task)}><Pencil size={15} /></button>
        <button className="icon-btn" title="Duplicate" aria-label={`Duplicate ${task.title}`} disabled={a.duplicate.isPending} onClick={() => a.duplicate.mutate(task)}><Copy size={15} /></button>
        <button className="icon-btn hover:!text-danger" title="Delete" aria-label={`Delete ${task.title}`} onClick={() => setConfirm(true)}><Trash2 size={15} /></button>
      </div>
      <ConfirmDialog open={confirm} title="Delete task" message={`Delete "${task.title}"? This cannot be undone.`} busy={a.remove.isPending}
        onCancel={() => setConfirm(false)} onConfirm={() => a.remove.mutate(task, { onSuccess: () => setConfirm(false) })} />
      <Modal open={resched} onClose={() => setResched(false)} title="Reschedule task"
        footer={<><button className="btn-ghost" onClick={() => setResched(false)}>Cancel</button>
          <button className="btn-primary" disabled={!date || a.rescheduleBoth.isPending}
            onClick={() => a.rescheduleBoth.mutate({ id: task.id, start_date: date, due_date: task.due_date && task.due_date < date ? date : undefined }, { onSuccess: () => setResched(false) })}>Reschedule</button></>}>
        <label className="label" htmlFor={`rs-${task.id}`}>New date for "{task.title}"</label>
        <input id={`rs-${task.id}`} type="date" className="input" value={date} min={localISO()} onChange={(e) => setDate(e.target.value)} />
      </Modal>
    </div>
  );
}

const SORTS: { v: string; label: string }[] = [
  { v: 'due_date:asc', label: 'Due date (soonest)' }, { v: 'due_date:desc', label: 'Due date (latest)' },
  { v: 'priority:asc', label: 'Priority' }, { v: 'created_at:desc', label: 'Newest first' },
  { v: 'created_at:asc', label: 'Oldest first' }, { v: 'title:asc', label: 'Title A-Z' },
];

export default function Tasks() {
  const reduce = useReducedMotion();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [project, setProject] = useState('');
  const [category, setCategory] = useState('');
  const [debCat, setDebCat] = useState('');
  const [sortKey, setSortKey] = useState('due_date:asc');
  const [compact, setCompact] = useState(() => { try { return localStorage.getItem('tf_density') === 'compact'; } catch { return false; } });
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<Task | null>(null);
  const [create, setCreate] = useState(false);

  useEffect(() => { const t = setTimeout(() => { setDebounced(search.trim()); setPage(0); }, 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { const t = setTimeout(() => { setDebCat(category.trim()); setPage(0); }, 300); return () => clearTimeout(t); }, [category]);
  useEffect(() => { try { localStorage.setItem('tf_density', compact ? 'compact' : 'list'); } catch { /* ignore */ } }, [compact]);

  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[] | { items: Project[] }>('/api/projects') });
  const plist = Array.isArray(projects.data) ? projects.data : projects.data?.items ?? [];

  const [sort, order] = sortKey.split(':') as [NonNullable<TaskQuery['sort']>, 'asc' | 'desc'];
  const query: TaskQuery = { search: debounced, status, priority, project_id: project, category: debCat, sort, order, limit: PAGE, offset: page * PAGE };
  const q = useQuery({ queryKey: ['tasks', query], queryFn: () => api.listTasks(query), placeholderData: keepPreviousData });
  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const hasNext = page + 1 < pages;
  const activeFilters = [status, priority, project, category].filter(Boolean).length + (debounced ? 1 : 0);
  const filtered = activeFilters > 0;
  const reset = () => { setSearch(''); setStatus(''); setPriority(''); setProject(''); setCategory(''); setPage(0); };
  const sel = (set: (v: string) => void) => (e: { target: { value: string } }) => { set(e.target.value); setPage(0); };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-page">Tasks</h1>
          <p className="text-sm text-fg-muted">{q.data ? `${total} ${total === 1 ? 'task' : 'tasks'}${filtered ? ' match your filters' : ''}` : 'Everything you are working on'}</p>
        </div>
        <button className="btn-primary" onClick={() => setCreate(true)}><Plus size={16} />New task</button>
      </div>

      <div className="card space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" aria-hidden />
            <input id="f-search" aria-label="Search tasks" className="input !pl-9 !pr-8" value={search} placeholder="Search tasks" onChange={(e) => setSearch(e.target.value)} />
            {search && <button className="icon-btn absolute right-1 top-1/2 !h-6 !w-6 -translate-y-1/2" aria-label="Clear search" onClick={() => setSearch('')}><X size={13} /></button>}
          </div>
          <div className="relative">
            <ArrowUpDown size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" aria-hidden />
            <select id="f-sort" aria-label="Sort" className="input !w-auto !pl-8" value={sortKey} onChange={(e) => { setSortKey(e.target.value); setPage(0); }}>
              {SORTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
          </div>
          <button className={`btn-ghost ${showFilters || activeFilters - (debounced ? 1 : 0) > 0 ? '!border-accent !text-accent' : ''}`} aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)}>
            <SlidersHorizontal size={15} />Filters{activeFilters - (debounced ? 1 : 0) > 0 && <span className="chip !bg-accent !text-white">{activeFilters - (debounced ? 1 : 0)}</span>}
          </button>
          <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Density">
            <button className={`icon-btn ${!compact ? '!bg-surface-2 !text-fg' : ''}`} aria-pressed={!compact} aria-label="Comfortable list" title="Comfortable" onClick={() => setCompact(false)}><Rows2 size={15} /></button>
            <button className={`icon-btn ${compact ? '!bg-surface-2 !text-fg' : ''}`} aria-pressed={compact} aria-label="Compact list" title="Compact" onClick={() => setCompact(true)}><Rows3 size={15} /></button>
          </div>
        </div>
        {showFilters && (
          <motion.div initial={reduce ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 gap-3 border-t border-line pt-3 md:grid-cols-5">
            <div><label className="label" htmlFor="f-status">Status</label>
              <select id="f-status" className="input" value={status} onChange={sel(setStatus)}><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select></div>
            <div><label className="label" htmlFor="f-pri">Priority</label>
              <select id="f-pri" className="input" value={priority} onChange={sel(setPriority)}><option value="">All</option>{PRIORITIES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select></div>
            <div><label className="label" htmlFor="f-proj">Project</label>
              <select id="f-proj" className="input" value={project} onChange={sel(setProject)}><option value="">All</option>{plist.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label className="label" htmlFor="f-cat">Category</label><input id="f-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Any" /></div>
            <div className="flex items-end"><button className="btn-ghost w-full" disabled={!filtered} onClick={reset}>Clear all</button></div>
          </motion.div>
        )}
      </div>

      {q.isError && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}

      {q.isLoading ? (
        <div className="space-y-2" role="status" aria-label="Loading tasks">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
      ) : items.length === 0 && !q.isError ? (
        filtered ? (
          <EmptyState title="No results" hint="No tasks match your search or filters. Try broadening them." action={<button className="btn-ghost" onClick={reset}>Clear filters</button>} />
        ) : (
          <EmptyState title="No tasks yet" hint="Capture your first task to get started." action={<button className="btn-primary" onClick={() => setCreate(true)}><Plus size={16} />New task</button>} />
        )
      ) : items.length > 0 && (
        <div aria-busy={q.isFetching} className={q.isFetching && q.isPlaceholderData ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
          <div className="space-y-2 md:hidden">{items.map((t) => <TaskCard key={t.id} task={t} onEdit={setEdit} compact={compact} />)}</div>
          <div className="card hidden overflow-hidden md:block">
            <div className="grid grid-cols-[auto_1fr_5.5rem_6.5rem_5rem_9.5rem] gap-3 border-b border-line bg-surface-2/50 px-4 py-2 text-caption font-medium uppercase tracking-wide text-fg-muted" aria-hidden>
              <span className="w-5" /><span>Task</span><span className="w-16">Priority</span><span className="w-24">Status</span><span>Due</span><span className="w-[150px] text-right">Actions</span>
            </div>
            {items.map((t) => <TaskRow key={t.id} task={t} onEdit={setEdit} compact={compact} />)}
          </div>
        </div>
      )}

      {(page > 0 || hasNext) && (
        <nav className="flex items-center justify-between" aria-label="Pagination">
          <button className="btn-ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={16} />Previous</button>
          <span className="text-sm text-fg-muted">Page {page + 1} of {pages}</span>
          <button className="btn-ghost" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>Next<ChevronRight size={16} /></button>
        </nav>
      )}
      <TaskModal open={create} onClose={() => setCreate(false)} />
      <TaskModal open={!!edit} task={edit} onClose={() => setEdit(null)} />
    </div>
  );
}
