import { useContext, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Pencil, Trash2, Link2, Copy, ArrowRightLeft, Archive, Flag } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import ErrorBanner from '../../components/ErrorBanner';
import EmptyState from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { Tabs } from '../../components/ui/Tabs';
import { useAuth } from '../../lib/auth';
import { ProjectCtx } from './ctx';
import { fmtDate } from '../../lib/dates';
import { jiraApi } from '../../lib/jiraApi';
import { ISSUE_TYPES, PRIORITIES, type IssueDetail, type IssuePatch, type IssueType, type JiraComment, type JiraProjectDetail, type Priority } from '../../lib/jiraTypes';
import { useErrToast, useRefreshJira } from './hooks';
import { AttachmentsSection, CloneMoveDialogs, CustomFieldInput, LinksSection, MentionTextarea, TimeSection, WatchBox, decodeMentions, encodeMentions, type MentionPick } from './IssueExtras';
import { PRIORITY_META, StatusPill, TYPE_META, TypeIcon, UserDot, canEdit, isAdmin, issuePath } from './ui';

function ago(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function IssueDetailModal({ issueKey, project, onClose }: { issueKey: string; project: JiraProjectDetail; onClose: () => void }) {
  const q = useQuery({ queryKey: ['jira', 'issue', issueKey], queryFn: () => jiraApi.getIssue(issueKey) });
  return (
    <Modal open onClose={onClose} title={issueKey} wide>
      {q.isLoading ? <div className="space-y-3"><Skeleton className="h-7 w-2/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>
        : q.error ? <ErrorBanner error={q.error} onRetry={() => q.refetch()} />
          : q.data ? <Body key={q.data.key} issue={q.data} project={project} onClose={onClose} /> : null}
    </Modal>
  );
}

function Body({ issue, project, onClose }: { issue: IssueDetail; project: JiraProjectDetail; onClose: () => void }) {
  const teamCtx = useContext(ProjectCtx);
  const toast = useToast();
  const errToast = useErrToast();
  const refresh = useRefreshJira();
  const editable = canEdit(project.my_role);
  const [title, setTitle] = useState(issue.title);
  const [desc, setDesc] = useState(issue.description ?? '');
  const [labels, setLabels] = useState(issue.labels.join(', '));
  const [points, setPoints] = useState(issue.story_points === null ? '' : String(issue.story_points));
  const [tab, setTab] = useState<'comments' | 'history'>('comments');
  const [confirmDel, setConfirmDel] = useState(false);
  const [subTitle, setSubTitle] = useState('');
  const [env, setEnv] = useState(issue.environment ?? '');
  const [dlg, setDlg] = useState<'clone' | 'move' | null>(null);
  const nav = useNavigate();
  const comps = useQuery({ queryKey: ['jira', 'components', project.key], queryFn: () => jiraApi.components(project.key) });
  const vers = useQuery({ queryKey: ['jira', 'versions', project.key], queryFn: () => jiraApi.versions(project.key) });
  const cfs = useQuery({ queryKey: ['jira', 'custom-fields', project.key], queryFn: () => jiraApi.customFields(project.key) });
  const archive = useMutation({
    mutationFn: () => jiraApi.bulk(project.key, { issue_keys: [issue.key], action: issue.archived ? 'unarchive' : 'archive' }),
    onSuccess: () => { refresh(); toast(issue.archived ? 'Issue restored' : 'Issue archived'); if (!issue.archived) onClose(); }, onError: (e) => errToast(e, 'Archive failed'),
  });

  const upd = useMutation({
    mutationFn: (b: IssuePatch) => jiraApi.updateIssue(issue.key, b),
    onSuccess: () => refresh(),
    onError: (e) => errToast(e, 'Update failed'),
  });
  const save = (b: IssuePatch) => upd.mutate(b);
  const rm = useMutation({
    mutationFn: () => jiraApi.deleteIssue(issue.key),
    onSuccess: () => { refresh(); toast(`${issue.key} deleted`); onClose(); },
    onError: (e) => errToast(e, 'Delete failed'),
  });
  const epics = useQuery({ queryKey: ['jira', 'epics', project.key], queryFn: () => jiraApi.listIssues(project.key, { type: 'epic', limit: 200 }), enabled: issue.type !== 'epic' && issue.type !== 'subtask' });
  const addSub = useMutation({
    mutationFn: (t: string) => jiraApi.createIssue(project.key, { type: 'subtask', title: t, parent_id: issue.id, sprint_id: issue.sprint_id }),
    onSuccess: () => { refresh(); setSubTitle(''); },
    onError: (e) => errToast(e, 'Could not add subtask'),
  });
  const toggleSub = useMutation({
    mutationFn: (s: { key: string; done: boolean }) => {
      const doneCol = project.columns.find((c) => c.category === 'done');
      const todoCol = project.columns.find((c) => c.category === 'todo') ?? project.columns[0];
      const col = s.done ? todoCol : doneCol;
      if (!col) throw new Error('Workflow has no matching column');
      return jiraApi.updateIssue(s.key, { column_id: col.id });
    },
    onSuccess: () => refresh(),
    onError: (e) => errToast(e, 'Could not update subtask'),
  });

  const sprints = project.sprints.filter((s) => s.state !== 'closed' || s.id === issue.sprint_id);
  const assignable = project.members.filter((m) => m.role !== 'viewer' || m.user_id === issue.assignee?.id);
  const dis = !editable;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
      <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          <TypeIcon type={issue.type} /><span className="font-medium">{issue.key}</span>
          {issue.parent && <><span aria-hidden>/</span><Link className="truncate hover:text-accent hover:underline" to={issuePath({ project_key: issue.project_key, key: issue.parent.key })}>{issue.parent.key} {issue.parent.title}</Link></>}
          <button className="icon-btn ml-auto" aria-label="Copy link to issue" onClick={() => { navigator.clipboard?.writeText(`${location.origin}${issuePath(issue)}`).then(() => toast('Link copied'), () => toast('Could not copy link', 'error')); }}><Link2 size={15} /></button>
          {editable && <button className="icon-btn" aria-pressed={!!issue.flagged} aria-label={issue.flagged ? 'Remove flag' : 'Flag issue'} onClick={() => save({ flagged: !issue.flagged })}><Flag size={15} className={issue.flagged ? 'fill-danger text-danger' : ''} /></button>}
          {editable && <button className="icon-btn" aria-label="Clone issue" onClick={() => setDlg('clone')}><Copy size={15} /></button>}
          {editable && <button className="icon-btn" aria-label="Move to another project" onClick={() => setDlg('move')}><ArrowRightLeft size={15} /></button>}
          {editable && <button className="icon-btn" aria-label={issue.archived ? 'Unarchive issue' : 'Archive issue'} onClick={() => archive.mutate()}><Archive size={15} /></button>}
          {editable && <button className="icon-btn" aria-label="Delete issue" onClick={() => setConfirmDel(true)}><Trash2 size={15} /></button>}
        </div>
        <div>
          <label className="sr-only" htmlFor="id-title">Title</label>
          <input id="id-title" className="input !border-transparent !px-2 text-lg font-semibold hover:!border-line focus:!border-accent" value={title} maxLength={200} disabled={dis}
            onChange={(e) => setTitle(e.target.value)} onBlur={() => { const t = title.trim(); if (!t) setTitle(issue.title); else if (t !== issue.title) save({ title: t }); }} />
        </div>
        <div>
          <label className="label" htmlFor="id-desc">Description</label>
          <textarea id="id-desc" rows={5} className="input" disabled={dis} placeholder={dis ? 'No description' : 'Add a description...'} value={desc} onChange={(e) => setDesc(e.target.value)} />
          {editable && desc !== (issue.description ?? '') && <div className="mt-2 flex gap-2"><button className="btn-primary !py-1" disabled={upd.isPending} onClick={() => save({ description: desc })}>Save</button><button className="btn-ghost !py-1" onClick={() => setDesc(issue.description ?? '')}>Cancel</button></div>}
        </div>

        {issue.type === 'epic' && <p className="text-sm text-fg-muted">{issue.epic_children_count} issue{issue.epic_children_count === 1 ? '' : 's'} in this epic. <Link className="text-accent hover:underline" to={`/jira/${project.key}/issues`}>View in Issues</Link></p>}

        {issue.blocked && <p className="rounded-lg bg-danger/10 px-3 py-1.5 text-sm font-medium text-danger">This issue is blocked by an open issue.</p>}
        {issue.archived && <p className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm text-fg-muted">This issue is archived.</p>}

        {issue.type !== 'subtask' && issue.type !== 'epic' && (
          <section aria-label="Subtasks">
            <h3 className="mb-2 text-sm font-semibold">Subtasks {issue.subtask_count > 0 && <span className="font-normal text-fg-muted">({issue.subtasks_done}/{issue.subtask_count})</span>}</h3>
            {issue.subtask_count > 0 && <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-success transition-all" style={{ width: `${(issue.subtasks_done / issue.subtask_count) * 100}%` }} /></div>}
            <ul className="space-y-1">
              {issue.subtasks.map((s) => {
                const done = s.status_category === 'done';
                return (
                  <li key={s.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={done} disabled={dis || toggleSub.isPending} aria-label={`Mark ${s.key} ${done ? 'not done' : 'done'}`} onChange={() => toggleSub.mutate({ key: s.key, done })} />
                    <Link to={issuePath(s)} className={`min-w-0 flex-1 truncate hover:text-accent ${done ? 'text-fg-muted line-through' : ''}`}><span className="mr-1.5 text-xs text-fg-muted">{s.key}</span>{s.title}</Link>
                    <StatusPill name={s.status_name} category={s.status_category} /><UserDot user={s.assignee} size={20} />
                  </li>);
              })}
            </ul>
            {editable && <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (subTitle.trim()) addSub.mutate(subTitle.trim()); }}>
              <input aria-label="New subtask title" className="input !py-1.5" placeholder="Add a subtask" maxLength={200} value={subTitle} onChange={(e) => setSubTitle(e.target.value)} />
              <button className="btn-ghost !py-1.5" disabled={addSub.isPending || !subTitle.trim()}>Add</button></form>}
          </section>
        )}

        <LinksSection issue={issue} editable={editable} />
        <AttachmentsSection issue={issue} editable={editable} />
        <TimeSection issue={issue} editable={editable} onEstimate={save} />

        <section aria-label="Activity">
          <Tabs value={tab} onChange={(v) => setTab(v as 'comments' | 'history')} tabs={[{ id: 'comments', label: 'Comments', count: issue.comment_count }, { id: 'history', label: 'History' }]} />
          <div className="mt-3">{tab === 'comments' ? <Comments issueKey={issue.key} project={project} /> : <History issueKey={issue.key} />}</div>
        </section>
      </div>

      <aside className="space-y-3 lg:border-l lg:border-line lg:pl-5" aria-label="Issue fields">
        <div><label className="label" htmlFor="f-status">Status</label>
          <select id="f-status" className="input" disabled={dis} value={issue.column_id} onChange={(e) => save({ column_id: Number(e.target.value) })}>
            {project.columns.map((c) => <option key={c.id} value={c.id} disabled={c.id !== issue.column_id && !!issue.allowed_column_ids && project.enforce_workflow === true && !issue.allowed_column_ids.includes(c.id)}>{c.name}</option>)}</select></div>
        <WatchBox issue={issue} />
        <div><label className="label" htmlFor="f-asg">Assignee</label>
          <select id="f-asg" className="input" disabled={dis} value={issue.assignee?.id ?? ''} onChange={(e) => { if (e.target.value === '__team') { teamCtx?.openTeam(); return; } save({ assignee_id: e.target.value ? Number(e.target.value) : null }); }}>
            <option value="">Unassigned</option>{assignable.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}<option value="__team">+ Add / invite people…</option></select>
          {editable && !issue.assignee && <MeButton project={project} onAssign={(id) => save({ assignee_id: id })} />}</div>
        <div><label className="label" htmlFor="f-pri">Priority</label>
          <select id="f-pri" className="input" disabled={dis} value={issue.priority} onChange={(e) => save({ priority: e.target.value as Priority })}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</select></div>
        <div><label className="label" htmlFor="f-type">Type</label>
          <select id="f-type" className="input" disabled={dis || issue.type === 'subtask'} value={issue.type} onChange={(e) => save({ type: e.target.value as IssueType })}>
            {ISSUE_TYPES.filter((t) => t !== 'subtask' || issue.type === 'subtask').map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}</select></div>
        <div><label className="label" htmlFor="f-spr">Sprint</label>
          <select id="f-spr" className="input" disabled={dis} value={issue.sprint_id ?? ''} onChange={(e) => save({ sprint_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Backlog</option>{sprints.map((s) => <option key={s.id} value={s.id}>{s.name}{s.state === 'active' ? ' (active)' : s.state === 'closed' ? ' (closed)' : ''}</option>)}</select></div>
        {issue.type !== 'epic' && issue.type !== 'subtask' && (
          <div><label className="label" htmlFor="f-epic">Epic</label>
            <select id="f-epic" className="input" disabled={dis} value={issue.parent?.id ?? ''} onChange={(e) => save({ parent_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">None</option>
              {issue.parent && !(epics.data?.items ?? []).some((x) => x.id === issue.parent?.id) && <option value={issue.parent.id}>{issue.parent.key} {issue.parent.title}</option>}
              {(epics.data?.items ?? []).map((x) => <option key={x.id} value={x.id}>{x.key} {x.title}</option>)}</select></div>)}
        <div><label className="label" htmlFor="f-pts">Story points</label>
          <input id="f-pts" type="number" min={0} className="input" disabled={dis} value={points} onChange={(e) => setPoints(e.target.value)}
            onBlur={() => { const v = points.trim() === '' ? null : Number(points); if (v !== null && (!Number.isFinite(v) || v < 0)) { setPoints(issue.story_points === null ? '' : String(issue.story_points)); return; } if (v !== issue.story_points) save({ story_points: v }); }} /></div>
        <div><label className="label" htmlFor="f-lab">Labels (comma separated)</label>
          <input id="f-lab" className="input" disabled={dis} value={labels} onChange={(e) => setLabels(e.target.value)}
            onBlur={() => { const next = Array.from(new Set(labels.split(',').map((x) => x.trim()).filter(Boolean))); if (next.join('|') !== issue.labels.join('|')) save({ labels: next }); setLabels(next.join(', ')); }} /></div>
        <div><label className="label" htmlFor="f-due">Due date</label>
          <input id="f-due" type="date" className="input" disabled={dis} value={issue.due_date ?? ''} onChange={(e) => save({ due_date: e.target.value || null })} /></div>
        <div><label className="label" htmlFor="f-start">Start date</label>
          <input id="f-start" type="date" className="input" disabled={dis} value={issue.start_date ?? ''} onChange={(e) => save({ start_date: e.target.value || null })} /></div>
        <div><label className="label" htmlFor="f-ver">Fix version</label>
          <select id="f-ver" className="input" disabled={dis} value={issue.fix_version_id ?? issue.fix_version?.id ?? ''} onChange={(e) => save({ fix_version_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">None</option>{(vers.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}{v.released ? ' (released)' : ''}</option>)}</select></div>
        <fieldset><legend className="label">Components</legend>
          {(comps.data ?? []).length === 0 ? <p className="text-xs text-fg-muted">None defined.</p> : <div className="flex flex-wrap gap-x-3 gap-y-1">
            {(comps.data ?? []).map((c) => { const ids = issue.component_ids ?? issue.components?.map((x) => x.id) ?? []; const on = ids.includes(c.id);
              return <label key={c.id} className="flex items-center gap-1 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" disabled={dis} checked={on} onChange={() => save({ component_ids: on ? ids.filter((x) => x !== c.id) : [...ids, c.id] })} />{c.name}</label>; })}</div>}</fieldset>
        <div><label className="label" htmlFor="f-env">Environment</label>
          <input id="f-env" className="input" disabled={dis} value={env} onChange={(e) => setEnv(e.target.value)} onBlur={() => { if (env !== (issue.environment ?? '')) save({ environment: env.trim() || null }); }} /></div>
        {(cfs.data ?? []).map((f) => <CustomFieldInput key={`${f.id}-${JSON.stringify(issue.custom_fields?.[String(f.id)] ?? null)}`} field={f} disabled={dis} value={issue.custom_fields?.[String(f.id)]}
          onChange={(v) => save({ custom_fields: { ...(issue.custom_fields ?? {}), [String(f.id)]: v } })} />)}
        <dl className="space-y-1 border-t border-line pt-3 text-xs text-fg-muted">
          <div className="flex items-center justify-between"><dt>Reporter</dt><dd className="flex items-center gap-1.5 text-fg"><UserDot user={issue.reporter} size={18} />{issue.reporter?.name}</dd></div>
          <div className="flex justify-between"><dt>Created</dt><dd className="text-fg">{fmtDate(issue.created_at.slice(0, 10))}</dd></div>
          <div className="flex justify-between"><dt>Updated</dt><dd className="text-fg">{fmtDate(issue.updated_at.slice(0, 10))}</dd></div>
          {issue.resolved_at && <div className="flex justify-between"><dt>Resolved</dt><dd className="text-fg">{fmtDate(issue.resolved_at.slice(0, 10))}</dd></div>}
        </dl>
      </aside>
      {dlg && <CloneMoveDialogs issue={issue} project={project} mode={dlg} onClose={() => setDlg(null)} onDone={(k) => { setDlg(null); if (dlg === 'move') onClose(); nav(`/jira/${k.split('-')[0]}/issue/${k}`); }} />}
      <ConfirmDialog open={confirmDel} title="Delete issue" message={`Delete ${issue.key}?${issue.type === 'epic' ? ' Its child issues will be detached.' : issue.subtask_count ? ' Its subtasks will be deleted too.' : ''} This cannot be undone.`} busy={rm.isPending} onConfirm={() => rm.mutate()} onCancel={() => setConfirmDel(false)} />
    </div>
  );
}

function MeButton({ project, onAssign }: { project: JiraProjectDetail; onAssign: (id: number) => void }) {
  const { user } = useAuth();
  const me = project.members.find((m) => String(m.user_id) === String(user?.id));
  if (!me || me.role === 'viewer') return null;
  return <button type="button" className="mt-1 text-xs text-accent hover:underline" onClick={() => onAssign(me.user_id)}>Assign to me</button>;
}

function Comments({ issueKey, project }: { issueKey: string; project: JiraProjectDetail }) {
  const { user } = useAuth();
  const toast = useToast();
  const errToast = useErrToast();
  const refresh = useRefreshJira();
  const [body, setBody] = useState('');
  const [picks, setPicks] = useState<MentionPick[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [editBody, setEditBody] = useState('');
  const [delId, setDelId] = useState<number | null>(null);
  const q = useQuery({ queryKey: ['jira', 'comments', issueKey], queryFn: () => jiraApi.listComments(issueKey) });
  const add = useMutation({ mutationFn: () => jiraApi.addComment(issueKey, encodeMentions(body.trim(), picks)), onSuccess: () => { refresh(); setBody(''); setPicks([]); }, onError: (e) => errToast(e, 'Could not post comment') });
  const edit = useMutation({ mutationFn: (id: number) => jiraApi.updateComment(id, editBody.trim()), onSuccess: () => { refresh(); setEditing(null); }, onError: (e) => errToast(e, 'Could not update comment') });
  const rm = useMutation({ mutationFn: (id: number) => jiraApi.deleteComment(id), onSuccess: () => { refresh(); setDelId(null); toast('Comment deleted'); }, onError: (e) => errToast(e, 'Could not delete comment') });
  const myId = Number(user?.id);
  const author = (c: JiraComment) => c.user ?? (c.user_name ? { id: c.user_id ?? 0, name: c.user_name } : null);
  const list = q.data ?? [];
  return (
    <div className="space-y-3">
      {canEdit(project.my_role) && (
        <form onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate(); }} className="flex gap-2">
          <UserDot user={{ name: user?.name ?? '?' }} size={28} />
          <div className="min-w-0 flex-1"><label className="sr-only" htmlFor="c-new">Add a comment</label>
            <MentionTextarea id="c-new" placeholder="Add a comment... (type @ to mention)" value={body} onChange={setBody} picks={picks} onPick={(p) => setPicks((x) => [...x, p])} />
            {body.trim() && <button className="btn-primary mt-2 !py-1" disabled={add.isPending}>{add.isPending ? 'Posting...' : 'Comment'}</button>}</div>
        </form>)}
      {q.isLoading ? <Skeleton className="h-16 w-full" /> : q.error ? <ErrorBanner error={q.error} onRetry={() => q.refetch()} />
        : list.length === 0 ? <EmptyState title="No comments yet" hint={canEdit(project.my_role) ? 'Start the conversation above.' : undefined} />
          : <ul className="space-y-3">{list.map((c) => {
            const a = author(c);
            const mine = a?.id === myId;
            return (
              <li key={c.id} className="flex gap-2">
                <UserDot user={a} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-fg-muted"><span className="font-semibold text-fg">{a?.name ?? 'Unknown'}</span> · {ago(c.created_at)}{c.updated_at && c.updated_at !== c.created_at && ' (edited)'}</p>
                  {editing === c.id ? (
                    <div className="mt-1"><textarea aria-label="Edit comment" className="input" rows={2} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                      <div className="mt-1 flex gap-2"><button className="btn-primary !py-1" disabled={edit.isPending || !editBody.trim()} onClick={() => edit.mutate(c.id)}>Save</button><button className="btn-ghost !py-1" onClick={() => setEditing(null)}>Cancel</button></div></div>
                  ) : <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{decodeMentions(c.body, c.mentions)}</p>}
                  {editing !== c.id && (mine || isAdmin(project.my_role)) && (
                    <div className="mt-1 flex gap-3 text-xs text-fg-muted">
                      {mine && <button className="inline-flex items-center gap-1 hover:text-fg" onClick={() => { setEditing(c.id); setEditBody(c.body); }}><Pencil size={11} />Edit</button>}
                      <button className="inline-flex items-center gap-1 hover:text-danger" onClick={() => setDelId(c.id)}><Trash2 size={11} />Delete</button></div>)}
                </div>
              </li>);
          })}</ul>}
      <ConfirmDialog open={delId !== null} title="Delete comment" message="This comment will be permanently removed." busy={rm.isPending} onConfirm={() => delId !== null && rm.mutate(delId)} onCancel={() => setDelId(null)} />
    </div>
  );
}

function History({ issueKey }: { issueKey: string }) {
  const q = useQuery({ queryKey: ['jira', 'history', issueKey], queryFn: () => jiraApi.history(issueKey) });
  if (q.isLoading) return <Skeleton className="h-20 w-full" />;
  if (q.error) return <ErrorBanner error={q.error} onRetry={() => q.refetch()} />;
  const list = q.data ?? [];
  if (!list.length) return <EmptyState title="No changes recorded" />;
  return (
    <ul className="space-y-2 text-sm">
      {list.map((h) => (
        <li key={h.id} className="rounded-lg border border-line px-3 py-2">
          <span className="font-semibold">{h.user?.name ?? 'Someone'}</span> changed <span className="font-medium">{h.field.replace(/_/g, ' ')}</span>
          <span className="text-fg-muted"> from </span><code className="rounded bg-surface-2 px-1">{h.old_value || 'none'}</code>
          <span className="text-fg-muted"> to </span><code className="rounded bg-surface-2 px-1">{h.new_value || 'none'}</code>
          <span className="ml-2 text-xs text-fg-muted">{ago(h.created_at)}</span>
        </li>))}
    </ul>
  );
}
