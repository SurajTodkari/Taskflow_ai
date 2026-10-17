import { useContext, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { jiraApi } from '../../lib/jiraApi';
import { ISSUE_TYPES, PRIORITIES, type IssueInput, type IssueType, type JiraProjectDetail, type JiraSprint, type Priority } from '../../lib/jiraTypes';
import { useErrToast, useRefreshJira } from './hooks';
import { PRIORITY_META, TYPE_META } from './ui';
import { ProjectCtx } from './ctx';

export interface CreateDefaults { column_id?: number; sprint_id?: number | null; type?: IssueType; parent_id?: number }

export function CreateIssueModal({ project, defaults, onClose, onCreated }: { project: JiraProjectDetail; defaults?: CreateDefaults; onClose: () => void; onCreated?: (key: string) => void }) {
  const teamCtx = useContext(ProjectCtx);
  const toast = useToast();
  const errToast = useErrToast();
  const refresh = useRefreshJira();
  const [type, setType] = useState<IssueType>(defaults?.type ?? 'task');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [assignee, setAssignee] = useState('');
  const [sprint, setSprint] = useState(defaults?.sprint_id ? String(defaults.sprint_id) : '');
  const [points, setPoints] = useState('');
  const [parent, setParent] = useState(defaults?.parent_id ? String(defaults.parent_id) : '');
  const [column, setColumn] = useState(defaults?.column_id ? String(defaults.column_id) : '');
  const [err, setErr] = useState('');
  const epics = useQuery({ queryKey: ['jira', 'epics', project.key], queryFn: () => jiraApi.listIssues(project.key, { type: 'epic', limit: 200 }) });
  const parents = useQuery({ queryKey: ['jira', 'parents', project.key], queryFn: () => jiraApi.listIssues(project.key, { limit: 200, sort: 'created', order: 'desc' }), enabled: type === 'subtask' });
  const parentOptions = type === 'subtask' ? (parents.data?.items ?? []).filter((i) => i.type !== 'subtask' && i.type !== 'epic') : type === 'epic' ? [] : epics.data?.items ?? [];
  const sprints = project.sprints.filter((s) => s.state !== 'closed');
  const m = useMutation({
    mutationFn: (b: IssueInput) => jiraApi.createIssue(project.key, b),
    onSuccess: (i) => { refresh(); toast(`Created ${i.key}`); onCreated?.(i.key); onClose(); },
    onError: (e) => errToast(e, 'Could not create issue'),
  });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!title.trim()) { setErr('Title is required'); return; }
    if (type === 'subtask' && !parent) { setErr('Pick a parent issue for the subtask'); return; }
    const pts = points.trim() === '' ? null : Number(points);
    if (pts !== null && (!Number.isFinite(pts) || pts < 0)) { setErr('Story points must be a non-negative number'); return; }
    m.mutate({
      type, title: title.trim(), description: description.trim() || null, priority,
      assignee_id: assignee ? Number(assignee) : null, sprint_id: sprint ? Number(sprint) : null,
      story_points: pts, parent_id: parent ? Number(parent) : null, ...(column ? { column_id: Number(column) } : {}),
    });
  };
  return (
    <Modal open onClose={onClose} title={`Create issue in ${project.key}`} wide>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="ci-type">Type</label>
            <select id="ci-type" className="input" value={type} onChange={(e) => { setType(e.target.value as IssueType); setParent(''); }}>
              {ISSUE_TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}</select></div>
          <div><label className="label" htmlFor="ci-pri">Priority</label>
            <select id="ci-pri" className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</select></div>
        </div>
        <div><label className="label" htmlFor="ci-title">Title</label>
          <input id="ci-title" className="input" maxLength={200} value={title} onChange={(e) => { setTitle(e.target.value); setErr(''); }} aria-invalid={!!err} />
          {err && <p className="mt-1 text-xs text-danger" role="alert">{err}</p>}</div>
        <div><label className="label" htmlFor="ci-desc">Description</label>
          <textarea id="ci-desc" className="input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="ci-asg">Assignee</label>
            <select id="ci-asg" className="input" value={assignee} onChange={(e) => { if (e.target.value === '__team') { teamCtx?.openTeam(); return; } setAssignee(e.target.value); }}>
              <option value="">Unassigned</option>{project.members.filter((x) => x.role !== 'viewer').map((x) => <option key={x.user_id} value={x.user_id}>{x.name}</option>)}<option value="__team">+ Add / invite people…</option></select></div>
          <div><label className="label" htmlFor="ci-col">Status</label>
            <select id="ci-col" className="input" value={column} onChange={(e) => setColumn(e.target.value)}>
              <option value="">{project.columns[0]?.name ?? 'Default'}</option>{project.columns.slice(1).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="label" htmlFor="ci-spr">Sprint</label>
            <select id="ci-spr" className="input" value={sprint} onChange={(e) => setSprint(e.target.value)}>
              <option value="">Backlog</option>{sprints.map((s) => <option key={s.id} value={s.id}>{s.name}{s.state === 'active' ? ' (active)' : ''}</option>)}</select></div>
          <div><label className="label" htmlFor="ci-pts">Story points</label>
            <input id="ci-pts" type="number" min={0} step={1} className="input" value={points} onChange={(e) => setPoints(e.target.value)} /></div>
          {type !== 'epic' && <div className="sm:col-span-2"><label className="label" htmlFor="ci-par">{type === 'subtask' ? 'Parent issue' : 'Epic'}</label>
            <select id="ci-par" className="input" value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">{type === 'subtask' ? 'Select parent...' : 'No epic'}</option>{parentOptions.map((i) => <option key={i.id} value={i.id}>{i.key} {i.title}</option>)}</select></div>}
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={m.isPending}>{m.isPending ? 'Creating...' : 'Create'}</button></div>
      </form>
    </Modal>
  );
}

/** One-line inline create used on the board columns and backlog sections. */
export function QuickCreate({ project, column_id, sprint_id, onDone }: { project: JiraProjectDetail; column_id?: number; sprint_id?: number | null; onDone?: () => void }) {
  const refresh = useRefreshJira();
  const errToast = useErrToast();
  const [type, setType] = useState<IssueType>('task');
  const [title, setTitle] = useState('');
  const m = useMutation({
    mutationFn: (b: IssueInput) => jiraApi.createIssue(project.key, b),
    onSuccess: () => { refresh(); setTitle(''); onDone?.(); },
    onError: (e) => errToast(e, 'Could not create issue'),
  });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!title.trim()) return;
    m.mutate({ type, title: title.trim(), ...(column_id ? { column_id } : {}), ...(sprint_id ? { sprint_id } : {}) });
  };
  return (
    <form onSubmit={submit} className="flex gap-1.5">
      <select aria-label="Issue type" className="input !w-auto !px-2 !py-1.5 text-xs" value={type} onChange={(e) => setType(e.target.value as IssueType)}>
        {ISSUE_TYPES.filter((t) => t !== 'subtask').map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}</select>
      <input aria-label="New issue title" className="input !py-1.5 text-xs" placeholder="What needs to be done?" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      <button className="btn-primary !px-3 !py-1.5 text-xs" disabled={m.isPending || !title.trim()}>Add</button>
    </form>
  );
}

