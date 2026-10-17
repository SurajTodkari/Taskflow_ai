import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '../../lib/api';
import type { AppNotification } from '../../lib/types';
import { Popover } from '../ui/Popover';

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'now'; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`; return `${Math.floor(s / 86400)}d`;
}
const isRead = (n: AppNotification) => Boolean(n.read ?? n.is_read);

export default function NotificationBell({ count }: { count: number }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['notifications-latest'],
    queryFn: async () => {
      const r = await api.get<AppNotification[] | { items?: AppNotification[] }>('/api/notifications', { limit: 6 });
      return Array.isArray(r) ? r : r.items ?? [];
    },
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['notifications-latest'] }); qc.invalidateQueries({ queryKey: ['unread-count'] }); qc.invalidateQueries({ queryKey: ['notifications'] }); };
  const read = useMutation({ mutationFn: (id: number) => api.post(`/api/notifications/${id}/read`), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => api.post('/api/notifications/read-all'), onSuccess: refresh });
  return (
    <Popover width="w-[22rem]" trigger={(p) => (
      <button {...p} className="icon-btn relative !h-10 !w-10 sm:!h-9 sm:!w-9" aria-label={`Notifications${count ? `, ${count} unread` : ''}`}>
        <Bell size={18} />{count > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{count > 99 ? '99+' : count}</span>}
      </button>)}>
      {(close) => (<div>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <button className="flex items-center gap-1 text-xs font-medium text-accent disabled:opacity-40" disabled={!count || readAll.isPending} onClick={() => readAll.mutate()}><CheckCheck size={14} />Mark all read</button>
        </div>
        <ul className="max-h-80 overflow-y-auto">
          {(list.data ?? []).length === 0 && <li className="px-4 py-8 text-center text-sm text-fg-muted">{list.isLoading ? 'Loading...' : "You're all caught up."}</li>}
          {(list.data ?? []).map((n) => (
            <li key={n.id} className="border-b border-line last:border-0">
              <button className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2" onClick={() => { if (!isRead(n)) read.mutate(n.id); }} aria-label={isRead(n) ? n.title : `${n.title} (unread, mark as read)`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isRead(n) ? 'bg-transparent' : 'bg-accent'}`} />
                <span className="min-w-0 flex-1"><span className={`block truncate text-sm ${isRead(n) ? 'text-fg-muted' : 'font-medium'}`}>{n.title}</span>
                  <span className="line-clamp-2 text-xs text-fg-muted">{n.body ?? n.message}</span></span>
                <span className="shrink-0 text-caption text-fg-muted">{ago(n.created_at)}</span>
              </button>
            </li>
          ))}
        </ul>
        <Link to="/notifications" onClick={close} className="block border-t border-line px-4 py-3 text-center text-sm font-medium text-accent hover:bg-surface-2">View all</Link>
      </div>)}
    </Popover>
  );
}
