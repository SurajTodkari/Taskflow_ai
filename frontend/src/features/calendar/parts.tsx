import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'motion/react';
import { Check, Flag, Pencil, X, Clock, FolderOpen } from 'lucide-react';
import type { Task } from '../../lib/types';
import { fmtDate, fmtTime } from '../../lib/dates';
import { isDone, pcol } from './utils';

export interface Anchor { x: number; y: number; w: number; h: number }
export const rectOf = (el: Element): Anchor => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };

/** Floating popover anchored to a rect, clamped to viewport; bottom sheet on small screens. */
export function Popover({ anchor, onClose, label, children }: { anchor: Anchor; onClose: () => void; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = anchor.x + anchor.w / 2 - w / 2; left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = anchor.y + anchor.h + 6; if (top + h > window.innerHeight - 8) top = Math.max(8, anchor.y - h - 6);
    setPos({ left, top });
  }, [anchor]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const d = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', k); const t = setTimeout(() => document.addEventListener('mousedown', d), 0);
    return () => { document.removeEventListener('keydown', k); document.removeEventListener('mousedown', d); clearTimeout(t); };
  }, [onClose]);
  const small = typeof window !== 'undefined' && window.innerWidth < 640;
  return createPortal(
    <motion.div ref={ref} role="dialog" aria-label={label}
      initial={reduce ? false : { opacity: 0, y: small ? 24 : 4, scale: small ? 1 : .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .15 }}
      style={small ? { left: 8, right: 8, bottom: 8 } : { left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      className="fixed z-[80] max-h-[70vh] overflow-auto rounded-xl border border-line bg-surface p-3 shadow-pop sm:w-72">
      {children}
    </motion.div>, document.body);
}

export function TaskChip({ t, date, dragging, onOpen, onDragStart, onDragEnd, compact }: {
  t: Task; date: string; dragging?: boolean; compact?: boolean;
  onOpen: (t: Task, el: Element) => void; onDragStart: (t: Task) => void; onDragEnd: () => void;
}) {
  const overdue = t.effective_status === 'overdue'; const done = isDone(t); const deadline = t.due_date === date;
  return (
    <button type="button" draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/task-id', String(t.id)); e.dataTransfer.effectAllowed = 'move'; onDragStart(t); }}
      onDragEnd={onDragEnd}
      onClick={(e) => { e.stopPropagation(); onOpen(t, e.currentTarget); }}
      title={`${t.title} (${t.priority})${deadline ? ' - due' : ''}`}
      style={{ background: pcol(t.priority, .12), borderLeftColor: pcol(t.priority), color: 'rgb(var(--fg))' }}
      className={`flex w-full cursor-grab items-center gap-1 truncate rounded-md border-l-[3px] px-1.5 text-left text-caption transition hover:brightness-95 active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent ${compact ? 'py-px' : 'py-0.5'} ${done ? 'line-through opacity-50' : ''} ${overdue ? 'ring-1 ring-danger' : ''} ${dragging ? 'opacity-30' : ''}`}>
      {deadline && <Flag size={10} className="shrink-0 text-danger" aria-label="Deadline" />}
      {t.start_time && <span className="shrink-0 text-fg-muted">{fmtTime(t.start_time)}</span>}
      <span className="truncate">{t.title}</span>
    </button>
  );
}

export function TaskDetail({ t, onClose, onComplete, onEdit, busy }: { t: Task; onClose: () => void; onComplete: () => void; onEdit: () => void; busy?: boolean }) {
  const done = isDone(t);
  return (
    <div>
      <div className="flex items-start gap-2">
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: pcol(t.priority) }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={`font-semibold leading-snug ${done ? 'line-through opacity-60' : ''}`}>{t.title}</p>
          <p className="text-caption capitalize text-fg-muted">{t.priority} priority - {t.effective_status.replace('_', ' ')}</p>
        </div>
        <button className="icon-btn -mr-1 -mt-1" aria-label="Close" onClick={onClose}><X size={16} /></button>
      </div>
      <dl className="mt-2 space-y-1 text-caption text-fg-muted">
        {(t.start_date || t.due_date) && <div className="flex items-center gap-1.5"><Clock size={12} />{t.start_date && fmtDate(t.start_date)}{t.start_time && ` ${fmtTime(t.start_time)}`}{t.due_date && <span className="inline-flex items-center gap-1"> {t.start_date ? '- ' : ''}<Flag size={10} className="text-danger" />due {fmtDate(t.due_date)}</span>}</div>}
        {t.project_name && <div className="flex items-center gap-1.5"><FolderOpen size={12} />{t.project_name}</div>}
      </dl>
      {t.description && <p className="mt-2 line-clamp-3 text-sm text-fg-muted">{t.description}</p>}
      <div className="mt-3 flex gap-2">
        {!done && <button className="btn-primary flex-1 !py-1.5" disabled={busy} onClick={onComplete}><Check size={14} />Complete</button>}
        <button className="btn-ghost flex-1 !py-1.5" onClick={onEdit}><Pencil size={14} />Edit</button>
      </div>
    </div>
  );
}
