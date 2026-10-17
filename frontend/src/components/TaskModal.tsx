import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X, Plus, Trash2, Paperclip, Download, ChevronDown, Play, Square, Send, Loader2, Repeat } from 'lucide-react';
import { useToast } from './Toast';
import { api } from '../lib/api';
import { taskFormSchema, type TaskFormValues } from '../lib/schemas';
import { PRIORITIES, STATUSES, type Project, type SubItem, type Task, type TaskInput } from '../lib/types';
import { fmtDuration } from '../lib/dates';

export interface TaskModalProps {
  open: boolean;
  onClose: () => void;
  /** provide to edit; omit/null to create */
  task?: Task | null;
  /** prefill for create (e.g. {start_date, due_date, project_id, board_column}) */
  defaults?: Partial<TaskInput>;
  onSaved?: (t: Task) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const cap = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function initial(task?: Task | null, d?: Partial<TaskInput>): TaskFormValues {
  return {
    title: task?.title ?? d?.title ?? '', description: task?.description ?? d?.description ?? '',
    project_id: String(task?.project_id ?? d?.project_id ?? ''), category: task?.category ?? d?.category ?? '',
    priority: task?.priority ?? d?.priority ?? 'medium', status: task?.status ?? d?.status ?? 'not_started',
    start_date: task?.start_date ?? d?.start_date ?? '', due_date: task?.due_date ?? d?.due_date ?? '',
    start_time: (task?.start_time ?? d?.start_time ?? '').slice(0, 5), end_time: (task?.end_time ?? d?.end_time ?? '').slice(0, 5),
    estimated_minutes: String(task?.estimated_minutes ?? d?.estimated_minutes ?? ''),
    reminder_at: toLocalInput(task?.reminder_at ?? d?.reminder_at),
    tags: task?.tags ?? d?.tags ?? [], notes: task?.notes ?? d?.notes ?? '',
    recur: !!d?.recurrence, freq: d?.recurrence?.freq ?? 'daily', interval: String(d?.recurrence?.interval ?? 1),
    by_weekday: d?.recurrence?.by_weekday ?? [], recur_end: d?.recurrence?.end_date ?? '',
  };
}

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PRI_DOT: Record<string, string> = { critical: 'bg-danger', high: 'bg-warning', medium: 'bg-accent', low: 'bg-fg-muted' };

function Field({ label, htmlFor, error, children, className = '' }: { label: string; htmlFor?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {error && <p role="alert" className="mt-1 text-caption text-danger">{error}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-caption font-semibold uppercase tracking-wide text-fg-muted">{children}</h3>;
}

function TagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('');
  const commit = () => {
    const parts = text.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
    if (parts.length) onChange(Array.from(new Set([...value, ...parts])));
    setText('');
  };
  return (
    <div className="input flex flex-wrap items-center gap-1.5 !py-1.5 focus-within:border-accent">
      {value.map((t) => (
        <span key={t} className="chip !bg-accent-soft !text-accent">#{t}
          <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}><X size={11} /></button>
        </span>
      ))}
      <input id="tm-tags" value={text} placeholder={value.length ? '' : 'Type a tag and press Enter'} className="min-w-[8ch] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-fg-muted"
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); e.stopPropagation(); commit(); }
          else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }} />
    </div>
  );
}

function ItemList({ title, items, newText, setNewText, onAdd, onToggle, onRemove, placeholder }: {
  title: string; items: SubItem[]; newText: string; setNewText: (s: string) => void; onAdd: () => void;
  onToggle: (i: SubItem) => void; onRemove: (i: SubItem) => void; placeholder: string;
}) {
  const done = items.filter((i) => i.done).length;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between"><SectionTitle>{title}</SectionTitle>{items.length > 0 && <span className="mb-2 text-caption text-fg-muted">{done}/{items.length}</span>}</div>
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it.id} className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-surface-2">
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={it.done} onChange={() => onToggle(it)} aria-label={`Toggle ${it.title}`} />
            <span className={`flex-1 text-sm ${it.done ? 'text-fg-muted line-through' : ''}`}>{it.title}</span>
            <button type="button" className="icon-btn !h-7 !w-7 opacity-60 hover:opacity-100 hover:!text-danger" aria-label={`Delete ${it.title}`} onClick={() => onRemove(it)}><Trash2 size={14} /></button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <input className="input" aria-label={`Add ${title.toLowerCase()} item`} value={newText} placeholder={placeholder} maxLength={200} onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onAdd(); } }} />
        <button type="button" className="btn-ghost" onClick={onAdd} disabled={!newText.trim()}><Plus size={15} />Add</button>
      </div>
    </div>
  );
}

