/** @type {import('tailwindcss').Config} */

// Every color token resolves to a CSS variable holding space-separated RGB
// channels, so a theme can swap the whole palette by redefining the variables
// (see the `[data-theme=...]` blocks in styles.css). `<alpha-value>` keeps
// Tailwind's opacity modifiers (e.g. `bg-ink-900/80`) working.
const c = (v) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', "Menlo", "Consolas", "monospace"],
        serif: ["var(--font-serif)"],
      },
      colors: {
        ink: {
          900: c("--ink-900"),
          800: c("--ink-800"),
          700: c("--ink-700"),
          600: c("--ink-600"),
          500: c("--ink-500"),
          400: c("--ink-400"),
        },
        accent: {
          DEFAULT: c("--accent"),
          dim: c("--accent-dim"),
        },
        // `zinc` is the app's text ramp (zinc-100 = most prominent → zinc-700 =
        // faintest). Re-themed per palette so e.g. light mode flips text dark.
        zinc: {
          100: c("--tx-100"),
          200: c("--tx-200"),
          300: c("--tx-300"),
          400: c("--tx-400"),
          500: c("--tx-500"),
          600: c("--tx-600"),
          700: c("--tx-700"),
          800: c("--tx-800"),
          900: c("--tx-900"),
        },
      },
    },
  },
  plugins: [],
};
