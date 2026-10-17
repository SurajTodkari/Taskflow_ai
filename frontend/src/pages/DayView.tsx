import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import type { Task, TaskInput } from '../lib/types';
import TaskSection from '../components/TaskSection';
import TaskModal from '../components/TaskModal';
import ErrorBanner from '../components/ErrorBanner';
import { SkeletonList } from '../components/Skeleton';

interface Shape {
  date?: string;
  tasks_today?: Task[]; tasks?: Task[]; planned?: Task[]; carried?: Task[]; carried_forward?: Task[]; overdue?: Task[];
  tomorrow?: { planned?: Task[]; carried?: Task[] };
}

export default function DayView({ kind }: { kind: 'today' | 'tomorrow' }) {
  const q = useQuery({ queryKey: [kind], queryFn: () => api.get<Shape>(`/api/${kind}`) });
  const [edit, setEdit] = useState<Task | null>(null);
  const [create, setCreate] = useState(false);
  const d = q.data;
  const isToday = kind === 'today';
  const main = isToday ? d?.tasks_today ?? d?.tasks ?? [] : d?.planned ?? d?.tomorrow?.planned ?? d?.tasks ?? [];
  const carried = isToday ? d?.carried_forward ?? [] : d?.carried ?? d?.tomorrow?.carried ?? d?.carried_forward ?? [];
  const overdue = d?.overdue ?? [];
  const defaults: Partial<TaskInput> = d?.date ? { start_date: d.date } : {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-page text-fg">{isToday ? "Today's Work" : "Tomorrow's Plan"}</h1>
          {d?.date && <p className="text-sm text-fg-muted">{new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>}
        </div>
        <button className="btn-primary" onClick={() => setCreate(true)}><Plus size={16} />Add task</button>
      </div>
      {q.isError && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? <SkeletonList /> : d && (
        <div className="space-y-5">
          <TaskSection id="sec-main" title={isToday ? "My Today's Work" : 'Planned for Tomorrow'} tasks={main} onEdit={setEdit} empty={isToday ? 'No tasks scheduled for today' : 'Nothing planned for tomorrow'} hint="Add a task to plan ahead." />
          <TaskSection id="sec-carried" title={isToday ? 'Carried Forward' : 'Carried Over to Tomorrow'} tasks={carried} onEdit={setEdit} carry tone="quiet" empty="No carried-forward tasks" hint="Unfinished tasks from earlier days appear here." />
          {isToday && <TaskSection id="sec-overdue" title="Overdue" tasks={overdue} onEdit={setEdit} carry tone="quiet" empty="No overdue tasks" hint="You're all caught up." />}
        </div>
      )}
      <TaskModal open={create} onClose={() => setCreate(false)} defaults={defaults} />
      <TaskModal open={!!edit} task={edit} onClose={() => setEdit(null)} />
    </div>
  );
}
