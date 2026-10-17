import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { jiraApi } from '../../lib/jiraApi';
import { PRIORITIES, type BulkPatch, type JiraProjectDetail, type Priority } from '../../lib/jiraTypes';
import { useErrToast, useRefreshJira } from './hooks';
import { PRIORITY_META } from './ui';

/** Sticky action bar for bulk operations on the selected issue keys. */
export default function BulkBar({ project, keys, onClear }: { project: JiraProjectDetail; keys: string[]; onClear: () => void }) {
  const toast = useToast();
  const errToast = useErrToast();
  const refresh = useRefreshJira();
  const [label, setLabel] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const vers = useQuery({ queryKey: ['jira', 'versions', project.key], queryFn: () => jiraApi.versions(project.key) });
  const run = useMutation({
    mutationFn: (v: { action: 'update' | 'delete' | 'archive' | 'unarchive'; patch?: BulkPatch }) => jiraApi.bulk(project.key, { issue_keys: keys, action: v.action, patch: v.patch }),
    onSuccess: (r) => {
      refresh();
      const failed = r?.failed ?? [];
      if (failed.length) errToast(new Error(`${r.updated ?? 0} updated, ${failed.length} failed: ${failed[0].key} ${failed[0].detail}`));
      else toast(`${r?.updated ?? keys.length} issue${keys.length === 1 ? '' : 's'} updated`);
      onClear();
    },
    onError: (e) => errToast(e, 'Bulk action failed'),
  });
  const upd = (patch: BulkPatch) => run.mutate({ action: 'update', patch });
  const members = project.members.filter((m) => m.role !== 'viewer');
  const sel = 'input !w-auto !py-1';
  return (
    <div role="region" aria-label="Bulk actions" className="sticky bottom-20 z-30 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3 shadow-pop lg:bottom-4">
      <strong className="text-sm">{keys.length} selected</strong>
      <select aria-label="Bulk assignee" className={sel} value="" disabled={run.isPending} onChange={(e) => { if (e.target.value) upd({ assignee_id: e.target.value === 'none' ? null : Number(e.target.value) }); }}>
        <option value="">Assign to...</option><option value="none">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select>
      <select aria-label="Bulk priority" className={sel} value="" disabled={run.isPending} onChange={(e) => { if (e.target.value) upd({ priority: e.target.value as Priority }); }}>
        <option value="">Priority...</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</select>
      <select aria-label="Bulk status" className={sel} value="" disabled={run.isPending} onChange={(e) => { if (e.target.value) upd({ column_id: Number(e.target.value) }); }}>
        <option value="">Move to...</option>{project.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      {project.board_type !== 'kanban' && <select aria-label="Bulk sprint" className={sel} value="" disabled={run.isPending} onChange={(e) => { if (e.target.value) upd({ sprint_id: e.target.value === 'backlog' ? null : Number(e.target.value) }); }}>
        <option value="">Sprint...</option><option value="backlog">Backlog</option>{project.sprints.filter((s) => s.state !== 'closed').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
      {(vers.data ?? []).length > 0 && <select aria-label="Bulk fix version" className={sel} value="" disabled={run.isPending} onChange={(e) => { if (e.target.value) upd({ fix_version_id: e.target.value === 'none' ? null : Number(e.target.value) }); }}>
        <option value="">Version...</option><option value="none">None</option>{(vers.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>}
      <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (label.trim()) { upd({ labels_add: [label.trim()] }); setLabel(''); } }}>
        <input aria-label="Label to add" className="input !w-28 !py-1" placeholder="Add label" value={label} onChange={(e) => setLabel(e.target.value)} /><button className="btn-ghost !py-1" disabled={!label.trim() || run.isPending}>Add</button></form>
      <button className="btn-ghost !py-1" disabled={run.isPending} onClick={() => run.mutate({ action: 'archive' })}>Archive</button>
      <button className="btn-danger !py-1" disabled={run.isPending} onClick={() => setConfirmDel(true)}>Delete</button>
      <button className="ml-auto text-sm text-fg-muted hover:text-fg" onClick={onClear}>Clear</button>
      <ConfirmDialog open={confirmDel} title="Delete issues" message={`Permanently delete ${keys.length} issue${keys.length === 1 ? '' : 's'}? This cannot be undone.`} busy={run.isPending}
        onConfirm={() => { setConfirmDel(false); run.mutate({ action: 'delete' }); }} onCancel={() => setConfirmDel(false)} />
    </div>
  );
}
