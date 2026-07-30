/*
 * Modernist Web UI — Tailwind theme.extend (drop-in).
 * Source: cc-gw2/src/web/tailwind.config.cjs
 *
 * Merge this `theme.extend` into your tailwind config. Also set at the top level:
 *   darkMode: ['class', '[data-theme="dark"]']
 *   plugins:  [require('tailwindcss-animate')]
 */

module.exports = {
  // darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' }
    },
    extend: {
      fontFamily: {
        sans: ['"Archivo"', '"Noto Sans SC"', '"PingFang SC"', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        heading: ['"Archivo"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
        mono: ['"Archivo"', '"SF Mono"', 'ui-monospace', 'monospace']
      },
      screens: {
        'xs': '475px'
      },
      colors: {
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary:    { DEFAULT: 'var(--primary)',    foreground: 'var(--primary-foreground)' },
        secondary:  { DEFAULT: 'var(--secondary)',  foreground: 'var(--secondary-foreground)' },
        destructive:{ DEFAULT: 'var(--destructive)',foreground: 'var(--destructive-foreground)' },
        muted:      { DEFAULT: 'var(--muted)',      foreground: 'var(--muted-foreground)' },
        accent:     { DEFAULT: 'var(--accent)',     foreground: 'var(--accent-foreground)' },
        popover:    { DEFAULT: 'var(--popover)',    foreground: 'var(--popover-foreground)' },
        card:       { DEFAULT: 'var(--card)',       foreground: 'var(--card-foreground)' },
        // Status is two-tier (color + bg). NO green: success is dark gray.
        success: { DEFAULT: 'var(--success)', bg: 'var(--success-bg)' },
        warning: { DEFAULT: 'var(--warning)', bg: 'var(--warning-bg)' },
        error:   { DEFAULT: 'var(--error)',   bg: 'var(--error-bg)' },
        info:    { DEFAULT: 'var(--info)',    bg: 'var(--info-bg)' },
        chart: {
          1: 'var(--chart-1)', 2: 'var(--chart-2)', 3: 'var(--chart-3)',
          4: 'var(--chart-4)', 5: 'var(--chart-5)'
        }
      },
      // Everything square. Only `full` (avatars/dots/pills) survives.
      borderRadius: {
        none: '0px',
        sm: 'var(--radius)', md: 'var(--radius)', lg: 'var(--radius)',
        xl: 'var(--radius)', '2xl': 'var(--radius)', '3xl': 'var(--radius)',
        full: '9999px'
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        // breathing dot for "online / listening / RPM" live indicators only
        'live-pulse': 'live-pulse 2.4s ease-in-out infinite'
      },
      transitionDuration: { '160': '160ms' },
      transitionTimingFunction: { surface: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'live-pulse': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%':      { opacity: '0.35', transform: 'scale(0.82)' }
        }
      }
    }
  }
  // plugins: [require('tailwindcss-animate')]
}
