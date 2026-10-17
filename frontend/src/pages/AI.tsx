import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Send, Sparkles, AlertTriangle, Bot, Target, CalendarClock, Sunrise, Clock, BarChart3, Cpu, ListChecks, type LucideIcon } from 'lucide-react';
import { api } from '../lib/api';
import type { AiInsights } from '../lib/types';
import ErrorBanner from '../components/ErrorBanner';
import { Skeleton } from '../components/Skeleton';

interface Msg { role: 'user' | 'ai'; text: string; source?: string; error?: boolean }
const CHIPS = ['What work is pending for tomorrow?', 'What should I prioritize today?', 'Which tasks are overdue?', 'Summarize my week', 'Am I overloaded this week?'];

const itemText = (x: unknown): string => {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') { const o = x as Record<string, unknown>; const t = o.title ?? o.name ?? o.task; const extra = o.reason ?? o.due_date ?? o.date; return `${t ?? JSON.stringify(o)}${extra ? ` – ${String(extra)}` : ''}`; }
  return String(x);
};

function SourceBadge({ source }: { source: string }) {
  const llm = source === 'llm';
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium ${llm ? 'bg-accent-soft text-accent' : 'bg-surface text-fg-muted'}`}>{llm ? <Sparkles size={11} /> : <ListChecks size={11} />}{llm ? 'AI model (LLM)' : 'Rule-based engine'}</span>;
}

function InsightCard({ title, icon: Icon, items, tone = 'text-accent' }: { title: string; icon: LucideIcon; items: unknown[]; tone?: string }) {
  return (<div className="rounded-xl border border-line bg-surface-2/50 p-3">
    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Icon size={15} className={tone} aria-hidden />{title}{items.length > 0 && <span className="chip ml-auto">{items.length}</span>}</h3>
    {items.length === 0 ? <p className="text-xs text-fg-muted">Nothing to show.</p> : <ul className="space-y-1 text-sm">{items.slice(0, 6).map((x, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-fg-muted" />{itemText(x)}</li>)}</ul>}</div>);
}

export default function AI() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<{ enabled: boolean; provider?: string }>('/api/ai/status') });
  const ins = useQuery({ queryKey: ['ai-insights'], queryFn: () => api.get<AiInsights>('/api/ai/insights'), refetchInterval: 60000 });
  const chat = useMutation({
    mutationFn: (message: string) => api.post<{ answer: string; source: string }>('/api/ai/chat', { message }),
    onSuccess: (r) => setMsgs((m) => [...m, { role: 'ai', text: r.answer, source: r.source }]),
    onError: (e) => setMsgs((m) => [...m, { role: 'ai', text: e instanceof Error ? e.message : 'Request failed', error: true }]),
  });
  useEffect(() => { end.current?.scrollIntoView?.({ behavior: 'smooth' }); }, [msgs, chat.isPending]);
  const send = (t: string) => { const v = t.trim(); if (!v || chat.isPending) return; setMsgs((m) => [...m, { role: 'user', text: v }]); setText(''); chat.mutate(v); };
  const submit = (e: FormEvent) => { e.preventDefault(); send(text); };
  const d = ins.data;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h1 className="flex items-center gap-2 text-page font-semibold"><Sparkles size={22} className="text-accent" />AI assistant</h1><p className="text-sm text-fg-muted">Answers are generated from your own tasks and schedule.</p></div>
        {status.data && <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${status.data.enabled ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}><Cpu size={13} />
          {status.data.enabled ? `AI key configured (${status.data.provider ?? 'LLM'})` : 'No AI key configured – answers come from built-in rules'}</span>}</div>
      {status.error && <ErrorBanner error={status.error} onRetry={() => status.refetch()} />}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="card flex h-[36rem] flex-col overflow-hidden" aria-label="Chat">
          <div className="flex-1 space-y-4 overflow-y-auto p-4" role="log" aria-live="polite">
            {msgs.length === 0 && <div className="flex h-full flex-col items-center justify-center text-center"><span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent"><Bot size={24} /></span>
              <p className="font-medium">How can I help you plan?</p><p className="mt-1 max-w-xs text-sm text-fg-muted">Ask about your tasks and schedule, or try a suggestion below.</p></div>}
            {msgs.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'ai' && <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"><Bot size={15} /></span>}
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${m.role === 'user' ? 'rounded-br-md bg-accent text-white' : m.error ? 'rounded-bl-md bg-danger/10 text-danger' : 'rounded-bl-md bg-surface-2'}`}>
                  {m.text}{m.source && <div className="mt-2"><SourceBadge source={m.source} /><span className="sr-only">Source: {m.source === 'llm' ? 'AI model (LLM)' : 'rule-based engine'}</span></div>}</div></div>))}
            {chat.isPending && <div className="flex items-center gap-2" role="status" aria-label="Assistant is typing"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-accent"><Bot size={15} /></span>
              <div className="flex gap-1 rounded-2xl rounded-bl-md bg-surface-2 px-4 py-3">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-muted" style={{ animationDelay: `${i * 0.15}s` }} />)}</div></div>}
            <div ref={end} />
          </div>
          <div className="flex gap-2 overflow-x-auto border-t border-line px-3 py-2.5">
            {CHIPS.map((c) => <button key={c} type="button" disabled={chat.isPending} onClick={() => send(c)} className="shrink-0 rounded-full border border-line bg-surface px-3 py-1 text-xs transition hover:border-accent hover:text-accent disabled:opacity-50">{c}</button>)}
          </div>
          <form onSubmit={submit} className="flex gap-2 border-t border-line p-3">
            <input className="input" aria-label="Message" placeholder="Ask about your tasks..." value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn-primary" disabled={chat.isPending || !text.trim()} aria-label="Send"><Send size={16} /></button></form>
        </section>
        <aside className="card space-y-3 p-4" aria-label="Insights">
          <h2 className="text-section font-semibold">Insights</h2>
          {ins.error && <ErrorBanner error={ins.error} onRetry={() => ins.refetch()} />}
          {ins.isLoading ? <div className="space-y-3"><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-24 w-full rounded-xl" /></div> : d && (<>
            {d.overload?.flag && <div role="alert" className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />{d.overload.message}</div>}
            {d.weekly_summary && <div className="rounded-xl border border-line bg-surface-2/50 p-3"><h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><BarChart3 size={15} className="text-accent" />Weekly summary</h3><p className="text-sm text-fg-muted">{d.weekly_summary}</p></div>}
            <InsightCard title="Suggested priorities" icon={Target} items={d.suggested_priorities ?? []} />
            <InsightCard title="Approaching deadlines" icon={CalendarClock} items={d.approaching_deadlines ?? []} tone="text-warning" />
            <InsightCard title="Tomorrow's plan" icon={Sunrise} items={d.tomorrow_plan ?? []} tone="text-success" />
            <InsightCard title="Delayed tasks" icon={Clock} items={d.delayed_tasks ?? []} tone="text-danger" />
          </>)}
        </aside>
      </div>
    </div>
  );
}
