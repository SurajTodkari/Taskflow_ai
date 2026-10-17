import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Trash2, UserPlus, X } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { jiraApi } from '../../lib/jiraApi';
import { ROLES, type CustomFieldType, type JiraProjectDetail, type Role, type Transition } from '../../lib/jiraTypes';
import { useErrToast, useRefreshJira } from './hooks';

export function InviteForm({ project }: { project: JiraProjectDetail }) {
  const toast = useToast();
  const errToast = useErrToast();
  const refresh = useRefreshJira();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [people, setPeople] = useState<{ id: number; name: string; email?: string }[]>([]);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (email.trim().length < 2) { setPeople([]); return; }
    let live = true;
    const t = setTimeout(() => { jiraApi.people(email.trim()).then((r) => { if (live) setPeople(r); }).catch(() => undefined); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [email]);
  const invites = useQuery({ queryKey: ['jira', 'invites', project.key], queryFn: () => jiraApi.listInvites(project.key), retry: false });
  const add = useMutation({
    mutationFn: () => jiraApi.inviteOrAdd(project.key, { email: email.trim().toLowerCase(), role }),
    onSuccess: (r) => {
      refresh();
      if (r?.invited) { setNote(`Invite sent to ${email.trim()}. They can be assigned issues after they sign up.`); toast('Invite sent'); } else { setNote(''); toast('Member added'); }
      setEmail('');
    },
    onError: (e) => errToast(e, 'Could not add member'),
  });
  const revoke = useMutation({ mutationFn: (id: number) => jiraApi.deleteInvite(id), onSuccess: () => { refresh(); toast('Invite revoked'); }, onError: (e) => errToast(e, 'Could not revoke invite') });
  return (
    <div className="space-y-3 border-t border-line pt-4">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (email.trim()) add.mutate(); }}>
        <div className="min-w-48 flex-1"><label className="label" htmlFor="m-email">Add or invite by email</label>
          <input id="m-email" type="email" list="m-people" className="input" placeholder="anyone@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <datalist id="m-people">{people.filter((p) => p.email).map((p) => <option key={p.id} value={p.email}>{p.name}</option>)}</datalist></div>
        <div><label className="label" htmlFor="m-role">Role</label><select id="m-role" className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
        <button className="btn-primary" disabled={add.isPending || !email.trim()}><UserPlus size={16} />{add.isPending ? 'Adding...' : 'Add / invite'}</button>
      </form>
      <p className="text-caption text-fg-muted">If the person has no account yet, they get a pending invite and join automatically when they sign up.</p>
      {note && <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">{note}</p>}
      {(invites.data ?? []).length > 0 && <div><h3 className="mb-1 text-sm font-semibold">Pending invites</h3>
        <ul className="space-y-1">{(invites.data ?? []).map((i) => <li key={i.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-sm"><span className="min-w-0 flex-1 truncate">{i.email}</span><span className="text-xs text-fg-muted">{i.role}</span>
          <button className="icon-btn" aria-label={`Revoke invite for ${i.email}`} onClick={() => revoke.mutate(i.id)}><X size={14} /></button></li>)}</ul></div>}
    </div>
  );
}

export function ProjectConfig({ project, admin }: { project: JiraProjectDetail; admin: boolean }) {
  const toast = useToast();
  const errToast = useErrToast();
  const refresh = useRefreshJira();
  const nav = useNavigate();
  const upd = useMutation({
    mutationFn: (b: Record<string, unknown>) => jiraApi.updateProjectSettings(project.key, b),
    onSuccess: () => { refresh(); toast('Saved'); }, onError: (e) => { refresh(); errToast(e, 'Update failed'); },
  });
  const arch = useMutation({
    mutationFn: () => jiraApi.updateProjectSettings(project.key, { archived: !project.archived }),
    onSuccess: () => { refresh(); toast(project.archived ? 'Project restored' : 'Project archived'); if (!project.archived) nav('/jira'); }, onError: (e) => errToast(e, 'Update failed'),
  });
  return (
    <section className="card space-y-4 p-5" aria-labelledby="s-config">
      <h2 id="s-config" className="text-section">Board and workflow</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="pc-type">Board type</label>
          <select id="pc-type" className="input" disabled={!admin} value={project.board_type ?? 'scrum'} onChange={(e) => upd.mutate({ board_type: e.target.value })}>
            <option value="scrum">Scrum (sprints and backlog)</option><option value="kanban">Kanban (continuous flow)</option></select></div>
        <div><label className="label" htmlFor="pc-asg">Default assignee</label>
          <select id="pc-asg" className="input" disabled={!admin} value={project.default_assignee_id ?? ''} onChange={(e) => upd.mutate({ default_assignee_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Unassigned</option>{project.members.filter((m) => m.role !== 'viewer').map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select></div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" disabled={!admin} checked={!!project.enforce_workflow} onChange={(e) => upd.mutate({ enforce_workflow: e.target.checked })} />Enforce workflow transitions (only allowed moves between columns)</label>
      {admin && <button className="btn-ghost" disabled={arch.isPending} onClick={() => arch.mutate()}>{project.archived ? 'Unarchive project' : 'Archive project (read-only)'}</button>}
    </section>
  );
}

export function WorkflowEditor({ project, admin }: { project: JiraProjectDetail; admin: boolean }) {
  const toast = useToast();
  const errToast = useErrToast();
  const q = useQuery({ queryKey: ['jira', 'workflow', project.key], queryFn: () => jiraApi.workflow(project.key), retry: false });
  const [set, setSet] = useState<Set<string> | null>(null);
  const cols = [...project.columns].sort((a, b) => a.position - b.position);
  const cur = set ?? new Set((q.data ?? []).map((t) => `${t.from}:${t.to}`));
  const toggle = (f: number, t: number) => { const n = new Set(cur); const k = `${f}:${t}`; if (n.has(k)) n.delete(k); else n.add(k); setSet(n); };
  const save = useMutation({
    mutationFn: () => jiraApi.setWorkflow(project.key, Array.from(cur).map((k) => { const [from, to] = k.split(':').map(Number); return { from, to } as Transition; })),
    onSuccess: () => { setSet(null); q.refetch(); toast('Workflow saved'); }, onError: (e) => errToast(e, 'Could not save workflow'),
  });
  return (
    <section className="card space-y-3 p-5" aria-labelledby="s-wf">
      <h2 id="s-wf" className="text-section">Workflow transitions</h2>
      <p className="text-xs text-fg-muted">{project.enforce_workflow ? 'Enforced: issues can only move along the checked transitions.' : 'Not enforced yet. Turn on "Enforce workflow" above to apply these.'} Rows are the current status, columns the target.</p>
      <div className="overflow-x-auto"><table className="text-sm">
        <thead><tr><th className="px-2 py-1 text-left text-xs font-medium text-fg-muted">From \ To</th>{cols.map((c) => <th key={c.id} className="px-2 py-1 text-xs font-medium text-fg-muted">{c.name}</th>)}</tr></thead>
        <tbody>{cols.map((f) => <tr key={f.id}><th scope="row" className="px-2 py-1 text-left text-xs font-medium">{f.name}</th>
          {cols.map((t) => <td key={t.id} className="px-2 py-1 text-center">{f.id === t.id ? <span className="text-fg-muted">-</span> :
            <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" aria-label={`Allow ${f.name} to ${t.name}`} disabled={!admin} checked={cur.has(`${f.id}:${t.id}`)} onChange={() => toggle(f.id, t.id)} />}</td>)}</tr>)}</tbody></table></div>
      {admin && set && <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Save workflow</button>}
    </section>
  );
}

export function ComponentsManager({ project, admin }: { project: JiraProjectDetail; admin: boolean }) {
  const errToast = useErrToast();
  const refresh = useRefreshJira();
  const [name, setName] = useState('');
  const [lead, setLead] = useState('');
  const q = useQuery({ queryKey: ['jira', 'components', project.key], queryFn: () => jiraApi.components(project.key) });
  const add = useMutation({ mutationFn: () => jiraApi.addComponent(project.key, { name: name.trim(), lead_id: lead ? Number(lead) : null }), onSuccess: () => { refresh(); setName(''); setLead(''); }, onError: (e) => errToast(e, 'Could not add component') });
  const rm = useMutation({ mutationFn: (id: number) => jiraApi.deleteComponent(id), onSuccess: () => refresh(), onError: (e) => errToast(e, 'Could not delete component') });
  return (
    <section className="card space-y-3 p-5" aria-labelledby="s-comp">
      <h2 id="s-comp" className="text-section">Components</h2>
      <ul className="space-y-1">{(q.data ?? []).map((c) => <li key={c.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-sm"><span className="min-w-0 flex-1 truncate">{c.name}</span>
        <span className="text-xs text-fg-muted">{project.members.find((m) => m.user_id === c.lead_id)?.name ?? ''}</span>
        {admin && <button className="icon-btn" aria-label={`Delete component ${c.name}`} onClick={() => rm.mutate(c.id)}><Trash2 size={14} /></button>}</li>)}
        {(q.data ?? []).length === 0 && <li className="text-xs text-fg-muted">No components.</li>}</ul>
      {admin && <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(); }}>
        <div className="min-w-40 flex-1"><label className="label" htmlFor="cp-n">New component</label><input id="cp-n" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="label" htmlFor="cp-l">Lead</label><select id="cp-l" className="input" value={lead} onChange={(e) => setLead(e.target.value)}><option value="">None</option>{project.members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select></div>
        <button className="btn-primary" disabled={!name.trim() || add.isPending}>Add</button></form>}
    </section>
  );
}

const FIELD_TYPES: CustomFieldType[] = ['text', 'number', 'select', 'date', 'checkbox'];
export function CustomFieldsManager({ project, admin }: { project: JiraProjectDetail; admin: boolean }) {
  const errToast = useErrToast();
  const refresh = useRefreshJira();
  const [name, setName] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [options, setOptions] = useState('');
  const [required, setRequired] = useState(false);
  const q = useQuery({ queryKey: ['jira', 'custom-fields', project.key], queryFn: () => jiraApi.customFields(project.key) });
  const add = useMutation({
    mutationFn: () => jiraApi.addCustomField(project.key, { name: name.trim(), field_type: type, required, options: type === 'select' ? options.split(',').map((x) => x.trim()).filter(Boolean) : null }),
    onSuccess: () => { refresh(); setName(''); setOptions(''); setRequired(false); }, onError: (e) => errToast(e, 'Could not add field'),
  });
  const rm = useMutation({ mutationFn: (id: number) => jiraApi.deleteCustomField(id), onSuccess: () => refresh(), onError: (e) => errToast(e, 'Could not delete field') });
  return (
    <section className="card space-y-3 p-5" aria-labelledby="s-cf">
      <h2 id="s-cf" className="text-section">Custom fields</h2>
      <ul className="space-y-1">{(q.data ?? []).map((f) => <li key={f.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-sm"><span className="min-w-0 flex-1 truncate">{f.name}{f.required && ' *'}</span>
        <span className="text-xs text-fg-muted">{f.field_type}{f.field_type === 'select' && f.options ? ` (${f.options.join(', ')})` : ''}</span>
        {admin && <button className="icon-btn" aria-label={`Delete field ${f.name}`} onClick={() => rm.mutate(f.id)}><Trash2 size={14} /></button>}</li>)}
        {(q.data ?? []).length === 0 && <li className="text-xs text-fg-muted">No custom fields.</li>}</ul>
      {admin && <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(); }}>
        <div className="min-w-36 flex-1"><label className="label" htmlFor="cf-n">Name</label><input id="cf-n" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="label" htmlFor="cf-t">Type</label><select id="cf-t" className="input" value={type} onChange={(e) => setType(e.target.value as CustomFieldType)}>{FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
        {type === 'select' && <div className="min-w-36 flex-1"><label className="label" htmlFor="cf-o">Options (comma separated)</label><input id="cf-o" className="input" value={options} onChange={(e) => setOptions(e.target.value)} /></div>}
        <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={required} onChange={(e) => setRequired(e.target.checked)} />Required</label>
        <button className="btn-primary" disabled={!name.trim() || add.isPending}>Add</button></form>}
    </section>
  );
}

export function LabelsView({ project }: { project: JiraProjectDetail }) {
  const q = useQuery({ queryKey: ['jira', 'issues', project.key, 'labels'], queryFn: () => jiraApi.listIssues(project.key, { limit: 200 }), staleTime: 60000 });
  const counts = new Map<string, number>();
  (q.data?.items ?? []).forEach((i) => (i.labels ?? []).forEach((l) => counts.set(l, (counts.get(l) ?? 0) + 1)));
  const rows = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  return (
    <section className="card space-y-3 p-5" aria-labelledby="s-lab">
      <h2 id="s-lab" className="text-section">Labels</h2>
      {rows.length === 0 ? <p className="text-xs text-fg-muted">No labels used yet. Add labels on an issue.</p> : <div className="flex flex-wrap gap-2">{rows.map(([l, n]) => <span key={l} className="chip">{l} <span className="text-fg-muted">{n}</span></span>)}</div>}
    </section>
  );
}
