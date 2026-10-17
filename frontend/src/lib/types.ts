export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type Status = 'not_started' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
export type EffectiveStatus = Status | 'overdue';
export type BoardColumn = 'backlog' | 'todo' | 'in_progress' | 'review' | 'completed';

export const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low'];
export const STATUSES: Status[] = ['not_started', 'in_progress', 'on_hold', 'completed', 'cancelled'];
export const BOARD_COLUMNS: BoardColumn[] = ['backlog', 'todo', 'in_progress', 'review', 'completed'];
export const OPEN_STATUSES: Status[] = ['not_started', 'in_progress', 'on_hold'];

export interface User { id: number | string; email: string; name: string; timezone?: string }
export interface AuthResponse { access_token: string; refresh_token: string; token_type: string; user: User }

export interface SubItem { id: number; title: string; done: boolean }
export interface Attachment { id: number; filename: string; size: number }

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly';
  interval: number;
  by_weekday?: number[];
  end_date?: string | null;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  project_id: number | null;
  project_name: string | null;
  project_color: string | null;
  category: string | null;
  priority: Priority;
  status: Status;
  effective_status: EffectiveStatus;
  board_column: BoardColumn;
  start_date: string | null;
  due_date: string | null;
  start_time: string | null;
  end_time: string | null;
  estimated_minutes: number | null;
  reminder_at: string | null;
  tags: string[];
  notes: string | null;
  queued_date: string | null;
  reschedule_count: number;
  completed_at: string | null;
  recurrence_rule_id: number | null;
  subtasks: SubItem[];
  checklist: SubItem[];
  attachments: Attachment[];
  created_at: string;
  updated_at: string;
  tracked_seconds: number;
}

export interface TaskInput {
  title: string;
  description?: string | null;
  project_id?: number | null;
  category?: string | null;
  priority?: Priority;
  status?: Status;
  board_column?: BoardColumn;
  start_date?: string | null;
  due_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  estimated_minutes?: number | null;
  reminder_at?: string | null;
  tags?: string[];
  notes?: string | null;
  recurrence?: Recurrence | null;
}

export interface TaskList { items?: Task[]; total?: number }

export interface TodayStats {
  total: number; completed: number; pending: number; in_progress: number; overdue: number; productivity: number;
}
export interface WeeklyPoint { date: string; total: number; completed: number; productivity: number }
export interface Tomorrow { date: string; planned: Task[]; carried: Task[] }
export interface Dashboard {
  now: string; date: string; today: TodayStats;
  tasks_today: Task[]; carried_forward: Task[]; overdue: Task[];
  tomorrow: Tomorrow; upcoming_deadlines: Task[]; weekly: WeeklyPoint[];
}

export interface Project {
  id: number; name: string; description?: string | null; color?: string | null;
  progress_percent?: number; task_counts?: { by_status?: Record<string, number> } & Record<string, unknown>;
  milestones?: Milestone[]; [k: string]: unknown;
}
export interface Milestone { id: number; title: string; due_date?: string | null; done?: boolean; [k: string]: unknown }

export interface AppNotification {
  id: number; title: string; body?: string; message?: string; kind?: string; type?: string;
  read: boolean; is_read?: boolean; created_at: string; task_id?: number | null; [k: string]: unknown;
}

export interface Settings {
  name: string; timezone: string; morning_time: string; evening_time: string; tomorrow_time: string;
  default_reminder_minutes: number; theme: 'light' | 'dark' | 'system';
  work_start: string; work_end: string; weekend_days: number[];
  notify_morning: boolean; notify_evening: boolean; notify_tomorrow: boolean;
  notify_reminders: boolean; notify_overdue: boolean;
  recurring_defaults: Record<string, unknown>;
}

export interface DailyReport {
  date: string; total: number; completed: number; pending: number; overdue: number; cancelled: number;
  completion_percent: number; time_spent_seconds: number;
  by_project: { project: string; total: number; completed: number }[];
  tomorrow_planned: Task[]; generated_at: string;
}

export interface Analytics {
  daily: { date: string; total: number; completed: number; productivity: number }[];
  weekly: { week: string; total: number; completed: number }[];
  monthly: { month: string; total: number; completed: number; productivity: number }[];
  completed_vs_pending: { completed: number; pending: number; overdue: number; cancelled: number };
  by_project: { project: string; total: number; completed: number; productivity: number }[];
  priority_distribution: { priority: string; count: number }[];
  overdue_trend: { date: string; count: number }[];
  workload: { date: string; estimated_minutes: number; tasks: number }[];
  time_tracking: { date: string; seconds: number }[];
  definitions: Record<string, string>;
}

export interface AiInsights {
  suggested_priorities: unknown[]; approaching_deadlines: unknown[]; tomorrow_plan: unknown[];
  overload: { flag: boolean; message: string }; delayed_tasks: unknown[]; weekly_summary: string;
}
