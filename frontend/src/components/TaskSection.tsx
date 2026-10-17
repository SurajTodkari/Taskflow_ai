import type { ReactNode } from 'react';
import type { Task } from '../lib/types';
import TaskCard from './TaskCard';
import EmptyState from './EmptyState';

export default function TaskSection({ title, tasks, onEdit, carry, empty = 'Nothing here', hint, action, id, subtitle, icon, tone = 'default', loading }: {
  title: string; tasks: Task[]; onEdit: (t: Task) => void; carry?: boolean; empty?: string; hint?: string; action?: ReactNode; id?: string;
  subtitle?: string; icon?: ReactNode; tone?: 'default' | 'quiet' | 'deadline'; loading?: boolean;
}) {
  return (
    <section aria-labelledby={id} className="card">
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4 sm:px-5">
        <div className="min-w-0">
          <h2 id={id} className="flex items-center gap-2 text-section text-fg">
            {icon && <span className="text-fg-muted" aria-hidden>{icon}</span>}{title}
            <span className="chip tabular-nums">{tasks.length}</span>
          </h2>
          {subtitle && <p className="text-caption text-fg-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {loading ? (
        <div className="space-y-2 p-4" aria-busy>{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-2" />)}</div>
      ) : tasks.length === 0 ? (
        <div className="px-4 pb-4 sm:px-5"><EmptyState title={empty} hint={hint} /></div>
      ) : (
        <ul className="divide-y divide-line px-1 pb-1 sm:px-2">
          {tasks.map((t) => <li key={t.id}><TaskCard flat task={t} onEdit={onEdit} showCarryActions={carry} quiet={tone === 'quiet'} urgency={tone === 'deadline'} /></li>)}
        </ul>
      )}
    </section>
  );
}
