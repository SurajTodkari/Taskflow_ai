import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

type Tone = 'brand' | 'green' | 'amber' | 'red' | 'sky';
const TONES: Record<Tone, { soft: string; text: string; color: string }> = {
  brand: { soft: 'bg-accent-soft', text: 'text-accent', color: 'rgb(var(--accent))' },
  green: { soft: 'bg-success/15', text: 'text-success', color: 'rgb(var(--success))' },
  amber: { soft: 'bg-warning/15', text: 'text-warning', color: 'rgb(var(--warning))' },
  red: { soft: 'bg-danger/15', text: 'text-danger', color: 'rgb(var(--danger))' },
  sky: { soft: 'bg-accent-soft', text: 'text-accent', color: 'rgb(var(--accent))' },
};

/** Circular progress ring (0-100). */
export function ProgressRing({ value, size = 48, stroke = 5, color }: { value: number; size?: number; stroke?: number; color: string }) {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--line))" strokeWidth={stroke} />
      <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} initial={{ strokeDashoffset: reduce ? c * (1 - pct / 100) : c }} animate={{ strokeDashoffset: c * (1 - pct / 100) }}
        transition={{ duration: reduce ? 0 : 0.9, ease: [0.2, 0.8, 0.2, 1] }} />
    </svg>
  );
}

export default function StatCard({ label, value, icon, tone = 'brand', suffix, onClick, active, ring, hint }: {
  onClick?: () => void; active?: boolean; label: string; value: ReactNode; icon?: ReactNode; tone?: Tone; suffix?: string;
  /** optional 0-100 progress ring shown instead of the icon */
  ring?: number; hint?: string;
}) {
  const t = TONES[tone];
  const cls = `card relative flex items-center gap-3 p-4 text-left ${onClick ? 'cursor-pointer transition duration-200 hover:-translate-y-0.5 hover:shadow-pop focus-visible:outline-none' : ''} ${active ? 'ring-2 ring-accent' : ''}`;
  const Wrap: any = onClick ? 'button' : 'div';
  return (
    <Wrap className={cls} {...(onClick ? { type: 'button', onClick, 'aria-pressed': !!active } : {})}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-caption font-medium text-fg-muted">{label}</div>
        <div className="mt-1.5 text-3xl font-bold leading-none tracking-tight tabular-nums text-fg">{value}{suffix && <span className="text-lg font-semibold text-fg-muted">{suffix}</span>}</div>
        {hint && <div className="mt-1.5 truncate text-caption text-fg-muted">{hint}</div>}
      </div>
      {ring !== undefined ? (
        <div className="relative"><ProgressRing value={ring} color={t.color} />
          <div className={`absolute inset-0 flex items-center justify-center ${t.text}`} aria-hidden>{icon}</div></div>
      ) : icon && <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${t.soft} ${t.text}`} aria-hidden>{icon}</div>}
    </Wrap>
  );
}
