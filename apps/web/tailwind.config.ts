import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // All colors flow through CSS variables for per-tenant theming.
        // See src/index.css for the token definitions.
        bg: {
          DEFAULT: 'rgb(var(--bg) / <alpha-value>)',
          muted: 'rgb(var(--bg-muted) / <alpha-value>)',
          subtle: 'rgb(var(--bg-subtle) / <alpha-value>)',
        },
        fg: {
          DEFAULT: 'rgb(var(--fg) / <alpha-value>)',
          muted: 'rgb(var(--fg-muted) / <alpha-value>)',
          subtle: 'rgb(var(--fg-subtle) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
          strong: 'rgb(var(--border-strong) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          fg: 'rgb(var(--brand-fg) / <alpha-value>)',
          subtle: 'rgb(var(--brand-subtle) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          fg: 'rgb(var(--accent-fg) / <alpha-value>)',
        },
        success: { DEFAULT: 'rgb(var(--success) / <alpha-value>)' },
        warning: { DEFAULT: 'rgb(var(--warning) / <alpha-value>)' },
        danger: { DEFAULT: 'rgb(var(--danger) / <alpha-value>)' },
        info: { DEFAULT: 'rgb(var(--info) / <alpha-value>)' },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
    },
  },
  plugins: [],
};

export default config;
