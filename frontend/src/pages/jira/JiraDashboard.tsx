import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Clock, Eye, UserCheck } from 'lucide-react';
import { jiraApi } from '../../lib/jiraApi';
import { fmtMinutes, type Issue } from '../../lib/jiraTypes';
import { PriorityIcon, StatusPill, TypeIcon, issuePath } from '../../features/jira/ui';
import { ActivityList } from './Activity';

function IssueList({ title, icon: I, items, empty }: { title: string; icon: typeof Eye; items?: Issue[]; empty: string }) {
  return (
    <section className="card p-4" aria-label={title}>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><I size={15} aria-hidden />{title}</h2>
      {(items ?? []).length === 0 ? <p className="text-xs text-fg-muted">{empty}</p> : (
        <ul className="space-y-1">{(items ?? []).slice(0, 6).map((i) => (
          <li key={i.id}><Link to={issuePath(i)} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-surface-2">
            <TypeIcon type={i.type} /><span className="text-xs text-fg-muted">{i.key}</span><span className="min-w-0 flex-1 truncate">{i.title}</span>
            <PriorityIcon priority={i.priority} /><StatusPill name={i.status_name} category={i.status_category} /></Link></li>))}</ul>)}
    </section>
  );
}

export default function JiraDashboard() {
  const q = useQuery({ queryKey: ['jira', 'dashboard'], queryFn: jiraApi.dashboard, retry: false });
  const act = useQuery({ queryKey: ['jira', 'activity', 'all'], queryFn: () => jiraApi.activity(8), retry: false });
  if (q.error) return null; // dashboard is a bonus; the project list below still works
  const d = q.data;
  return (
    <div className="space-y-3">
      <h2 className="text-section">Your work</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="card p-4"><p className="text-xs text-fg-muted">Assigned to me (open)</p><p className="text-2xl font-bold">{d?.assigned_to_me_open ?? '-'}</p></div>
        <div className="card p-4"><p className="text-xs text-fg-muted">Logged this week</p><p className="text-2xl font-bold">{d ? fmtMinutes(d.worklog_minutes_week) : '-'}</p></div>
        <div className="card hidden p-4 md:block"><p className="text-xs text-fg-muted">Watching</p><p className="text-2xl font-bold">{d?.watching?.length ?? '-'}</p></div>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <IssueList title="Due soon" icon={Clock} items={d?.due_soon} empty="Nothing due soon." />
        <IssueList title="Recently updated" icon={UserCheck} items={d?.recently_updated} empty="No recent updates." />
        <IssueList title="Watching" icon={Eye} items={d?.watching} empty="You are not watching any issues." />
      </div>
      {(act.data ?? []).length > 0 && <div><h3 className="mb-2 text-sm font-semibold">Recent activity</h3><ActivityList items={act.data ?? []} /></div>}
    </div>
  );
}
