import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { notifIssuePath } from '../components/shell/JiraQuickSearch';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BellRing, Check, CheckCheck, Info, Settings as Cog, Send, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import type { AppNotification } from '../lib/types';
import { disablePush, enablePush, getPushState, type PushState } from '../lib/push';
import ErrorBanner from '../components/ErrorBanner';
import EmptyState from '../components/EmptyState';
import { SkeletonList } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { KIND_META, classify, group, isRead, when, type NKind } from '../features/notifications/kinds';

const STATE_TEXT: Record<PushState, string> = {
  unsupported: 'Not supported by this browser/device',
  denied: 'Blocked in browser settings',
  default: 'Not enabled yet',
  granted: 'Permission granted, but not subscribed',
  subscribed: 'Enabled on this device',
};
const FILTERS: ({ k: 'all' | NKind; l: string })[] = [{ k: 'all', l: 'All' }, { k: 'urgent', l: 'Overdue' }, { k: 'reminder', l: 'Reminders' }, { k: 'summary', l: 'Summaries' }, { k: 'general', l: 'General' }];

export default function Notifications() {
  const qc = useQueryClient();
  const toast = useToast();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [kind, setKind] = useState<'all' | NKind>('all');
  const reduce = useReducedMotion();
  const [push, setPush] = useState<PushState>('default');
  const [busy, setBusy] = useState(false);
  useEffect(() => { getPushState().then(setPush).catch(() => setPush('unsupported')); }, []);

  const q = useQuery({
    queryKey: ['notifications', unreadOnly],
    queryFn: async () => { const r = await api.get<AppNotification[] | { items?: AppNotification[] }>('/api/notifications', { unread_only: unreadOnly || undefined, limit: 200 }); return Array.isArray(r) ? r : r.items ?? []; },
    refetchInterval: 30000,
  });
  const err = (e: unknown) => toast(e instanceof Error ? e.message : 'Action failed', 'error');
  const read = useMutation({ mutationFn: (id: number) => api.post(`/api/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries(), onError: err });
  const readAll = useMutation({ mutationFn: () => api.post('/api/notifications/read-all'), onSuccess: () => { qc.invalidateQueries(); toast('All marked as read'); }, onError: err });
  const test = useMutation({ mutationFn: () => api.post('/api/notifications/test'), onSuccess: () => { qc.invalidateQueries(); toast('Test notification sent. Check the list below' + (push === 'subscribed' ? ' and your device.' : '.')); }, onError: err });

  const toggleOS = async () => {
    setBusy(true);
    try {
      const s = push === 'subscribed' ? await disablePush() : await enablePush();
      setPush(s);
      if (s === 'denied') toast('Permission denied. Enable notifications for this site in your browser settings.', 'error');
      else if (s === 'subscribed') toast('OS notifications enabled');
      else if (s === 'granted') toast('Permission granted, but push is not configured on the server (no VAPID key).', 'error');
    } catch (e) { err(e); } finally { setBusy(false); }
  };

  const all = q.data ?? [];
  const list = useMemo(() => all.filter((n) => kind === 'all' || classify(n) === kind), [all, kind]);
  const unread = all.filter((n) => !isRead(n)).length;
  const groups = (['Today', 'Yesterday', 'Earlier'] as const).map((g) => ({ g, items: list.filter((n) => group(when(n)) === g) })).filter((x) => x.items.length);
  const row = (n: AppNotification) => {
    const k = classify(n); const m = KIND_META[k]; const Icon = m.icon; const r = isRead(n);
    return (
      <motion.li layout={!reduce} key={n.id} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
        className={`card relative flex items-start gap-3 overflow-hidden p-3 pl-4 ${r ? '' : 'bg-accent-soft/40'} ${k === 'urgent' && !r ? 'ring-1 ring-danger/40' : ''}`}>
        <span className={`absolute inset-y-0 left-0 w-1 ${m.bar} ${r ? 'opacity-30' : ''}`} aria-hidden />
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${m.tone}`} aria-hidden><Icon size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${r ? 'font-medium text-fg-muted' : 'font-semibold'}`}>{n.title}</span>
            <span className="chip">{m.label.replace(/s$/, '')}</span>
            {!r && <span className="sr-only">Unread</span>}
          </div>
          {(n.body || n.message) && <p className="mt-0.5 text-sm text-fg-muted">{n.body || n.message}</p>}
          {notifIssuePath(n) && <Link to={notifIssuePath(n) as string} className="mt-1 inline-block text-sm font-medium text-accent hover:underline">Open issue</Link>}
          <p className="mt-1 text-caption text-fg-muted">{when(n).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
        </div>
        {!r ? <button className="icon-btn" aria-label="Mark as read" title="Mark as read" onClick={() => read.mutate(n.id)}><Check size={16} /></button> : null}
      </motion.li>
    );
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-page">Notifications</h1><p className="text-sm text-fg-muted">{unread ? `${unread} unread` : 'You are all caught up'}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />Unread only</label>
          <button className="btn-ghost" onClick={() => readAll.mutate()} disabled={readAll.isPending || unread === 0}><CheckCheck size={16} />Mark all read</button>
          <Link to="/settings" className="btn-ghost"><Cog size={16} />Settings</Link>
        </div>
      </div>

      <section className="card space-y-3 p-4" aria-labelledby="os-h">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent"><BellRing size={18} /></span>
            <div><h2 id="os-h" className="text-section">OS / push notifications</h2>
              <p className="text-sm text-fg-muted">Status: <strong className="text-fg">{STATE_TEXT[push]}</strong></p></div>
          </div>
          <div className="flex gap-2">
            {push !== 'unsupported' && push !== 'denied' && <button className="btn-primary" disabled={busy} onClick={toggleOS}>{busy ? 'Working...' : push === 'subscribed' ? 'Disable OS notifications' : 'Enable OS notifications'}</button>}
            <button className="btn-ghost" disabled={test.isPending} onClick={() => test.mutate()}><Send size={14} />{test.isPending ? 'Sending...' : 'Send test'}</button>
          </div>
        </div>
        {push === 'denied' && <div role="alert" className="flex gap-2 rounded-lg bg-danger/10 p-3 text-sm text-danger"><ShieldAlert size={16} className="mt-0.5 shrink-0" />Notifications are blocked for this site. Click the lock/site-info icon in your address bar, set Notifications to Allow, then reload this page. The app cannot re-prompt once blocked.</div>}
        {push === 'unsupported' && <div role="alert" className="rounded-lg bg-warning/15 p-3 text-sm text-fg">This browser does not support web push. On iPhone/iPad, push only works after you add the app to the Home Screen (iOS 16.4+). In-app notifications below still work.</div>}
        <details className="group rounded-lg bg-surface-2 p-3 text-xs text-fg-muted" open={push === 'denied' || push === 'unsupported' ? true : undefined}>
          <summary className="flex cursor-pointer items-center gap-2 font-medium text-fg"><Info size={14} />In-app vs OS notifications</summary>
          <div className="mt-2 space-y-1.5">
            <p><strong>In-app notifications</strong> are saved to your account and appear in this list and the bell icon while the app is open (refreshed about every 30 seconds). They are always on, but you only see them when you open TaskFlow.</p>
            <p><strong>OS / push notifications</strong> are delivered by your browser's push service to your device, even when the tab is closed. They need your permission, a supported browser (HTTPS required), and are enabled per device and browser. Delivery timing is controlled by the browser/OS and may be delayed by battery saver, Do Not Disturb or focus modes, and the server checks for due reminders about once a minute.</p>
            <p>If you deny the permission prompt, only in-app notifications will be delivered until you allow them in browser settings.</p>
          </div>
        </details>
      </section>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by type">
        {FILTERS.map((f) => <button key={f.k} aria-pressed={kind === f.k} onClick={() => setKind(f.k)}
          className={`rounded-full border px-3 py-1 text-sm transition ${kind === f.k ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-fg-muted hover:text-fg'}`}>{f.l}</button>)}
      </div>

      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? <SkeletonList rows={5} /> : list.length === 0 && !q.error ? <EmptyState title={unreadOnly ? 'No unread notifications' : kind !== 'all' ? 'Nothing in this category' : 'No notifications yet'} hint="Reminders, daily summaries and overdue alerts will show up here." />
        : <div className="space-y-5">{groups.map(({ g, items }) => (
          <section key={g} aria-label={g}><h2 className="mb-2 text-caption font-semibold uppercase tracking-wide text-fg-muted">{g}</h2>
            <ul className="space-y-2"><AnimatePresence initial={false}>{items.map(row)}</AnimatePresence></ul></section>))}</div>}
    </div>
  );
}
