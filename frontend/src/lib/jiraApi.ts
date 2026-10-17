import { request } from './api';
import type {
  Board, HistoryItem, Issue, IssueDetail, IssueInput, IssuePatch, IssueQuery, JiraColumn, JiraComment, JiraProject,
  JiraProjectDetail, JiraSprint, ProjectSummary, Role, SprintReport, StatusCategory,
  ActivityItem, Attachment, BulkPatch, CustomField, DashboardData, Invite, IssueLink, JiraComponent, JiraVersion, PersonRef,
  RoadmapEpic, SavedFilter, Transition, UserRef, Worklog,
} from './jiraTypes';

const P = '/api/jira';
const post = <T,>(p: string, body?: unknown) => request<T>(p, { method: 'POST', body: body ?? {} });
const patch = <T,>(p: string, body: unknown) => request<T>(p, { method: 'PATCH', body });
const get = <T,>(p: string, query?: Record<string, unknown>) => request<T>(p, { query });
const del = (p: string) => request<void>(p, { method: 'DELETE' });
const e = encodeURIComponent;

async function listIssues(key: string, q: IssueQuery & { jql?: string; include_archived?: number } = {}): Promise<{ items: Issue[]; total: number }> {
  const res = await request<Response>(`${P}/projects/${e(key)}/issues`, { raw: true, query: q as Record<string, unknown> });
  const body = (await res.json()) as Issue[] | { items?: Issue[] };
  const items = Array.isArray(body) ? body : body.items ?? [];
  const h = Number(res.headers.get('X-Total-Count'));
  return { items, total: Number.isFinite(h) && h > 0 ? h : items.length };
}

async function search(jql: string, limit = 50, offset = 0, include_archived?: boolean): Promise<{ items: Issue[]; total: number }> {
  const res = await request<Response>(`${P}/search`, { raw: true, query: { jql, limit, offset, include_archived: include_archived ? 1 : undefined } });
  const body = (await res.json()) as Issue[] | { items?: Issue[] };
  const items = Array.isArray(body) ? body : body.items ?? [];
  const h = Number(res.headers.get('X-Total-Count'));
  return { items, total: Number.isFinite(h) && h > 0 ? h : items.length };
}
async function blob(path: string, query?: Record<string, unknown>): Promise<Blob> {
  const res = await request<Response>(path, { raw: true, query });
  return res.blob();
}
export function saveBlob(b: Blob, name: string) {
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}
const list = <T,>(r: T[] | { items?: T[] } | null | undefined): T[] => (Array.isArray(r) ? r : r?.items ?? []);
type Wl = { user: UserRef | string | null; open_issues: number; open_points: number; remaining_minutes: number };
type Cr = { date: string; created: number; resolved: number };
type Vel = { sprint: { name: string } | string; committed_points: number; completed_points: number };

