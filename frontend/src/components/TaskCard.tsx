import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Pencil, Trash2, Copy, CalendarClock, SunMedium, Clock, MoreHorizontal, AlertCircle } from 'lucide-react';
import type { Task } from '../lib/types';
import { fmtDate, fmtTime, localISO, addDays } from '../lib/dates';
import { useTaskActions } from '../lib/useTaskActions';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';

export const PRIORITY_STYLE: Record<string, string> = {
  critical: 'bg-danger/15 text-danger',
  high: 'bg-warning/15 text-warning',
  medium: 'bg-accent-soft text-accent',
  low: 'bg-surface-2 text-fg-muted',
};
const PRIORITY_DOT: Record<string, string> = { critical: 'bg-danger', high: 'bg-warning', medium: 'bg-accent', low: 'bg-fg-muted/50' };
export const STATUS_STYLE: Record<string, string> = {
  not_started: 'bg-surface-2 text-fg-muted',
  in_progress: 'bg-accent-soft text-accent',
  on_hold: 'bg-warning/15 text-warning',
  completed: 'bg-success/15 text-success',
  cancelled: 'bg-surface-2 text-fg-muted',
  overdue: 'bg-danger/15 text-danger',
};
export const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Animated checkbox: circle fills, check draws, tiny pop. Reduced-motion safe. */
export function CheckButton({ checked, disabled, onClick, name }: { checked: boolean; disabled?: boolean; onClick: () => void; name: string }) {
  const reduce = useReducedMotion();
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-label={checked ? `"${name}" completed` : `Mark "${name}" complete`} aria-pressed={checked}
      className="group -m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:cursor-default">
      <motion.span animate={reduce ? undefined : { scale: checked ? [1, 1.25, 1] : 1 }} transition={{ duration: 0.35 }}
        className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 transition-colors duration-200 ${checked ? 'border-success bg-success' : 'border-fg-muted/40 group-hover:border-success'}`}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={false} animate={{ pathLength: checked ? 1 : 0 }} transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : 0.05 }} />
        </svg>
      </motion.span>
    </button>
  );
}

export interface TaskCardProps {
  task: Task;
  onEdit?: (t: Task) => void;
  /** show "Reschedule" and "Add to today" actions (carried forward / overdue sections) */
  showCarryActions?: boolean;
  compact?: boolean;
  /** render without own card chrome (used inside TaskSection) */
  flat?: boolean;
  /** softer styling for carried-forward / overdue lists */
  quiet?: boolean;
  /** highlight due-soon (upcoming deadlines) */
  urgency?: boolean;
}

export default function TaskCard({ task, onEdit, showCarryActions, compact, flat, quiet, urgency }: TaskCardProps) {
  const a = useTaskActions();
  const reduce = useReducedMotion();
  const [confirm, setConfirm] = useState(false);
  const [resched, setResched] = useState(false);
  const [menu, setMenu] = useState(false);
  const [optimistic, setOptimistic] = useState(false);
  const [gone, setGone] = useState(false);
  const [date, setDate] = useState(addDays(localISO(), 1));
  const menuRef = useRef<HTMLDivElement>(null);
  const done = task.status === 'completed' || optimistic;
  const closed = done || task.status === 'cancelled';
  const overdue = task.effective_status === 'overdue' && !done;
  const time = task.start_time ? `${fmtTime(task.start_time)}${task.end_time ? '–' + fmtTime(task.end_time) : ''}` : '';
  const today = localISO();
  const daysLeft = task.due_date ? Math.round((new Date(task.due_date + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 864e5) : null;
  const soon = urgency && !closed && daysLeft !== null && daysLeft <= 1;
  const status = done ? 'completed' : task.effective_status;

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [menu]);

  const complete = () => {
    if (closed) return;
    setOptimistic(true);
    a.complete.mutate(task, {
      onError: () => setOptimistic(false),
      onSuccess: () => { if (showCarryActions) setTimeout(() => setGone(true), reduce ? 0 : 450); },
    });
  };
  const item = 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-fg hover:bg-surface-2 focus-visible:bg-surface-2';

  return (
    <motion.div initial={false} animate={gone ? { height: 0, opacity: 0 } : { height: 'auto', opacity: 1 }} transition={{ duration: reduce ? 0 : 0.28 }}
      style={{ overflow: gone ? 'hidden' : 'visible' }} className={flat ? '' : 'card'}>
      <div className={`group relative flex items-start gap-3 px-3 py-3 ${flat ? 'rounded-xl transition-colors hover:bg-surface-2/60' : ''} ${soon ? 'bg-warning/5' : ''} ${quiet ? 'opacity-95' : ''}`}>
        <div className="mt-0.5 pl-2"><CheckButton checked={done} disabled={closed || a.complete.isPending} onClick={complete} name={task.title} /></div>
        <div className="min-w-0 flex-1 pl-1">
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 text-sm font-medium leading-6 text-fg">
              <span className="relative inline-block max-w-full"><span className={`transition-colors duration-300 ${closed ? 'text-fg-muted' : ''}`}>{task.title}</span>
              <motion.span aria-hidden className="pointer-events-none absolute left-0 top-1/2 h-px bg-fg-muted" initial={false}
                animate={{ width: closed ? '100%' : '0%' }} transition={{ duration: reduce ? 0 : 0.35, ease: [0.2, 0.8, 0.2, 1] }} /></span>
            </span>
            <span className={`mt-0.5 hidden shrink-0 rounded-full px-2 py-0.5 text-caption font-medium sm:inline ${STATUS_STYLE[status] || ''}`}>{label(status)}</span>
            <div className="relative shrink-0" ref={menuRef}>
              <button type="button" className="icon-btn !h-9 !w-9 sm:!h-8 sm:!w-8" aria-label={`Actions for ${task.title}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><MoreHorizontal size={18} /></button>
              <AnimatePresence>
                {menu && (
                  <motion.div role="menu" initial={{ opacity: 0, scale: reduce ? 1 : 0.95, y: reduce ? 0 : -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: reduce ? 1 : 0.95 }}
                    transition={{ duration: 0.14 }} style={{ transformOrigin: 'top right' }}
                    className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-line bg-surface p-1 shadow-pop">
                    {onEdit && <button role="menuitem" className={item} onClick={() => { setMenu(false); onEdit(task); }}><Pencil size={15} className="text-fg-muted" />Edit</button>}
                    <button role="menuitem" className={item} disabled={a.duplicate.isPending} onClick={() => { setMenu(false); a.duplicate.mutate(task); }}><Copy size={15} className="text-fg-muted" />Duplicate</button>
                    {!closed && <button role="menuitem" className={item} onClick={() => { setMenu(false); setResched(true); }}><CalendarClock size={15} className="text-fg-muted" />Reschedule</button>}
                    {!closed && <button role="menuitem" className={item} onClick={() => { setMenu(false); a.addToToday.mutate(task); }}><SunMedium size={15} className="text-fg-muted" />Add to today</button>}
                    <div className="my-1 h-px bg-line" />
                    <button role="menuitem" className={`${item} !text-danger`} onClick={() => { setMenu(false); setConfirm(true); }}><Trash2 size={15} />Delete</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          {!compact && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-muted">
              {task.project_name && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: task.project_color || 'rgb(var(--fg-muted))' }} aria-hidden />{task.project_name}</span>}
              <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${PRIORITY_DOT[task.priority]}`} aria-hidden />{label(task.priority)}</span>
              {time && <span className="inline-flex items-center gap-1"><Clock size={12} aria-hidden />{time}</span>}
              {task.due_date && (
                <span className={`inline-flex items-center gap-1 ${overdue ? 'font-medium text-danger' : soon ? 'font-medium text-warning' : ''}`}>
                  {(overdue || soon) && <AlertCircle size={12} aria-hidden />}
                  Due {fmtDate(task.due_date)}{urgency && daysLeft !== null && daysLeft >= 0 ? ` · ${daysLeft === 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft}d`}` : ''}
                </span>
              )}
              <span className={`rounded-full px-2 py-px font-medium sm:hidden ${STATUS_STYLE[status] || ''}`}>{label(status)}</span>
              {task.reschedule_count > 0 && <span>Rescheduled {task.reschedule_count}×</span>}
              {task.tags.slice(0, 2).map((t) => <span key={t} className="chip !py-px">#{t}</span>)}
            </div>
          )}
          {showCarryActions && !closed && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => setResched(true)}><CalendarClock size={13} />Reschedule</button>
              <button className="btn-ghost !px-2.5 !py-1.5 text-xs" disabled={a.addToToday.isPending} onClick={() => a.addToToday.mutate(task)}><SunMedium size={13} />Add to today</button>
            </div>
          )}
        </div>
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
    </motion.div>
  );
}
