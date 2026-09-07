/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Deep cyber-infrastructure ink scale — near-black core with a cool
        // blue-black cast (not neutral graphite). Every panel/card/overlay
        // is built from this one scale so contrast steps stay consistent.
        ink: {
          950: "#06090e",
          900: "#0a0e17",
          850: "#0c121e",
          800: "#121a2b",
          700: "#1c2537",
          600: "#2a3548",
          500: "#475569",
          400: "#64748b",
          300: "#94a3b8",
          200: "#cbd5e1",
          100: "#e2e8f0",
          50: "#f1f5f9",
        },
        // Signature brand accent — glowing telemetry cyan, the primary HUD
        // color for nav/CTAs/active states. Risk severity keeps its own
        // separate scale below so the two systems never collide.
        brand: {
          DEFAULT: "#00f0ff",
          bright: "#5ef8ff",
          dim: "#0070f3",
          ink: "#00232a",
        },
        risk: {
          critical: "#ff3366",
          high: "#ff6a3d",
          moderate: "#ffb300",
          low: "#00e676",
        },
      },
      fontFamily: {
        sans: ["'Plus Jakarta Sans'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "'Consolas'", "monospace"],
      },
      // Coherent type scale — every surface draws from this instead of
      // one-off arbitrary text-[Npx] values scattered per file.
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
        xs: ["0.75rem", { lineHeight: "1.1rem", letterSpacing: "0.005em" }],
        sm: ["0.8125rem", { lineHeight: "1.3rem" }],
        base: ["0.875rem", { lineHeight: "1.45rem" }],
        md: ["0.9375rem", { lineHeight: "1.45rem" }],
        lg: ["1.0625rem", { lineHeight: "1.5rem", fontWeight: "600" }],
        xl: ["1.25rem", { lineHeight: "1.6rem", letterSpacing: "-0.01em", fontWeight: "700" }],
        "2xl": ["1.5rem", { lineHeight: "1.8rem", letterSpacing: "-0.015em" }],
        "3xl": ["2rem", { lineHeight: "2.2rem", letterSpacing: "-0.015em" }],
        "4xl": ["2.75rem", { lineHeight: "2.9rem", letterSpacing: "-0.02em" }],
        metric: ["1.75rem", { lineHeight: "1.9rem", letterSpacing: "-0.01em" }],
        "metric-lg": ["2.75rem", { lineHeight: "2.85rem", letterSpacing: "-0.02em" }],
      },
      boxShadow: {
        panel: "0 12px 40px -12px rgba(0,0,0,0.55)",
        glow: "0 0 24px -4px rgba(226,166,61,0.35)",
      },
    },
  },
  plugins: [],
};
