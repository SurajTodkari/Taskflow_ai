import type { ReactNode } from 'react';
type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
const T: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-muted', accent: 'bg-accent-soft text-accent',
  success: 'bg-success/15 text-success', warning: 'bg-warning/15 text-warning', danger: 'bg-danger/15 text-danger',
};
export function Badge({ tone = 'neutral', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium ${T[tone]} ${className}`}>{children}</span>;
}
export default Badge;
