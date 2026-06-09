/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', "Menlo", "Consolas", "monospace"],
      },
      colors: {
        ink: {
          900: "#0b0d10",
          800: "#11141a",
          700: "#171b22",
          600: "#1f242d",
          500: "#2a313c",
          400: "#3a4250",
        },
        accent: {
          DEFAULT: "#ff7a59",
          dim: "#a44f3c",
        },
      },
    },
  },
  plugins: [],
};
