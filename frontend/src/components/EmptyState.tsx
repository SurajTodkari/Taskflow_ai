import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { Inbox, type LucideIcon } from 'lucide-react';
export default function EmptyState({ title, hint, action, icon: Icon = Inbox }: { title: string; hint?: string; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-4 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent"><Icon size={22} aria-hidden /></div>
      <p className="text-sm font-semibold text-fg">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-xs text-fg-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </motion.div>
  );
}
