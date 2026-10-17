export type IssueType = 'epic' | 'story' | 'task' | 'bug' | 'subtask';
export type Priority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';
export type StatusCategory = 'todo' | 'in_progress' | 'done';
export type Role = 'admin' | 'member' | 'viewer';
export type SprintState = 'planned' | 'active' | 'closed';

export const ISSUE_TYPES: IssueType[] = ['epic', 'story', 'task', 'bug', 'subtask'];
export const PRIORITIES: Priority[] = ['highest', 'high', 'medium', 'low', 'lowest'];
export const CATEGORIES: StatusCategory[] = ['todo', 'in_progress', 'done'];
export const ROLES: Role[] = ['admin', 'member', 'viewer'];

export interface UserRef { id: number; name: string }
export interface JiraColumn { id: number; name: string; category: StatusCategory; position: number; wip_limit?: number | null; over_wip?: boolean }
export interface JiraMember { user_id: number; name: string; email: string; role: Role }
export interface JiraSprint {
  id: number; name: string; goal?: string | null; state: SprintState;
  start_date?: string | null; end_date?: string | null; completed_at?: string | null;
  issue_count?: number; points_total?: number; points_done?: number;
}
export interface JiraProject {
  id: number; key: string; name: string; description?: string | null;
  lead?: UserRef | null; my_role: Role; member_count: number; issue_count: number; open_issue_count: number;
  active_sprint: { id: number; name: string } | null;
  board_type?: 'scrum' | 'kanban'; enforce_workflow?: boolean; default_assignee_id?: number | null; archived?: boolean;
}
export interface JiraProjectDetail extends JiraProject { columns: JiraColumn[]; members: JiraMember[]; sprints: JiraSprint[] }

export interface IssueParent { id: number; key: string; title: string; type: IssueType }
export interface Issue {
  id: number; key: string; number: number; project_key: string; type: IssueType; title: string; description?: string | null;
  column_id: number; status_name: string; status_category: StatusCategory; priority: Priority;
  assignee: UserRef | null; reporter: UserRef; parent: IssueParent | null; sprint_id: number | null;
  story_points: number | null; labels: string[]; due_date: string | null; rank: number;
  resolved_at: string | null; created_at: string; updated_at: string;
  subtask_count: number; subtasks_done: number; comment_count: number;
  start_date?: string | null; original_estimate_min?: number | null; remaining_estimate_min?: number | null;
  flagged?: boolean; archived?: boolean; fix_version_id?: number | null; custom_fields?: Record<string, unknown>; environment?: string | null;
  component_ids?: number[]; components?: { id: number; name: string }[]; fix_version?: { id: number; name: string } | null;
  watchers_count?: number; is_watching?: boolean; time_spent_min?: number; links?: IssueLink[]; attachment_count?: number;
  blocked?: boolean; allowed_column_ids?: number[];
}
export interface IssueLink { id: number; direction_label: string; issue: { id: number; key: string; title: string; status_name: string; status_category: StatusCategory; type: IssueType } }
export interface Attachment { id: number; filename: string; size: number; content_type: string; user?: UserRef | null; created_at: string }
export interface IssueDetail extends Issue { subtasks: Issue[]; epic_children_count: number; attachments?: Attachment[] }

export interface IssueInput {
  type: IssueType; title: string; description?: string | null; column_id?: number; priority?: Priority;
  assignee_id?: number | null; parent_id?: number | null; sprint_id?: number | null;
  story_points?: number | null; labels?: string[]; due_date?: string | null;
  start_date?: string | null; original_estimate_min?: number | null; remaining_estimate_min?: number | null;
  flagged?: boolean; archived?: boolean; fix_version_id?: number | null; custom_fields?: Record<string, unknown>; environment?: string | null;
  component_ids?: number[];
}
export type IssuePatch = Partial<IssueInput>;

export interface IssueQuery {
  q?: string; type?: string; status_category?: string; column_id?: number | string; assignee?: string | number;
  priority?: string; label?: string; sprint_id?: string | number; parent_id?: number | string;
  sort?: 'rank' | 'created' | 'updated' | 'priority' | 'due'; order?: 'asc' | 'desc'; limit?: number; offset?: number;
}

export interface JiraComment {
  id: number; issue_id?: number; body: string; created_at: string; updated_at?: string;
  user?: UserRef | null; user_id?: number; user_name?: string; mentions?: UserRef[];
}
export interface HistoryItem { id: number; user: UserRef | null; field: string; old_value: string | null; new_value: string | null; created_at: string }

export interface BoardColumn extends JiraColumn { issues: Issue[] }
export interface Board { sprint: JiraSprint | null; columns: BoardColumn[] }

export type CountMap = Record<string, number> | { key: string; count: number }[];
export interface ProjectSummary {
  by_status_category: CountMap;
  by_type: CountMap;
  by_priority: CountMap;
  by_assignee: { user: UserRef | null; count: number }[];
  created_vs_resolved_14d: { date: string; created: number; resolved: number }[];
}
export interface SprintReport {
  committed_points: number; completed_points: number; issues_total: number; issues_done: number;
  burndown: { date: string; remaining_points: number; ideal?: number }[];
}

export interface PersonRef { id: number; name: string; email?: string }
export interface Invite { id: number; email: string; role: Role; created_at?: string }
export interface JiraComponent { id: number; name: string; description?: string | null; lead_id?: number | null }
export interface JiraVersion {
  id: number; name: string; description?: string | null; start_date?: string | null; release_date?: string | null;
  issue_count?: number; done_count?: number; released?: boolean; released_at?: string | null;
}
export interface Worklog { id: number; user?: UserRef | null; user_id?: number; seconds?: number; minutes?: number; started_at?: string; comment?: string | null }
export type CustomFieldType = 'text' | 'number' | 'select' | 'date' | 'checkbox';
export interface CustomField { id: number; name: string; field_type: CustomFieldType; options?: string[] | null; required?: boolean; position?: number }
export interface SavedFilter { id: number; name: string; jql: string; shared?: boolean; project_id?: number | null; owner_id?: number }
export interface Transition { from: number; to: number }
export interface RoadmapEpic { issue: Issue; start_date?: string | null; due_date?: string | null; children_total: number; children_done: number; percent: number; version?: { id: number; name: string } | null }
export interface ActivityItem { type: string; user?: UserRef | null; issue?: { key: string; title: string } | null; text?: string; created_at: string }
export interface DashboardData {
  assigned_to_me_open?: number; due_soon?: Issue[]; recently_updated?: Issue[]; my_projects?: JiraProject[]; watching?: Issue[]; worklog_minutes_week?: number;
}
export interface BulkPatch {
  assignee_id?: number | null; priority?: Priority; column_id?: number; sprint_id?: number | null;
  labels_add?: string[]; labels_remove?: string[]; fix_version_id?: number | null; component_ids?: number[];
}
export const fmtMinutes = (m?: number | null) => { if (!m) return '0m'; const h = Math.floor(m / 60), r = m % 60; return `${h ? h + 'h ' : ''}${r ? r + 'm' : h ? '' : '0m'}`.trim(); };
