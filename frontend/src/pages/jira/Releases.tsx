import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Package, Plus, Rocket, Trash2 } from 'lucide-react';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/EmptyState';
import ErrorBanner from '../../components/ErrorBanner';
import Modal from '../../components/Modal';
import { Skeleton } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { fmtDate } from '../../lib/dates';
import { jiraApi } from '../../lib/jiraApi';
import type { JiraVersion } from '../../lib/jiraTypes';
import { useProjectCtx } from '../../features/jira/ctx';
import { useErrToast, useRefreshJira } from '../../features/jira/hooks';
import { canEdit, isAdmin } from '../../features/jira/ui';

export default function Releases() {
  const { project } = useProjectCtx();
  const toast = useToast();
  const errToast = useErrToast();
  const refresh = useRefreshJira();
  const admin = isAdmin(project.my_role);
  const [name, setName] = useState('');
  const [rel, setRel] = useState('');
  const [releasing, setReleasing] = useState<JiraVersion | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [del, setDel] = useState<JiraVersion | null>(null);
  const q = useQuery({ queryKey: ['jira', 'versions', project.key], queryFn: () => jiraApi.versions(project.key) });
  const add = useMutation({ mutationFn: () => jiraApi.addVersion(project.key, { name: name.trim(), release_date: rel || null }), onSuccess: () => { refresh(); setName(''); setRel(''); toast('Version created'); }, onError: (e) => errToast(e, 'Could not create version') });
  const release = useMutation({
    mutationFn: (v: JiraVersion) => jiraApi.releaseVersion(v.id, moveTo ? Number(moveTo) : null),
    onSuccess: () => { refresh(); setReleasing(null); toast('Version released'); }, onError: (e) => errToast(e, 'Could not release'),
  });
  const rm = useMutation({ mutationFn: (v: JiraVersion) => jiraApi.deleteVersion(v.id), onSuccess: () => { refresh(); setDel(null); }, onError: (e) => errToast(e, 'Could not delete version') });
  const list = q.data ?? [];
  const unreleased = list.filter((v) => !v.released);
  return (
    <div className="space-y-4">
      {admin && <form className="card flex flex-wrap items-end gap-2 p-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(); }}>
        <div className="min-w-40 flex-1"><label className="label" htmlFor="v-n">New version</label><input id="v-n" className="input" placeholder="e.g. 1.0" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="label" htmlFor="v-d">Release date</label><input id="v-d" type="date" className="input" value={rel} onChange={(e) => setRel(e.target.value)} /></div>
        <button className="btn-primary" disabled={!name.trim() || add.isPending}><Plus size={16} />Create</button></form>}
      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? <Skeleton className="h-40 w-full rounded-2xl" /> : list.length === 0 ? <EmptyState icon={Package} title="No versions yet" hint={admin ? 'Create a version to group issues into a release.' : 'A project admin can create versions.'} /> : (
        <ul className="grid gap-3 md:grid-cols-2">{list.map((v) => {
          const total = v.issue_count ?? 0, done = v.done_count ?? 0;
          return (
            <li key={v.id} className="card space-y-2 p-4">
              <div className="flex items-center gap-2"><h2 className="font-semibold">{v.name}</h2>
                <span className={`rounded-full px-2 py-0.5 text-caption font-semibold ${v.released ? 'bg-success/15 text-success' : 'bg-surface-2 text-fg-muted'}`}>{v.released ? 'Released' : 'Unreleased'}</span>
                <span className="ml-auto flex">
                  {admin && !v.released && <button className="btn-ghost !py-1 text-xs" onClick={() => { setReleasing(v); setMoveTo(''); }}><Rocket size={13} />Release</button>}
                  {admin && <button className="icon-btn" aria-label={`Delete ${v.name}`} onClick={() => setDel(v)}><Trash2 size={14} /></button>}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} aria-label={`${v.name} progress`}><div className="h-full rounded-full bg-success" style={{ width: total ? `${(done / total) * 100}%` : '0%' }} /></div>
              <p className="text-xs text-fg-muted">{done}/{total} issues done{v.released_at ? ` · released ${fmtDate(v.released_at.slice(0, 10))}` : v.release_date ? ` · due ${fmtDate(v.release_date)}` : ''}</p>
            </li>);
        })}</ul>)}
      {!canEdit(project.my_role) && <p className="text-xs text-fg-muted">Read-only.</p>}
      <Modal open={!!releasing} onClose={() => setReleasing(null)} title={`Release ${releasing?.name ?? ''}`}
        footer={<><button className="btn-ghost" onClick={() => setReleasing(null)}>Cancel</button><button className="btn-primary" disabled={release.isPending} onClick={() => releasing && release.mutate(releasing)}>Release</button></>}>
        <p className="mb-3 text-sm text-fg-muted">{(releasing?.issue_count ?? 0) - (releasing?.done_count ?? 0)} issue(s) are still open. Choose where to move them.</p>
        <label className="label" htmlFor="rl-to">Move open issues to</label>
        <select id="rl-to" className="input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}><option value="">Leave in this version</option>{unreleased.filter((v) => v.id !== releasing?.id).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
      </Modal>
      <ConfirmDialog open={!!del} title="Delete version" message={`Delete ${del?.name}? Issues keep existing but lose this version.`} busy={rm.isPending} onConfirm={() => del && rm.mutate(del)} onCancel={() => setDel(null)} />
    </div>
  );
}
