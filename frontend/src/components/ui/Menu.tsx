import { useEffect, useRef, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Popover, type TriggerProps } from './Popover';

export type MenuItem =
  | { type?: 'item'; label: string; icon?: LucideIcon; onSelect?: () => void; to?: string; danger?: boolean; active?: boolean; disabled?: boolean }
  | { type: 'separator' }
  | { type: 'label'; label: ReactNode };

function MenuList({ items, close }: { items: MenuItem[]; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const els = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled=true])') ?? []);
  useEffect(() => { els()[0]?.focus(); }, []);
  const onKey = (e: React.KeyboardEvent) => {
    const list = els(); const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === 'Tab') close();
  };
  return (
    <div ref={ref} onKeyDown={onKey} className="p-1 text-sm">
      {items.map((it, k) => {
        if (it.type === 'separator') return <div key={k} role="separator" className="my-1 h-px bg-line" />;
        if (it.type === 'label') return <div key={k} className="px-3 py-2">{it.label}</div>;
        const cls = `flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left outline-none transition-colors focus-visible:bg-surface-2 hover:bg-surface-2 aria-disabled:opacity-50 ${it.danger ? 'text-danger' : it.active ? 'text-accent' : 'text-fg'}`;
        const inner = <>{it.icon && <it.icon size={15} aria-hidden />}<span className="flex-1">{it.label}</span></>;
        if (it.to) return <Link key={k} role="menuitem" to={it.to} className={cls} onClick={() => { close(); it.onSelect?.(); }}>{inner}</Link>;
        return <button key={k} role="menuitem" type="button" aria-disabled={it.disabled} className={cls} onClick={() => { if (it.disabled) return; close(); it.onSelect?.(); }}>{inner}</button>;
      })}
    </div>
  );
}

export function Menu({ trigger, items, align, width = 'w-56' }: { trigger: (p: TriggerProps & { open: boolean }) => ReactNode; items: MenuItem[]; align?: 'start' | 'end'; width?: string }) {
  return <Popover role="menu" trigger={trigger} align={align} width={width}>{(close) => <MenuList items={items} close={close} />}</Popover>;
}
export const Dropdown = Menu;
export default Menu;
