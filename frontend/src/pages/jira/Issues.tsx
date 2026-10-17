import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ArrowDown, ArrowUp } from 'lucide-react';
import ErrorBanner from '../../components/ErrorBanner';
import EmptyState from '../../components/EmptyState';
import { SkeletonList } from '../../components/Skeleton';
import { fmtDate } from '../../lib/dates';
import { jiraApi } from '../../lib/jiraApi';
import { ISSUE_TYPES, PRIORITIES, type IssueQuery } from '../../lib/jiraTypes';
import { useProjectCtx } from '../../features/jira/ctx';
import { IssueTable } from '../../features/jira/IssueTable';
import { PRIORITY_META, TYPE_META } from '../../features/jira/ui';

const PAGE = 50;
type Sort = NonNullable<IssueQuery['sort']>;
const SORTS: { id: Sort; label: string }[] = [{ id: 'updated', label: 'Updated' }, { id: 'created', label: 'Created' }, { id: 'priority', label: 'Priority' }, { id: 'due', label: 'Due date' }, { id: 'rank', label: 'Rank' }];

export default function Issues() {
  const { project, openIssue } = useProjectCtx();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [f, setF] = useState({ type: '', column_id: '', assignee: '', priority: '', label: '', sprint_id: '' });
  const [sort, setSort] = useState<Sort>('updated');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setPage(0); }, 250); return () => clearTimeout(t); }, [search]);
  const set = (k: keyof typeof f, v: string) => { setF((o) => ({ ...o, [k]: v })); setPage(0); };

  const query: IssueQuery = { q: q || undefined, type: f.type || undefined, column_id: f.column_id || undefined, assignee: f.assignee || undefined, priority: f.priority || undefined, label: f.label || undefined, sprint_id: f.sprint_id || undefined, sort, order, limit: PAGE, offset: page * PAGE };
  const res = useQuery({ queryKey: ['jira', 'issues', project.key, 'table', query], queryFn: () => jiraApi.listIssues(project.key, query), placeholderData: (p) => p });
  const labelsQ = useQuery({ queryKey: ['jira', 'issues', project.key, 'labels'], queryFn: () => jiraApi.listIssues(project.key, { limit: 200 }), staleTime: 60000 });
  const labels = Array.from(new Set((labelsQ.data?.items ?? []).flatMap((i) => i.labels ?? []))).sort();

  const filtersOn = !!(q || Object.values(f).some(Boolean));
  const total = res.data?.total ?? 0;
  const items = res.data?.items ?? [];
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64"><Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" aria-hidden />
          <input aria-label="Search issues" className="input !pl-8" placeholder="Search title or key (e.g. TF-12)" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select aria-label="Type" className="input !w-auto" value={f.type} onChange={(e) => set('type', e.target.value)}><option value="">All types</option>{ISSUE_TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}</select>
        <select aria-label="Status" className="input !w-auto" value={f.column_id} onChange={(e) => set('column_id', e.target.value)}><option value="">All statuses</option>{project.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select aria-label="Assignee" className="input !w-auto" value={f.assignee} onChange={(e) => set('assignee', e.target.value)}><option value="">Any assignee</option><option value="me">Assigned to me</option><option value="unassigned">Unassigned</option>{project.members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select>
        <select aria-label="Priority" className="input !w-auto" value={f.priority} onChange={(e) => set('priority', e.target.value)}><option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</select>
        <select aria-label="Label" className="input !w-auto" value={f.label} onChange={(e) => set('label', e.target.value)}><option value="">Any label</option>{labels.map((l) => <option key={l} value={l}>{l}</option>)}</select>
        <select aria-label="Sprint" className="input !w-auto" value={f.sprint_id} onChange={(e) => set('sprint_id', e.target.value)}><option value="">Any sprint</option><option value="backlog">Backlog</option><option value="active">Active sprint</option>{project.sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <div className="ml-auto flex items-center gap-1">
          <select aria-label="Sort by" className="input !w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>{SORTS.map((s) => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}</select>
          <button className="icon-btn border border-line" aria-label={order === 'asc' ? 'Ascending, switch to descending' : 'Descending, switch to ascending'} onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}>{order === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}</button>
        </div>
      </div>
      {filtersOn && <button className="text-sm text-accent hover:underline" onClick={() => { setSearch(''); setF({ type: '', column_id: '', assignee: '', priority: '', label: '', sprint_id: '' }); setPage(0); }}>Clear all filters</button>}

      {res.error && <ErrorBanner error={res.error} onRetry={() => res.refetch()} />}
      {res.isLoading ? <SkeletonList rows={6} />
        : items.length === 0 && !res.error ? <EmptyState title={filtersOn ? 'No issues match these filters' : 'No issues yet'} hint={filtersOn ? 'Try clearing some filters.' : 'Create the first issue with the button above.'} />
          : <>
            <IssueTable issues={items} onOpen={(i) => openIssue(i.key)} sprints={project.sprints} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg-muted">
              <span>{total} issue{total === 1 ? '' : 's'}{items.length ? ` · showing ${page * PAGE + 1}-${page * PAGE + items.length}` : ''}{items[0]?.updated_at ? ` · latest update ${fmtDate(items[0].updated_at.slice(0, 10))}` : ''}</span>
              {pages > 1 && <span className="flex items-center gap-2"><button className="btn-ghost !py-1" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page + 1} of {pages}</span><button className="btn-ghost !py-1" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button></span>}
            </div>
          </>}
    </div>
  );
}
