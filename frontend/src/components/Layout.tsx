import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import type { Task } from '../lib/types';
import TaskModal from './TaskModal';
import { DesktopSidebar, MobileDrawer, BottomTabBar } from './shell/Sidebar';
import TopBar from './shell/TopBar';
import SearchPalette from './shell/SearchPalette';
import { titleFor } from './shell/nav';
import { OfflineBanner } from './ui/OfflineBanner';
import { JiraQuickSearch } from './shell/JiraQuickSearch';

const KEY = 'sidebar-collapsed';
function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const reduce = useReducedMotion();
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState(false);
  const [jiraSearch, setJiraSearch] = useState(false);
  const [newTask, setNewTask] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } });
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem(KEY, c ? '0' : '1'); } catch { /* ignore */ } return !c; });

  useEffect(() => { setDrawer(false); }, [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e) || document.querySelector('[aria-modal="true"]')) return;
      const inJira = location.pathname.startsWith('/jira');
      if (e.key === '/') { e.preventDefault(); if (inJira) setJiraSearch(true); else setSearch(true); }
      else if (e.key.toLowerCase() === 'c' && /^\/jira\/[^/]+/.test(location.pathname) && !location.pathname.startsWith('/jira/my-issues')) { e.preventDefault(); window.dispatchEvent(new Event('jira:create-issue')); }
      else if (e.key.toLowerCase() === 'n') { e.preventDefault(); setNewTask(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const unread = useQuery({
    queryKey: ['unread-count'],
    queryFn: async () => {
      const r = await api.get<number | { count?: number; unread?: number; unread_count?: number }>('/api/notifications/unread-count');
      return typeof r === 'number' ? r : r.count ?? r.unread ?? r.unread_count ?? 0;
    },
    refetchInterval: 30000,
  });
  const count = unread.data ?? 0;
  const title = titleFor(loc.pathname);
  useEffect(() => { document.title = `${title} - TaskFlow AI`; }, [title]);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const closeSearch = useCallback(() => setSearch(false), []);

  return (
    <div className="min-h-screen bg-bg lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[90] focus:rounded focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      <DesktopSidebar collapsed={collapsed} onToggle={toggle} unread={count} user={user} />
      <MobileDrawer open={drawer} onClose={closeDrawer} unread={count} user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <TopBar title={title} user={user} unread={count} onMenu={() => setDrawer(true)} onNewTask={() => setNewTask(true)}
          onLogout={async () => { await logout(); nav('/login'); }}
          search={<SearchPalette open={search} onOpen={() => setSearch(true)} onClose={closeSearch} onOpenTask={setEditTask} />} />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 p-4 pb-24 sm:p-6 lg:pb-6">
          <motion.div key={loc.pathname} initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}>
            <Outlet />
          </motion.div>
        </main>
      </div>
      <BottomTabBar onMore={() => setDrawer(true)} unread={count} />
      <JiraQuickSearch open={jiraSearch} onClose={() => setJiraSearch(false)} />
      <TaskModal open={newTask} onClose={() => setNewTask(false)} />
      <TaskModal open={!!editTask} task={editTask} onClose={() => setEditTask(null)} />
    </div>
  );
}
