import { request } from './api';
import type {
  Board, HistoryItem, Issue, IssueDetail, IssueInput, IssuePatch, IssueQuery, JiraColumn, JiraComment, JiraProject,
  JiraProjectDetail, JiraSprint, ProjectSummary, Role, SprintReport, StatusCategory,
} from './jiraTypes';

const P = '/api/jira';
const post = <T,>(p: string, body?: unknown) => request<T>(p, { method: 'POST', body: body ?? {} });
const patch = <T,>(p: string, body: unknown) => request<T>(p, { method: 'PATCH', body });
const get = <T,>(p: string, query?: Record<string, unknown>) => request<T>(p, { query });
const del = (p: string) => request<void>(p, { method: 'DELETE' });
const e = encodeURIComponent;

async function listIssues(key: string, q: IssueQuery = {}): Promise<{ items: Issue[]; total: number }> {
  const res = await request<Response>(`${P}/projects/${e(key)}/issues`, { raw: true, query: q as Record<string, unknown> });
  const body = (await res.json()) as Issue[] | { items?: Issue[] };
  const items = Array.isArray(body) ? body : body.items ?? [];
  const h = Number(res.headers.get('X-Total-Count'));
  return { items, total: Number.isFinite(h) && h > 0 ? h : items.length };
}

export const jiraApi = {
  // projects
  listProjects: () => get<JiraProject[]>(`${P}/projects`),
  createProject: (b: { key: string; name: string; description?: string }) => post<JiraProject>(`${P}/projects`, b),
  getProject: (key: string) => get<JiraProjectDetail>(`${P}/projects/${e(key)}`),
  updateProject: (key: string, b: { name?: string; description?: string; lead_id?: number }) => patch<JiraProject>(`${P}/projects/${e(key)}`, b),
  deleteProject: (key: string) => del(`${P}/projects/${e(key)}`),
  // members
  addMember: (key: string, b: { email: string; role: Role }) => post(`${P}/projects/${e(key)}/members`, b),
  setMemberRole: (key: string, uid: number, role: Role) => patch(`${P}/projects/${e(key)}/members/${uid}`, { role }),
  removeMember: (key: string, uid: number) => del(`${P}/projects/${e(key)}/members/${uid}`),
  // columns
  addColumn: (key: string, b: { name: string; category: StatusCategory }) => post<JiraColumn>(`${P}/projects/${e(key)}/columns`, b),
  updateColumn: (id: number, b: { name?: string; category?: StatusCategory; position?: number }) => patch<JiraColumn>(`${P}/columns/${id}`, b),
  deleteColumn: (id: number, moveTo?: number) => request<void>(`${P}/columns/${id}`, { method: 'DELETE', query: { move_to: moveTo } }),
  // issues
  listIssues,
  createIssue: (key: string, b: IssueInput) => post<Issue>(`${P}/projects/${e(key)}/issues`, b),
  getIssue: (ik: string) => get<IssueDetail>(`${P}/issues/${e(ik)}`),
  updateIssue: (ik: string, b: IssuePatch) => patch<IssueDetail>(`${P}/issues/${e(ik)}`, b),
  deleteIssue: (ik: string) => del(`${P}/issues/${e(ik)}`),
  moveIssue: (ik: string, b: { column_id: number; before_issue_id?: number; after_issue_id?: number }) => post<Issue>(`${P}/issues/${e(ik)}/move`, b),
  rankIssue: (ik: string, b: { sprint_id: number | null; before_issue_id?: number; after_issue_id?: number }) => post<Issue>(`${P}/issues/${e(ik)}/rank`, b),
  // comments / history
  listComments: (ik: string) => get<JiraComment[]>(`${P}/issues/${e(ik)}/comments`),
  addComment: (ik: string, body: string) => post<JiraComment>(`${P}/issues/${e(ik)}/comments`, { body }),
  updateComment: (id: number, body: string) => patch<JiraComment>(`${P}/comments/${id}`, { body }),
  deleteComment: (id: number) => del(`${P}/comments/${id}`),
  history: (ik: string) => get<HistoryItem[]>(`${P}/issues/${e(ik)}/history`),
  // sprints
  listSprints: (key: string) => get<JiraSprint[]>(`${P}/projects/${e(key)}/sprints`),
  createSprint: (key: string, b: { name: string; goal?: string; start_date?: string | null; end_date?: string | null }) => post<JiraSprint>(`${P}/projects/${e(key)}/sprints`, b),
  updateSprint: (id: number, b: Partial<Pick<JiraSprint, 'name' | 'goal' | 'start_date' | 'end_date'>>) => patch<JiraSprint>(`${P}/sprints/${id}`, b),
  deleteSprint: (id: number) => del(`${P}/sprints/${id}`),
  startSprint: (id: number, b: { start_date?: string | null; end_date?: string | null }) => post<JiraSprint>(`${P}/sprints/${id}/start`, b),
  completeSprint: (id: number, move_open_to: 'backlog' | number) => post<JiraSprint>(`${P}/sprints/${id}/complete`, { move_open_to }),
  sprintReport: (id: number) => get<SprintReport>(`${P}/sprints/${id}/report`),
  // board / misc
  board: (key: string, q: { sprint_id?: string | number; assignee?: string | number; label?: string; q?: string } = {}) => get<Board>(`${P}/projects/${e(key)}/board`, q),
  summary: (key: string) => get<ProjectSummary>(`${P}/projects/${e(key)}/summary`),
  myIssues: (status_category: 'open' | 'done') => get<Issue[]>(`${P}/my-issues`, { status_category }),
};
