import { useId, type ReactNode } from 'react';
import { motion } from 'motion/react';

export interface TabItem { id: string; label: ReactNode; count?: number }
export function Tabs({ tabs, value, onChange, className = '' }: { tabs: TabItem[]; value: string; onChange: (id: string) => void; className?: string }) {
  const gid = useId();
  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === value);
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (n === null) return;
    e.preventDefault();
    const t = tabs[(n + tabs.length) % tabs.length]; onChange(t.id);
    requestAnimationFrame(() => document.getElementById(`${gid}-${t.id}`)?.focus());
  };
  return (
    <div role="tablist" onKeyDown={onKey} className={`inline-flex gap-1 rounded-xl bg-surface-2 p-1 ${className}`}>
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button key={t.id} id={`${gid}-${t.id}`} role="tab" type="button" aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => onChange(t.id)}
            className={`relative min-h-8 rounded-lg px-3 py-1 text-sm font-medium transition-colors ${on ? 'text-fg' : 'text-fg-muted hover:text-fg'}`}>
            {on && <motion.span layoutId={`${gid}-pill`} className="absolute inset-0 rounded-lg bg-surface shadow-sm" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            <span className="relative flex items-center gap-1.5">{t.label}{t.count !== undefined && <span className="text-caption text-fg-muted">{t.count}</span>}</span>
          </button>
        );
      })}
    </div>
  );
}
export default Tabs;
