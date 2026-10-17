import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Activity as ActivityIcon } from 'lucide-react';
import EmptyState from '../../components/EmptyState';
import ErrorBanner from '../../components/ErrorBanner';
import { SkeletonList } from '../../components/Skeleton';
import { jiraApi } from '../../lib/jiraApi';
import type { ActivityItem } from '../../lib/jiraTypes';
import { useProjectCtx } from '../../features/jira/ctx';
import { UserDot } from '../../features/jira/ui';

export function ActivityList({ items }: { items: ActivityItem[] }) {
  if (!items.length) return <EmptyState icon={ActivityIcon} title="No activity yet" />;
  return (
    <ul className="space-y-2">{items.map((a, i) => {
      const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(a.created_at) ? a.created_at : a.created_at + 'Z');
      return (
        <li key={i} className="card flex items-start gap-3 p-3 text-sm">
          <UserDot user={a.user} size={26} />
          <div className="min-w-0 flex-1">
            <p><span className="font-semibold">{a.user?.name ?? 'Someone'}</span> <span className="text-fg-muted">{a.type?.replace(/_/g, ' ')}</span>{' '}
              {a.issue && <Link className="font-medium hover:text-accent hover:underline" to={`/jira/${a.issue.key.split('-')[0]}/issue/${a.issue.key}`}>{a.issue.key} {a.issue.title}</Link>}</p>
            {a.text && <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-fg-muted">{a.text}</p>}
          </div>
          <time className="shrink-0 text-caption text-fg-muted" dateTime={a.created_at}>{Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
        </li>);
    })}</ul>
  );
}

export default function Activity() {
  const { project } = useProjectCtx();
  const q = useQuery({ queryKey: ['jira', 'activity', project.key], queryFn: () => jiraApi.projectActivity(project.key, 50), refetchInterval: 60000 });
  if (q.isLoading) return <SkeletonList rows={6} />;
  if (q.error) return <ErrorBanner error={q.error} onRetry={() => q.refetch()} />;
  return <ActivityList items={q.data ?? []} />;
}
