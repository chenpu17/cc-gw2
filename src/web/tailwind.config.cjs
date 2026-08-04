/** @type {import('tailwindcss').Config} */

// 主题变量是纯 hex(见 global.css)。用相对颜色语法包一层 <alpha-value>,
// 让 `bg-primary/10` 这类透明度修饰真正生效 —— 直接写 'var(--x)' 时
// Tailwind 3.4 无法注入 alpha,会静默丢弃整条规则。
const withAlpha = (variable) => `rgb(from var(${variable}) r g b / <alpha-value>)`

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
        border: withAlpha('--border'),
        input: withAlpha('--input'),
        ring: withAlpha('--ring'),
        background: withAlpha('--background'),
        foreground: withAlpha('--foreground'),
        primary: {
          DEFAULT: withAlpha('--primary'),
          foreground: withAlpha('--primary-foreground')
        },
        secondary: {
          DEFAULT: withAlpha('--secondary'),
          foreground: withAlpha('--secondary-foreground')
        },
        destructive: {
          DEFAULT: withAlpha('--destructive'),
          foreground: withAlpha('--destructive-foreground')
        },
        muted: {
          DEFAULT: withAlpha('--muted'),
          foreground: withAlpha('--muted-foreground')
        },
        accent: {
          DEFAULT: withAlpha('--accent'),
          foreground: withAlpha('--accent-foreground')
        },
        popover: {
          DEFAULT: withAlpha('--popover'),
          foreground: withAlpha('--popover-foreground')
        },
        card: {
          DEFAULT: withAlpha('--card'),
          foreground: withAlpha('--card-foreground')
        },
        success: {
          DEFAULT: withAlpha('--success'),
          bg: withAlpha('--success-bg')
        },
        warning: {
          DEFAULT: withAlpha('--warning'),
          bg: withAlpha('--warning-bg')
        },
        error: {
          DEFAULT: withAlpha('--error'),
          bg: withAlpha('--error-bg')
        },
        info: {
          DEFAULT: withAlpha('--info'),
          bg: withAlpha('--info-bg')
        },
        chart: {
          1: withAlpha('--chart-1'),
          2: withAlpha('--chart-2'),
          3: withAlpha('--chart-3'),
          4: withAlpha('--chart-4'),
          5: withAlpha('--chart-5')
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
