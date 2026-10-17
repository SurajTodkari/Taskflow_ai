import { useNavigate } from 'react-router-dom';
import { LogOut, Menu as MenuIcon, Plus, Settings, User as UserIcon } from 'lucide-react';
import type { User } from '../../lib/types';
import { Avatar } from '../ui/Avatar';
import { Menu } from '../ui/Menu';
import ThemeSwitcher from './ThemeSwitcher';
import NotificationBell from './NotificationBell';

export default function TopBar({ title, user, unread, onMenu, onNewTask, onLogout, search }: { title: string; user: User | null; unread: number; onMenu: () => void; onNewTask: () => void; onLogout: () => void; search: React.ReactNode }) {
  const nav = useNavigate();
  const date = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface/85 px-3 py-2 backdrop-blur sm:gap-3 sm:px-6">
      <button className="icon-btn !h-10 !w-10 lg:hidden" aria-label="Open menu" onClick={onMenu}><MenuIcon size={20} /></button>
      <div className="hidden min-w-0 shrink-0 lg:block"><h1 className="truncate text-section">{title}</h1></div>
      <div className="flex min-w-0 flex-1 items-center justify-center lg:px-4">{search}</div>
      <time className="hidden whitespace-nowrap text-sm text-fg-muted md:block" aria-label="Current date">{date}</time>
      <button className="btn-primary !min-h-10 sm:!min-h-9 !px-3" onClick={onNewTask} aria-label="Quick add task (N)"><Plus size={16} /><span className="hidden sm:inline">Add task</span></button>
      <ThemeSwitcher />
      <NotificationBell count={unread} />
      <Menu width="w-60" trigger={(p) => <button {...p} className="rounded-full" aria-label="User menu"><Avatar name={user?.name || user?.email} size={34} /></button>}
        items={[
          { type: 'label', label: <><div className="truncate text-sm font-medium">{user?.name}</div><div className="truncate text-xs text-fg-muted">{user?.email}</div></> },
          { type: 'separator' },
          { label: 'Profile', icon: UserIcon, to: '/settings' },
          { label: 'Settings', icon: Settings, onSelect: () => nav('/settings') },
          { type: 'separator' },
          { label: 'Log out', icon: LogOut, danger: true, onSelect: onLogout },
        ]} />
    </header>
  );
}