interface Comment { id: number; body: string; created_at: string }
interface Act { id: number; action: string; detail: Record<string, unknown>; created_at: string }

function CommentsTab({ taskId }: { taskId: number }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['task-comments', taskId], queryFn: () => api.get<Comment[]>(`/api/tasks/${taskId}/comments`) });
  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try { await api.post(`/api/tasks/${taskId}/comments`, { body }); setText(''); await qc.invalidateQueries({ queryKey: ['task-comments', taskId] }); qc.invalidateQueries({ queryKey: ['task-activity', taskId] }); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not post comment', 'error'); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      {q.isLoading ? <p className="text-sm text-fg-muted">Loading comments...</p> : q.isError ? <p role="alert" className="text-sm text-danger">Could not load comments.</p>
        : (q.data ?? []).length === 0 ? <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-fg-muted">No comments yet. Start the conversation.</p>
        : <ul className="space-y-3">{(q.data ?? []).map((c) => (
          <li key={c.id} className="rounded-xl bg-surface-2 px-3 py-2.5">
            <p className="whitespace-pre-wrap text-sm">{c.body}</p>
            <p className="mt-1 text-caption text-fg-muted">{new Date(c.created_at).toLocaleString()}</p>
          </li>))}</ul>}
      <div className="flex gap-2">
        <textarea className="input min-h-[44px] resize-y" rows={2} aria-label="Write a comment" placeholder="Write a comment" value={text} maxLength={5000} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); send(); } }} />
        <button type="button" className="btn-primary self-end" onClick={send} disabled={busy || !text.trim()} aria-label="Post comment">{busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}</button>
      </div>
    </div>
  );
}

