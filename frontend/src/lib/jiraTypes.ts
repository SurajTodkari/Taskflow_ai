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
export interface JiraColumn { id: number; name: string; category: StatusCategory; position: number }
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
}
export interface IssueDetail extends Issue { subtasks: Issue[]; epic_children_count: number }

export interface IssueInput {
  type: IssueType; title: string; description?: string | null; column_id?: number; priority?: Priority;
  assignee_id?: number | null; parent_id?: number | null; sprint_id?: number | null;
  story_points?: number | null; labels?: string[]; due_date?: string | null;
}
export type IssuePatch = Partial<IssueInput>;

export interface IssueQuery {
  q?: string; type?: string; status_category?: string; column_id?: number | string; assignee?: string | number;
  priority?: string; label?: string; sprint_id?: string | number; parent_id?: number | string;
  sort?: 'rank' | 'created' | 'updated' | 'priority' | 'due'; order?: 'asc' | 'desc'; limit?: number; offset?: number;
}

export interface JiraComment {
  id: number; issue_id?: number; body: string; created_at: string; updated_at?: string;
  user?: UserRef | null; user_id?: number; user_name?: string;
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
