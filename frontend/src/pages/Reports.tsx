import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import type { DailyReport } from '../lib/types';
import { localISO, fmtDuration, fmtDate, addDays } from '../lib/dates';
import StatCard from '../components/StatCard';
import ErrorBanner from '../components/ErrorBanner';
import EmptyState from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';

export default function Reports() {
  const toast = useToast();
  const [date, setDate] = useState(localISO());
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['report', date], queryFn: () => api.get<DailyReport>('/api/reports/daily', { date }) });
  const list = useQuery({ queryKey: ['report-list'], queryFn: async () => { const r = await api.get<unknown[]>('/api/reports'); return Array.isArray(r) ? r : []; } });
  const dates = (list.data ?? []).map((x) => (typeof x === 'string' ? x : (x as { date?: string })?.date)).filter(Boolean) as string[];

  const exp = async (format: 'pdf' | 'csv') => {
    setBusy(format);
    try { await downloadFile('/api/reports/daily/export', `report-${date}.${format}`, { date, format }); toast(`${format.toUpperCase()} downloaded`); }
    catch (e) { toast(e instanceof Error ? e.message : 'Export failed', 'error'); }
    finally { setBusy(null); }
  };
  const r = q.data;
  const pretty = (() => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); })();
  const pct = r ? Math.round(r.completion_percent) : 0;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-page">Daily reports</h1><p className="text-sm text-fg-muted">{pretty}</p></div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex items-end gap-1">
            <button className="icon-btn border border-line" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={18} /></button>
            <div><label className="label" htmlFor="rd">Date</label><input id="rd" type="date" className="input" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
            <button className="icon-btn border border-line" aria-label="Next day" onClick={() => setDate(addDays(date, 1))}><ChevronRight size={18} /></button>
            <button className="btn-ghost" onClick={() => setDate(localISO())} disabled={date === localISO()}>Today</button>
          </div>
          {(['pdf', 'csv'] as const).map((f) => (
            <button key={f} className="btn-ghost" disabled={!!busy || !r} aria-busy={busy === f} onClick={() => exp(f)}>
              {busy === f ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}{busy === f ? 'Exporting...' : f.toUpperCase()}</button>
          ))}
        </div>
      </div>
      {dates.length > 0 && <div className="flex flex-wrap items-center gap-1.5 text-caption"><span className="text-fg-muted">Saved reports:</span>
        {dates.slice(0, 14).map((d) => <button key={d} onClick={() => setDate(d)} aria-pressed={d === date} className={`rounded-full border px-2.5 py-0.5 transition ${d === date ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-fg-muted hover:text-fg'}`}>{fmtDate(d)}</button>)}</div>}
      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}</div>
        : !r ? (q.error ? null : <EmptyState title="No report for this date" hint="Pick another day or generate tasks for this date." />)
          : (<>
            <section className="card p-5" aria-label="Completion summary">
              <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-section">Completion</h2><span className="text-2xl font-bold">{pct}%</span></div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Completion percent">
                <div className="h-full rounded-full bg-success transition-all duration-700" style={{ width: `${pct}%` }} /></div>
              <p className="mt-2 text-caption text-fg-muted">{r.completed} of {r.total} tasks completed - {fmtDuration(r.time_spent_seconds)} tracked</p>
            </section>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Total tasks" value={r.total} tone="brand" />
              <StatCard label="Completed" value={r.completed} tone="green" />
              <StatCard label="Pending" value={r.pending} tone="amber" />
              <StatCard label="Overdue" value={r.overdue} tone="red" />
              <StatCard label="Cancelled" value={r.cancelled} tone="sky" />
              <StatCard label="Time tracked" value={fmtDuration(r.time_spent_seconds)} tone="brand" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="card p-5"><h2 className="mb-3 flex items-center gap-2 text-section"><FileText size={16} className="text-accent" />By project</h2>
                {r.by_project.length === 0 ? <p className="text-sm text-fg-muted">No project tasks on this date.</p> :
                  <table className="w-full text-sm"><thead><tr className="text-left text-caption text-fg-muted"><th className="py-1 font-medium">Project</th><th className="font-medium">Total</th><th className="font-medium">Completed</th></tr></thead>
                    <tbody>{r.by_project.map((p) => <tr key={p.project} className="border-t border-line"><td className="py-2">{p.project}</td><td>{p.total}</td><td>{p.completed}</td></tr>)}</tbody></table>}</section>
              <section className="card p-5"><h2 className="mb-3 text-section">Planned for the next day</h2>
                {r.tomorrow_planned.length === 0 ? <p className="text-sm text-fg-muted">Nothing planned yet.</p> :
                  <ul className="space-y-2 text-sm">{r.tomorrow_planned.map((t) => <li key={t.id} className="flex items-center justify-between gap-2"><span className="truncate">{t.title}</span><span className="chip capitalize">{t.priority}</span></li>)}</ul>}</section>
            </div>
            <p className="text-caption text-fg-muted">Generated {new Date(r.generated_at).toLocaleString()}</p>
          </>)}
    </div>
  );
}
