import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Loader2, Inbox as InboxIcon } from 'lucide-react';
import { api } from '../lib/api';
import { quickCaptureSchema } from '../lib/schemas';
import { OPEN_STATUSES, type Task } from '../lib/types';
import { useToast } from '../components/Toast';
import TaskCard from '../components/TaskCard';
import TaskModal from '../components/TaskModal';
import ErrorBanner from '../components/ErrorBanner';
import { Skeleton } from '../components/Skeleton';

export default function Inbox() {
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState<Task | null>(null);
  const { register, handleSubmit, reset, setFocus, formState: { errors, isSubmitting } } = useForm<{ title: string }>({ resolver: zodResolver(quickCaptureSchema), defaultValues: { title: '' } });
  const q = useQuery({ queryKey: ['tasks', 'inbox'], queryFn: () => api.listTasks({ sort: 'created_at', order: 'desc', limit: 500 }) });
  const items = useMemo(() => (q.data?.items ?? []).filter((t) => OPEN_STATUSES.includes(t.status) && !t.project_id && !t.start_date && !t.due_date), [q.data]);

  const add = handleSubmit(async ({ title }) => {
    try {
      await api.createTask({ title: title.trim() });
      reset(); qc.invalidateQueries(); toast('Captured to inbox'); setFocus('title');
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not add task', 'error'); }
  });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-page">Inbox</h1>
        <p className="text-sm text-fg-muted">Capture now, organize later. Tasks without a project or date land here.</p>
      </div>
      <form onSubmit={add} noValidate className="card flex items-start gap-2 p-2">
        <div className="flex-1">
          <label htmlFor="inbox-capture" className="sr-only">Quick capture</label>
          <input id="inbox-capture" autoFocus autoComplete="off" className="input !border-transparent !bg-transparent !py-2.5 text-base" placeholder="Capture a task and press Enter" aria-invalid={!!errors.title} {...register('title')} />
          {errors.title && <p role="alert" className="px-3 pb-1 text-caption text-danger">{errors.title.message}</p>}
        </div>
        <button className="btn-primary !py-2.5" type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 size={15} className="animate-spin" /> : <Plus size={16} />}Add</button>
      </form>

      {q.isError && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? (
        <div className="space-y-2" role="status" aria-label="Loading inbox">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
      ) : items.length === 0 && !q.isError ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-line px-4 py-14 text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent"><InboxIcon size={22} aria-hidden /></span>
          <p className="text-section">Inbox zero</p>
          <p className="mt-1 max-w-xs text-sm text-fg-muted">Nothing waiting. Type above to capture a thought before it slips away.</p>
        </div>
      ) : (
        <div className="space-y-2">{items.map((t) => <TaskCard key={t.id} task={t} onEdit={setEdit} />)}</div>
      )}
      <TaskModal open={!!edit} task={edit} onClose={() => setEdit(null)} />
    </div>
  );
}
