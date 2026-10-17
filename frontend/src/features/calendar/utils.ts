import type { Task } from '../../lib/types';
import { addDays, localISO } from '../../lib/dates';

export type View = 'day' | 'week' | 'month' | 'year';
export const parse = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
export const diffDays = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
export const weekStart = (iso: string) => { const d = parse(iso); return addDays(iso, -((d.getDay() + 6) % 7)); };
export const sched = (t: Task) => t.start_date || t.due_date || t.queued_date || '';
export const isDone = (t: Task) => t.status === 'completed' || t.status === 'cancelled';
export const asArr = (r: unknown): Task[] => Array.isArray(r) ? r as Task[] : ((r as { items?: Task[] })?.items ?? (r as { tasks?: Task[] })?.tasks ?? []);
export const days = (s: string, e: string) => { const r: string[] = []; for (let d = s; d <= e; d = addDays(d, 1)) r.push(d); return r; };

/** CSS var channel per priority (rgb triplet var name). */
export const PVAR: Record<string, string> = { critical: '--danger', high: '--warning', medium: '--accent', low: '--fg-muted' };
export const pcol = (p: string, a = 1) => `rgb(var(${PVAR[p] ?? '--fg-muted'}) / ${a})`;

export function range(view: View, anchor: string): [string, string] {
  if (view === 'day') return [anchor, anchor];
  if (view === 'week') { const s = weekStart(anchor); return [s, addDays(s, 6)]; }
  if (view === 'month') {
    const d = parse(anchor); const first = localISO(new Date(d.getFullYear(), d.getMonth(), 1));
    const last = localISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    return [weekStart(first), addDays(weekStart(last), 6)];
  }
  const y = parse(anchor).getFullYear(); return [`${y}-01-01`, `${y}-12-31`];
}
export const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
