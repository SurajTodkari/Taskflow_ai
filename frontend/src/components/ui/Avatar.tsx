export function Avatar({ name, size = 32, className = '' }: { name?: string; size?: number; className?: string }) {
  const ch = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 font-semibold text-white ${className}`} style={{ width: size, height: size, fontSize: size * 0.42 }}>{ch}</span>
  );
}
export default Avatar;
