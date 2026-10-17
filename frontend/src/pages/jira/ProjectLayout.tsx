import { useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Plus, ChevronLeft } from 'lucide-react';
import ErrorBanner from '../../components/ErrorBanner';
import EmptyState from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { ApiError } from '../../lib/api';
import { ProjectCtx } from '../../features/jira/ctx';
import { CreateIssueModal, type CreateDefaults } from '../../features/jira/dialogs';
import { useProject } from '../../features/jira/hooks';
import IssueDetailModal from '../../features/jira/IssueDetailModal';
import { canEdit } from '../../features/jira/ui';
import Board from './Board';
import Backlog from './Backlog';
import Issues from './Issues';
import Summary from './Summary';
import ProjectSettings from './ProjectSettings';

const TABS = [
  { id: 'board', label: 'Board' }, { id: 'backlog', label: 'Backlog' }, { id: 'issues', label: 'Issues' },
  { id: 'summary', label: 'Summary' }, { id: 'settings', label: 'Settings' },
];
const PAGES: Record<string, () => JSX.Element | null> = { board: Board, backlog: Backlog, issues: Issues, summary: Summary, settings: ProjectSettings };

export default function ProjectLayout() {
  const { key = '', issueKey } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const q = useProject(key);
  const [creating, setCreating] = useState<CreateDefaults | null>(null);
  const seg = loc.pathname.split('/')[3] ?? '';
  const bgState = (loc.state as { bg?: string } | null)?.bg;
  const tab = seg === 'issue' ? (bgState && PAGES[bgState] ? bgState : 'issues') : seg;

  const ctx = useMemo(() => q.data ? ({
    project: q.data,
    openIssue: (ik: string) => nav(`/jira/${q.data.key}/issue/${ik}`, { state: { bg: tab } }),
    newIssue: (d?: CreateDefaults) => setCreating(d ?? {}),
  }) : null, [q.data, nav, tab]);

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-10 w-full max-w-md" /><Skeleton className="h-72 w-full rounded-2xl" /></div>;
  if (q.error) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return notFound
      ? <EmptyState title="Project not found" hint="It may have been deleted or you are not a member." action={<Link className="btn-primary" to="/jira">Back to projects</Link>} />
      : <ErrorBanner error={q.error} onRetry={() => q.refetch()} />;
  }
  if (!q.data || !ctx) return null;
  const p = q.data;
  const Page = PAGES[tab];
  const closeIssue = () => nav(`/jira/${p.key}/${tab}`, { replace: true });

  return (
    <ProjectCtx.Provider value={ctx}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link to="/jira" className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"><ChevronLeft size={14} />Projects</Link>
            <h1 className="flex items-center gap-2 text-page font-semibold"><span className="rounded-lg bg-accent-soft px-2 py-0.5 text-sm font-bold text-accent">{p.key}</span><span className="truncate">{p.name}</span></h1>
          </div>
          {canEdit(p.my_role) && <button className="btn-primary" onClick={() => setCreating({})}><Plus size={16} />Create issue</button>}
        </div>
        <nav aria-label="Project sections" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
          {TABS.map((t) => (
            <NavLink key={t.id} to={`/jira/${p.key}/${t.id}`} className={() => `relative whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors ${tab === t.id ? 'text-accent' : 'text-fg-muted hover:text-fg'}`}>
              {t.label}{tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
            </NavLink>))}
        </nav>
        {issueKey && Page ? <Page /> : <Outlet />}
        {issueKey && <IssueDetailModal issueKey={issueKey} project={p} onClose={closeIssue} />}
        {creating && <CreateIssueModal project={p} defaults={creating} onClose={() => setCreating(null)} onCreated={() => undefined} />}
      </div>
    </ProjectCtx.Provider>
  );
}

export function ProjectIndexRedirect() {
  const { key } = useParams();
  return <Navigate to={`/jira/${key}/board`} replace />;
}
