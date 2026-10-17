import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import ConfirmDialog from '../../components/ConfirmDialog';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Avatar } from '../../components/ui/Avatar';
import { useAuth } from '../../lib/auth';
import { jiraApi } from '../../lib/jiraApi';
import { CATEGORIES, ROLES, type JiraColumn, type JiraMember, type Role, type StatusCategory } from '../../lib/jiraTypes';
import { useProjectCtx } from '../../features/jira/ctx';
import { useErrToast, useRefreshJira } from '../../features/jira/hooks';
import { CATEGORY_META, isAdmin } from '../../features/jira/ui';
import { ComponentsManager, CustomFieldsManager, InviteForm, LabelsView, ProjectConfig, WorkflowEditor } from '../../features/jira/SettingsExtra';

export default function ProjectSettings() {
  const { project } = useProjectCtx();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const errToast = useErrToast();
  const refresh = useRefreshJira();
  const admin = isAdmin(project.my_role);
  const myId = Number(user?.id);

  const [name, setName] = useState(project.name);
  const [desc, setDesc] = useState(project.description ?? '');
  const [colName, setColName] = useState('');
  const [colCat, setColCat] = useState<StatusCategory>('in_progress');
  const [delCol, setDelCol] = useState<JiraColumn | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [rmMember, setRmMember] = useState<JiraMember | null>(null);
  const [delProject, setDelProject] = useState(false);

  const saveProject = useMutation({ mutationFn: () => jiraApi.updateProject(project.key, { name: name.trim(), description: desc }), onSuccess: () => { refresh(); toast('Project updated'); }, onError: (e) => errToast(e, 'Update failed') });
  const setMemberRole = useMutation({ mutationFn: (v: { id: number; role: Role }) => jiraApi.setMemberRole(project.key, v.id, v.role), onSuccess: () => { refresh(); toast('Role updated'); }, onError: (e) => { refresh(); errToast(e, 'Could not change role'); } });
  const removeMember = useMutation({
    mutationFn: (m: JiraMember) => jiraApi.removeMember(project.key, m.user_id),
    onSuccess: (_d, m) => { refresh(); setRmMember(null); if (m.user_id === myId) { toast('You left the project'); nav('/jira'); } else toast('Member removed'); },
    onError: (e) => errToast(e, 'Could not remove member'),
  });
  const addCol = useMutation({ mutationFn: () => jiraApi.addColumn(project.key, { name: colName.trim(), category: colCat }), onSuccess: () => { refresh(); setColName(''); toast('Column added'); }, onError: (e) => errToast(e, 'Could not add column') });
  const updCol = useMutation({ mutationFn: (v: { id: number; b: { name?: string; category?: StatusCategory; position?: number; wip_limit?: number | null } }) => jiraApi.updateColumn(v.id, v.b), onSuccess: () => refresh(), onError: (e) => { refresh(); errToast(e, 'Could not update column'); } });
  const rmCol = useMutation({
    mutationFn: (c: JiraColumn) => jiraApi.deleteColumn(c.id, moveTo ? Number(moveTo) : undefined),
    onSuccess: () => { refresh(); setDelCol(null); toast('Column deleted'); },
    onError: (e) => errToast(e, 'Could not delete column'),
  });
  const rmProject = useMutation({ mutationFn: () => jiraApi.deleteProject(project.key), onSuccess: () => { refresh(); toast('Project deleted'); nav('/jira'); }, onError: (e) => errToast(e, 'Could not delete project') });

  const cols = [...project.columns].sort((a, b) => a.position - b.position);
  const swap = (i: number, d: -1 | 1) => {
    const other = cols[i + d];
    if (!other) return;
    // move to the neighbour's position; backend reorders the rest
    updCol.mutate({ id: cols[i].id, b: { position: other.position } });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {!admin && <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-fg-muted">Only project admins can change settings. You are a <strong>{project.my_role}</strong>.</p>}

      <section className="card space-y-4 p-5" aria-labelledby="s-details">
        <h2 id="s-details" className="text-section">Details</h2>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) saveProject.mutate(); }}>
          <div><label className="label" htmlFor="s-name">Name</label><input id="s-name" className="input" disabled={!admin} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="label" htmlFor="s-key">Key</label><input id="s-key" className="input font-mono" disabled value={project.key} /></div>
          <div><label className="label" htmlFor="s-desc">Description</label><textarea id="s-desc" className="input" rows={3} disabled={!admin} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          {admin && <button className="btn-primary" disabled={saveProject.isPending || !name.trim() || (name.trim() === project.name && desc === (project.description ?? ''))}>{saveProject.isPending ? 'Saving...' : 'Save changes'}</button>}
        </form>
      </section>

      <section className="card space-y-4 p-5" aria-labelledby="s-members">
        <h2 id="s-members" className="text-section">Members ({project.members.length})</h2>
        <ul className="divide-y divide-line">
          {project.members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-2.5">
              <Avatar name={m.name} size={32} />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{m.name}{m.user_id === myId && <span className="ml-1.5 text-xs text-fg-muted">(you)</span>}</p><p className="truncate text-xs text-fg-muted">{m.email}</p></div>
              <select aria-label={`Role for ${m.name}`} className="input !w-auto" disabled={!admin || setMemberRole.isPending} value={m.role} onChange={(e) => setMemberRole.mutate({ id: m.user_id, role: e.target.value as Role })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
              {(admin || m.user_id === myId) && <button className="icon-btn" aria-label={m.user_id === myId ? 'Leave project' : `Remove ${m.name}`} onClick={() => setRmMember(m)}><Trash2 size={15} /></button>}
            </li>))}
        </ul>
        {admin && <InviteForm project={project} />}
      </section>

      <section className="card space-y-4 p-5" aria-labelledby="s-cols">
        <h2 id="s-cols" className="text-section">Workflow columns</h2>
        <p className="text-xs text-fg-muted">Columns appear on the board in this order. The category decides whether an issue counts as to do, in progress or done.</p>
        <ul className="space-y-2">
          {cols.map((c, i) => <ColumnRow key={`${c.id}-${c.name}-${c.category}-${c.wip_limit ?? ''}`} col={c} admin={admin} first={i === 0} last={i === cols.length - 1} onMove={(d) => swap(i, d)}
            onSave={(b) => updCol.mutate({ id: c.id, b })} onDelete={() => { setDelCol(c); setMoveTo(''); }} />)}
        </ul>
        {admin && <form className="flex flex-wrap items-end gap-2 border-t border-line pt-4" onSubmit={(e) => { e.preventDefault(); if (colName.trim()) addCol.mutate(); }}>
          <div className="min-w-40 flex-1"><label className="label" htmlFor="c-name">New column</label><input id="c-name" className="input" maxLength={60} placeholder="e.g. QA" value={colName} onChange={(e) => setColName(e.target.value)} /></div>
          <div><label className="label" htmlFor="c-cat">Category</label><select id="c-cat" className="input" value={colCat} onChange={(e) => setColCat(e.target.value as StatusCategory)}>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}</select></div>
          <button className="btn-primary" disabled={addCol.isPending || !colName.trim()}><Plus size={16} />Add</button>
        </form>}
      </section>

      <ProjectConfig project={project} admin={admin} />
      <WorkflowEditor project={project} admin={admin} />
      <ComponentsManager project={project} admin={admin} />
      <CustomFieldsManager project={project} admin={admin} />
      <LabelsView project={project} />

      {admin && <section className="card space-y-3 border-danger/40 p-5" aria-labelledby="s-danger">
        <h2 id="s-danger" className="text-section text-danger">Danger zone</h2>
        <p className="text-sm text-fg-muted">Deleting a project permanently removes all of its issues, sprints and comments.</p>
        <button className="btn-danger" onClick={() => setDelProject(true)}><Trash2 size={16} />Delete project</button>
      </section>}

      <Modal open={!!delCol} onClose={() => setDelCol(null)} title={`Delete column "${delCol?.name ?? ''}"`}
        footer={<><button className="btn-ghost" onClick={() => setDelCol(null)}>Cancel</button><button className="btn-danger" disabled={rmCol.isPending} onClick={() => delCol && rmCol.mutate(delCol)}>{rmCol.isPending ? 'Deleting...' : 'Delete column'}</button></>}>
        <p className="mb-3 text-sm text-fg-muted">Any issues in this column are moved to the column you choose. A project needs at least one column.</p>
        <label className="label" htmlFor="dc-to">Move issues to</label>
        <select id="dc-to" className="input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
          <option value="">Select a column</option>{cols.filter((c) => c.id !== delCol?.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </Modal>
      <ConfirmDialog open={!!rmMember} title={rmMember?.user_id === myId ? 'Leave project' : 'Remove member'} confirmLabel={rmMember?.user_id === myId ? 'Leave' : 'Remove'}
        message={rmMember?.user_id === myId ? 'You will lose access to this project.' : `Remove ${rmMember?.name}? Their issues will become unassigned.`} busy={removeMember.isPending}
        onConfirm={() => rmMember && removeMember.mutate(rmMember)} onCancel={() => setRmMember(null)} />
      <ConfirmDialog open={delProject} title="Delete project" message={`Delete ${project.name} (${project.key}) and everything in it? This cannot be undone.`} busy={rmProject.isPending} onConfirm={() => rmProject.mutate()} onCancel={() => setDelProject(false)} />
    </div>
  );
}

