import type { Project } from '../../lib/types';

export const projectStats = (p: Project) => {
  const counts = (p.task_counts?.by_status ?? {}) as Record<string, number>;
  const total = Object.values(counts).reduce((a, b) => a + Number(b), 0);
  const done = Number(counts.completed ?? 0);
  const active = Number(counts.in_progress ?? 0);
  const pct = Math.round(p.progress_percent ?? 0);
  const status: 'planning' | 'active' | 'done' = total > 0 && (pct >= 100 || done === total) ? 'done' : total === 0 ? 'planning' : 'active';
  return { counts, total, done, active, pct, status };
};

export const STATUS_BADGE = {
  planning: { label: 'Planning', cls: 'bg-surface-2 text-fg-muted' },
  active: { label: 'Active', cls: 'bg-accent-soft text-accent' },
  done: { label: 'Completed', cls: 'bg-success/15 text-success' },
} as const;

export function ProgressRing({ pct, size = 56, stroke = 5, color = 'rgb(var(--accent))' }: { pct: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--line))" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, pct) / 100)} style={{ transition: 'stroke-dashoffset .5s var(--ease)' }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">{pct}%</span>
    </div>
  );
}
