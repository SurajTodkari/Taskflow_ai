import { useQuery } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import EmptyState from '../../components/EmptyState';
import ErrorBanner from '../../components/ErrorBanner';
import { Skeleton } from '../../components/Skeleton';
import { fmtDate } from '../../lib/dates';
import { jiraApi } from '../../lib/jiraApi';
import { useProjectCtx } from '../../features/jira/ctx';

const day = (s?: string | null) => (s ? new Date(s.slice(0, 10) + 'T00:00:00').getTime() : NaN);

export default function Roadmap() {
  const { project, openIssue } = useProjectCtx();
  const q = useQuery({ queryKey: ['jira', 'roadmap', project.key], queryFn: () => jiraApi.roadmap(project.key) });
  if (q.isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (q.error) return <ErrorBanner error={q.error} onRetry={() => q.refetch()} />;
  const epics = q.data ?? [];
  if (!epics.length) return <EmptyState icon={Zap} title="No epics yet" hint="Create epics and give them start and due dates to see them on the roadmap." />;
  const starts = epics.map((e) => day(e.start_date ?? e.issue?.start_date)).filter(Number.isFinite);
  const ends = epics.map((e) => day(e.due_date ?? e.issue?.due_date)).filter(Number.isFinite);
  const all = [...starts, ...ends];
  const min = all.length ? Math.min(...all) : Date.now();
  const max = all.length ? Math.max(...all, min + 864e5 * 7) : min + 864e5 * 30;
  const span = max - min || 1;
  const todayPct = Math.min(100, Math.max(0, ((Date.now() - min) / span) * 100));
  return (
    <div className="card overflow-x-auto p-4">
      <div className="min-w-[640px] space-y-2">
        <div className="flex justify-between pl-56 text-caption text-fg-muted"><span>{fmtDate(new Date(min).toISOString().slice(0, 10))}</span><span>{fmtDate(new Date(max).toISOString().slice(0, 10))}</span></div>
        {epics.map((e) => {
          const s = day(e.start_date ?? e.issue?.start_date), d = day(e.due_date ?? e.issue?.due_date);
          const has = Number.isFinite(s) || Number.isFinite(d);
          const a = Number.isFinite(s) ? s : d, b = Number.isFinite(d) ? d : s;
          const left = has ? ((a - min) / span) * 100 : 0;
          const width = has ? Math.max(2, ((b - a) / span) * 100) : 0;
          const pct = Math.round(e.percent ?? (e.children_total ? (e.children_done / e.children_total) * 100 : 0));
          return (
            <div key={e.issue.id} className="flex items-center gap-3">
              <button className="w-56 shrink-0 truncate text-left text-sm hover:text-accent" title={e.issue.title} onClick={() => openIssue(e.issue.key)}>
                <span className="mr-1.5 text-xs text-fg-muted">{e.issue.key}</span>{e.issue.title}</button>
              <div className="relative h-7 flex-1 rounded-lg bg-surface-2">
                <span className="absolute inset-y-0 w-px bg-danger/60" style={{ left: `${todayPct}%` }} aria-hidden />
                {has ? <div className="absolute inset-y-1 overflow-hidden rounded-md bg-accent/30" style={{ left: `${left}%`, width: `${width}%` }} role="img" aria-label={`${e.issue.title}: ${pct}% done, ${e.children_done} of ${e.children_total} issues`}>
                  <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                  <span className="absolute inset-0 truncate px-2 text-caption font-medium leading-5 text-fg">{pct}%{e.version ? ` · ${e.version.name}` : ''}</span></div>
                  : <span className="absolute inset-y-0 left-2 text-caption leading-7 text-fg-muted">No dates · {pct}% ({e.children_done}/{e.children_total})</span>}
              </div>
            </div>);
        })}
      </div>
    </div>
  );
}
