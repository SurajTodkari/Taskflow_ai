import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, CheckCheck, Trash2, ChevronDown, ChevronRight, Layers } from 'lucide-react';
import ConfirmDialog from '../../components/ConfirmDialog';
import ErrorBanner from '../../components/ErrorBanner';
import EmptyState from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { fmtDate } from '../../lib/dates';
import { jiraApi } from '../../lib/jiraApi';
import type { Issue, JiraSprint } from '../../lib/jiraTypes';
import { useProjectCtx } from '../../features/jira/ctx';
import { CompleteSprintModal, CreateSprintModal, QuickCreate, StartSprintModal } from '../../features/jira/dialogs';
import { useErrToast, useRefreshJira } from '../../features/jira/hooks';
import { DropLine, Points, PriorityIcon, StatusPill, TypeIcon, UserDot, canEdit, dropIndex, isAdmin, neighbours } from '../../features/jira/ui';

type SectionId = number | 'backlog';

export default function Backlog() {
  const { project, openIssue } = useProjectCtx();
  const qc = useQueryClient();
  const toast = useToast();
  const errToast = useErrToast();
  const refresh = useRefreshJira();
  const editable = canEdit(project.my_role);
  const [collapsed, setCollapsed] = useState<Set<SectionId>>(new Set());
  const [startSp, setStartSp] = useState<JiraSprint | null>(null);
  const [completeSp, setCompleteSp] = useState<JiraSprint | null>(null);
  const [delSp, setDelSp] = useState<JiraSprint | null>(null);
  const [creatingSprint, setCreatingSprint] = useState(false);
  const [drag, setDrag] = useState<Issue | null>(null);
  const [over, setOver] = useState<{ sec: SectionId; index: number } | null>(null);
  const [quick, setQuick] = useState<SectionId | null>(null);

  const qk = ['jira', 'issues', project.key, 'backlog'] as const;
  const q = useQuery({ queryKey: qk, queryFn: () => jiraApi.listIssues(project.key, { limit: 200, sort: 'rank', order: 'asc' }) });

  const rank = useMutation({
    mutationFn: (v: { issue: Issue; sprint_id: number | null; nb: { before_issue_id?: number; after_issue_id?: number } }) => jiraApi.rankIssue(v.issue.key, { sprint_id: v.sprint_id, ...v.nb }),
    onError: (e) => errToast(e, 'Could not move issue'),
    onSettled: () => { refresh(); },
  });
  const delSprint = useMutation({
    mutationFn: (id: number) => jiraApi.deleteSprint(id),
    onSuccess: () => { refresh(); toast('Sprint deleted; its issues are back in the backlog'); setDelSp(null); },
    onError: (e) => errToast(e, 'Could not delete sprint'),
  });

  const issues = useMemo(() => (q.data?.items ?? []).filter((i) => i.type !== 'subtask'), [q.data]);
  const sprints = useMemo(() => project.sprints.filter((s) => s.state !== 'closed').sort((a, b) => (a.state === 'active' ? -1 : 0) - (b.state === 'active' ? -1 : 0) || a.id - b.id), [project.sprints]);
  const bySection = (sec: SectionId) => issues.filter((i) => (sec === 'backlog' ? i.sprint_id === null : i.sprint_id === sec));

  const drop = (sec: SectionId) => {
    if (!drag || !over || over.sec !== sec) { setDrag(null); setOver(null); return; }
    const moved = drag;
    const list = bySection(sec).filter((i) => i.id !== moved.id);
    const nb = neighbours(list, over.index);
    const sid = sec === 'backlog' ? null : sec;
    qc.setQueryData<{ items: Issue[]; total: number }>(qk, (old) => {
      if (!old) return old;
      const rest = old.items.filter((i) => i.id !== moved.id);
      const m = { ...moved, sprint_id: sid };
      let at = rest.length;
      const ref = nb.before_issue_id ?? nb.after_issue_id;
      if (ref !== undefined) { const k = rest.findIndex((i) => i.id === ref); if (k >= 0) at = nb.before_issue_id !== undefined ? k : k + 1; }
      else { const first = rest.findIndex((i) => (sid === null ? i.sprint_id === null : i.sprint_id === sid)); if (first >= 0) at = first; }
      rest.splice(at, 0, m);
      return { ...old, items: rest };
    });
    setDrag(null); setOver(null);
    rank.mutate({ issue: moved, sprint_id: sid, nb });
  };

  const toggle = (s: SectionId) => setCollapsed((c) => { const n = new Set(c); if (n.has(s)) n.delete(s); else n.add(s); return n; });

  const renderSection = (id: SectionId, title: string, sprint?: JiraSprint) => {
    const list = bySection(id);
    const pts = list.reduce((s, i) => s + (i.story_points ?? 0), 0);
    const donePts = list.filter((i) => i.status_category === 'done').reduce((s, i) => s + (i.story_points ?? 0), 0);
    const open = !collapsed.has(id);
    const isOver = drag && over?.sec === id;
    const filtered = list.filter((x) => x.id !== drag?.id);
    return (
      <section aria-label={title} className={`card overflow-hidden transition-colors ${isOver ? '!border-accent' : ''}`}>
        <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2/50 px-3 py-2.5">
          <button className="icon-btn" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`} onClick={() => toggle(id)}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
          <h2 className="font-semibold">{title}</h2>
          {sprint?.state === 'active' && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-caption font-semibold text-accent">Active</span>}
          {sprint && (sprint.start_date || sprint.end_date) && <span className="text-xs text-fg-muted">{fmtDate(sprint.start_date)} - {fmtDate(sprint.end_date)}</span>}
          <span className="text-xs text-fg-muted">{list.length} issue{list.length === 1 ? '' : 's'}</span>
          <span className="rounded-full bg-surface px-2 py-0.5 text-caption font-semibold text-fg-muted" title="Done / total story points">{donePts}/{pts} pts</span>
          <span className="ml-auto flex items-center gap-1">
            {editable && sprint?.state === 'planned' && <button className="btn-ghost !py-1 text-xs" onClick={() => setStartSp(sprint)}><Play size={13} />Start sprint</button>}
            {editable && sprint?.state === 'active' && <button className="btn-ghost !py-1 text-xs" onClick={() => setCompleteSp(sprint)}><CheckCheck size={13} />Complete sprint</button>}
            {isAdmin(project.my_role) && sprint && <button className="icon-btn" aria-label={`Delete ${sprint.name}`} onClick={() => setDelSp(sprint)}><Trash2 size={14} /></button>}
          </span>
        </header>
        {sprint?.goal && open && <p className="border-b border-line px-4 py-1.5 text-xs text-fg-muted">Goal: {sprint.goal}</p>}
        {open && (
          <div>
            <div className="flex min-h-14 flex-col gap-1.5 p-2.5"
              onDragOver={(e) => { if (!drag || !editable) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const idx = dropIndex(e.currentTarget, e.clientY, drag.id); if (over?.sec !== id || over.index !== idx) setOver({ sec: id, index: idx }); }}
              onDrop={(e) => { e.preventDefault(); drop(id); }}>
              {list.map((i, k) => (
                <div key={i.id} className="contents">
                  {isOver && drag?.id !== i.id && over.index === list.slice(0, k).filter((x) => x.id !== drag?.id).length && <DropLine />}
                  <BacklogRow issue={i} dragging={drag?.id === i.id} draggable={editable} onOpen={() => openIssue(i.key)}
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', i.key); setDrag(i); }} onDragEnd={() => { setDrag(null); setOver(null); }} />
                </div>))}
              {isOver && over.index >= filtered.length && <DropLine />}
              {list.length === 0 && !isOver && <p className="py-3 text-center text-xs text-fg-muted">{id === 'backlog' ? 'The backlog is empty.' : 'Plan a sprint by dragging issues here from the backlog.'}</p>}
            </div>
            {editable && <div className="border-t border-line/70 p-2">
              {quick === id ? <div className="space-y-1.5"><QuickCreate project={project} sprint_id={id === 'backlog' ? null : id} />
                <button className="text-xs text-fg-muted hover:text-fg" onClick={() => setQuick(null)}>Close</button></div>
                : <button className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg" onClick={() => setQuick(id)}><Plus size={14} />Create issue</button>}
            </div>}
          </div>)}
      </section>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-muted">Drag issues between sprints and the backlog to plan your work.</p>
        {editable && <button className="btn-ghost" onClick={() => setCreatingSprint(true)}><Layers size={16} />Create sprint</button>}
      </div>
      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}</div>
        : q.data ? (
          <>
            {sprints.length === 0 && <EmptyState icon={Layers} title="No sprints yet" hint="Create a sprint to start planning, or work straight from the backlog." action={editable ? <button className="btn-primary" onClick={() => setCreatingSprint(true)}>Create sprint</button> : undefined} />}
            {sprints.map((s) => <div key={s.id}>{renderSection(s.id, s.name, s)}</div>)}
            {renderSection('backlog', 'Backlog')}
            {q.data.total > q.data.items.length && <p className="text-center text-xs text-fg-muted">Showing the first {q.data.items.length} of {q.data.total} issues. Use the Issues tab to find the rest.</p>}
          </>) : null}
      {startSp && <StartSprintModal sprint={startSp} onClose={() => setStartSp(null)} />}
      {completeSp && <CompleteSprintModal sprint={completeSp} sprints={project.sprints} onClose={() => setCompleteSp(null)} />}
      {creatingSprint && <CreateSprintModal project={project} onClose={() => setCreatingSprint(false)} />}
      <ConfirmDialog open={!!delSp} title="Delete sprint" message={`Delete "${delSp?.name}"? Its issues will move to the backlog.`} busy={delSprint.isPending} onConfirm={() => delSp && delSprint.mutate(delSp.id)} onCancel={() => setDelSp(null)} />
    </div>
  );
}

function BacklogRow({ issue, onOpen, draggable, dragging, onDragStart, onDragEnd }: { issue: Issue; onOpen: () => void; draggable: boolean; dragging: boolean; onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void }) {
  return (
    <div data-card data-issue-id={issue.id} draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      className={`flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2 text-sm transition hover:border-accent/50 ${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${dragging ? 'opacity-40' : ''}`}>
      <CompactIssue issue={issue} />
    </div>
  );
}

function CompactIssue({ issue }: { issue: Issue }) {
  return (
    <>
      <TypeIcon type={issue.type} />
      <span className="text-xs font-medium text-fg-muted">{issue.key}</span>
      <span className={`min-w-0 flex-1 truncate ${issue.status_category === 'done' ? 'text-fg-muted line-through' : ''}`}>{issue.title}</span>
      {issue.parent?.type === 'epic' && <span className="hidden max-w-32 truncate rounded bg-violet-500/15 px-1.5 text-caption text-violet-600 sm:inline dark:text-violet-300" title={issue.parent.title}>{issue.parent.title}</span>}
      <StatusPill name={issue.status_name} category={issue.status_category} />
      <PriorityIcon priority={issue.priority} />
      <Points value={issue.story_points} />
      <UserDot user={issue.assignee} />
    </>
  );
}
