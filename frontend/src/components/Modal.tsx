import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';

interface Props { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function Modal({ open, onClose, title, children, wide, footer }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (!ref.current) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key === 'Tab') {
        const els = ref.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!els.length) { e.preventDefault(); return; }
        const first = els[0], last = els[els.length - 1];
        if (!ref.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => {
      const f = ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not([data-close])');
      (f || ref.current)?.focus();
    }, 30);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [open]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
          <motion.div className="absolute inset-0 bg-fg/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onMouseDown={() => closeRef.current()} aria-hidden />
          <motion.div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className={`relative flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-line bg-surface text-fg shadow-pop outline-none sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-md'}`}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 id={titleId} className="text-section">{title}</h2>
              <button data-close type="button" className="icon-btn" onClick={() => closeRef.current()} aria-label="Close dialog"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