export const jiraApi = {
  search,
  blob,
  people: async (q: string) => list(await get<PersonRef[] | { items?: PersonRef[] }>(`${P}/people`, { q })),
  listInvites: async (key: string) => list(await get<Invite[] | { items?: Invite[] }>(`${P}/projects/${e(key)}/invites`)),
  deleteInvite: (id: number) => del(`${P}/invites/${id}`),
  inviteOrAdd: (key: string, b: { email: string; role: Role }) => post<{ invited?: boolean; email?: string }>(`${P}/projects/${e(key)}/members`, b),
  updateProjectSettings: (key: string, b: Record<string, unknown>) => patch<JiraProject>(`${P}/projects/${e(key)}`, b),
  addLink: (ik: string, b: { link_type: string; target_key: string }) => post<IssueLink>(`${P}/issues/${e(ik)}/links`, b),
  deleteLink: (id: number) => del(`${P}/links/${id}`),
  watch: (ik: string) => post(`${P}/issues/${e(ik)}/watch`),
  unwatch: (ik: string) => del(`${P}/issues/${e(ik)}/watch`),
  watchers: async (ik: string) => list(await get<UserRef[] | { items?: UserRef[] }>(`${P}/issues/${e(ik)}/watchers`)),
  worklogs: async (ik: string) => list(await get<Worklog[] | { items?: Worklog[] }>(`${P}/issues/${e(ik)}/worklogs`)),
  addWorklog: (ik: string, b: { minutes: number; started_at?: string; comment?: string }) => post<Worklog>(`${P}/issues/${e(ik)}/worklogs`, b),
  deleteWorklog: (id: number) => del(`${P}/worklogs/${id}`),
  timeReport: async (key: string, q: { from?: string; to?: string } = {}) => list(await get<{ user: UserRef | string; minutes: number; issues: number }[] | { items?: { user: UserRef | string; minutes: number; issues: number }[] }>(`${P}/projects/${e(key)}/time-report`, q)),
  uploadAttachment: (ik: string, file: File) => { const f = new FormData(); f.append('file', file); return request<Attachment>(`${P}/issues/${e(ik)}/attachments`, { method: 'POST', form: f }); },
  deleteAttachment: (id: number) => del(`${P}/attachments/${id}`),
  attachmentBlob: (id: number, inline?: boolean) => blob(`${P}/attachments/${id}`, inline ? { inline: 1 } : undefined),
  components: async (key: string) => list(await get<JiraComponent[] | { items?: JiraComponent[] }>(`${P}/projects/${e(key)}/components`)),
  addComponent: (key: string, b: { name: string; description?: string; lead_id?: number | null }) => post<JiraComponent>(`${P}/projects/${e(key)}/components`, b),
  updateComponent: (id: number, b: Partial<JiraComponent>) => patch<JiraComponent>(`${P}/components/${id}`, b),
  deleteComponent: (id: number) => del(`${P}/components/${id}`),
  versions: async (key: string) => list(await get<JiraVersion[] | { items?: JiraVersion[] }>(`${P}/projects/${e(key)}/versions`)),
  addVersion: (key: string, b: { name: string; description?: string; start_date?: string | null; release_date?: string | null }) => post<JiraVersion>(`${P}/projects/${e(key)}/versions`, b),
  updateVersion: (id: number, b: Partial<JiraVersion>) => patch<JiraVersion>(`${P}/versions/${id}`, b),
  deleteVersion: (id: number) => del(`${P}/versions/${id}`),
  releaseVersion: (id: number, move_open_to_version_id: number | null) => post<JiraVersion>(`${P}/versions/${id}/release`, { move_open_to_version_id }),
  filters: async () => list(await get<SavedFilter[] | { items?: SavedFilter[] }>(`${P}/filters`)),
  addFilter: (b: { name: string; jql: string; shared?: boolean; project_id?: number | null }) => post<SavedFilter>(`${P}/filters`, b),
  updateFilter: (id: number, b: Partial<SavedFilter>) => patch<SavedFilter>(`${P}/filters/${id}`, b),
  deleteFilter: (id: number) => del(`${P}/filters/${id}`),
  workflow: async (key: string) => { const r = await get<{ transitions?: Transition[] } | Transition[]>(`${P}/projects/${e(key)}/workflow`); return Array.isArray(r) ? r : r?.transitions ?? []; },
  setWorkflow: (key: string, transitions: Transition[]) => request<unknown>(`${P}/projects/${e(key)}/workflow`, { method: 'PUT', body: { transitions } }),
  customFields: async (key: string) => list(await get<CustomField[] | { items?: CustomField[] }>(`${P}/projects/${e(key)}/custom-fields`)),
  addCustomField: (key: string, b: Partial<CustomField>) => post<CustomField>(`${P}/projects/${e(key)}/custom-fields`, b),
  updateCustomField: (id: number, b: Partial<CustomField>) => patch<CustomField>(`${P}/custom-fields/${id}`, b),
  deleteCustomField: (id: number) => del(`${P}/custom-fields/${id}`),
  roadmap: async (key: string) => list(await get<RoadmapEpic[] | { items?: RoadmapEpic[] }>(`${P}/projects/${e(key)}/roadmap`)),
  reportVelocity: async (key: string, n = 8) => { const r = await get<{ sprints?: Vel[]; items?: Vel[]; average?: number } | Vel[]>(`${P}/projects/${e(key)}/reports/velocity`, { n }); return Array.isArray(r) ? { items: r, average: undefined as number | undefined } : { items: r?.sprints ?? r?.items ?? [], average: r?.average }; },
  reportCreatedResolved: async (key: string, days = 30) => list(await get<Cr[] | { items?: Cr[] }>(`${P}/projects/${e(key)}/reports/created-vs-resolved`, { days })),
  reportResolution: (key: string) => get<{ avg_days?: number; median_days?: number; by_type?: { type: string; avg_days: number; count?: number }[] }>(`${P}/projects/${e(key)}/reports/resolution-time`),
  reportWorkload: async (key: string) => list(await get<Wl[] | { items?: Wl[] }>(`${P}/projects/${e(key)}/reports/workload`)),
  reportCfd: (key: string, days = 30) => get<unknown>(`${P}/projects/${e(key)}/reports/cfd`, { days }),
  projectActivity: async (key: string, limit = 50) => list(await get<ActivityItem[] | { items?: ActivityItem[] }>(`${P}/projects/${e(key)}/activity`, { limit })),
  activity: async (limit = 30) => list(await get<ActivityItem[] | { items?: ActivityItem[] }>(`${P}/activity`, { limit })),
  dashboard: () => get<DashboardData>(`${P}/dashboard`),
  bulk: (key: string, b: { issue_keys: string[]; action: 'update' | 'delete' | 'archive' | 'unarchive'; patch?: BulkPatch }) => post<{ updated: number; failed?: { key: string; detail: string }[] }>(`${P}/projects/${e(key)}/issues/bulk`, b),
  cloneIssue: (ik: string, b: { include_subtasks?: boolean; title_prefix?: string }) => post<Issue>(`${P}/issues/${e(ik)}/clone`, b),
  moveProject: (ik: string, b: { project_key: string; column_id?: number }) => post<Issue>(`${P}/issues/${e(ik)}/move-project`, b),
  exportCsv: (key: string, jql?: string) => blob(`${P}/projects/${e(key)}/issues/export`, { format: 'csv', jql }),
  importCsv: (key: string, file: File) => { const f = new FormData(); f.append('file', file); return request<{ created: number; errors?: { row: number; detail: string }[] }>(`${P}/projects/${e(key)}/issues/import`, { method: 'POST', form: f }); },

  // projects
  listProjects: () => get<JiraProject[]>(`${P}/projects`),
  listProjectsWithArchived: () => get<JiraProject[]>(`${P}/projects`, { include_archived: 1 }),
  createProject: (b: { key: string; name: string; description?: string; board_type?: 'scrum' | 'kanban' }) => post<JiraProject>(`${P}/projects`, b),
  getProject: (key: string) => get<JiraProjectDetail>(`${P}/projects/${e(key)}`),
  updateProject: (key: string, b: { name?: string; description?: string; lead_id?: number }) => patch<JiraProject>(`${P}/projects/${e(key)}`, b),
  deleteProject: (key: string) => del(`${P}/projects/${e(key)}`),
  // members
  addMember: (key: string, b: { email: string; role: Role }) => post(`${P}/projects/${e(key)}/members`, b),
  setMemberRole: (key: string, uid: number, role: Role) => patch(`${P}/projects/${e(key)}/members/${uid}`, { role }),
  removeMember: (key: string, uid: number) => del(`${P}/projects/${e(key)}/members/${uid}`),
  // columns
  addColumn: (key: string, b: { name: string; category: StatusCategory }) => post<JiraColumn>(`${P}/projects/${e(key)}/columns`, b),
  updateColumn: (id: number, b: { name?: string; category?: StatusCategory; position?: number; wip_limit?: number | null }) => patch<JiraColumn>(`${P}/columns/${id}`, b),
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
  board: (key: string, q: { sprint_id?: string | number; assignee?: string | number; label?: string; q?: string; include_archived?: number } = {}) => get<Board>(`${P}/projects/${e(key)}/board`, q),
  summary: (key: string) => get<ProjectSummary>(`${P}/projects/${e(key)}/summary`),
  myIssues: (status_category: 'open' | 'done') => get<Issue[]>(`${P}/my-issues`, { status_category }),
};
