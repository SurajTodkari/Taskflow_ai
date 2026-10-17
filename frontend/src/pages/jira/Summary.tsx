import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ErrorBanner from '../../components/ErrorBanner';
import { Skeleton } from '../../components/Skeleton';
import { ChartCard, ChartTooltip } from '../../features/charts/ChartCard';
import { useChartColors } from '../../features/charts/theme';
import { jiraApi } from '../../lib/jiraApi';
import { useProjectCtx } from '../../features/jira/ctx';
import { toPairs } from '../../features/jira/hooks';
import { CATEGORY_META, PRIORITY_META, TYPE_META } from '../../features/jira/ui';
import type { Priority, IssueType, StatusCategory } from '../../lib/jiraTypes';

const TYPE_COLORS: Record<string, string> = { epic: '#8b5cf6', story: '#10b981', task: '#0ea5e9', bug: '#ef4444', subtask: '#64748b' };
const PRI_COLORS: Record<string, string> = { highest: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#0ea5e9', lowest: '#94a3b8' };

export default function Summary() {
  const { project } = useProjectCtx();
  const c = useChartColors();
  const q = useQuery({ queryKey: ['jira', 'summary', project.key], queryFn: () => jiraApi.summary(project.key) });
  const sprintChoices = project.sprints.filter((s) => s.state !== 'planned');
  const defaultSprint = project.sprints.find((s) => s.state === 'active') ?? sprintChoices[sprintChoices.length - 1];
  const [sprintId, setSprintId] = useState<number | null>(null);
  const sid = sprintId ?? defaultSprint?.id ?? null;
  const report = useQuery({ queryKey: ['jira', 'report', sid], queryFn: () => jiraApi.sprintReport(sid as number), enabled: sid !== null });

  if (q.isLoading) return <div className="grid gap-4 md:grid-cols-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-72 w-full rounded-2xl" />)}</div>;
  if (q.error) return <ErrorBanner error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  if (!s) return null;

  const status = toPairs(s.by_status_category).map(([k, v]) => ({ name: CATEGORY_META[k as StatusCategory]?.label ?? k, value: v, key: k }));
  const types = toPairs(s.by_type).map(([k, v]) => ({ name: TYPE_META[k as IssueType]?.label ?? k, value: v, key: k }));
  const pris = toPairs(s.by_priority).map(([k, v]) => ({ name: PRIORITY_META[k as Priority]?.label ?? k, value: v, key: k }))
    .sort((a, b) => ['highest', 'high', 'medium', 'low', 'lowest'].indexOf(a.key) - ['highest', 'high', 'medium', 'low', 'lowest'].indexOf(b.key));
  const assignees = (s.by_assignee ?? []).map((a) => ({ name: a.user?.name ?? 'Unassigned', value: a.count }));
  const flow = (s.created_vs_resolved_14d ?? []).map((d) => ({ ...d, label: d.date.slice(5) }));
  const total = status.reduce((a, x) => a + x.value, 0);
  const statusColor: Record<string, string> = { todo: c['fg-muted'], in_progress: c.accent, done: c.success };
  const axis = { stroke: c['fg-muted'], fontSize: 12, tickLine: false, axisLine: false } as const;
  const done = status.find((x) => x.key === 'done')?.value ?? 0;
  const r = report.data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['Total issues', total], ['Done', done], ['In progress', status.find((x) => x.key === 'in_progress')?.value ?? 0], ['To do', status.find((x) => x.key === 'todo')?.value ?? 0]].map(([l, v]) => (
          <div key={l} className="card p-4"><p className="text-xs text-fg-muted">{l}</p><p className="text-2xl font-bold">{v}</p></div>))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title="Status overview" empty={total === 0} summary={status.map((x) => `${x.name} ${x.value}`).join(', ')}>
          <ResponsiveContainer width="100%" height="100%"><PieChart>
            <Pie data={status} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2} stroke="none">{status.map((x) => <Cell key={x.key} fill={statusColor[x.key] ?? c.accent} />)}</Pie>
            <Tooltip content={<ChartTooltip />} /><Legend /></PieChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Created vs resolved" def="Last 14 days" empty={flow.length === 0} summary="Issues created and resolved per day">
          <ResponsiveContainer width="100%" height="100%"><LineChart data={flow} margin={{ left: -20, right: 8, top: 8 }}>
            <CartesianGrid stroke={c.line} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" {...axis} /><YAxis allowDecimals={false} {...axis} />
            <Tooltip content={<ChartTooltip />} /><Legend />
            <Line type="monotone" dataKey="created" name="Created" stroke={c.accent} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="resolved" name="Resolved" stroke={c.success} strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Issues by type" empty={types.length === 0} summary={types.map((x) => `${x.name} ${x.value}`).join(', ')}>
          <ResponsiveContainer width="100%" height="100%"><BarChart data={types} margin={{ left: -20, right: 8, top: 8 }}>
            <CartesianGrid stroke={c.line} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" {...axis} /><YAxis allowDecimals={false} {...axis} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: c.line, opacity: 0.3 }} />
            <Bar dataKey="value" name="Issues" radius={[6, 6, 0, 0]}>{types.map((x) => <Cell key={x.key} fill={TYPE_COLORS[x.key] ?? c.accent} />)}</Bar></BarChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Issues by priority" empty={pris.length === 0} summary={pris.map((x) => `${x.name} ${x.value}`).join(', ')}>
          <ResponsiveContainer width="100%" height="100%"><BarChart data={pris} margin={{ left: -20, right: 8, top: 8 }}>
            <CartesianGrid stroke={c.line} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" {...axis} /><YAxis allowDecimals={false} {...axis} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: c.line, opacity: 0.3 }} />
            <Bar dataKey="value" name="Issues" radius={[6, 6, 0, 0]}>{pris.map((x) => <Cell key={x.key} fill={PRI_COLORS[x.key] ?? c.accent} />)}</Bar></BarChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Workload by assignee" empty={assignees.length === 0} summary={assignees.map((x) => `${x.name} ${x.value}`).join(', ')}>
          <ResponsiveContainer width="100%" height="100%"><BarChart data={assignees} layout="vertical" margin={{ left: 8, right: 16, top: 8 }}>
            <CartesianGrid stroke={c.line} strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} {...axis} /><YAxis type="category" dataKey="name" width={90} {...axis} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: c.line, opacity: 0.3 }} /><Bar dataKey="value" name="Issues" fill={c.accent} radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer>
        </ChartCard>
        <div className="space-y-2">
          <div className="flex items-center gap-2"><label className="text-sm font-medium" htmlFor="sr-sel">Sprint burndown</label>
            <select id="sr-sel" className="input !w-auto" value={sid ?? ''} onChange={(e) => setSprintId(Number(e.target.value))} disabled={sprintChoices.length === 0}>
              {sprintChoices.length === 0 && <option value="">No started sprints</option>}{sprintChoices.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}{sp.state === 'active' ? ' (active)' : ''}</option>)}</select></div>
          <ChartCard title="Remaining story points" def={r ? `${r.completed_points}/${r.committed_points} points done · ${r.issues_done}/${r.issues_total} issues` : report.isLoading ? 'Loading...' : undefined}
            empty={!r || r.burndown.length === 0} summary="Remaining story points per day">
            <ResponsiveContainer width="100%" height="100%"><LineChart data={(r?.burndown ?? []).map((d) => ({ ...d, label: d.date.slice(5) }))} margin={{ left: -20, right: 8, top: 8 }}>
              <CartesianGrid stroke={c.line} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" {...axis} /><YAxis allowDecimals={false} {...axis} />
              <Tooltip content={<ChartTooltip />} /><Legend />
              <Line type="monotone" dataKey="remaining_points" name="Remaining" stroke={c.accent} strokeWidth={2} dot={false} />
              {r?.burndown.some((d) => d.ideal !== undefined) && <Line type="linear" dataKey="ideal" name="Ideal" stroke={c['fg-muted']} strokeDasharray="5 4" dot={false} />}</LineChart></ResponsiveContainer>
          </ChartCard>
          {report.error && <ErrorBanner error={report.error} onRetry={() => report.refetch()} />}
        </div>
      </div>
    </div>
  );
}
