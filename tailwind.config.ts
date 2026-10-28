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
        /* 压低圆角：16–24px 的大圆角是"模板感"的主要来源 */
        DEFAULT: '4px',
        md: '6px',
        lg: '8px',
        xl: '10px',
        '2xl': '12px',
        '3xl': '14px',
      },
      boxShadow: {
        /* 只表达"浮起一像素"，不做辉光 */
        soft: '0 1px 0 rgb(24 27 26 / 0.05)',
        lift: '0 1px 3px rgb(24 27 26 / 0.08)',
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
        /* 进场上限 140ms：新内容要"立刻在"，不是"演给你看" */
        'fade-up': 'fade-up 140ms var(--ease-out) both',
        'fade-in': 'fade-in 120ms ease-out both',
        caret: 'caret 1s step-end infinite',
        'trace-dash': 'trace-dash 1.2s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
