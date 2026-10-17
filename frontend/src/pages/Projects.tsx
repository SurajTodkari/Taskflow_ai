import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { Plus, Pencil, Trash2, FolderKanban, CalendarClock, ListChecks } from 'lucide-react';
import { api } from '../lib/api';
import type { Project } from '../lib/types';
import { fmtDate } from '../lib/dates';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import ErrorBanner from '../components/ErrorBanner';
import EmptyState from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { ProgressRing, STATUS_BADGE, projectStats } from '../features/projects/ui';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Keep it under 120 characters'),
  description: z.string().max(2000, 'Too long').optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a valid color'),
});
type FormVals = z.infer<typeof schema>;
const SWATCHES = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];

export function ProjectForm({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormVals>({
    resolver: zodResolver(schema),
    defaultValues: { name: project?.name ?? '', description: project?.description ?? '', color: project?.color ?? '#6366f1' },
  });
  const color = watch('color');
  const m = useMutation({
    mutationFn: (v: FormVals) => { const b = { name: v.name.trim(), description: v.description || null, color: v.color }; return project ? api.patch(`/api/projects/${project.id}`, b) : api.post('/api/projects', b); },
    onSuccess: () => { qc.invalidateQueries(); toast(project ? 'Project updated' : 'Project created'); onClose(); },
    onError: (e) => toast(e instanceof Error ? e.message : 'Save failed', 'error'),
  });
  return (
    <Modal open onClose={onClose} title={project ? 'Edit project' : 'New project'}>
      <form onSubmit={handleSubmit((v) => m.mutate(v))} className="space-y-4" noValidate>
        <div><label className="label" htmlFor="pn">Name</label>
          <input id="pn" className="input" aria-invalid={!!errors.name} aria-describedby={errors.name ? 'pn-e' : undefined} {...register('name')} />
          {errors.name && <p id="pn-e" className="mt-1 text-xs text-danger">{errors.name.message}</p>}</div>
        <div><label className="label" htmlFor="pd">Description</label>
          <textarea id="pd" className="input" rows={3} {...register('description')} />
          {errors.description && <p className="mt-1 text-xs text-danger">{errors.description.message}</p>}</div>
        <div><label className="label" htmlFor="pc">Color</label>
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((c) => (
              <button key={c} type="button" aria-label={`Use color ${c}`} aria-pressed={color?.toLowerCase() === c} onClick={() => setValue('color', c, { shouldDirty: true })}
                className={`h-7 w-7 rounded-full ring-offset-2 ring-offset-surface transition ${color?.toLowerCase() === c ? 'ring-2 ring-fg' : 'hover:scale-110'}`} style={{ background: c }} />))}
            <input id="pc" type="color" className="h-8 w-10 cursor-pointer rounded-lg border border-line bg-surface p-0.5" {...register('color')} />
          </div>
          {errors.color && <p className="mt-1 text-xs text-danger">{errors.color.message}</p>}</div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={m.isPending}>{m.isPending ? 'Saving...' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}

export default function Projects() {
  const qc = useQueryClient();
  const toast = useToast();
  const reduce = useReducedMotion();
  const [edit, setEdit] = useState<Project | null | undefined>(undefined);
  const [del, setDel] = useState<Project | null>(null);
  const q = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/api/projects'), refetchInterval: 30000 });
  const rm = useMutation({
    mutationFn: (id: number) => api.del(`/api/projects/${id}`),
    onSuccess: () => { qc.invalidateQueries(); toast('Project deleted'); setDel(null); },
    onError: (e) => toast(e instanceof Error ? e.message : 'Delete failed', 'error'),
  });
  const list = Array.isArray(q.data) ? q.data : [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-page font-semibold">Projects</h1><p className="text-sm text-fg-muted">{list.length} project{list.length === 1 ? '' : 's'} · track progress, milestones and deadlines</p></div>
        <button className="btn-primary" onClick={() => setEdit(null)}><Plus size={16} />New project</button></div>
      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-44 w-full rounded-2xl" />)}</div>
        : list.length === 0 && !q.error ? <EmptyState title="No projects yet" hint="Create a project to group tasks, track milestones and see progress." action={<button className="btn-primary" onClick={() => setEdit(null)}>Create project</button>} />
          : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{list.map((p, i) => {
            const s = projectStats(p);
            const badge = STATUS_BADGE[s.status];
            const col = p.color || '#6366f1';
            const nextMs = (p.milestones ?? []).filter((m) => !m.done && m.due_date).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];
            const deadline = (p.due_date ?? p.deadline ?? nextMs?.due_date) as string | null | undefined;
            return (
              <motion.div key={p.id} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.04, duration: 0.25 }}
                className="card group relative overflow-hidden p-5 transition hover:-translate-y-0.5 hover:shadow-pop">
                <div className="absolute inset-x-0 top-0 h-1" style={{ background: col }} />
                <div className="flex items-start gap-3">
                  <ProgressRing pct={s.pct} color={col} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/projects/${p.id}`} className="flex items-center gap-1.5 font-semibold after:absolute after:inset-0 after:content-[''] hover:text-accent"><FolderKanban size={16} className="shrink-0" style={{ color: col }} /><span className="truncate">{p.name}</span></Link>
                    <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-caption font-medium ${badge.cls}`}>{badge.label}</span>
                  </div>
                  <div className="relative z-10 flex shrink-0"><button className="icon-btn" aria-label={`Edit ${p.name}`} onClick={() => setEdit(p)}><Pencil size={15} /></button>
                    <button className="icon-btn" aria-label={`Delete ${p.name}`} onClick={() => setDel(p)}><Trash2 size={15} /></button></div>
                </div>
                {p.description ? <p className="mt-3 line-clamp-2 text-sm text-fg-muted">{p.description}</p> : <p className="mt-3 text-sm italic text-fg-muted">No description</p>}
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full transition-all" style={{ width: `${s.pct}%`, background: col }} /></div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
                  <span className="inline-flex items-center gap-1"><ListChecks size={13} />{s.done}/{s.total} task{s.total === 1 ? '' : 's'} done</span>
                  <span className="inline-flex items-center gap-1"><CalendarClock size={13} />{deadline ? fmtDate(deadline) : 'No deadline'}</span>
                </div>
              </motion.div>);
          })}</div>}
      {edit !== undefined && <ProjectForm project={edit} onClose={() => setEdit(undefined)} />}
      <ConfirmDialog open={!!del} title="Delete project" message={`Delete "${del?.name}"? This cannot be undone.`} busy={rm.isPending} onConfirm={() => del && rm.mutate(del.id)} onCancel={() => setDel(null)} />
    </div>
  );
}
