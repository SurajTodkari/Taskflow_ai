export type ThemeMode = 'light' | 'dark' | 'system';

const listeners = new Set<() => void>();
export function subscribeTheme(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

export function getTheme(): ThemeMode {
  try { return (localStorage.getItem('theme') as ThemeMode) || 'system'; } catch { return 'system'; }
}
export function applyTheme(mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}
export function setTheme(mode: ThemeMode) {
  try { localStorage.setItem('theme', mode); } catch { /* ignore */ }
  applyTheme(mode);
  listeners.forEach((f) => f());
}
export function isDark() { return document.documentElement.classList.contains('dark'); }
export function toggleTheme(): ThemeMode {
  const next: ThemeMode = isDark() ? 'light' : 'dark';
  setTheme(next);
  return next;
}
// follow OS changes while in system mode
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (getTheme() === 'system') applyTheme('system'); });
}
