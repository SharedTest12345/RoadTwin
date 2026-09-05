/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          950: "#05070a",
          900: "#0a0e14",
          850: "#0e131b",
          800: "#131a24",
          700: "#1b2430",
          600: "#26313f",
          500: "#3a4a5c",
          400: "#5c7186",
          300: "#8ba0b3",
        },
        risk: {
          critical: "#ef4444",
          high: "#f97316",
          moderate: "#eab308",
          low: "#84cc16",
          minimal: "#22c55e",
        },
        accent: {
          DEFAULT: "#3ddc97",
          dim: "#1d8a5c",
        },
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "'Consolas'", "monospace"],
        sans: ["'Inter'", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
