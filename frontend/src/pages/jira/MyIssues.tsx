import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ListChecks } from 'lucide-react';
import ErrorBanner from '../../components/ErrorBanner';
import EmptyState from '../../components/EmptyState';
import { SkeletonList } from '../../components/Skeleton';
import { Tabs } from '../../components/ui/Tabs';
import { jiraApi } from '../../lib/jiraApi';
import { IssueTable } from '../../features/jira/IssueTable';
import { issuePath } from '../../features/jira/ui';

export default function MyIssues() {
  const nav = useNavigate();
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const q = useQuery({ queryKey: ['jira', 'my-issues', tab], queryFn: () => jiraApi.myIssues(tab) });
  const list = q.data ?? [];
  const groups = Array.from(list.reduce((m, i) => m.set(i.project_key, [...(m.get(i.project_key) ?? []), i]), new Map<string, typeof list>()));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-page font-semibold">My issues</h1><p className="text-sm text-fg-muted">Everything assigned to you across projects.</p></div>
        <Tabs value={tab} onChange={(v) => setTab(v as 'open' | 'done')} tabs={[{ id: 'open', label: 'Open' }, { id: 'done', label: 'Done' }]} />
      </div>
      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? <SkeletonList rows={5} />
        : list.length === 0 && !q.error ? <EmptyState icon={ListChecks} title={tab === 'open' ? 'Nothing assigned to you' : 'No completed issues yet'} hint={tab === 'open' ? 'Issues assigned to you will show up here.' : undefined} action={<Link className="btn-ghost" to="/jira">Browse projects</Link>} />
          : groups.map(([key, issues]) => (
            <section key={key} aria-label={key} className="space-y-2">
              <h2 className="text-section"><Link className="hover:text-accent" to={`/jira/${key}/board`}>{key}</Link> <span className="text-sm font-normal text-fg-muted">{issues.length}</span></h2>
              <IssueTable issues={issues} onOpen={(i) => nav(issuePath(i), { state: { bg: 'issues' } })} />
            </section>))}
    </div>
  );
}
