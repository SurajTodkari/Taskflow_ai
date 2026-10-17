import { useId } from 'react';

/** Vector recreation of the Nexora "N + orbit" mark. */
export function LogoMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" className={className} role="img" aria-label="Nexora logo" fill="none">
      <defs>
        <linearGradient id={`n${id}`} x1="20" y1="10" x2="100" y2="105" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1FA2FF" /><stop offset=".55" stopColor="#1565E8" /><stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
        <linearGradient id={`o${id}`} x1="0" y1="80" x2="120" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22D3EE" /><stop offset="1" stopColor="#2563EB" />
        </linearGradient>
      </defs>
      <path d="M26 104V24L46 12v80L26 104Z" fill={`url(#n${id})`} opacity=".92" />
      <path d="M46 12h20l34 70v22H80L46 34V12Z" fill={`url(#n${id})`} />
      <path d="M80 104V30l20-12v74l-20 12Z" fill={`url(#n${id})`} opacity=".85" />
      <ellipse cx="60" cy="66" rx="56" ry="15" transform="rotate(-24 60 66)" stroke={`url(#o${id})`} strokeWidth="5" strokeLinecap="round" strokeDasharray="150 40" />
      <circle cx="104" cy="22" r="6" fill={`url(#o${id})`} />
    </svg>
  );
}

export default function Logo({ size = 36, tagline = false, className = '', light = false }: { size?: number; tagline?: boolean; className?: string; light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} />
      <span className="flex flex-col leading-none">
        <span className={`font-extrabold tracking-[0.12em] ${light ? 'text-white' : 'text-[#0B1B3F] dark:text-white'}`} style={{ fontSize: size * 0.5 }}>NEXORA</span>
        {tagline && <span className={`mt-1 font-medium tracking-[0.18em] ${light ? 'text-sky-200' : 'text-fg-muted'}`} style={{ fontSize: Math.max(8, size * 0.2) }}>AI RESEARCH CENTRE</span>}
      </span>
    </span>
  );
}
