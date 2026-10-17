import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { User, Bell, Clock, Palette, BellRing, Check } from 'lucide-react';
import { api } from '../lib/api';
import type { Settings as S } from '../lib/types';
import { setTheme } from '../lib/theme';
import { disablePush, enablePush, getPushState, type PushState } from '../lib/push';
import ErrorBanner from '../components/ErrorBanner';
import { SkeletonList } from '../components/Skeleton';
import { useToast } from '../components/Toast';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NOTIFY: ['notify_morning' | 'notify_evening' | 'notify_tomorrow' | 'notify_reminders' | 'notify_overdue' | 'jira_email_notifications', string][] = [['jira_email_notifications', 'Email me about Jira invites, assignments and mentions (if email is enabled)'], ['notify_morning', 'Morning summary'], ['notify_evening', 'Evening summary'], ['notify_tomorrow', 'Tomorrow preview'], ['notify_reminders', 'Task reminders'], ['notify_overdue', 'Overdue alerts']];
const hhmm = (v: string) => (v ?? '').slice(0, 5);
const time = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM');
const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  timezone: z.string().min(1),
  theme: z.enum(['light', 'dark', 'system']),
  work_start: time, work_end: time, morning_time: time, evening_time: time, tomorrow_time: time,
  default_reminder_minutes: z.coerce.number().int().min(0, 'Min 0').max(10080, 'Max 10080'),
  weekend_days: z.array(z.number()),
  notify_morning: z.boolean(), notify_evening: z.boolean(), notify_tomorrow: z.boolean(), notify_reminders: z.boolean(), notify_overdue: z.boolean(), jira_email_notifications: z.boolean().optional(),
  defaultsText: z.string().refine((v) => { try { JSON.parse(v || '{}'); return true; } catch { return false; } }, 'Must be valid JSON'),
}).refine((v) => v.work_end > v.work_start, { path: ['work_end'], message: 'Must be after work start' });
type F = z.input<typeof schema>;
type FOut = z.output<typeof schema>;

