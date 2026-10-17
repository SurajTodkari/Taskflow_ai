import { useEffect, useState } from 'react';

const NAMES = ['accent', 'success', 'warning', 'danger', 'fg', 'fg-muted', 'line', 'surface'] as const;
export type ChartColors = Record<(typeof NAMES)[number], string>;

function read(): ChartColors {
  const cs = getComputedStyle(document.documentElement);
  const o = {} as ChartColors;
  NAMES.forEach((n) => { o[n] = `rgb(${cs.getPropertyValue('--' + n).trim().replace(/\s+/g, ' ') || '99 102 241'})`; });
  return o;
}
/** Resolved theme colors (recharts needs concrete values); updates when the .dark class toggles. */
export function useChartColors(): ChartColors {
  const [c, setC] = useState<ChartColors>(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setC(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => mo.disconnect();
  }, []);
  return c;
}
