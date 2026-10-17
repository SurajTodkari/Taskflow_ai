import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, CheckCheck, Zap, ListChecks } from 'lucide-react';
import ErrorBanner from '../../components/ErrorBanner';
import EmptyState from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { useAuth } from '../../lib/auth';
import { fmtDate } from '../../lib/dates';
import { jiraApi } from '../../lib/jiraApi';
import { ISSUE_TYPES, type Board as BoardData, type Issue } from '../../lib/jiraTypes';
import { useProjectCtx } from '../../features/jira/ctx';
import { CompleteSprintModal, QuickCreate } from '../../features/jira/dialogs';
import { useErrToast, useRefreshJira } from '../../features/jira/hooks';
import BulkBar from '../../features/jira/BulkBar';
import { CATEGORY_META, DropLine, IssueRow, TYPE_META, UserDot, canEdit, dropIndex, neighbours } from '../../features/jira/ui';

export default function Board() {
  const { project, openIssue, newIssue } = useProjectCtx();
  const { user } = useAuth();
  const qc = useQueryClient();
  const errToast = useErrToast();
  const refresh = useRefreshJira();
  const editable = canEdit(project.my_role);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [assignee, setAssignee] = useState('');
  const [label, setLabel] = useState('');
  const [type, setType] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [quick, setQuick] = useState<number | null>(null);
  const kanban = project.board_type === 'kanban';
  const [lanes, setLanes] = useState<'' | 'assignee' | 'epic'>('');
  const [selectMode, setSelectMode] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [drag, setDrag] = useState<Issue | null>(null);
  const [over, setOver] = useState<{ col: number; index: number } | null>(null);
  const colRefs = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 250); return () => clearTimeout(t); }, [search]);

  const params = { sprint_id: !kanban && showAll ? 'all' : undefined, assignee: assignee || undefined, label: label || undefined, q: debounced || undefined };
  const qk = ['jira', 'board', project.key, params] as const;
  const q = useQuery({ queryKey: qk, queryFn: () => jiraApi.board(project.key, params), refetchInterval: 30000 });

  const move = useMutation({
    mutationFn: (v: { issue: Issue; column_id: number; nb: { before_issue_id?: number; after_issue_id?: number } }) => jiraApi.moveIssue(v.issue.key, { column_id: v.column_id, ...v.nb }),
    onError: (e) => { errToast(e, 'Could not move issue'); },
    onSettled: () => { refresh(); },
  });

  const allIssues = useMemo(() => (q.data?.columns ?? []).flatMap((c) => c.issues), [q.data]);
  const labels = useMemo(() => Array.from(new Set(allIssues.flatMap((i) => i.labels ?? []))).sort(), [allIssues]);
  const members = project.members;

  const drop = (colId: number) => {
    if (!drag || !over || over.col !== colId || !q.data) { setDrag(null); setOver(null); return; }
    const target = q.data.columns.find((c) => c.id === colId);
    if (!target) return;
    const list = visible(target).filter((i) => i.id !== drag.id);
    const nb = neighbours(list, over.index);
    const moved = drag;
    // optimistic update
    qc.setQueryData<BoardData>(qk, (old) => {
      if (!old) return old;
      const cols = old.columns.map((c) => {
        const without = c.issues.filter((i) => i.id !== moved.id);
        if (c.id !== colId) return { ...c, issues: without };
        const next = [...without];
        let at = next.length;
        if (nb.before_issue_id !== undefined) { const k = next.findIndex((i) => i.id === nb.before_issue_id); if (k >= 0) at = k; }
        else if (nb.after_issue_id !== undefined) { const k = next.findIndex((i) => i.id === nb.after_issue_id); if (k >= 0) at = k + 1; }
        else at = 0;
        next.splice(at, 0, { ...moved, column_id: colId, status_name: c.name, status_category: c.category });
        return { ...c, issues: next };
      });
      return { ...old, columns: cols };
    });
    setDrag(null); setOver(null);
    move.mutate({ issue: moved, column_id: colId, nb });
  };

  const sprint = q.data?.sprint ?? null;
  const toggleSel = (k: string) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const laneGroups = useMemo(() => {
    const cols = q.data?.columns ?? [];
    const all = cols.flatMap((c) => c.issues).filter((i) => !type || i.type === type);
    if (lanes === 'assignee') {
      const ids = Array.from(new Set(all.map((i) => i.assignee?.id ?? 0)));
      return ids.map((id) => ({ id: `a${id}`, label: all.find((i) => (i.assignee?.id ?? 0) === id)?.assignee?.name ?? 'Unassigned', count: all.filter((i) => (i.assignee?.id ?? 0) === id).length, test: (i: Issue) => (i.assignee?.id ?? 0) === id }));
    }
    const ids = Array.from(new Set(all.map((i) => i.parent?.id ?? 0)));
    return ids.map((id) => ({ id: `e${id}`, label: all.find((i) => (i.parent?.id ?? 0) === id)?.parent?.title ?? 'No epic', count: all.filter((i) => (i.parent?.id ?? 0) === id).length, test: (i: Issue) => (i.parent?.id ?? 0) === id }));
  }, [q.data, lanes, type]);
  const visible = (c: BoardData['columns'][number]) => c.issues.filter((i) => !type || i.type === type);
  const filtersOn = !!(debounced || assignee || label || type);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {kanban ? <p className="text-sm text-fg-muted">Kanban board - all open issues</p> : sprint ? <p className="flex flex-wrap items-center gap-2 text-sm"><Zap size={15} className="text-accent" aria-hidden /><span className="font-semibold">{sprint.name}</span>
            {(sprint.start_date || sprint.end_date) && <span className="text-fg-muted">{fmtDate(sprint.start_date)} - {fmtDate(sprint.end_date)}</span>}
            {sprint.goal && <span className="text-fg-muted">· {sprint.goal}</span>}</p>
            : <p className="text-sm text-fg-muted">{showAll ? 'Showing every issue in the project' : 'No active sprint'}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!kanban && <label className="inline-flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Show all issues</label>}
          <select aria-label="Swimlanes" className="input !w-auto" value={lanes} onChange={(e) => setLanes(e.target.value as '' | 'assignee' | 'epic')}><option value="">No swimlanes</option><option value="assignee">Swimlanes: assignee</option><option value="epic">Swimlanes: epic</option></select>
          {editable && <button className={`btn-ghost ${selectMode ? '!border-accent !text-accent' : ''}`} aria-pressed={selectMode} onClick={() => { setSelectMode(!selectMode); setSel([]); }}><ListChecks size={16} />Select</button>}
          {!kanban && editable && sprint && sprint.state === 'active' && <button className="btn-ghost" onClick={() => setCompleting(true)}><CheckCheck size={16} />Complete sprint</button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-56"><Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" aria-hidden />
          <input aria-label="Search board" className="input !pl-8" placeholder="Search issues" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="flex items-center -space-x-1.5" role="group" aria-label="Filter by assignee">
          {members.slice(0, 8).map((m) => {
            const on = assignee === String(m.user_id);
            return <button key={m.user_id} type="button" title={m.name} aria-label={`Filter by ${m.name}`} aria-pressed={on} onClick={() => setAssignee(on ? '' : String(m.user_id))}
              className={`rounded-full ring-2 transition ${on ? 'z-10 ring-accent' : 'ring-bg hover:z-10'}`}><UserDot user={m} size={28} /></button>;
          })}
          {user && <button type="button" aria-pressed={assignee === 'me'} onClick={() => setAssignee(assignee === 'me' ? '' : 'me')} className={`ml-3 rounded-full border px-2.5 py-1 text-xs font-medium ${assignee === 'me' ? 'border-accent text-accent' : 'border-line text-fg-muted hover:text-fg'}`}>Only mine</button>}
        </div>
        <select aria-label="Filter by type" className="input !w-auto" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>{ISSUE_TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}</select>
        <select aria-label="Filter by label" className="input !w-auto" value={label} onChange={(e) => setLabel(e.target.value)}>
          <option value="">All labels</option>{labels.map((l) => <option key={l} value={l}>{l}</option>)}{label && !labels.includes(label) && <option value={label}>{label}</option>}</select>
        {filtersOn && <button className="text-sm text-accent hover:underline" onClick={() => { setSearch(''); setAssignee(''); setLabel(''); setType(''); }}>Clear filters</button>}
      </div>

      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? <div className="flex gap-3 overflow-x-auto">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-80 w-72 shrink-0 rounded-2xl" />)}</div>
        : q.data && !kanban && !sprint && !showAll && allIssues.length === 0 ? (
          <EmptyState icon={Zap} title="No active sprint" hint="Start a sprint from the Backlog to see its issues here, or show every issue in the project." action={<button className="btn-ghost" onClick={() => setShowAll(true)}>Show all issues</button>} />)
          : q.data && lanes ? (
            <div className="space-y-4">{laneGroups.map((g) => (
              <section key={g.id} aria-label={g.label} className="space-y-2">
                <h2 className="text-sm font-semibold">{g.label} <span className="font-normal text-fg-muted">({g.count})</span></h2>
                <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
                  {q.data.columns.map((c) => <div key={c.id} className="w-72 shrink-0 snap-start space-y-2 rounded-2xl border border-line bg-surface-2/60 p-2.5"><p className="text-xs font-bold uppercase tracking-wide text-fg-muted">{c.name}</p>
                    {visible(c).filter(g.test).map((i) => <IssueRow key={i.id} issue={i} selectMode={selectMode} selected={sel.includes(i.key)} onOpen={() => (selectMode ? toggleSel(i.key) : openIssue(i.key))} />)}</div>)}
                </div></section>))}</div>)
          : q.data && (
            <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0" onDragEnd={() => { setDrag(null); setOver(null); }}>
              {q.data.columns.map((c) => {
                const issues = visible(c);
                const pts = issues.reduce((s, i) => s + (i.story_points ?? 0), 0);
                const isOver = over?.col === c.id && drag;
                return (
                  <section key={c.id} aria-label={c.name} className={`flex w-72 shrink-0 snap-start flex-col rounded-2xl border bg-surface-2/60 transition-colors ${isOver ? 'border-accent' : 'border-line'}`}>
                    <header className="flex items-center gap-2 px-3 pb-1 pt-3">
                      <h2 className="truncate text-xs font-bold uppercase tracking-wide text-fg-muted">{c.name}</h2>
                      <span className={`rounded-full px-1.5 text-caption font-semibold ${c.over_wip || (c.wip_limit && issues.length > c.wip_limit) ? 'bg-danger/15 text-danger' : 'bg-surface text-fg-muted'}`} title={c.wip_limit ? `WIP limit ${c.wip_limit}` : undefined}>{issues.length}{c.wip_limit ? `/${c.wip_limit}` : ''}{(c.over_wip || (c.wip_limit && issues.length > c.wip_limit)) ? ' over limit' : ''}</span>
                      {c.category === 'done' && <span title={CATEGORY_META.done.label} className="text-success"><CheckCheck size={14} aria-hidden /></span>}
                      {pts > 0 && <span className="ml-auto text-caption text-fg-muted" title="Story points">{pts} pts</span>}
                    </header>
                    <div ref={(el) => { if (el) colRefs.current.set(c.id, el); else colRefs.current.delete(c.id); }}
                      className="flex min-h-24 flex-1 flex-col gap-2 p-2.5"
                      onDragOver={(e) => { if (!drag || !editable) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const el = colRefs.current.get(c.id); if (el) { const idx = dropIndex(el, e.clientY, drag.id); if (over?.col !== c.id || over.index !== idx) setOver({ col: c.id, index: idx }); } }}
                      onDrop={(e) => { e.preventDefault(); drop(c.id); }}>
                      {issues.map((i, idx) => (
                        <div key={i.id} className="contents">
                          {isOver && drag?.id !== i.id && over.index === issues.slice(0, idx).filter((x) => x.id !== drag?.id).length && <DropLine />}
                          <IssueRow issue={i} draggable={editable && !selectMode} dragging={drag?.id === i.id} selectMode={selectMode} selected={sel.includes(i.key)} onOpen={() => (selectMode ? toggleSel(i.key) : openIssue(i.key))}
                            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', i.key); setDrag(i); }} onDragEnd={() => { setDrag(null); setOver(null); }} />
                        </div>))}
                      {isOver && over.index >= issues.filter((x) => x.id !== drag?.id).length && <DropLine />}
                      {issues.length === 0 && !isOver && <p className="py-4 text-center text-xs text-fg-muted">{filtersOn ? 'No matching issues' : editable ? 'Drop issues here' : 'No issues'}</p>}
                    </div>
                    {editable && <div className="border-t border-line/70 p-2">
                      {quick === c.id ? <div className="space-y-1.5"><QuickCreate project={project} column_id={c.id} sprint_id={sprint?.id ?? null} onDone={() => setQuick(null)} />
                        <div className="flex justify-between text-xs"><button className="text-fg-muted hover:text-fg" onClick={() => setQuick(null)}>Cancel</button><button className="text-accent hover:underline" onClick={() => newIssue({ column_id: c.id, sprint_id: sprint?.id ?? null })}>More options</button></div></div>
                        : <button className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-fg-muted hover:bg-surface hover:text-fg" onClick={() => setQuick(c.id)}><Plus size={14} />Create issue</button>}
                    </div>}
                  </section>);
              })}
            </div>)}
      {selectMode && sel.length > 0 && <BulkBar project={project} keys={sel} onClear={() => { setSel([]); setSelectMode(false); }} />}
      {completing && sprint && <CompleteSprintModal sprint={sprint} sprints={project.sprints} onClose={() => setCompleting(false)} />}
    </div>
  );
}
