export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-gradient-to-r from-surface-2 via-line/60 to-surface-2 bg-[length:400px_100%] ${className}`} style={{ animation: 'shimmer 1.4s linear infinite' }} />;
}
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card flex items-center gap-3 p-4">
          <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-1/3" /></div>
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      ))}
    </div>
  );
}
export function SkeletonCard({ className = 'h-28' }: { className?: string }) {
  return <div className={`card p-5 ${className}`} aria-hidden><Skeleton className="mb-3 h-3 w-1/3" /><Skeleton className="h-7 w-1/2" /></div>;
}
export default Skeleton;
