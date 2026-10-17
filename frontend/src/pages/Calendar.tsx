import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, Flag, CalendarDays, SlidersHorizontal } from 'lucide-react';
import { api } from '../lib/api';
import type { Task } from '../lib/types';
import { addDays, localISO, fmtDate, fmtTime } from '../lib/dates';
import TaskModal from '../components/TaskModal';
import ErrorBanner from '../components/ErrorBanner';
import EmptyState from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { View, parse, diffDays, sched, isDone, asArr, days, range, pcol, toMin, PVAR } from '../features/calendar/utils';
import { Popover, TaskChip, TaskDetail, rectOf, type Anchor } from '../features/calendar/parts';

const HOUR_H = 48, H0 = 6, H1 = 23;
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function useSmall() {
  const [s, setS] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => { const m = window.matchMedia('(max-width: 767px)'); const f = () => setS(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return s;
}

type Pop = { kind: 'task'; t: Task; a: Anchor } | { kind: 'more'; date: string; a: Anchor } | null;

export default function Calendar() {
  const today = localISO();
  const small = useSmall();
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(today);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [modal, setModal] = useState<{ task?: Task | null; defaults?: { start_date: string; due_date: string; start_time?: string } } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [pop, setPop] = useState<Pop>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const [start, end] = range(view, anchor);

  const q = useQuery({ queryKey: ['calendar', start, end], queryFn: async () => asArr(await api.get('/api/calendar', { start, end })), refetchInterval: 30000 });
  const up = useQuery({ queryKey: ['calendar-upcoming', today], queryFn: async () => asArr(await api.get('/api/calendar', { start: today, end: addDays(today, 7) })), refetchInterval: 30000 });
  const complete = useMutation({
    mutationFn: (id: number) => api.completeTask(id),
    onSuccess: () => { qc.invalidateQueries(); toast('Task completed'); setPop(null); },
    onError: (e) => toast(e instanceof Error ? e.message : 'Action failed', 'error'),
  });

  const tasks = useMemo(() => (q.data ?? []).filter((t) => { const d = sched(t); return (!from || d >= from) && (!to || d <= to); }), [q.data, from, to]);
  const byDate = useMemo(() => {
    const m: Record<string, Task[]> = {};
    tasks.forEach((t) => {
      const ds = new Set([t.start_date, t.due_date, t.queued_date].filter(Boolean) as string[]);
      const primary = sched(t);
      ds.forEach((d) => { if (d === primary || d === t.queued_date || d === t.due_date) (m[d] ||= []).push(t); });
    });
    return m;
  }, [tasks]);

  const move = (n: number) => {
    const d = parse(anchor);
    if (view === 'day') setAnchor(addDays(anchor, n));
    else if (view === 'week') setAnchor(addDays(anchor, 7 * n));
    else if (view === 'month') setAnchor(localISO(new Date(d.getFullYear(), d.getMonth() + n, 1)));
    else setAnchor(localISO(new Date(d.getFullYear() + n, 0, 1)));
  };
  const title = view === 'day' ? parse(anchor).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : view === 'week' ? `${fmtDate(start)} - ${fmtDate(end)}, ${parse(end).getFullYear()}`
    : view === 'month' ? parse(anchor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : String(parse(anchor).getFullYear());

  const onDrop = async (e: React.DragEvent, date: string) => {
    e.preventDefault(); setDragOver(null); setDragId(null);
    const id = Number(e.dataTransfer.getData('text/task-id'));
    const t = (q.data ?? []).find((x) => x.id === id);
    if (!t) return;
    const cur = sched(t); if (!cur || cur === date) return;
    const delta = diffDays(cur, date);
    const body: { start_date?: string; due_date?: string } = {};
    if (t.start_date) body.start_date = addDays(t.start_date, delta);
    if (t.due_date) body.due_date = addDays(t.due_date, delta);
    try { await api.rescheduleTask(id, body); toast(`Rescheduled to ${fmtDate(date)}`); qc.invalidateQueries(); }
    catch (err) { toast(err instanceof Error ? err.message : 'Reschedule failed', 'error'); }
  };
  const dropProps = (date: string) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(date); },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver((d) => (d === date ? null : d)); },
    onDrop: (e: React.DragEvent) => onDrop(e, date),
  });
  const openTask = useCallback((t: Task, el: Element) => setPop({ kind: 'task', t, a: rectOf(el) }), []);
  const newOn = (date: string, start_time?: string) => setModal({ defaults: { start_date: date, due_date: date, ...(start_time ? { start_time } : {}) } });
  const chip = (t: Task, date: string, compact = false) => (
    <TaskChip key={t.id + date} t={t} date={date} compact={compact} dragging={dragId === t.id} onOpen={openTask} onDragStart={(x) => setDragId(x.id)} onDragEnd={() => { setDragId(null); setDragOver(null); }} />
  );
  const dropCls = (date: string) => (dragOver === date ? 'bg-accent-soft ring-2 ring-inset ring-accent' : '');

  const dayNum = (date: string, label?: string) => (
    <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-caption font-medium ${date === today ? 'bg-accent text-white' : 'text-fg-muted'}`}>{label ?? parse(date).getDate()}</span>
  );

  /* ---------- Month ---------- */
  const monthView = () => {
    const m = parse(anchor).getMonth();
    return (
      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line bg-surface-2/50 text-center text-caption font-medium text-fg-muted">{WD.map((d) => <div key={d} className="py-2">{d}</div>)}</div>
        <div className="grid grid-cols-7">
          {days(start, end).map((date) => {
            const list = byDate[date] ?? []; const dim = parse(date).getMonth() !== m;
            return (
              <div key={date} onClick={() => newOn(date)} {...dropProps(date)} role="gridcell" aria-label={`${fmtDate(date)}, ${list.length} tasks`}
                className={`min-h-[104px] cursor-pointer border-b border-r border-line p-1.5 transition-colors hover:bg-surface-2/60 ${dim ? 'bg-surface-2/40 opacity-60' : ''} ${dropCls(date)}`}>
                <div className="mb-1 flex items-center justify-between">{dayNum(date)}{list.some((t) => t.due_date === date && !isDone(t)) && <Flag size={10} className="text-danger" aria-label="Has deadlines" />}</div>
                <div className="space-y-1">
                  {list.slice(0, 3).map((t) => chip(t, date, true))}
                  {list.length > 3 && <button className="text-caption font-medium text-accent hover:underline" onClick={(e) => { e.stopPropagation(); setPop({ kind: 'more', date, a: rectOf(e.currentTarget) }); }}>+{list.length - 3} more</button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /* ---------- Time grid (day/week) ---------- */
  const timeGrid = (ds: string[]) => {
    const hours = Array.from({ length: H1 - H0 }, (_, i) => H0 + i);
    const cols = `56px repeat(${ds.length}, minmax(${ds.length > 1 ? 88 : 0}px, 1fr))`;
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    return (
      <div className="card overflow-x-auto">
        <div style={{ minWidth: ds.length > 1 ? 56 + ds.length * 88 : 0 }}>
          <div className="sticky top-0 z-10 grid border-b border-line bg-surface" style={{ gridTemplateColumns: cols }}>
            <div />
            {ds.map((d) => (
              <div key={d} className="border-l border-line py-2 text-center">
                <div className="text-caption text-fg-muted">{parse(d).toLocaleDateString(undefined, { weekday: 'short' })}</div>
                {dayNum(d)}
              </div>
            ))}
          </div>
          {/* all-day row */}
          <div className="grid border-b border-line" style={{ gridTemplateColumns: cols }}>
            <div className="p-1 text-right text-[10px] uppercase tracking-wide text-fg-muted">All day</div>
            {ds.map((d) => {
              const l = (byDate[d] ?? []).filter((t) => !(t.start_time && t.start_date === d));
              return <div key={d} {...dropProps(d)} onClick={() => newOn(d)} className={`min-h-[36px] cursor-pointer space-y-1 border-l border-line p-1 ${dropCls(d)}`}>{l.map((t) => chip(t, d, true))}</div>;
            })}
          </div>
          <div className="relative grid" style={{ gridTemplateColumns: cols }}>
            <div>{hours.map((h) => <div key={h} style={{ height: HOUR_H }} className="pr-2 text-right text-[10px] text-fg-muted"><span className="relative -top-1.5">{String(h).padStart(2, '0')}:00</span></div>)}</div>
            {ds.map((d) => {
              const timed = (byDate[d] ?? []).filter((t) => t.start_time && t.start_date === d).sort((a, b) => a.start_time!.localeCompare(b.start_time!));
              // greedy overlap columns
              const ends: number[] = []; const placed = timed.map((t) => {
                const s = toMin(t.start_time!); const e = Math.max(s + 30, t.end_time ? toMin(t.end_time) : s + 60);
                let c = ends.findIndex((x) => x <= s); if (c < 0) { c = ends.length; ends.push(e); } else ends[c] = e;
                return { t, s, e, c };
              });
              const nc = Math.max(1, ends.length);
              return (
                <div key={d} {...dropProps(d)} className={`relative border-l border-line ${dropCls(d)}`}>
                  {hours.map((h) => (
                    <div key={h} style={{ height: HOUR_H }} role="button" tabIndex={-1} aria-label={`New task ${fmtDate(d)} ${h}:00`}
                      onClick={() => newOn(d, `${String(h).padStart(2, '0')}:00`)} className="group cursor-pointer border-b border-line/60 hover:bg-accent-soft/50">
                      <Plus size={12} className="m-1 text-accent opacity-0 group-hover:opacity-70" aria-hidden />
                    </div>
                  ))}
                  {d === today && nowMin >= H0 * 60 && nowMin < H1 * 60 && (
                    <div className="pointer-events-none absolute left-0 right-0 z-10 flex items-center" style={{ top: ((nowMin - H0 * 60) / 60) * HOUR_H }} aria-label="Current time">
                      <span className="-ml-1 h-2 w-2 rounded-full bg-danger" /><span className="h-px flex-1 bg-danger" />
                    </div>
                  )}
                  {placed.filter((p) => p.s < H1 * 60 && p.e > H0 * 60).map(({ t, s, e, c }) => (
                    <div key={t.id} className="absolute z-[5] px-0.5" style={{ top: Math.max(0, ((s - H0 * 60) / 60) * HOUR_H), height: Math.max(22, ((e - s) / 60) * HOUR_H - 2), left: `${(c / nc) * 100}%`, width: `${100 / nc}%` }}>
                      <div className="h-full [&>button]:h-full [&>button]:items-start [&>button]:whitespace-normal [&>button]:py-1">{chip(t, d)}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  /* ---------- Agenda (mobile) ---------- */
  const agenda = (ds: string[]) => {
    const withTasks = ds.filter((d) => (byDate[d] ?? []).length);
    if (!withTasks.length) return <div className="card p-4"><EmptyState title="Nothing scheduled" hint="Add a task for this period." action={<button className="btn-primary" onClick={() => newOn(view === 'day' ? anchor : today)}><Plus size={16} />New task</button>} /></div>;
    return (
      <div className="space-y-3">{withTasks.map((d) => (
        <section key={d} {...dropProps(d)} className={`card p-3 ${dropCls(d)}`} aria-label={fmtDate(d)}>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">{dayNum(d)}<span className={d === today ? 'text-accent' : ''}>{parse(d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span></h3>
          <div className="space-y-1.5">{[...byDate[d]].sort((a, b) => (a.start_time || '99').localeCompare(b.start_time || '99')).map((t) => chip(t, d))}</div>
        </section>))}
      </div>
    );
  };

  /* ---------- Year heatmap ---------- */
  const yearView = () => {
    const y = parse(anchor).getFullYear();
    const max = Math.max(1, ...Object.values(byDate).map((l) => l.length));
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 12 }, (_, i) => {
          const first = new Date(y, i, 1); const n = new Date(y, i + 1, 0).getDate(); const lead = (first.getDay() + 6) % 7;
          return (
            <div key={i} className="card p-3">
              <button className="mb-2 text-sm font-semibold hover:text-accent" onClick={() => { setAnchor(localISO(first)); setView('month'); }}>{first.toLocaleDateString(undefined, { month: 'long' })}</button>
              <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
                {WD.map((w) => <div key={w} className="text-[10px] text-fg-muted">{w[0]}</div>)}
                {Array.from({ length: lead }, (_, k) => <div key={'b' + k} />)}
                {Array.from({ length: n }, (_, k) => {
                  const d = localISO(new Date(y, i, k + 1)); const c = byDate[d]?.length ?? 0; const a = c ? 0.18 + 0.82 * (c / max) : 0;
                  return <button key={d} onClick={() => { setAnchor(d); setView('day'); }} aria-label={`${fmtDate(d)}: ${c} tasks`} title={`${fmtDate(d)}: ${c} task${c === 1 ? '' : 's'}`}
                    style={c ? { background: `rgb(var(--accent) / ${a})`, color: a > .55 ? '#fff' : undefined } : undefined}
                    className={`aspect-square rounded-md transition hover:scale-110 ${d === today ? 'ring-2 ring-accent' : ''} ${c ? '' : 'bg-surface-2/70 text-fg-muted'}`}>{k + 1}</button>;
                })}
              </div>
            </div>);
        })}</div>
        <div className="flex items-center justify-end gap-1.5 text-caption text-fg-muted">Less{[0, .25, .5, .75, 1].map((v) => <span key={v} className="h-3 w-3 rounded" style={{ background: v ? `rgb(var(--accent) / ${.18 + .82 * v})` : 'rgb(var(--surface-2))' }} />)}More</div>
      </div>
    );
  };

  let body;
  if (q.isLoading) body = <Skeleton className="h-[480px] w-full rounded-2xl" />;
  else if (view === 'year') body = yearView();
  else if (small) body = agenda(days(...(view === 'month' ? [start, end] : [start, end]) as [string, string]).filter((d) => view !== 'month' || parse(d).getMonth() === parse(anchor).getMonth()));
  else if (view === 'month') body = monthView();
  else body = timeGrid(view === 'week' ? days(start, end) : [anchor]);

  const upcoming = (up.data ?? []).filter((t) => !isDone(t)).sort((a, b) => (t2d(a)).localeCompare(t2d(b))).slice(0, 12);
  function t2d(t: Task) { return t.due_date || sched(t); }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-page">Calendar</h1>
        <button className="btn-primary" onClick={() => newOn(view === 'day' ? anchor : today)}><Plus size={16} />New task</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button className="icon-btn border border-line" aria-label="Previous" onClick={() => move(-1)}><ChevronLeft size={18} /></button>
          <button className="icon-btn border border-line" aria-label="Next" onClick={() => move(1)}><ChevronRight size={18} /></button>
          <button className="btn-ghost !py-1.5" onClick={() => setAnchor(today)}>Today</button>
        </div>
        <h2 className="mx-1 min-w-0 flex-1 truncate text-section sm:flex-none" aria-live="polite">{title}</h2>
        <div className="ml-auto flex items-center gap-2">
          <button className={`icon-btn border border-line ${(from || to) ? '!text-accent' : ''}`} aria-label="Date filter" aria-expanded={showFilter} onClick={() => setShowFilter((s) => !s)}><SlidersHorizontal size={16} /></button>
          <div className="relative inline-flex rounded-lg bg-surface-2 p-0.5" role="tablist" aria-label="Calendar view">
            {(['day', 'week', 'month', 'year'] as View[]).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
                className={`rounded-md px-2.5 py-1 text-sm capitalize transition ${view === v ? 'bg-surface font-medium text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}>{v}</button>
            ))}
          </div>
        </div>
      </div>
      {(showFilter || from || to) && (
        <div className="card flex flex-wrap items-end gap-3 p-3">
          <div><label className="label" htmlFor="cf">Filter from</label><input id="cf" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="label" htmlFor="ct">Filter to</label><input id="ct" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          {(from || to) && <button className="btn-ghost" onClick={() => { setFrom(''); setTo(''); }}>Clear filter</button>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 text-caption text-fg-muted">
        {Object.keys(PVAR).map((p) => <span key={p} className="inline-flex items-center gap-1.5 capitalize"><span className="h-2.5 w-2.5 rounded-full" style={{ background: pcol(p) }} />{p}</span>)}
        <span className="inline-flex items-center gap-1"><Flag size={10} className="text-danger" />deadline</span>
        <span className="ml-auto hidden sm:inline">Drag a task to another day to reschedule. Click an empty slot to create.</span>
      </div>
      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0">{body}</div>
        <aside className="card h-fit p-4" aria-label="Upcoming deadlines">
          <h3 className="mb-3 flex items-center gap-2 text-section"><CalendarDays size={16} className="text-accent" />Upcoming deadlines</h3>
          {up.isLoading ? <Skeleton className="h-24 w-full" /> : up.error ? <ErrorBanner error={up.error} onRetry={() => up.refetch()} /> :
            upcoming.length === 0 ? <p className="text-sm text-fg-muted">Nothing due in the next 7 days.</p> :
              <ul className="space-y-1">{upcoming.map((t) => (
                <li key={t.id}><button className="flex w-full items-start gap-2 rounded-lg p-2 text-left text-sm hover:bg-surface-2" onClick={(e) => openTask(t, e.currentTarget)}>
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: pcol(t.priority) }} />
                  <span className="min-w-0"><span className="block truncate font-medium">{t.title}</span>
                    <span className="text-caption text-fg-muted">{t.due_date ? `Due ${fmtDate(t.due_date)}` : fmtDate(sched(t))}{t.start_time ? ` - ${fmtTime(t.start_time)}` : ''}</span></span></button></li>))}</ul>}
        </aside>
      </div>

      {pop?.kind === 'task' && (
        <Popover anchor={pop.a} onClose={() => setPop(null)} label="Task details">
          <TaskDetail t={pop.t} busy={complete.isPending} onClose={() => setPop(null)} onComplete={() => complete.mutate(pop.t.id)} onEdit={() => { setModal({ task: pop.t }); setPop(null); }} />
        </Popover>
      )}
      {pop?.kind === 'more' && (
        <Popover anchor={pop.a} onClose={() => setPop(null)} label={`Tasks on ${fmtDate(pop.date)}`}>
          <p className="mb-2 text-sm font-semibold">{parse(pop.date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</p>
          <div className="space-y-1">{(byDate[pop.date] ?? []).map((t) => (
            <div key={t.id} onClick={(e) => { e.stopPropagation(); setPop({ kind: 'task', t, a: rectOf(e.currentTarget) }); }}>{chip(t, pop.date)}</div>))}</div>
          <button className="btn-ghost mt-2 w-full !py-1.5" onClick={() => { newOn(pop.date); setPop(null); }}><Plus size={14} />Add task</button>
        </Popover>
      )}
      {modal && <TaskModal open onClose={() => setModal(null)} task={modal.task ?? null} defaults={modal.defaults} onSaved={() => qc.invalidateQueries()} />}
    </div>
  );
}
