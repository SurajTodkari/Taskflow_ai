import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

type Kind = 'success' | 'error' | 'info';
interface T { id: number; kind: Kind; text: string }
const Ctx = createContext<(text: string, kind?: Kind) => void>(() => {});
let n = 0;
const ICON = { success: <CheckCircle2 size={18} className="text-success" />, error: <AlertCircle size={18} className="text-danger" />, info: <Info size={18} className="text-accent" /> };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<T[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => { clearTimeout(timers.current.get(id)); timers.current.delete(id); setList((l) => l.filter((x) => x.id !== id)); }, []);
  const push = useCallback((text: string, kind: Kind = 'success') => {
    const id = ++n;
    setList((l) => [...l.slice(-3), { id, kind, text }]);
    timers.current.set(id, setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 4000));
  }, [dismiss]);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-20 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 lg:bottom-4" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {list.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, x: 40, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 40, scale: 0.96 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 text-sm text-fg shadow-pop">
              <span className="mt-0.5 shrink-0">{ICON[t.kind]}</span>
              <span className="flex-1">{t.text}</span>
              <button className="text-fg-muted hover:text-fg" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X size={14} /></button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
