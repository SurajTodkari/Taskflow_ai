/** @type {import('tailwindcss').Config} */
const v = (n) => `rgb(var(--${n}) / <alpha-value>)`;
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        bg: v('bg'), surface: v('surface'), 'surface-2': v('surface-2'), line: v('line'),
        fg: v('fg'), 'fg-muted': v('fg-muted'), accent: v('accent'), 'accent-soft': v('accent-soft'),
        success: v('success'), warning: v('warning'), danger: v('danger'),
        brand: { 50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 800: '#3730a3', 900: '#312e81' },
        ink: { 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a', 950: '#0a0f1e' },
      },
      borderRadius: { md: 'var(--radius-sm)', lg: 'var(--radius-md)', xl: 'var(--radius-lg)', '2xl': 'var(--radius-xl)' },
      boxShadow: { card: 'var(--shadow-md)', pop: 'var(--shadow-lg)', sm: 'var(--shadow-sm)' },
      fontSize: { display: ['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.025em', fontWeight: '700' }], page: ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.02em', fontWeight: '700' }], section: ['1rem', { lineHeight: '1.5rem', fontWeight: '600' }], caption: ['0.75rem', { lineHeight: '1rem' }] },
      transitionTimingFunction: { out: 'cubic-bezier(.2,.8,.2,1)' },
    },
  },
  plugins: [],
};
