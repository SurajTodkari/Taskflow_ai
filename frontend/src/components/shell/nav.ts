import { LayoutDashboard, Sun, Sunrise, Inbox, ListTodo, CalendarDays, FolderKanban, Columns3, Bell, BarChart3, FileText, Sparkles, Settings, type LucideIcon } from 'lucide-react';

export interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean }
export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/today', label: 'My Today', icon: Sun },
  { to: '/tomorrow', label: "Tomorrow's Plan", icon: Sunrise },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/tasks', label: 'All Tasks', icon: ListTodo },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/kanban', label: 'Kanban Board', icon: Columns3 },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/reports', label: 'Daily Reports', icon: FileText },
  { to: '/ai', label: 'AI Assistant', icon: Sparkles },
  { to: '/settings', label: 'Settings', icon: Settings },
];
export function titleFor(path: string): string {
  if (/^\/projects\/.+/.test(path)) return 'Project';
  const hit = NAV.find((n) => (n.end ? path === n.to : path === n.to || path.startsWith(n.to + '/')));
  return hit?.label ?? 'TaskFlow AI';
}
