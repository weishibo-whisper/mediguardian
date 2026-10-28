import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
        },
        /**
         * 强调色的「按角色」令牌。
         * brand-* 是色阶（按明度命名），accent-* 是按用途命名：
         *   solid        填充块背景（配白字，实测 ≥ 4.5:1）
         *   solid-hover  填充块悬停
         *   text         浅/深底上的强调文字（每个主题各自取值）
         * 拆开的原因：同一个青绿色既要当"白字的底"，又要当"底上的字"，
         * 在深色主题下这两个用途需要相反的方向（底要压暗、字要提亮），
         * 共用一个 token 必然有一个角色不合格。
         */
        accent: {
          solid: 'rgb(var(--accent-solid) / <alpha-value>)',
          'solid-hover': 'rgb(var(--accent-solid-hover) / <alpha-value>)',
          text: 'rgb(var(--accent-text) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          soft: 'rgb(var(--ink-soft) / <alpha-value>)',
          mute: 'rgb(var(--ink-mute) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
          sunken: 'rgb(var(--surface-sunken) / <alpha-value>)',
        },
        line: 'rgb(var(--line) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        ok: 'rgb(var(--ok) / <alpha-value>)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        soft: '0 1px 2px rgb(9 30 27 / 0.04), 0 8px 24px -16px rgb(9 30 27 / 0.18)',
        lift: '0 2px 4px rgb(9 30 27 / 0.05), 0 18px 40px -24px rgb(9 30 27 / 0.28)',
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Source Han Sans SC"',
          'system-ui',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', '"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'caret': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        'trace-dash': {
          to: { strokeDashoffset: '-24' },
        },
      },
      animation: {
        'fade-up': 'fade-up 320ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 240ms ease-out both',
        caret: 'caret 1s step-end infinite',
        'trace-dash': 'trace-dash 1.2s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
