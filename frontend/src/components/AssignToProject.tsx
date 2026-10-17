import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Modal from './Modal';
import { useToast } from './Toast';
import { jiraApi } from '../lib/jiraApi';
import type { Task } from '../lib/types';
import type { Priority } from '../lib/jiraTypes';

const PRIORITY_MAP: Record<string, Priority> = { critical: 'highest', high: 'high', medium: 'medium', low: 'low' };

/** Turns a personal task into an issue in a team (Jira-style) project, optionally assigned to a member or an invited email. */
export default function AssignToProject({ task, open, onClose }: { task: Task; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [key, setKey] = useState('');
  const [assignee, setAssignee] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const projects = useQuery({ queryKey: ['jira', 'projects'], queryFn: jiraApi.listProjects, enabled: open });
  const writable = (projects.data ?? []).filter((p) => p.my_role !== 'viewer' && !p.archived);
  const projectKey = key || writable[0]?.key || '';
  const detail = useQuery({ queryKey: ['jira', 'project', projectKey], queryFn: () => jiraApi.getProject(projectKey), enabled: open && !!projectKey });
  const members = (detail.data?.members ?? []).filter((m) => m.role !== 'viewer');
  const canInvite = detail.data?.my_role === 'admin';

  const create = (assignee_id: number | null) => jiraApi.createIssue(projectKey, {
    type: 'task', title: task.title,
    description: [task.description, task.notes].filter(Boolean).join('\n\n') || null,
    priority: PRIORITY_MAP[task.priority] ?? 'medium',
    assignee_id,
    due_date: task.due_date, labels: task.tags ?? [],
  });

  const send = useMutation({
    mutationFn: async () => {
      const em = inviteEmail.trim().toLowerCase();
      if (em && !assignee) {
        const r = await jiraApi.inviteOrAdd(projectKey, { email: em, role: 'member' });
        if (r?.invited) return { issue: await create(null), invited: em };
        const d = await jiraApi.getProject(projectKey);
        const m = d.members.find((x) => x.email.toLowerCase() === em);
        return { issue: await create(m ? m.user_id : null), invited: '' };
      }
      return { issue: await create(assignee ? Number(assignee) : null), invited: '' };
    },
    onSuccess: ({ issue, invited }) => {
      toast(invited ? `Created ${issue.key}. Invite sent to ${invited}; they can be assigned after they sign up.` : `Created ${issue.key}${issue.assignee ? ` and assigned to ${issue.assignee.name}` : ''}`);
      setInviteEmail(''); onClose();
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Could not create issue', 'error'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Assign to project"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!projectKey || send.isPending} onClick={() => send.mutate()}>Create issue</button></>}>
      <p className="mb-3 text-sm text-fg-muted">Creates a copy of "{task.title}" as an issue in a team project. Your personal task stays as is.</p>
      {projects.isLoading ? <p className="text-sm text-fg-muted">Loading projects…</p>
        : writable.length === 0 ? <p className="text-sm text-fg-muted">You have no team project yet. Create one under Projects (Jira) first.</p>
        : <div className="space-y-3">
          <div><label className="label" htmlFor="atp-project">Project</label>
            <select id="atp-project" className="input" value={projectKey} onChange={(e) => { setKey(e.target.value); setAssignee(''); }}>
              {writable.map((p) => <option key={p.key} value={p.key}>{p.key} – {p.name}</option>)}
            </select></div>
          <div><label className="label" htmlFor="atp-assignee">Assignee</label>
            <select id="atp-assignee" className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={detail.isLoading}>
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
            </select>
            <p className="mt-1 text-caption text-fg-muted">Only project members can be assigned.</p></div>
          {canInvite && !assignee && <div><label className="label" htmlFor="atp-invite">Or invite someone by email</label>
            <input id="atp-invite" type="email" className="input" placeholder="anyone@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            <p className="mt-1 text-caption text-fg-muted">Not registered yet? They get an invite and can be assigned after they sign up. Existing users are added as members.</p></div>}
        </div>}
    </Modal>
  );
}
