import { AlertTriangle } from 'lucide-react';
export default function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Something went wrong';
  return (
    <div role="alert" className="flex items-center gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-fg">
      <AlertTriangle size={18} className="shrink-0 text-danger" aria-hidden />
      <span className="flex-1">{msg}</span>
      {onRetry && <button className="btn-ghost !py-1" onClick={onRetry}>Retry</button>}
    </div>
  );
}