function ColumnRow({ col, admin, first, last, onMove, onSave, onDelete }: { col: JiraColumn; admin: boolean; first: boolean; last: boolean; onMove: (d: -1 | 1) => void; onSave: (b: { name?: string; category?: StatusCategory; wip_limit?: number | null }) => void; onDelete: () => void }) {
  const [name, setName] = useState(col.name);
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2">
      <input aria-label={`Name of column ${col.name}`} className="input min-w-32 flex-1" disabled={!admin} maxLength={60} value={name} onChange={(e) => setName(e.target.value)}
        onBlur={() => { const n = name.trim(); if (!n) setName(col.name); else if (n !== col.name) onSave({ name: n }); }} />
      <select aria-label={`Category of ${col.name}`} className="input !w-auto" disabled={!admin} value={col.category} onChange={(e) => onSave({ category: e.target.value as StatusCategory })}>
        {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}</select>
      <input type="number" min={0} aria-label={`WIP limit for ${col.name}`} title="WIP limit (empty = none)" placeholder="WIP" className="input !w-20" disabled={!admin} defaultValue={col.wip_limit ?? ''}
        onBlur={(e) => { const v = e.target.value.trim() === '' ? null : Number(e.target.value); if (v !== (col.wip_limit ?? null) && (v === null || (Number.isFinite(v) && v >= 0))) onSave({ wip_limit: v }); }} />
      {admin && <span className="flex">
        <button className="icon-btn" aria-label={`Move ${col.name} up`} disabled={first} onClick={() => onMove(-1)}><ArrowUp size={15} /></button>
        <button className="icon-btn" aria-label={`Move ${col.name} down`} disabled={last} onClick={() => onMove(1)}><ArrowDown size={15} /></button>
        <button className="icon-btn" aria-label={`Delete column ${col.name}`} onClick={onDelete}><Trash2 size={15} /></button></span>}
    </li>
  );
}