export function StartSprintModal({ sprint, onClose }: { sprint: JiraSprint; onClose: () => void }) {
  const toast = useToast();
  const errToast = useErrToast();
  const refresh = useRefreshJira();
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(sprint.start_date ?? today);
  const [end, setEnd] = useState(sprint.end_date ?? new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10));
  const m = useMutation({
    mutationFn: () => jiraApi.startSprint(sprint.id, { start_date: start || null, end_date: end || null }),
    onSuccess: () => { refresh(); toast(`${sprint.name} started`); onClose(); },
    onError: (e) => errToast(e, 'Could not start sprint'),
  });
  return (
    <Modal open onClose={onClose} title={`Start ${sprint.name}`} footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={m.isPending || (!!end && !!start && end < start)} onClick={() => m.mutate()}>{m.isPending ? 'Starting...' : 'Start sprint'}</button></>}>
      <p className="mb-3 text-sm text-fg-muted">{sprint.issue_count ?? 0} issue(s) in this sprint. Only one sprint can be active at a time.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="ss-s">Start date</label><input id="ss-s" type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div><label className="label" htmlFor="ss-e">End date</label><input id="ss-e" type="date" className="input" min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export function CompleteSprintModal({ sprint, sprints, onClose }: { sprint: JiraSprint; sprints: JiraSprint[]; onClose: () => void }) {
  const toast = useToast();
  const errToast = useErrToast();
  const refresh = useRefreshJira();
  const [target, setTarget] = useState('backlog');
  const others = sprints.filter((s) => s.id !== sprint.id && s.state === 'planned');
  const m = useMutation({
    mutationFn: () => jiraApi.completeSprint(sprint.id, target === 'backlog' ? 'backlog' : Number(target)),
    onSuccess: () => { refresh(); toast(`${sprint.name} completed`); onClose(); },
    onError: (e) => errToast(e, 'Could not complete sprint'),
  });
  return (
    <Modal open onClose={onClose} title={`Complete ${sprint.name}`} footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Completing...' : 'Complete sprint'}</button></>}>
      <p className="mb-3 text-sm text-fg-muted">Completed issues stay with this sprint. Move the unfinished ones to:</p>
      <label className="label" htmlFor="cs-t">Move open issues to</label>
      <select id="cs-t" className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="backlog">Backlog</option>{others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
    </Modal>
  );
}

export function CreateSprintModal({ project, onClose }: { project: JiraProjectDetail; onClose: () => void }) {
  const toast = useToast();
  const errToast = useErrToast();
  const refresh = useRefreshJira();
  const [name, setName] = useState(`Sprint ${project.sprints.length + 1}`);
  const [goal, setGoal] = useState('');
  const m = useMutation({
    mutationFn: () => jiraApi.createSprint(project.key, { name: name.trim(), goal: goal.trim() || undefined }),
    onSuccess: () => { refresh(); toast('Sprint created'); onClose(); },
    onError: (e) => errToast(e, 'Could not create sprint'),
  });
  return (
    <Modal open onClose={onClose} title="Create sprint">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) m.mutate(); }}>
        <div><label className="label" htmlFor="cs-n">Name</label><input id="cs-n" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="label" htmlFor="cs-g">Goal (optional)</label><textarea id="cs-g" className="input" rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} /></div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={m.isPending || !name.trim()}>{m.isPending ? 'Creating...' : 'Create'}</button></div>
      </form>
    </Modal>
  );
}
