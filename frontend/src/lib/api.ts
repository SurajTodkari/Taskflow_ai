import type { AuthResponse, Task, TaskInput, User } from './types';

const envUrl = import.meta.env.VITE_API_URL as string | undefined;
export const API_URL: string = (envUrl !== undefined && envUrl !== ''
  ? envUrl
  : import.meta.env.DEV ? 'http://localhost:8000' : '').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const AT = 'tf_access', RT = 'tf_refresh';
export const tokenStore = {
  get access() { try { return localStorage.getItem(AT); } catch { return null; } },
  get refresh() { try { return localStorage.getItem(RT); } catch { return null; } },
  set(a: string, r: string) { try { localStorage.setItem(AT, a); localStorage.setItem(RT, r); } catch { /* ignore */ } },
  clear() { try { localStorage.removeItem(AT); localStorage.removeItem(RT); } catch { /* ignore */ } },
};

let onAuthLost: (() => void) | null = null;
export function setAuthLostHandler(fn: (() => void) | null) { onAuthLost = fn; }

function errMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) {
      return d.map((x) => {
        const loc = Array.isArray(x?.loc) ? x.loc.filter((l: unknown) => l !== 'body').join('.') : '';
        return `${loc ? loc + ': ' : ''}${x?.msg ?? 'invalid'}`;
      }).join('; ');
    }
  }
  if (status === 0) return 'Network error. Check your connection.';
  return `Request failed (${status})`;
}

let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  const rt = tokenStore.refresh;
  if (!rt) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const r = await fetch(`${API_URL}/api/auth/refresh`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }),
        });
        if (!r.ok) return false;
        const d = (await r.json()) as AuthResponse;
        tokenStore.set(d.access_token, d.refresh_token);
        return true;
      } catch { return false; }
      finally { setTimeout(() => { refreshing = null; }, 0); }
    })();
  }
  return refreshing;
}

export interface ReqOpts { method?: string; body?: unknown; form?: FormData; query?: Record<string, unknown>; auth?: boolean; raw?: boolean }

export function buildQuery(q?: Record<string, unknown>): string {
  if (!q) return '';
  const p = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); });
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function doFetch(path: string, o: ReqOpts): Promise<Response> {
  if (!API_URL && import.meta.env.PROD) throw new ApiError(0, 'App is not configured: VITE_API_URL was not set when this site was built. Set it to the API URL in Render and redeploy.');
  const headers: Record<string, string> = {};
  if (o.auth !== false && tokenStore.access) headers.Authorization = `Bearer ${tokenStore.access}`;
  let body: BodyInit | undefined;
  if (o.form) body = o.form;
  else if (o.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.body); }
  try {
    return await fetch(`${API_URL}${path}${buildQuery(o.query)}`, { method: o.method || 'GET', headers, body });
  } catch {
    throw new ApiError(0, errMessage(null, 0));
  }
}

export async function request<T = unknown>(path: string, o: ReqOpts = {}): Promise<T> {
  let res = await doFetch(path, o);
  if (res.status === 401 && o.auth !== false && !path.startsWith('/api/auth/')) {
    if (await tryRefresh()) res = await doFetch(path, o);
    else { tokenStore.clear(); onAuthLost?.(); }
  }
  if (res.status === 401 && o.auth !== false && !path.startsWith('/api/auth/')) { tokenStore.clear(); onAuthLost?.(); }
  if (o.raw) {
    if (!res.ok) throw new ApiError(res.status, errMessage(await res.json().catch(() => null), res.status));
    return res as unknown as T;
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, errMessage(data, res.status));
  return data as T;
}

export interface TaskQuery {
  search?: string; status?: string; priority?: string; project_id?: number | string; category?: string; tag?: string;
  date_from?: string; date_to?: string; sort?: 'due_date' | 'priority' | 'created_at' | 'title'; order?: 'asc' | 'desc';
  limit?: number; offset?: number;
}

/** Normalizes list responses: backend may return an array or {items,total}. */
export async function listTasks(q: TaskQuery = {}): Promise<{ items: Task[]; total: number }> {
  const res = await request<Response>('/api/tasks', { raw: true, query: q as Record<string, unknown> });
  const body = (await res.json()) as Task[] | { items?: Task[] };
  const items = Array.isArray(body) ? body : body.items ?? [];
  const header = Number(res.headers.get('X-Total-Count'));
  return { items, total: Number.isFinite(header) && header > 0 ? header : items.length };
}

const post = <T,>(p: string, body?: unknown) => request<T>(p, { method: 'POST', body: body ?? {} });
const patch = <T,>(p: string, body: unknown) => request<T>(p, { method: 'PATCH', body });
const get = <T,>(p: string, query?: Record<string, unknown>) => request<T>(p, { query });
const del = <T,>(p: string) => request<T>(p, { method: 'DELETE' });

/** Download a protected file (attachment / export) as a blob and trigger browser save. */
export async function downloadFile(path: string, filename: string, query?: Record<string, unknown>) {
  const res = await request<Response>(path, { raw: true, query });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const api = {
  request, get, post, patch, del,
  // auth
  login: (email: string, password: string) => request<AuthResponse>('/api/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  register: (b: { email: string; password: string; name: string; timezone?: string }) => request<AuthResponse>('/api/auth/register', { method: 'POST', body: b, auth: false }),
  logout: (refresh_token: string) => request('/api/auth/logout', { method: 'POST', body: { refresh_token }, auth: false }),
  me: () => get<User>('/api/auth/me'),
  // tasks
  listTasks,
  getTask: (id: number) => get<Task>(`/api/tasks/${id}`),
  createTask: (b: TaskInput) => post<Task>('/api/tasks', b),
  updateTask: (id: number, b: Partial<TaskInput>) => patch<Task>(`/api/tasks/${id}`, b),
  deleteTask: (id: number) => del<void>(`/api/tasks/${id}`),
  duplicateTask: (id: number) => post<Task>(`/api/tasks/${id}/duplicate`),
  completeTask: (id: number) => post<Task>(`/api/tasks/${id}/complete`),
  rescheduleTask: (id: number, b: { start_date?: string | null; due_date?: string | null; start_time?: string | null; end_time?: string | null }) => post<Task>(`/api/tasks/${id}/reschedule`, b),
  addToToday: (id: number) => post<Task>(`/api/tasks/${id}/add-to-today`),
  moveBoard: (id: number, board_column: string) => patch<Task>(`/api/tasks/${id}/board`, { board_column }),
  addSubtask: (id: number, title: string) => post(`/api/tasks/${id}/subtasks`, { title }),
  updateSubtask: (sid: number, b: { title?: string; done?: boolean }) => patch(`/api/subtasks/${sid}`, b),
  deleteSubtask: (sid: number) => del(`/api/subtasks/${sid}`),
  addChecklist: (id: number, title: string) => post(`/api/tasks/${id}/checklist`, { title }),
  updateChecklist: (cid: number, b: { title?: string; done?: boolean }) => patch(`/api/checklist/${cid}`, b),
  deleteChecklist: (cid: number) => del(`/api/checklist/${cid}`),
  uploadAttachment: (id: number, file: File) => { const f = new FormData(); f.append('file', file); return request(`/api/tasks/${id}/attachments`, { method: 'POST', form: f }); },
  deleteAttachment: (aid: number) => del(`/api/attachments/${aid}`),
  downloadAttachment: (aid: number, filename: string) => downloadFile(`/api/attachments/${aid}/download`, filename),
  startTimer: (id: number) => post(`/api/tasks/${id}/timer/start`),
  stopTimer: (id: number) => post(`/api/tasks/${id}/timer/stop`),
};
