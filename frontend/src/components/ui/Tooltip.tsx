import { useId, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';

export function Tooltip({ label, children, side = 'right', disabled }: { label: ReactNode; children: ReactNode; side?: 'right' | 'top' | 'bottom'; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const pos = side === 'right' ? 'left-full top-1/2 ml-2 -translate-y-1/2' : side === 'top' ? 'bottom-full left-1/2 mb-2 -translate-x-1/2' : 'top-full left-1/2 mt-2 -translate-x-1/2';
  return (
    <span className="relative flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} aria-describedby={open ? id : undefined}>
      {children}
      <AnimatePresence>
        {open && !disabled && (
          <motion.span id={id} role="tooltip" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
            className={`pointer-events-none absolute z-[80] whitespace-nowrap rounded-md bg-fg px-2 py-1 text-caption font-medium text-bg shadow-pop ${pos}`}>{label}</motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
export default Tooltip;
