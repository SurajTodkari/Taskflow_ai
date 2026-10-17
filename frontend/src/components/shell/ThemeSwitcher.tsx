import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor, Check } from 'lucide-react';
import { applyTheme, getTheme, setTheme, subscribeTheme, type ThemeMode } from '../../lib/theme';
import { Menu } from '../ui/Menu';

export default function ThemeSwitcher() {
  const [mode, setMode] = useState<ThemeMode>(getTheme());
  useEffect(() => subscribeTheme(() => setMode(getTheme())), []);
  const Icon = mode === 'dark' ? Moon : mode === 'light' ? Sun : Monitor;
  const pick = (m: ThemeMode) => { setTheme(m); setMode(m); };
  useEffect(() => { applyTheme(mode); }, [mode]);
  const item = (m: ThemeMode, label: string, icon: typeof Sun) => ({ label: label + (mode === m ? '' : ''), icon: mode === m ? Check : icon, active: mode === m, onSelect: () => pick(m) });
  return (
    <Menu width="w-44" trigger={(p) => <button {...p} className="icon-btn !h-10 !w-10 sm:!h-9 sm:!w-9" aria-label={`Theme: ${mode}`}><Icon size={18} /></button>}
      items={[item('light', 'Light', Sun), item('dark', 'Dark', Moon), item('system', 'System', Monitor)]} />
  );
}
