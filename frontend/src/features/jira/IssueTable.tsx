import { fmtDate } from '../../lib/dates';
import type { Issue, JiraSprint } from '../../lib/jiraTypes';
import { Labels, Points, PriorityIcon, StatusPill, TypeIcon, UserDot } from './ui';

export function IssueTable({ issues, onOpen, sprints, showProject }: { issues: Issue[]; onOpen: (i: Issue) => void; sprints?: JiraSprint[]; showProject?: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-line text-xs uppercase tracking-wide text-fg-muted">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-medium">Key</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Summary</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Priority</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Assignee</th>
            {sprints && <th scope="col" className="px-3 py-2.5 font-medium">Sprint</th>}
            <th scope="col" className="px-3 py-2.5 font-medium">Pts</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Due</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {issues.map((i) => {
            const overdue = i.due_date && i.status_category !== 'done' && i.due_date < today;
            return (
              <tr key={i.id} className="cursor-pointer transition-colors hover:bg-surface-2/60" onClick={() => onOpen(i)}>
                <td className="whitespace-nowrap px-3 py-2.5"><span className="inline-flex items-center gap-1.5"><TypeIcon type={i.type} /><button className="font-medium text-fg-muted hover:text-accent hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(i); }}>{showProject ? i.key : i.key}</button></span></td>
                <td className="max-w-md px-3 py-2.5"><span className={`line-clamp-2 ${i.status_category === 'done' ? 'text-fg-muted line-through' : ''}`}>{i.title}</span>
                  {i.labels?.length > 0 && <span className="mt-1 flex flex-wrap gap-1"><Labels labels={i.labels} /></span>}</td>
                <td className="px-3 py-2.5"><StatusPill name={i.status_name} category={i.status_category} /></td>
                <td className="px-3 py-2.5"><PriorityIcon priority={i.priority} label /></td>
                <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5"><UserDot user={i.assignee} />{i.assignee ? <span className="max-w-28 truncate">{i.assignee.name}</span> : <span className="text-fg-muted">Unassigned</span>}</span></td>
                {sprints && <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">{sprints.find((s) => s.id === i.sprint_id)?.name ?? 'Backlog'}</td>}
                <td className="px-3 py-2.5"><Points value={i.story_points} /></td>
                <td className={`whitespace-nowrap px-3 py-2.5 ${overdue ? 'font-medium text-danger' : 'text-fg-muted'}`}>{i.due_date ? fmtDate(i.due_date) : ''}</td>
              </tr>);
          })}
        </tbody>
      </table>
    </div>
  );
}
