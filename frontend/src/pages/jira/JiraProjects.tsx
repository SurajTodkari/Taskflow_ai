import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { Plus, KanbanSquare, Users, ListChecks, Zap } from 'lucide-react';
import Modal from '../../components/Modal';
import ErrorBanner from '../../components/ErrorBanner';
import EmptyState from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { jiraApi } from '../../lib/jiraApi';
import { useErrToast, useRefreshJira } from '../../features/jira/hooks';

export function suggestKey(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const k = words.length === 1 ? words[0].slice(0, 4) : words.map((w) => w[0]).join('').slice(0, 5);
  return k;
}
const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;

function CreateProject({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const errToast = useErrToast();
  const refresh = useRefreshJira();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [touched, setTouched] = useState(false);
  const [desc, setDesc] = useState('');
  const [err, setErr] = useState('');
  const m = useMutation({
    mutationFn: () => jiraApi.createProject({ key, name: name.trim(), description: desc.trim() || undefined }),
    onSuccess: (p) => { refresh(); toast(`Project ${p.key} created`); onClose(); nav(`/jira/${p.key}/board`); },
    onError: (e) => { const msg = e instanceof Error ? e.message : 'Could not create project'; setErr(msg); errToast(e); },
  });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!name.trim()) { setErr('Name is required'); return; }
    if (!KEY_RE.test(key)) { setErr('Key must be 2-10 characters, A-Z and 0-9, starting with a letter'); return; }
    setErr(''); m.mutate();
  };
  return (
    <Modal open onClose={onClose} title="Create project">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div><label className="label" htmlFor="jp-name">Name</label>
          <input id="jp-name" className="input" maxLength={120} value={name} onChange={(e) => { setName(e.target.value); if (!touched) setKey(suggestKey(e.target.value)); }} /></div>
        <div><label className="label" htmlFor="jp-key">Key</label>
          <input id="jp-key" className="input font-mono uppercase" maxLength={10} value={key} onChange={(e) => { setTouched(true); setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); }} aria-describedby="jp-key-h" />
          <p id="jp-key-h" className="mt-1 text-caption text-fg-muted">Issues will be numbered {key || 'KEY'}-1, {key || 'KEY'}-2, ... The key cannot be changed later.</p></div>
        <div><label className="label" htmlFor="jp-desc">Description</label>
          <textarea id="jp-desc" className="input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={m.isPending}>{m.isPending ? 'Creating...' : 'Create project'}</button></div>
      </form>
    </Modal>
  );
}

export default function JiraProjects() {
  const reduce = useReducedMotion();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['jira', 'projects'], queryFn: jiraApi.listProjects });
  const list = q.data ?? [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-page font-semibold">Projects (Jira)</h1><p className="text-sm text-fg-muted">Team projects with boards, backlogs and sprints.</p></div>
        <div className="flex gap-2"><Link to="/jira/my-issues" className="btn-ghost">My issues</Link><button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} />Create project</button></div>
      </div>
      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}</div>
        : list.length === 0 && !q.error ? <EmptyState icon={KanbanSquare} title="No projects yet" hint="Create a project to plan work with a board, backlog and sprints." action={<button className="btn-primary" onClick={() => setCreating(true)}>Create project</button>} />
          : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{list.map((p, i) => (
            <motion.div key={p.id} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.04, duration: 0.25 }}
              className="card group relative p-5 transition hover:-translate-y-0.5 hover:shadow-pop">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-xs font-bold text-accent">{p.key.slice(0, 4)}</span>
                <div className="min-w-0 flex-1">
                  <Link to={`/jira/${p.key}/board`} className="block truncate font-semibold after:absolute after:inset-0 after:content-[''] hover:text-accent">{p.name}</Link>
                  <p className="text-caption text-fg-muted">{p.key} · {p.my_role}{p.lead ? ` · Lead ${p.lead.name}` : ''}</p>
                </div>
              </div>
              <p className={`mt-3 line-clamp-2 text-sm ${p.description ? 'text-fg-muted' : 'italic text-fg-muted'}`}>{p.description || 'No description'}</p>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
                <span className="inline-flex items-center gap-1"><ListChecks size={13} />{p.open_issue_count} open / {p.issue_count}</span>
                <span className="inline-flex items-center gap-1"><Users size={13} />{p.member_count}</span>
                {p.active_sprint && <span className="inline-flex items-center gap-1 text-accent"><Zap size={13} />{p.active_sprint.name}</span>}
              </div>
            </motion.div>))}</div>}
      {creating && <CreateProject onClose={() => setCreating(false)} />}
    </div>
  );
}
