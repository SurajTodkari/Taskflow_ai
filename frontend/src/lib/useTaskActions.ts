import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useToast } from '../components/Toast';
import type { Task } from './types';

/** Shared task mutations; invalidates all queries and shows toasts. */
export function useTaskActions() {
  const qc = useQueryClient();
  const toast = useToast();
  const done = (msg: string) => () => { qc.invalidateQueries(); toast(msg); };
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'Action failed', 'error');
  const mk = <V,>(fn: (v: V) => Promise<unknown>, msg: string) =>
    useMutation({ mutationFn: fn, onSuccess: done(msg), onError: fail });
  return {
    complete: mk((t: Task) => api.completeTask(t.id), 'Task completed'),
    remove: mk((t: Task) => api.deleteTask(t.id), 'Task deleted'),
    duplicate: mk((t: Task) => api.duplicateTask(t.id), 'Task duplicated'),
    addToToday: mk((t: Task) => api.addToToday(t.id), 'Added to today'),
    rescheduleBoth: mk((v: { id: number; start_date?: string | null; due_date?: string | null }) => api.rescheduleTask(v.id, { start_date: v.start_date, due_date: v.due_date }), 'Task rescheduled'),
  };
}