function describe(a: Act): string {
  const d = a.detail || {};
  const t = typeof d.title === 'string' ? ` "${d.title}"` : '';
  const to = typeof d.to === 'string' ? ` to ${cap(d.to)}` : '';
  return `${cap(a.action)}${t}${to}`;
}
function ActivityTab({ taskId }: { taskId: number }) {
  const q = useQuery({ queryKey: ['task-activity', taskId], queryFn: () => api.get<Act[]>(`/api/tasks/${taskId}/activity`) });
  if (q.isLoading) return <p className="text-sm text-fg-muted">Loading activity...</p>;
  if (q.isError) return <p role="alert" className="text-sm text-danger">Could not load activity.</p>;
  const rows = q.data ?? [];
  if (!rows.length) return <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-fg-muted">No activity yet.</p>;
  return (
    <ol className="relative ml-2 space-y-4 border-l border-line pl-4">
      {rows.map((a) => (
        <li key={a.id} className="relative">
          <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-accent" aria-hidden />
          <p className="text-sm">{describe(a)}</p>
          <p className="text-caption text-fg-muted">{new Date(a.created_at).toLocaleString()}</p>
        </li>))}
    </ol>
  );
}

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function TaskModal({ open, onClose, task, defaults, onSaved }: TaskModalProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const reduce = useReducedMotion();
  const editing = !!task;
  const panelRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tmp = useRef(-1);
  const [tab, setTab] = useState<'details' | 'comments' | 'activity'>('details');
  const [more, setMore] = useState(false);
  const [serverErr, setServerErr] = useState('');
  const [subs, setSubs] = useState<SubItem[]>([]);
  const [checks, setChecks] = useState<SubItem[]>([]);
  const [atts, setAtts] = useState<Task['attachments']>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [newSub, setNewSub] = useState('');
  const [newCheck, setNewCheck] = useState('');
  const [tracked, setTracked] = useState(0);
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const [desktop, setDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches);

  const form = useForm<TaskFormValues>({ resolver: zodResolver(taskFormSchema), defaultValues: initial(task, defaults), mode: 'onTouched' });
  const { register, handleSubmit, control, watch, setValue, reset, formState: { errors, isSubmitting, isDirty } } = form;
  const recur = watch('recur');
  const freq = watch('freq');

  useEffect(() => { const m = window.matchMedia('(min-width: 768px)'); const h = () => setDesktop(m.matches); m.addEventListener('change', h); return () => m.removeEventListener('change', h); }, []);

  useEffect(() => {
    if (!open) return;
    reset(initial(task, defaults)); setServerErr(''); setPendingFiles([]); setNewSub(''); setNewCheck(''); setTab('details');
    setSubs(task?.subtasks ?? []); setChecks(task?.checklist ?? []); setAtts(task?.attachments ?? []);
    setTracked(task?.tracked_seconds ?? 0); setRunningSince(null);
    const d = defaults ?? {};
    setMore(!!(task && (task.start_date || task.end_time || task.estimated_minutes || task.category || task.reminder_at || task.tags.length || task.notes || task.subtasks.length || task.checklist.length || task.attachments.length || task.recurrence_rule_id)) || !!(d.start_date || d.recurrence));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  // focus management + body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => panelRef.current?.querySelector<HTMLInputElement>('#tm-title')?.focus(), 60);
    return () => { clearTimeout(t); document.body.style.overflow = prevOverflow; prev?.focus?.(); };
  }, [open]);

  useEffect(() => {
    if (runningSince === null) return;
    const i = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, [runningSince]);

  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[] | { items: Project[] }>('/api/projects'), enabled: open });
  const projList = useMemo(() => { const d = projects.data; return Array.isArray(d) ? d : d?.items ?? []; }, [projects.data]);

  const submit = handleSubmit(async (f) => {
    setServerErr('');
    const body: TaskInput = {
      title: f.title.trim(), description: f.description.trim() || null,
      project_id: f.project_id ? Number(f.project_id) : null, category: f.category.trim() || null,
      priority: f.priority, status: f.status,
      start_date: f.start_date || null, due_date: f.due_date || null,
      start_time: f.start_time || null, end_time: f.end_time || null,
      estimated_minutes: f.estimated_minutes ? Number(f.estimated_minutes) : null,
      reminder_at: f.reminder_at ? new Date(f.reminder_at).toISOString() : null,
      tags: f.tags, notes: f.notes.trim() || null,
    };
    if (defaults?.board_column && !editing) body.board_column = defaults.board_column;
    if (f.recur) body.recurrence = { freq: f.freq, interval: Number(f.interval), by_weekday: f.freq === 'weekly' ? f.by_weekday : [], end_date: f.recur_end || null };
    else if (editing && task?.recurrence_rule_id != null) body.recurrence = null;
    try {
      const saved = editing ? await api.updateTask(task!.id, body) : await api.createTask(body);
      if (!editing) {
        const results = await Promise.allSettled([
          ...subs.map((s) => api.addSubtask(saved.id, s.title)),
          ...checks.map((c) => api.addChecklist(saved.id, c.title)),
          ...pendingFiles.map((file) => api.uploadAttachment(saved.id, file)),
        ]);
        if (results.some((r) => r.status === 'rejected')) toast('Task saved, but some sub-items or files failed to upload', 'error');
      }
      qc.invalidateQueries();
      toast(editing ? 'Task updated' : 'Task created');
      onSaved?.(saved);
      onClose();
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Failed to save task';
      setServerErr(m); toast(m, 'error');
    }
  }, (errs) => {
    const advanced = ['start_date', 'end_time', 'estimated_minutes', 'category', 'reminder_at', 'interval', 'by_weekday', 'recur_end', 'notes'];
    if (Object.keys(errs).some((k) => advanced.includes(k))) setMore(true);
    setTab('details');
  });

  const requestClose = useCallback(() => { if (!isSubmitting) onClose(); }, [isSubmitting, onClose]);

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') { e.stopPropagation(); requestClose(); return; }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.target as HTMLElement).id !== 'tm-comment') { e.preventDefault(); submit(); return; }
    if (e.key === 'Tab' && panelRef.current) {
      const els = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  const refresh = () => qc.invalidateQueries();
  async function addItem(kind: 'sub' | 'check') {
    const title = (kind === 'sub' ? newSub : newCheck).trim();
    if (!title) return;
    try {
      if (editing) {
        const created = (kind === 'sub' ? await api.addSubtask(task!.id, title) : await api.addChecklist(task!.id, title)) as SubItem | undefined;
        const item: SubItem = created && typeof created === 'object' && 'id' in created && 'title' in created ? { id: created.id, title: created.title, done: !!created.done } : { id: tmp.current--, title, done: false };
        (kind === 'sub' ? setSubs : setChecks)((l) => [...l, item]);
        refresh();
      } else (kind === 'sub' ? setSubs : setChecks)((l) => [...l, { id: tmp.current--, title, done: false }]);
      if (kind === 'sub') setNewSub(''); else setNewCheck('');
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'error'); }
  }
  async function toggleItem(kind: 'sub' | 'check', it: SubItem) {
    const setter = kind === 'sub' ? setSubs : setChecks;
    setter((l) => l.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)));
    if (editing && it.id > 0) {
      try { await (kind === 'sub' ? api.updateSubtask(it.id, { done: !it.done }) : api.updateChecklist(it.id, { done: !it.done })); refresh(); }
      catch (e) { setter((l) => l.map((x) => (x.id === it.id ? it : x))); toast(e instanceof Error ? e.message : 'Failed', 'error'); }
    }
  }
  async function removeItem(kind: 'sub' | 'check', it: SubItem) {
    const setter = kind === 'sub' ? setSubs : setChecks;
    try {
      if (editing && it.id > 0) { await (kind === 'sub' ? api.deleteSubtask(it.id) : api.deleteChecklist(it.id)); refresh(); }
      setter((l) => l.filter((x) => x.id !== it.id));
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'error'); }
  }
  async function onFiles(files: FileList | null) {
    if (!files) return;
    const list = Array.from(files);
    const tooBig = list.find((x) => x.size > 10 * 1024 * 1024);
    if (tooBig) { toast(`${tooBig.name} exceeds the 10 MB limit`, 'error'); return; }
    if (!editing) { setPendingFiles((p) => [...p, ...list]); return; }
    for (const file of list) {
      try { await api.uploadAttachment(task!.id, file); toast('Attachment uploaded'); } catch (e) { toast(e instanceof Error ? e.message : 'Upload failed', 'error'); }
    }
    try { const fresh = await api.getTask(task!.id); setAtts(fresh.attachments); } catch { /* ignore */ }
    refresh();
    if (fileRef.current) fileRef.current.value = '';
  }
  async function delAtt(id: number) {
    try { await api.deleteAttachment(id); setAtts((a) => a.filter((x) => x.id !== id)); refresh(); toast('Attachment removed'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Delete failed', 'error'); }
  }
  async function toggleTimer() {
    if (!task) return;
    try {
      if (runningSince === null) { await api.startTimer(task.id); setRunningSince(Date.now()); toast('Timer started'); }
      else { await api.stopTimer(task.id); setTracked((t) => t + Math.round((Date.now() - runningSince) / 1000)); setRunningSince(null); refresh(); toast('Timer stopped'); }
    } catch (e) { toast(e instanceof Error ? e.message : 'Timer failed', 'error'); }
  }

  const elapsed = tracked + (runningSince ? Math.round((Date.now() - runningSince) / 1000) : 0);
  const err = (k: keyof TaskFormValues) => errors[k]?.message as string | undefined;
  const tabs = editing ? (['details', 'comments', 'activity'] as const) : (['details'] as const);

  const panelAnim = desktop
    ? { initial: { x: reduce ? 0 : 48, opacity: 0 }, animate: { x: 0, opacity: 1 }, exit: { x: reduce ? 0 : 48, opacity: 0 } }
    : { initial: { y: reduce ? 0 : 40, opacity: 0 }, animate: { y: 0, opacity: 1 }, exit: { y: reduce ? 0 : 40, opacity: 0 } };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50" onKeyDown={onKeyDown}>
          <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
            onClick={() => { if (!isDirty) requestClose(); }} aria-hidden />
          <motion.aside ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="tm-heading"
            className="absolute inset-0 flex flex-col bg-surface shadow-pop md:inset-y-0 md:left-auto md:right-0 md:w-[540px] md:border-l md:border-line"
            {...panelAnim} transition={{ type: 'spring', stiffness: 380, damping: 36, mass: 0.9 }}>
            <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
              <h2 id="tm-heading" className="text-section">{editing ? 'Edit task' : 'New task'}</h2>
              <button type="button" className="icon-btn" aria-label="Close" onClick={requestClose}><X size={18} /></button>
            </header>
            {editing && (
              <div role="tablist" aria-label="Task sections" className="flex gap-1 border-b border-line px-4">
                {tabs.map((t) => (
                  <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
                    className={`relative px-3 py-2.5 text-sm font-medium transition ${tab === t ? 'text-fg' : 'text-fg-muted hover:text-fg'}`}>
                    {cap(t)}
                    {tab === t && <motion.span layoutId="tm-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-accent" />}
                  </button>))}
              </div>
            )}
            <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
                {serverErr && <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{serverErr}</div>}
                {tab === 'comments' && task && <CommentsTab taskId={task.id} />}
                {tab === 'activity' && task && <ActivityTab taskId={task.id} />}
                {tab === 'details' && (<>
                  <Field label="Title" htmlFor="tm-title" error={err('title')}>
                    <input id="tm-title" className={`input !py-2.5 text-base font-medium ${errors.title ? '!border-danger' : ''}`} placeholder="What needs to be done?" maxLength={220} aria-invalid={!!errors.title}
                      {...register('title')}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); submit(); } }} />
                  </Field>
                  <Field label="Description" htmlFor="tm-desc" error={err('description')}>
                    <textarea id="tm-desc" rows={3} className="input resize-y" placeholder="Add details" {...register('description')} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Project" htmlFor="tm-project">
                      <select id="tm-project" className="input" {...register('project_id')}>
                        <option value="">No project</option>
                        {projList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Due date" htmlFor="tm-due" error={err('due_date')}>
                      <input id="tm-due" type="date" className={`input ${errors.due_date ? '!border-danger' : ''}`} {...register('due_date')} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Time" htmlFor="tm-start-time"><input id="tm-start-time" type="time" className="input" {...register('start_time')} /></Field>
                    <div>
                      <span className="label">Priority</span>
                      <Controller control={control} name="priority" render={({ field }) => (
                        <div role="radiogroup" aria-label="Priority" className="flex gap-1 rounded-lg bg-surface-2 p-1">
                          {PRIORITIES.map((p) => (
                            <button key={p} type="button" role="radio" aria-checked={field.value === p} onClick={() => field.onChange(p)} title={cap(p)}
                              className={`flex flex-1 items-center justify-center gap-1 rounded-md px-1 py-1.5 text-caption font-medium transition ${field.value === p ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}>
                              <span className={`hidden h-1.5 w-1.5 rounded-full sm:block ${PRI_DOT[p]}`} aria-hidden />{cap(p).slice(0, 4)}
                            </button>))}
                        </div>)} />
                    </div>
                  </div>

                  <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-controls="tm-more"
                    className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-sm font-medium text-fg-muted transition hover:bg-surface-2 hover:text-fg">
                    More options
                    <ChevronDown size={16} className={`transition-transform ${more ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence initial={false}>
                    {more && (
                      <motion.div id="tm-more" key="more" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduce ? 0 : 0.22 }} className="overflow-hidden">
                        <div className="space-y-5 pb-1">
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Start date" htmlFor="tm-start" error={err('start_date')}><input id="tm-start" type="date" className="input" {...register('start_date')} /></Field>
                            <Field label="End time" htmlFor="tm-end-time" error={err('end_time')}><input id="tm-end-time" type="time" className={`input ${errors.end_time ? '!border-danger' : ''}`} {...register('end_time')} /></Field>
                            <Field label="Estimated minutes" htmlFor="tm-est" error={err('estimated_minutes')}><input id="tm-est" inputMode="numeric" className="input" placeholder="e.g. 45" {...register('estimated_minutes')} /></Field>
                            <Field label="Category" htmlFor="tm-cat" error={err('category')}><input id="tm-cat" className="input" placeholder="e.g. Work" {...register('category')} /></Field>
                            <Field label="Status" htmlFor="tm-status"><select id="tm-status" className="input" {...register('status')}>{STATUSES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select></Field>
                            <Field label="Reminder" htmlFor="tm-rem"><input id="tm-rem" type="datetime-local" className="input" {...register('reminder_at')} /></Field>
                          </div>

                          <div className="rounded-xl border border-line p-3">
                            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4" {...register('recur')} /><Repeat size={14} aria-hidden />Repeat this task</label>
                            {recur && (
                              <div className="mt-3 space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                  <Field label="Frequency" htmlFor="tm-freq"><select id="tm-freq" className="input" {...register('freq')}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></Field>
                                  <Field label="Every (interval)" htmlFor="tm-int" error={err('interval')}><input id="tm-int" inputMode="numeric" className="input" {...register('interval')} /></Field>
                                </div>
                                {freq === 'weekly' && (
                                  <Field label="On days" error={err('by_weekday')}>
                                    <Controller control={control} name="by_weekday" render={({ field }) => (
                                      <div className="flex flex-wrap gap-1.5">{WEEK.map((d, i) => {
                                        const on = field.value.includes(i);
                                        return <button key={d} type="button" aria-pressed={on} onClick={() => field.onChange(on ? field.value.filter((x) => x !== i) : [...field.value, i].sort())}
                                          className={`rounded-full border px-3 py-1 text-caption font-medium transition ${on ? 'border-accent bg-accent text-white' : 'border-line text-fg-muted hover:bg-surface-2'}`}>{d}</button>;
                                      })}</div>)} />
                                  </Field>
                                )}
                                <Field label="Ends on (optional)" htmlFor="tm-rend" error={err('recur_end')}><input id="tm-rend" type="date" className="input" {...register('recur_end')} /></Field>
                              </div>
                            )}
                          </div>

                          <Field label="Tags" htmlFor="tm-tags"><Controller control={control} name="tags" render={({ field }) => <TagInput value={field.value} onChange={field.onChange} />} /></Field>
                          <ItemList title="Subtasks" items={subs} newText={newSub} setNewText={setNewSub} onAdd={() => addItem('sub')} onToggle={(i) => toggleItem('sub', i)} onRemove={(i) => removeItem('sub', i)} placeholder="Add a subtask" />
                          <ItemList title="Checklist" items={checks} newText={newCheck} setNewText={setNewCheck} onAdd={() => addItem('check')} onToggle={(i) => toggleItem('check', i)} onRemove={(i) => removeItem('check', i)} placeholder="Add a checklist item" />
                          <Field label="Notes" htmlFor="tm-notes" error={err('notes')}><textarea id="tm-notes" rows={3} className="input resize-y" placeholder="Private notes" {...register('notes')} /></Field>

                          <div>
                            <SectionTitle>Attachments</SectionTitle>
                            <ul className="space-y-1">
                              {atts.map((a) => (
                                <li key={a.id} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-sm">
                                  <Paperclip size={14} className="shrink-0 text-fg-muted" aria-hidden />
                                  <span className="min-w-0 flex-1 truncate">{a.filename}</span>
                                  <span className="text-caption text-fg-muted">{(a.size / 1024).toFixed(a.size > 1048576 ? 0 : 1)} KB</span>
                                  <button type="button" className="icon-btn !h-7 !w-7" aria-label={`Download ${a.filename}`} onClick={() => api.downloadAttachment(a.id, a.filename).catch((e) => toast(e instanceof Error ? e.message : 'Download failed', 'error'))}><Download size={14} /></button>
                                  <button type="button" className="icon-btn !h-7 !w-7 hover:!text-danger" aria-label={`Delete ${a.filename}`} onClick={() => delAtt(a.id)}><Trash2 size={14} /></button>
                                </li>))}
                              {pendingFiles.map((f, i) => (
                                <li key={f.name + i} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-sm">
                                  <Paperclip size={14} className="shrink-0 text-fg-muted" aria-hidden /><span className="min-w-0 flex-1 truncate">{f.name}</span>
                                  <span className="text-caption text-fg-muted">uploads on save</span>
                                  <button type="button" className="icon-btn !h-7 !w-7" aria-label={`Remove ${f.name}`} onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))}><X size={14} /></button>
                                </li>))}
                            </ul>
                            <input ref={fileRef} type="file" multiple className="sr-only" id="tm-file" onChange={(e) => onFiles(e.target.files)} tabIndex={-1} />
                            <button type="button" className="btn-ghost mt-2" onClick={() => fileRef.current?.click()}><Paperclip size={15} />Add file</button>
                            <span className="ml-2 text-caption text-fg-muted">Max 10 MB each</span>
                          </div>

                          {editing && (
                            <div className="flex items-center justify-between rounded-xl border border-line p-3">
                              <div>
                                <SectionTitle>Time tracked</SectionTitle>
                                <p className="-mt-1 text-lg font-semibold tabular-nums" aria-live="off">{runningSince ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : fmtDuration(elapsed)}</p>
                              </div>
                              <button type="button" className={runningSince ? 'btn-danger' : 'btn-ghost'} onClick={toggleTimer}>
                                {runningSince ? <><Square size={14} />Stop</> : <><Play size={14} />Start timer</>}
                              </button>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>)}
              </div>
              <footer className="flex items-center justify-between gap-3 border-t border-line bg-surface px-5 py-3">
                <span className="hidden text-caption text-fg-muted sm:block"><kbd className="rounded border border-line px-1">Ctrl</kbd> + <kbd className="rounded border border-line px-1">Enter</kbd> to save</span>
                <div className="ml-auto flex gap-2">
                  <button type="button" className="btn-ghost" onClick={requestClose}>Cancel</button>
                  <button type="submit" className="btn-primary min-w-[96px]" disabled={isSubmitting}>{isSubmitting ? <Loader2 size={15} className="animate-spin" /> : null}{editing ? 'Save changes' : 'Create task'}</button>
                </div>
              </footer>
            </form>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
