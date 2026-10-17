import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, CalendarClock, Check, Pencil, GripVertical } from 'lucide-react';
import { api } from '../lib/api';
import { BOARD_COLUMNS, type BoardColumn, type Project, type Task } from '../lib/types';
import { fmtDate } from '../lib/dates';
import { label, PRIORITY_STYLE } from '../components/TaskCard';
import TaskModal from '../components/TaskModal';
import ErrorBanner from '../components/ErrorBanner';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';

const COL_TITLE: Record<BoardColumn, string> = { backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress', review: 'Review', completed: 'Completed' };
const COL_DOT: Record<BoardColumn, string> = { backlog: 'bg-fg-muted', todo: 'bg-sky-500', in_progress: 'bg-accent', review: 'bg-warning', completed: 'bg-success' };
const asArr = (r: unknown): Task[] => Array.isArray(r) ? r as Task[] : ((r as { items?: Task[] })?.items ?? []);
type Board = Record<BoardColumn, Task[]>;

export function KanbanBoard({ projectId, compact }: { projectId?: number | string; compact?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [over, setOver] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [modal, setModal] = useState<{ task?: Task | null; col?: BoardColumn } | null>(null);
  const key = ['board', projectId ?? 'all'];
  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      if (projectId) return await api.get<Board>(`/api/projects/${projectId}/board`);
      const r = asArr(await api.get('/api/tasks', { limit: 500, sort: 'created_at', order: 'desc' }));
      const m = { backlog: [], todo: [], in_progress: [], review: [], completed: [] } as Board;
      r.forEach((t) => (m[t.board_column] ?? m.backlog).push(t));
      return m;
    },
    refetchInterval: 30000,
  });

  const move = async (id: number, col: BoardColumn) => {
    const from = BOARD_COLUMNS.find((c) => q.data?.[c]?.some((t) => t.id === id));
    if (!from || from === col) return;
    const prev = q.data;
    qc.setQueryData(key, (old: Board | undefined) => {
      if (!old) return old; const t = old[from].find((x) => x.id === id); if (!t) return old;
      return { ...old, [from]: old[from].filter((x) => x.id !== id), [col]: [{ ...t, board_column: col }, ...old[col]] } as Board;
    });
    try { await api.moveBoard(id, col); toast(`Moved to ${COL_TITLE[col]}`); }
    catch (err) { qc.setQueryData(key, prev); toast(err instanceof Error ? err.message : 'Move failed', 'error'); }
    qc.invalidateQueries();
  };
  const drop = (e: React.DragEvent, col: BoardColumn) => {
    e.preventDefault(); setOver(null); setDragId(null);
    const id = Number(e.dataTransfer.getData('text/task-id'));
    if (id) void move(id, col);
  };
  const complete = async (t: Task) => {
    try { await api.completeTask(t.id); toast('Task completed'); qc.invalidateQueries(); } catch (err) { toast(err instanceof Error ? err.message : 'Failed', 'error'); }
  };

  if (q.isLoading) return <div className="flex gap-3 overflow-x-auto">{BOARD_COLUMNS.map((c) => <Skeleton key={c} className="h-64 w-64 shrink-0 rounded-2xl" />)}</div>;
  return (
    <>
      {q.error && <div className="mb-3"><ErrorBanner error={q.error} onRetry={() => q.refetch()} /></div>}
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0 sm:snap-none">
        {BOARD_COLUMNS.map((col) => {
          const items = q.data?.[col] ?? [];
          const active = over === col;
          return (
            <section key={col} aria-label={COL_TITLE[col]} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(col); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === col ? null : o)); }} onDrop={(e) => drop(e, col)}
              className={`flex w-[82%] shrink-0 snap-start flex-col rounded-2xl border p-2.5 transition ${compact ? 'sm:w-56' : 'sm:w-72'} ${active ? 'border-accent bg-accent-soft ring-2 ring-accent/30' : 'border-line bg-surface-2/60'}`}>
              <div className="mb-2 flex items-center justify-between px-1">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><span className={`h-2 w-2 rounded-full ${COL_DOT[col]}`} />{COL_TITLE[col]}
                  <span className="rounded-full bg-surface px-2 py-0.5 text-caption font-medium text-fg-muted" aria-label={`${items.length} tasks`}>{items.length}</span></h3>
                <button className="icon-btn" aria-label={`Add task to ${COL_TITLE[col]}`} onClick={() => setModal({ col })}><Plus size={16} /></button></div>
              <div className="min-h-[5rem] flex-1 space-y-2">
                {items.length === 0 && <div className={`rounded-xl border border-dashed py-6 text-center text-xs text-fg-muted ${active ? 'border-accent' : 'border-line'}`}>Drop tasks here</div>}
                {items.map((t) => (
                  <div key={t.id} draggable onDragStart={(e) => { e.dataTransfer.setData('text/task-id', String(t.id)); e.dataTransfer.effectAllowed = 'move'; setDragId(t.id); }} onDragEnd={() => { setDragId(null); setOver(null); }}
                    className={`card group cursor-grab p-3 text-sm transition hover:shadow-pop active:cursor-grabbing ${dragId === t.id ? 'rotate-1 opacity-40' : ''}`} style={t.project_color ? { borderLeft: `3px solid ${t.project_color}` } : undefined}>
                    <div className="flex items-start gap-1.5">
                      <GripVertical size={14} className="mt-0.5 shrink-0 text-fg-muted opacity-0 transition group-hover:opacity-100" aria-hidden />
                      <button type="button" onClick={() => setModal({ task: t })} className={`min-w-0 flex-1 text-left font-medium ${t.status === 'completed' ? 'line-through opacity-60' : ''}`}>{t.title}</button>
                      <div className="flex shrink-0 opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        {t.status !== 'completed' && <button className="icon-btn !h-6 !w-6" aria-label={`Complete ${t.title}`} onClick={() => complete(t)}><Check size={14} /></button>}
                        <button className="icon-btn !h-6 !w-6" aria-label={`Edit ${t.title}`} onClick={() => setModal({ task: t })}><Pencil size={13} /></button></div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className={`rounded-full px-2 py-0.5 font-medium ${PRIORITY_STYLE[t.priority]}`}>{label(t.priority)}</span>
                      {t.due_date && <span className={`inline-flex items-center gap-1 ${t.effective_status === 'overdue' ? 'text-danger' : 'text-fg-muted'}`}><CalendarClock size={12} />{fmtDate(t.due_date)}</span>}
                      {!projectId && t.project_name && <span className="truncate text-fg-muted">{t.project_name}</span>}
                    </div>
                    <label className="mt-2 block sm:hidden"><span className="sr-only">Move {t.title} to column</span>
                      <select className="input !py-1 text-xs" value={col} onChange={(e) => void move(t.id, e.target.value as BoardColumn)}>
                        {BOARD_COLUMNS.map((c) => <option key={c} value={c}>{COL_TITLE[c]}</option>)}</select></label>
                  </div>))}
              </div>
            </section>);
        })}
      </div>
      {modal && <TaskModal open onClose={() => setModal(null)} task={modal.task ?? null}
        defaults={modal.col ? { board_column: modal.col, project_id: projectId ? Number(projectId) : undefined } : undefined} onSaved={() => qc.invalidateQueries()} />}
    </>
  );
}

export default function Kanban() {
  const [project, setProject] = useState('');
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/api/projects') });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-page font-semibold">Kanban board</h1>
          <p className="text-sm text-fg-muted">Drag cards between columns, or use the move menu on mobile. Click a title to edit.</p></div>
        <div className="w-full sm:w-56"><label className="label" htmlFor="kp">Project</label>
          <select id="kp" className="input" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">All projects</option>
            {(Array.isArray(projects.data) ? projects.data : []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
      </div>
      <KanbanBoard key={project} projectId={project || undefined} />
    </div>
  );
}
