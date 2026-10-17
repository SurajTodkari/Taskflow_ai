import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, Bug, CheckSquare, ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, GitBranch, Minus, Zap, MessageSquare, ListTree, type LucideIcon } from 'lucide-react';
import { Avatar } from '../../components/ui/Avatar';
import type { Issue, IssueType, JiraProjectDetail, Priority, Role, StatusCategory } from '../../lib/jiraTypes';

export const TYPE_META: Record<IssueType, { label: string; icon: LucideIcon; cls: string }> = {
  epic: { label: 'Epic', icon: Zap, cls: 'bg-violet-500/15 text-violet-600 dark:text-violet-300' },
  story: { label: 'Story', icon: Bookmark, cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' },
  task: { label: 'Task', icon: CheckSquare, cls: 'bg-sky-500/15 text-sky-600 dark:text-sky-300' },
  bug: { label: 'Bug', icon: Bug, cls: 'bg-red-500/15 text-red-600 dark:text-red-300' },
  subtask: { label: 'Subtask', icon: GitBranch, cls: 'bg-slate-500/15 text-slate-600 dark:text-slate-300' },
};
export const PRIORITY_META: Record<Priority, { label: string; icon: LucideIcon; cls: string }> = {
  highest: { label: 'Highest', icon: ChevronsUp, cls: 'text-red-600 dark:text-red-400' },
  high: { label: 'High', icon: ChevronUp, cls: 'text-orange-600 dark:text-orange-400' },
  medium: { label: 'Medium', icon: Minus, cls: 'text-amber-600 dark:text-amber-400' },
  low: { label: 'Low', icon: ChevronDown, cls: 'text-sky-600 dark:text-sky-400' },
  lowest: { label: 'Lowest', icon: ChevronsDown, cls: 'text-slate-500 dark:text-slate-400' },
};
export const CATEGORY_META: Record<StatusCategory, { label: string; cls: string }> = {
  todo: { label: 'To do', cls: 'bg-surface-2 text-fg-muted' },
  in_progress: { label: 'In progress', cls: 'bg-accent-soft text-accent' },
  done: { label: 'Done', cls: 'bg-success/15 text-success' },
};

export function TypeIcon({ type, size = 14 }: { type: IssueType; size?: number }) {
  const m = TYPE_META[type] ?? TYPE_META.task;
  const I = m.icon;
  return <span title={m.label} className={`inline-flex shrink-0 items-center justify-center rounded p-0.5 ${m.cls}`}><I size={size} aria-hidden /><span className="sr-only">{m.label}</span></span>;
}
export function TypeBadge({ type }: { type: IssueType }) {
  const m = TYPE_META[type] ?? TYPE_META.task;
  const I = m.icon;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium ${m.cls}`}><I size={12} aria-hidden />{m.label}</span>;
}
export function PriorityIcon({ priority, label }: { priority: Priority; label?: boolean }) {
  const m = PRIORITY_META[priority] ?? PRIORITY_META.medium;
  const I = m.icon;
  return <span title={`${m.label} priority`} className={`inline-flex items-center gap-1 ${m.cls}`}><I size={16} aria-hidden />{label ? <span className="text-xs">{m.label}</span> : <span className="sr-only">{m.label} priority</span>}</span>;
}
export function StatusPill({ name, category }: { name: string; category: StatusCategory }) {
  return <span className={`inline-flex max-w-full items-center truncate rounded-md px-2 py-0.5 text-caption font-semibold uppercase tracking-wide ${CATEGORY_META[category]?.cls ?? ''}`}>{name}</span>;
}
export function UserDot({ user, size = 22 }: { user: { name: string } | null | undefined; size?: number }) {
  if (!user) return <span title="Unassigned" className="inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-line text-fg-muted" style={{ width: size, height: size, fontSize: size * 0.45 }}>?</span>;
  return <span title={user.name} className="inline-flex"><Avatar name={user.name} size={size} /></span>;
}
export function Points({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  return <span title="Story points" className="inline-flex min-w-5 items-center justify-center rounded-full bg-surface-2 px-1.5 text-caption font-semibold text-fg-muted">{value}</span>;
}
export function Labels({ labels }: { labels: string[] }) {
  if (!labels?.length) return null;
  return <>{labels.map((l) => <span key={l} className="chip">{l}</span>)}</>;
}

export const canEdit = (role?: Role) => role === 'admin' || role === 'member';
export const isAdmin = (role?: Role) => role === 'admin';

export function issuePath(i: { project_key: string; key: string }) { return `/jira/${i.project_key}/issue/${i.key}`; }

export function IssueKeyLink({ issue, bg }: { issue: Pick<Issue, 'key' | 'project_key'>; bg?: string }) {
  return <Link to={issuePath(issue)} state={{ bg }} onClick={(e) => e.stopPropagation()} className="text-xs font-medium text-fg-muted hover:text-accent hover:underline">{issue.key}</Link>;
}

/** Compact card used on the board and in the backlog. */
export function IssueRow({ issue, onOpen, draggable, onDragStart, onDragEnd, dragging, compact }: {
  issue: Issue; onOpen: () => void; draggable?: boolean; onDragStart?: (e: React.DragEvent) => void; onDragEnd?: () => void; dragging?: boolean; compact?: boolean;
}) {
  const overdue = issue.due_date && issue.status_category !== 'done' && issue.due_date < new Date().toISOString().slice(0, 10);
  return (
    <div data-card data-issue-id={issue.id} draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd}
      role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      className={`group cursor-pointer rounded-xl border border-line bg-surface p-3 text-sm shadow-sm transition hover:border-accent/50 hover:shadow-card focus-visible:ring-2 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${dragging ? 'opacity-40' : ''}`}>
      <p className={`line-clamp-3 font-medium ${issue.status_category === 'done' ? 'text-fg-muted line-through' : ''}`}>{issue.title}</p>
      {!compact && issue.labels?.length > 0 && <div className="mt-2 flex flex-wrap gap-1"><Labels labels={issue.labels} /></div>}
      {!compact && issue.parent && <p className="mt-2 truncate text-caption text-fg-muted" title={issue.parent.title}>{issue.parent.key} {issue.parent.title}</p>}
      <div className="mt-2.5 flex items-center gap-2 text-fg-muted">
        <TypeIcon type={issue.type} />
        <span className="text-xs font-medium">{issue.key}</span>
        <PriorityIcon priority={issue.priority} />
        {issue.subtask_count > 0 && <span className="inline-flex items-center gap-0.5 text-caption" title="Subtasks done"><ListTree size={12} aria-hidden />{issue.subtasks_done}/{issue.subtask_count}</span>}
        {issue.comment_count > 0 && <span className="inline-flex items-center gap-0.5 text-caption" title="Comments"><MessageSquare size={12} aria-hidden />{issue.comment_count}</span>}
        {overdue && <span className="text-caption font-medium text-danger">Overdue</span>}
        <span className="ml-auto flex items-center gap-1.5"><Points value={issue.story_points} /><UserDot user={issue.assignee} /></span>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}

export function memberName(p: JiraProjectDetail | undefined, id: number | null | undefined) {
  return p?.members.find((m) => m.user_id === id)?.name ?? '';
}

/** Which issue index a drop at clientY would land in, among elements marked data-card inside container. */
export function dropIndex(container: HTMLElement, clientY: number, skipId?: number): number {
  const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-card]')).filter((c) => Number(c.dataset.issueId) !== skipId);
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return i;
  }
  return cards.length;
}

export function DropLine() { return <div className="h-1 rounded-full bg-accent" aria-hidden />; }

/** Neighbour ids for inserting at `index` in `list` (dragged issue already excluded). */
export function neighbours(list: Issue[], index: number): { before_issue_id?: number; after_issue_id?: number } {
  if (list[index]) return { before_issue_id: list[index].id };
  if (index > 0 && list[index - 1]) return { after_issue_id: list[index - 1].id };
  return {};
}
