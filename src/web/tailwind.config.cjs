/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px'
      }
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
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)'
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)'
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)'
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)'
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)'
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)'
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)'
        },
        success: {
          DEFAULT: 'var(--success)',
          bg: 'var(--success-bg)'
        },
        warning: {
          DEFAULT: 'var(--warning)',
          bg: 'var(--warning-bg)'
        },
        error: {
          DEFAULT: 'var(--error)',
          bg: 'var(--error-bg)'
        },
        info: {
          DEFAULT: 'var(--info)',
          bg: 'var(--info-bg)'
        },
        chart: {
          1: 'var(--chart-1)',
          2: 'var(--chart-2)',
          3: 'var(--chart-3)',
          4: 'var(--chart-4)',
          5: 'var(--chart-5)'
        }
      },
      borderRadius: {
        none: '0px',
        sm: 'var(--radius)',
        md: 'var(--radius)',
        lg: 'var(--radius)',
        xl: 'var(--radius)',
        '2xl': 'var(--radius)',
        '3xl': 'var(--radius)',
        full: '9999px'
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        // 实时状态点的呼吸动画(对齐设计稿 @keyframes livePulse,仅用于「在线/RPM/监听」等存活指示)
        'live-pulse': 'live-pulse 2.4s ease-in-out infinite'
      },
      transitionDuration: {
        '160': '160ms'
      },
      transitionTimingFunction: {
        surface: 'cubic-bezier(0.22, 1, 0.36, 1)'
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        'live-pulse': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.35', transform: 'scale(0.82)' }
        }
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
}
