import { AlertTriangle, Bell, CalendarCheck, Sunrise, Moon, type LucideIcon } from 'lucide-react';
import type { AppNotification } from '../../lib/types';

export type NKind = 'urgent' | 'reminder' | 'summary' | 'general';
export const KIND_META: Record<NKind, { label: string; icon: LucideIcon; tone: string; bar: string }> = {
  urgent: { label: 'Overdue alerts', icon: AlertTriangle, tone: 'bg-danger/10 text-danger', bar: 'bg-danger' },
  reminder: { label: 'Reminders', icon: Bell, tone: 'bg-warning/15 text-warning', bar: 'bg-warning' },
  summary: { label: 'Daily summaries', icon: Sunrise, tone: 'bg-accent-soft text-accent', bar: 'bg-accent' },
  general: { label: 'General', icon: CalendarCheck, tone: 'bg-surface-2 text-fg-muted', bar: 'bg-fg-muted' },
};
export const SUMMARY_ICON = { morning: Sunrise, evening: Moon, tomorrow: CalendarCheck };

export function classify(n: AppNotification): NKind {
  const s = `${n.kind ?? ''} ${n.type ?? ''} ${(n as { dedupe_key?: string }).dedupe_key ?? ''} ${n.title}`.toLowerCase();
  if (/overdue/.test(s)) return 'urgent';
  if (/reminder|remind/.test(s)) return 'reminder';
  if (/morning|evening|tomorrow|summary|daily/.test(s)) return 'summary';
  return 'general';
}
export const isRead = (n: AppNotification) => Boolean(n.read ?? n.is_read);
export const when = (n: AppNotification) => new Date(n.created_at.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(n.created_at) ? n.created_at : n.created_at + 'Z');
export function group(d: Date): 'Today' | 'Yesterday' | 'Earlier' {
  const t = new Date(); const sod = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((sod(t) - sod(d)) / 86400000);
  return diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : 'Earlier';
}
