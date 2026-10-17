import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Search, CornerDownLeft, CheckCircle2, Circle } from 'lucide-react';
import { listTasks } from '../../lib/api';
import type { Task } from '../../lib/types';
import { NAV } from './nav';
import { Spinner } from '../ui/Spinner';

export default function SearchPalette({ open, onOpen, onClose, onOpenTask }: { open: boolean; onOpen: () => void; onClose: () => void; onOpenTask: (t: Task) => void }) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [idx, setIdx] = useState(0);
  const nav = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 200); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (open) { setQ(''); setDq(''); setIdx(0); setTimeout(() => input.current?.focus(), 30); } }, [open]);
  const res = useQuery({ queryKey: ['search', dq], queryFn: () => listTasks({ search: dq, limit: 8 }), enabled: open && dq.length > 0, refetchInterval: false });
  const tasks = dq ? res.data?.items ?? [] : [];
  const pages = (dq ? NAV.filter((n) => n.label.toLowerCase().includes(dq.toLowerCase())) : NAV.slice(0, 5)).slice(0, 5);
  const rows: ({ kind: 'task'; t: Task } | { kind: 'page'; to: string; label: string; Icon: typeof Search })[] = [
    ...tasks.map((t) => ({ kind: 'task' as const, t })),
    ...pages.map((p) => ({ kind: 'page' as const, to: p.to, label: p.label, Icon: p.icon })),
  ];
  useEffect(() => setIdx(0), [dq, res.data]);
  const go = (i: number) => {
    const r = rows[i]; if (!r) return;
    onClose();
    if (r.kind === 'task') onOpenTask(r.t); else nav(r.to);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(idx); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  return (
    <>
      <button onClick={onOpen} aria-label="Search tasks" className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-3 text-sm text-fg-muted transition-colors hover:bg-surface-2 sm:h-9 sm:max-w-md">
        <Search size={15} aria-hidden /><span className="flex-1 truncate text-left">Search tasks...</span><kbd className="hidden rounded border border-line bg-surface px-1.5 text-caption sm:inline">Ctrl K</kbd>
      </button>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[55] flex items-start justify-center p-4 pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <motion.div className="absolute inset-0 bg-fg/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-hidden onClick={onClose} />
            <motion.div role="dialog" aria-modal="true" aria-label="Search" initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.15 }}
              className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-pop" onKeyDown={onKey}>
              <div className="flex items-center gap-3 border-b border-line px-4">
                <Search size={16} className="text-fg-muted" aria-hidden />
                <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks or jump to a page" role="combobox" aria-expanded aria-controls="search-results" aria-activedescendant={`sr-${idx}`}
                  className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-muted focus-visible:ring-0 focus-visible:ring-offset-0" />
                {res.isFetching && <Spinner size={14} className="text-fg-muted" />}
              </div>
              <ul id="search-results" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
                {dq && !res.isFetching && tasks.length === 0 && <li className="px-3 py-2 text-xs text-fg-muted">No tasks match "{dq}"</li>}
                {rows.map((r, i) => (
                  <li key={i} id={`sr-${i}`} role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onClick={() => go(i)}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${i === idx ? 'bg-accent-soft text-fg' : ''}`}>
                    {r.kind === 'task' ? (<>
                      {r.t.status === 'completed' ? <CheckCircle2 size={16} className="text-success" /> : <Circle size={16} className="text-fg-muted" />}
                      <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.t.title}</span>{(r.t.project_name || r.t.due_date) && <span className="block truncate text-caption text-fg-muted">{[r.t.project_name, r.t.due_date].filter(Boolean).join(' · ')}</span>}</span>
                    </>) : (<><r.Icon size={16} className="text-fg-muted" /><span className="flex-1">Go to {r.label}</span></>)}
                    {i === idx && <CornerDownLeft size={13} className="text-fg-muted" aria-hidden />}
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
