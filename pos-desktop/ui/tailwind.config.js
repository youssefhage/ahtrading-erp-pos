/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        // Theme tokens are CSS-variable based so we can switch light/dark at runtime.
        // Variables store "R G B" (space-separated) so Tailwind alpha utilities work.
        bg: 'rgb(var(--color-bg) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        'surface-highlight': 'rgb(var(--color-surface-highlight) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        border: 'rgb(var(--color-border) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        'accent-hover': 'rgb(var(--color-accent-hover) / <alpha-value>)',
        'accent-content': 'rgb(var(--color-accent-content) / <alpha-value>)',
        ink: 'rgb(var(--color-ink) / <alpha-value>)',
        'ink-muted': 'rgb(var(--color-ink-muted) / <alpha-value>)',
      },
      fontFamily: {
        // Keep Tailwind's `font-sans` consistent with `src/styles.css` (offline-safe fallbacks included).
        sans: ['Roboto', '"Avenir Next"', '"Segoe UI"', 'sans-serif'],
        mono: ['Roboto', '"SF Mono"', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
