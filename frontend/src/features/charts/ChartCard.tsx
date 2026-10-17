import { useId, type ReactNode } from 'react';
import { BarChart3 } from 'lucide-react';

export function ChartCard({ title, def, children, empty, summary }: { title: string; def?: string; children: ReactNode; empty?: boolean; summary?: string }) {
  const id = useId();
  return (
    <section className="card p-5" aria-labelledby={id}>
      <h2 id={id} className="text-section">{title}</h2>
      {def && <p className="mt-0.5 line-clamp-2 text-caption text-fg-muted" title={def}>{def}</p>}
      <div className="mt-3 h-64" role="img" aria-label={`${title}. ${empty ? 'No data in this range.' : summary ?? ''}`}>
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-sm text-fg-muted">
            <BarChart3 size={22} aria-hidden />No data in this range
          </div>
        ) : children}
      </div>
    </section>
  );
}

export function ChartTooltip({ active, payload, label, c }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string; payload?: { fill?: string } }[]; label?: string | number; c?: unknown }) {
  void c;
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-caption shadow-pop">
      {label !== undefined && label !== '' && <p className="mb-1 font-medium text-fg">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 text-fg-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />{p.name}: <span className="font-semibold text-fg">{p.value}</span>
        </p>
      ))}
    </div>
  );
}
