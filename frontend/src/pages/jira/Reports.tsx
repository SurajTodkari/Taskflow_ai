import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ErrorBanner from '../../components/ErrorBanner';
import { ChartCard, ChartTooltip } from '../../features/charts/ChartCard';
import { useChartColors } from '../../features/charts/theme';
import { jiraApi } from '../../lib/jiraApi';
import { fmtMinutes } from '../../lib/jiraTypes';
import { useProjectCtx } from '../../features/jira/ctx';

const nameOf = (u: { name: string } | string | null | undefined) => (typeof u === 'string' ? u : u?.name ?? 'Unassigned');

/** Normalize CFD payload: [{date, <col>: n}] or [{date, counts:{col:n}}] or {days:[...]} */
function normCfd(raw: unknown): { rows: Record<string, number | string>[]; keys: string[] } {
  const arr = (Array.isArray(raw) ? raw : (raw as { items?: unknown[]; days?: unknown[]; series?: unknown[] } | null)?.items ?? (raw as { days?: unknown[] } | null)?.days ?? (raw as { series?: unknown[] } | null)?.series ?? []) as Record<string, unknown>[];
  const keys = new Set<string>();
  const rows = arr.map((r) => {
    const src = (r.counts ?? r.columns ?? r) as Record<string, unknown>;
    const o: Record<string, number | string> = { date: String(r.date ?? '').slice(5) };
    Object.entries(src).forEach(([k, v]) => { if (k !== 'date' && typeof v === 'number') { o[k] = v; keys.add(k); } });
    return o;
  });
  return { rows, keys: Array.from(keys) };
}

