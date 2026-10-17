import { z } from 'zod';

export const taskFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title must be 200 characters or fewer'),
  description: z.string().max(5000, 'Description is too long'),
  project_id: z.string(),
  category: z.string().max(60, 'Category is too long'),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  status: z.enum(['not_started', 'in_progress', 'on_hold', 'completed', 'cancelled']),
  start_date: z.string(),
  due_date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  estimated_minutes: z.string().regex(/^(\d{1,6})?$/, 'Enter whole minutes'),
  reminder_at: z.string(),
  tags: z.array(z.string()),
  notes: z.string().max(10000, 'Notes are too long'),
  recur: z.boolean(),
  freq: z.enum(['daily', 'weekly', 'monthly']),
  interval: z.string(),
  by_weekday: z.array(z.number()),
  recur_end: z.string(),
}).superRefine((v, ctx) => {
  const bad = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (v.start_date && v.due_date && v.due_date < v.start_date) bad('due_date', 'Due date cannot be before the start date');
  const sameDay = !v.start_date || !v.due_date || v.start_date === v.due_date;
  if (v.start_time && v.end_time && sameDay && v.end_time <= v.start_time) bad('end_time', 'End time must be after the start time');
  if (v.recur) {
    if (!/^\d+$/.test(v.interval) || +v.interval < 1) bad('interval', 'Interval must be 1 or more');
    if (v.freq === 'weekly' && v.by_weekday.length === 0) bad('by_weekday', 'Pick at least one weekday');
    if (!v.start_date && !v.due_date) bad('start_date', 'Recurring tasks need a start or due date');
    const base = v.start_date || v.due_date;
    if (v.recur_end && base && v.recur_end < base) bad('recur_end', 'Repeat end must be after the first date');
  }
});

export type TaskFormValues = z.infer<typeof taskFormSchema>;

export const quickCaptureSchema = z.object({
  title: z.string().trim().min(1, 'Type something to capture').max(200, 'Keep it under 200 characters'),
});
