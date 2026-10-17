import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useDismiss } from './useDismiss';

export interface TriggerProps { onClick: () => void; 'aria-haspopup': 'dialog' | 'menu'; 'aria-expanded': boolean; 'aria-controls': string }
interface Props {
  trigger: (p: TriggerProps & { open: boolean }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'start' | 'end';
  width?: string;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  className?: string;
  role?: 'dialog' | 'menu';
  panelRef?: React.RefObject<HTMLDivElement>;
}
export function Popover({ trigger, children, align = 'end', width = 'w-72', open: ctl, onOpenChange, className = '', role = 'dialog', panelRef }: Props) {
  const [own, setOwn] = useState(false);
  const open = ctl ?? own;
  const set = useCallback((o: boolean) => { setOwn(o); onOpenChange?.(o); }, [onOpenChange]);
  const close = useCallback(() => set(false), [set]);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const reduce = useReducedMotion();
  useDismiss(open, [root], close);
  return (
    <div ref={root} className="relative">
      {trigger({ onClick: () => set(!open), 'aria-haspopup': role, 'aria-expanded': open, 'aria-controls': id, open })}
      <AnimatePresence>
        {open && (
          <motion.div id={id} ref={panelRef} role={role}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }} transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
            className={`absolute z-50 mt-2 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-pop ${align === 'end' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'} ${width} ${className}`}>
            {typeof children === 'function' ? children(close) : children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
export default Popover;