export default function Reports() {
  const { project } = useProjectCtx();
  const c = useChartColors();
  const k = project.key;
  const [days, setDays] = useState(30);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const vel = useQuery({ queryKey: ['jira', 'rep', k, 'vel'], queryFn: () => jiraApi.reportVelocity(k) });
  const cr = useQuery({ queryKey: ['jira', 'rep', k, 'cr', days], queryFn: () => jiraApi.reportCreatedResolved(k, days) });
  const res = useQuery({ queryKey: ['jira', 'rep', k, 'res'], queryFn: () => jiraApi.reportResolution(k) });
  const wl = useQuery({ queryKey: ['jira', 'rep', k, 'wl'], queryFn: () => jiraApi.reportWorkload(k) });
  const cfdQ = useQuery({ queryKey: ['jira', 'rep', k, 'cfd', days], queryFn: () => jiraApi.reportCfd(k, days) });
  const tr = useQuery({ queryKey: ['jira', 'rep', k, 'time', from, to], queryFn: () => jiraApi.timeReport(k, { from, to }) });
  const cfd = useMemo(() => normCfd(cfdQ.data), [cfdQ.data]);
  const axis = { stroke: c['fg-muted'], fontSize: 12, tickLine: false, axisLine: false } as const;
  const velData = (vel.data?.items ?? []).map((v) => ({ name: typeof v.sprint === 'string' ? v.sprint : v.sprint?.name, committed: v.committed_points, completed: v.completed_points }));
  const crData = (cr.data ?? []).map((d) => ({ ...d, label: d.date.slice(5) }));
  const palette = [c.accent, c.success, c.warning, c.danger, c['fg-muted'], '#8b5cf6', '#0ea5e9'];
  const err = vel.error || cr.error || res.error || wl.error || cfdQ.error;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><label className="text-sm" htmlFor="rp-days">Range</label>
        <select id="rp-days" className="input !w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[14, 30, 60, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select></div>
      {err && <ErrorBanner error={err} onRetry={() => { vel.refetch(); cr.refetch(); res.refetch(); wl.refetch(); cfdQ.refetch(); }} />}
      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title="Velocity" def={vel.data?.average !== undefined ? `Average completed: ${vel.data.average} points` : 'Committed vs completed points per closed sprint'} empty={velData.length === 0} summary={velData.map((v) => `${v.name} ${v.completed}/${v.committed}`).join(', ')}>
          <ResponsiveContainer width="100%" height="100%"><BarChart data={velData} margin={{ left: -20, right: 8, top: 8 }}>
            <CartesianGrid stroke={c.line} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" {...axis} /><YAxis allowDecimals={false} {...axis} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: c.line, opacity: 0.3 }} /><Legend />
            <Bar dataKey="committed" name="Committed" fill={c['fg-muted']} radius={[4, 4, 0, 0]} /><Bar dataKey="completed" name="Completed" fill={c.accent} radius={[4, 4, 0, 0]} />
            {vel.data?.average !== undefined && <ReferenceLine y={vel.data.average} stroke={c.success} strokeDasharray="4 4" />}</BarChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Created vs resolved" def={`Last ${days} days`} empty={crData.length === 0} summary="Issues created and resolved per day">
          <ResponsiveContainer width="100%" height="100%"><LineChart data={crData} margin={{ left: -20, right: 8, top: 8 }}>
            <CartesianGrid stroke={c.line} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" {...axis} /><YAxis allowDecimals={false} {...axis} />
            <Tooltip content={<ChartTooltip />} /><Legend />
            <Line type="monotone" dataKey="created" name="Created" stroke={c.accent} strokeWidth={2} dot={false} /><Line type="monotone" dataKey="resolved" name="Resolved" stroke={c.success} strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Cumulative flow" def="Approximate: reconstructed from issue history" empty={cfd.rows.length === 0} summary="Issues per column per day">
          <ResponsiveContainer width="100%" height="100%"><AreaChart data={cfd.rows} margin={{ left: -20, right: 8, top: 8 }}>
            <CartesianGrid stroke={c.line} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" {...axis} /><YAxis allowDecimals={false} {...axis} />
            <Tooltip content={<ChartTooltip />} /><Legend />
            {cfd.keys.map((key, i) => <Area key={key} type="monotone" dataKey={key} stackId="1" stroke={palette[i % palette.length]} fill={palette[i % palette.length]} fillOpacity={0.5} />)}</AreaChart></ResponsiveContainer>
        </ChartCard>
        <section className="card space-y-3 p-5" aria-labelledby="rp-res">
          <h2 id="rp-res" className="text-section">Resolution time</h2>
          <div className="grid grid-cols-2 gap-3"><div><p className="text-xs text-fg-muted">Average</p><p className="text-2xl font-bold">{res.data?.avg_days ?? '-'} <span className="text-sm font-normal text-fg-muted">days</span></p></div>
            <div><p className="text-xs text-fg-muted">Median</p><p className="text-2xl font-bold">{res.data?.median_days ?? '-'} <span className="text-sm font-normal text-fg-muted">days</span></p></div></div>
          <table className="w-full text-sm"><thead className="text-left text-xs text-fg-muted"><tr><th className="py-1 font-medium">Type</th><th className="py-1 font-medium">Avg days</th></tr></thead>
            <tbody>{(res.data?.by_type ?? []).map((t) => <tr key={t.type} className="border-t border-line"><td className="py-1 capitalize">{t.type}</td><td>{t.avg_days}</td></tr>)}</tbody></table>
        </section>
      </div>
      <section className="card space-y-3 p-5" aria-labelledby="rp-wl">
        <h2 id="rp-wl" className="text-section">Workload</h2>
        <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm"><thead className="text-xs text-fg-muted"><tr><th className="py-1 font-medium">Assignee</th><th className="py-1 font-medium">Open issues</th><th className="py-1 font-medium">Open points</th><th className="py-1 font-medium">Remaining</th></tr></thead>
          <tbody>{(wl.data ?? []).map((w, i) => <tr key={i} className="border-t border-line"><td className="py-1.5">{nameOf(w.user)}</td><td>{w.open_issues}</td><td>{w.open_points}</td><td>{fmtMinutes(w.remaining_minutes)}</td></tr>)}
            {(wl.data ?? []).length === 0 && <tr><td colSpan={4} className="py-3 text-center text-fg-muted">No open work.</td></tr>}</tbody></table></div>
      </section>
      <section className="card space-y-3 p-5" aria-labelledby="rp-tr">
        <div className="flex flex-wrap items-end justify-between gap-2"><h2 id="rp-tr" className="text-section">Time report</h2>
          <div className="flex items-end gap-2"><div><label className="label" htmlFor="tr-f">From</label><input id="tr-f" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><label className="label" htmlFor="tr-t">To</label><input id="tr-t" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div></div></div>
        {tr.error && <ErrorBanner error={tr.error} onRetry={() => tr.refetch()} />}
        <table className="w-full text-left text-sm"><thead className="text-xs text-fg-muted"><tr><th className="py-1 font-medium">User</th><th className="py-1 font-medium">Time logged</th><th className="py-1 font-medium">Issues</th></tr></thead>
          <tbody>{(tr.data ?? []).map((r, i) => <tr key={i} className="border-t border-line"><td className="py-1.5">{nameOf(r.user)}</td><td>{fmtMinutes(r.minutes)}</td><td>{r.issues}</td></tr>)}
            {(tr.data ?? []).length === 0 && <tr><td colSpan={3} className="py-3 text-center text-fg-muted">No work logged in this range.</td></tr>}</tbody></table>
      </section>
    </div>
  );
}
