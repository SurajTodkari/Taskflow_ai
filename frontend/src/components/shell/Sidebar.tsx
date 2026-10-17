import { LogoMark } from '../brand/Logo';
import { useEffect, useRef } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { CheckSquare, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { NAV } from './nav';
import { Tooltip } from '../ui/Tooltip';
import { Avatar } from '../ui/Avatar';
import type { User } from '../../lib/types';

function Items({ collapsed, unread, onNavigate, idPrefix }: { collapsed: boolean; unread: number; onNavigate?: () => void; idPrefix: string }) {
  return (
    <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-3 py-2">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <Tooltip key={to} label={label} disabled={!collapsed}>
          <NavLink to={to} end={end} onClick={onNavigate} aria-label={collapsed ? label : undefined}
            className={({ isActive }) => `group relative flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${collapsed ? 'justify-center' : ''} ${isActive ? 'text-accent' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'}`}>
            {({ isActive }) => (<>
              {isActive && <motion.span layoutId={`${idPrefix}-active`} className="absolute inset-0 rounded-lg bg-accent-soft" transition={{ type: 'spring', stiffness: 500, damping: 40 }}>
                <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-accent" /></motion.span>}
              <span className="relative shrink-0"><Icon size={18} aria-hidden />
                {to === '/notifications' && unread > 0 && collapsed && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-danger" />}</span>
              {!collapsed && <span className="relative flex-1 truncate">{label}</span>}
              {!collapsed && to === '/notifications' && unread > 0 && <span className="relative rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
            </>)}
          </NavLink>
        </Tooltip>
      ))}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link to="/" className={`flex items-center gap-2.5 px-5 py-4 text-base font-bold tracking-tight text-fg ${collapsed ? 'justify-center px-0' : ''}`} aria-label="TaskFlow AI home">
      <LogoMark size={30} className="shrink-0" />
      {!collapsed && <span className="flex flex-col leading-tight">TaskFlow AI<span className="text-[10px] font-medium tracking-[0.14em] text-fg-muted">BY NEXORA</span></span>}
    </Link>
  );
}

function Profile({ user, collapsed }: { user: User | null; collapsed: boolean }) {
  return (
    <Link to="/settings" className={`m-3 flex items-center gap-3 rounded-xl border border-line p-2 transition-colors hover:bg-surface-2 ${collapsed ? 'justify-center' : ''}`} aria-label="Profile and settings">
      <Avatar name={user?.name || user?.email} size={32} />
      {!collapsed && <span className="min-w-0 leading-tight"><span className="block truncate text-sm font-medium">{user?.name}</span><span className="block truncate text-caption text-fg-muted">{user?.email}</span></span>}
    </Link>
  );
}

export function DesktopSidebar({ collapsed, onToggle, unread, user }: { collapsed: boolean; onToggle: () => void; unread: number; user: User | null }) {
  return (
    <motion.aside initial={false} animate={{ width: collapsed ? 72 : 256 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      className="sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface lg:flex">
      <Brand collapsed={collapsed} />
      <Items collapsed={collapsed} unread={unread} idPrefix="d" />
      <div className="px-3"><Tooltip label="Expand sidebar" disabled={!collapsed}>
        <button className={`flex min-h-9 w-full items-center gap-3 rounded-lg px-3 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg ${collapsed ? 'justify-center' : ''}`} onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>
          {collapsed ? <PanelLeftOpen size={18} /> : <><PanelLeftClose size={18} />Collapse</>}
        </button></Tooltip></div>
      <Profile user={user} collapsed={collapsed} />
    </motion.aside>
  );
}

export function MobileDrawer({ open, onClose, unread, user }: { open: boolean; onClose: () => void; unread: number; user: User | null }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    ref.current?.querySelector<HTMLElement>('a,button')?.focus();
    return () => document.removeEventListener('keydown', k);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <motion.div className="absolute inset-0 bg-fg/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} aria-hidden />
          <motion.aside ref={ref} role="dialog" aria-modal="true" aria-label="Navigation menu"
            initial={reduce ? { opacity: 0 } : { x: '-100%' }} animate={{ x: 0, opacity: 1 }} exit={reduce ? { opacity: 0 } : { x: '-100%' }} transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute left-0 top-0 flex h-full w-72 max-w-[85%] flex-col bg-surface shadow-pop">
            <div className="flex items-center justify-between pr-3"><Brand collapsed={false} /><button className="icon-btn !h-11 !w-11" aria-label="Close menu" onClick={onClose}><X size={20} /></button></div>
            <Items collapsed={false} unread={unread} onNavigate={onClose} idPrefix="m" />
            <Profile user={user} collapsed={false} />
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

export function BottomTabBar({ onMore, unread }: { onMore: () => void; unread: number }) {
  const tabs = NAV.filter((n) => ['/', '/today', '/inbox', '/tasks'].includes(n.to));
  const cls = 'relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium';
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {tabs.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `${cls} ${isActive ? 'text-accent' : 'text-fg-muted'}`}>
          {({ isActive }) => (<>
            {isActive && <motion.span layoutId="tab-active" className="absolute top-0 h-0.5 w-8 rounded-b-full bg-accent" />}
            <Icon size={20} aria-hidden />{label.replace('My ', '').replace('All ', '')}
          </>)}
        </NavLink>
      ))}
      <button className={`${cls} text-fg-muted`} onClick={onMore} aria-label="Open menu"><span className="relative"><Menu20 />{unread > 0 && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-danger" />}</span>More</button>
    </nav>
  );
}
import { Menu as MenuIcon } from 'lucide-react';
const Menu20 = () => <MenuIcon size={20} aria-hidden />;
