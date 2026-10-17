import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { WifiOff } from 'lucide-react';

export function useOnline() {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const u = () => setOn(true), d = () => setOn(false);
    window.addEventListener('online', u); window.addEventListener('offline', d);
    return () => { window.removeEventListener('online', u); window.removeEventListener('offline', d); };
  }, []);
  return on;
}
export function OfflineBanner() {
  const on = useOnline();
  return (
    <AnimatePresence>
      {!on && (
        <motion.div role="alert" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden bg-warning/15 text-warning">
          <div className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium"><WifiOff size={15} aria-hidden />You are offline. Changes may not save until you reconnect.</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
export default OfflineBanner;