function zones(): string[] {
  try { const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf; if (f) return f('timeZone'); } catch { /* ignore */ }
  return ['UTC'];
}
const Err = ({ m }: { m?: string }) => (m ? <p className="mt-1 text-xs text-danger" role="alert">{m}</p> : null);
function Section({ icon: Icon, title, desc, children }: { icon: typeof User; title: string; desc?: string; children: React.ReactNode }) {
  return (<section className="card p-5"><div className="mb-4 flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><Icon size={18} /></span>
    <div><h2 className="text-section font-semibold">{title}</h2>{desc && <p className="text-xs text-fg-muted">{desc}</p>}</div></div><div className="space-y-4">{children}</div></section>);
}
function Toggle({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (<label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface-2">{label}
    <input type="checkbox" role="switch" className="peer sr-only" {...rest} /><span aria-hidden className="relative h-5 w-9 shrink-0 rounded-full bg-line transition peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4" /></label>);
}

export default function Settings() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<S>('/api/settings') });
  const [push, setPush] = useState<PushState>('default');
  const [saved, setSaved] = useState(false);
  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isDirty } } = useForm<F, unknown, FOut>({ resolver: zodResolver(schema) });
  const tz = watch('timezone');
  const weekend = watch('weekend_days') ?? [];
  const tzs = useMemo(() => { const z = zones(); return tz && !z.includes(tz) ? [tz, ...z] : z; }, [tz]);
  useEffect(() => {
    const d = q.data; if (!d) return;
    reset({ ...d, jira_email_notifications: d.jira_email_notifications ?? true, morning_time: hhmm(d.morning_time), evening_time: hhmm(d.evening_time), tomorrow_time: hhmm(d.tomorrow_time), work_start: hhmm(d.work_start), work_end: hhmm(d.work_end), defaultsText: JSON.stringify(d.recurring_defaults ?? {}, null, 2) });
  }, [q.data, reset]);
  useEffect(() => { getPushState().then(setPush).catch(() => setPush('unsupported')); }, []);
  const save = useMutation({
    mutationFn: (b: S) => api.patch<S>('/api/settings', b),
    onSuccess: (r) => { qc.invalidateQueries(); if (r?.theme) setTheme(r.theme); toast('Settings saved'); setSaved(true); setTimeout(() => setSaved(false), 2500); },
    onError: (e) => toast(e instanceof Error ? e.message : 'Save failed', 'error'),
  });
  if (q.isLoading || !q.data) return <div className="max-w-3xl space-y-4"><h1 className="text-page font-semibold">Settings</h1>{q.error ? <ErrorBanner error={q.error} onRetry={() => q.refetch()} /> : <SkeletonList rows={6} />}</div>;
  const submit = handleSubmit((v) => {
    const { defaultsText, ...rest } = v;
    save.mutate({ ...rest, recurring_defaults: JSON.parse(defaultsText || '{}') } as S);
  });
  const togglePush = async () => {
    try { const s = push === 'subscribed' ? await disablePush() : await enablePush(); setPush(s); if (s === 'denied') toast('Permission denied. Allow notifications in your browser site settings.', 'error'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'error'); }
  };
  const pushLabel = push === 'subscribed' ? 'Enabled' : push === 'denied' ? 'Blocked in browser' : push === 'unsupported' ? 'Unsupported here' : push === 'granted' ? 'Granted (not subscribed)' : 'Not enabled';
  const timeField = (id: string, name: 'work_start' | 'work_end' | 'morning_time' | 'evening_time' | 'tomorrow_time', lab: string) => (
    <div><label className="label" htmlFor={id}>{lab}</label><input id={id} type="time" className="input" {...register(name)} /><Err m={errors[name]?.message} /></div>);
  return (
    <form onSubmit={submit} className="max-w-3xl space-y-5" noValidate>
      <div><h1 className="text-page font-semibold">Settings</h1><p className="text-sm text-fg-muted">Personalize how TaskFlow works and notifies you.</p></div>
      <Section icon={User} title="Profile" desc="Your name and timezone.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="sn">Name</label><input id="sn" className="input" {...register('name')} /><Err m={errors.name?.message} /></div>
          <div><label className="label" htmlFor="stz">Timezone</label><select id="stz" className="input" {...register('timezone')}>{tzs.map((z) => <option key={z}>{z}</option>)}</select></div>
        </div>
      </Section>
      <Section icon={Clock} title="Schedule" desc="Working hours and weekend days.">
        <div className="grid gap-3 sm:grid-cols-2">{timeField('sws', 'work_start', 'Work start')}{timeField('swe', 'work_end', 'Work end')}</div>
        <fieldset><legend className="label">Weekend days</legend><div className="flex flex-wrap gap-2">{DAYS.map((d, i) => (
          <label key={d} className={`cursor-pointer rounded-full border px-3 py-1 text-sm transition focus-within:ring-2 focus-within:ring-accent ${weekend.includes(i) ? 'border-accent bg-accent-soft text-accent' : 'border-line hover:bg-surface-2'}`}>
            <input type="checkbox" className="sr-only" checked={weekend.includes(i)} onChange={(e) => setValue('weekend_days', e.target.checked ? [...weekend, i].sort() : weekend.filter((x) => x !== i), { shouldDirty: true })} />{d}</label>))}</div></fieldset>
      </Section>
      <Section icon={Bell} title="Notifications" desc="Times use your selected timezone. The server checks about once a minute, so delivery can be up to a minute late.">
        <div className="grid gap-3 sm:grid-cols-4">
          {timeField('sm', 'morning_time', 'Morning')}{timeField('se', 'evening_time', 'Evening')}{timeField('stm', 'tomorrow_time', 'Tomorrow preview')}
          <div><label className="label" htmlFor="sr">Reminder (min before)</label><input id="sr" type="number" className="input" {...register('default_reminder_minutes')} /><Err m={errors.default_reminder_minutes?.message} /></div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">{NOTIFY.map(([k, l]) => <Toggle key={k} label={l} {...register(k)} />)}</div>
      </Section>
      <Section icon={BellRing} title="Push permission" desc="Browser notifications on this device.">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 p-3 text-sm">
          <span className="inline-flex items-center gap-2">Status: <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${push === 'subscribed' ? 'bg-success/15 text-success' : push === 'denied' ? 'bg-danger/15 text-danger' : 'bg-surface text-fg-muted'}`}>{pushLabel}</span></span>
          {push !== 'unsupported' && push !== 'denied' && <button type="button" className="btn-ghost" onClick={togglePush}>{push === 'subscribed' ? 'Disable on this device' : 'Enable on this device'}</button>}
          {push === 'denied' && <span className="text-xs text-danger">Allow notifications for this site in browser settings, then reload.</span>}
        </div>
      </Section>
      <Section icon={Palette} title="Appearance" desc="Theme and recurring task defaults.">
        <div><label className="label" htmlFor="sth">Theme</label><select id="sth" className="input max-w-xs" {...register('theme', { onChange: (e) => setTheme(e.target.value) })}>
          <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
        <div><label className="label" htmlFor="srd">Recurring defaults (JSON applied to new recurring tasks)</label>
          <textarea id="srd" rows={4} className="input font-mono text-xs" {...register('defaultsText')} /><Err m={errors.defaultsText?.message} /></div>
      </Section>
      <div className="sticky bottom-3 z-10 flex items-center justify-end gap-3 rounded-2xl border border-line bg-surface/90 p-3 shadow-pop backdrop-blur">
        <span className="text-xs text-fg-muted" role="status">{saved ? <span className="inline-flex items-center gap-1 text-success"><Check size={14} />All changes saved</span> : isDirty ? 'Unsaved changes' : ''}</span>
        <button className="btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving...' : 'Save settings'}</button></div>
    </form>
  );
}
