import { useEffect, type RefObject } from 'react';
export function useDismiss(open: boolean, refs: RefObject<HTMLElement>[], onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (refs.some((r) => r.current?.contains(t))) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('touchstart', down); document.removeEventListener('keydown', key); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);
}
