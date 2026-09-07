/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Neutral charcoal ink scale (GIS/engineering-tool palette, not the
        // old cool blue-black cyber cast) — true near-black core with a
        // warm-neutral graphite cast, calibrated to the reference design's
        // own panel bg (#141513, ink-850) and hairline border (#3f403f,
        // ink-600). Every panel/card/overlay is built from this one scale
        // so contrast steps stay consistent.
        ink: {
          950: "#000000",
          900: "#0a0a09",
          850: "#141513",
          800: "#1c1d1a",
          700: "#262723",
          600: "#3f403f",
          500: "#5c5d59",
          400: "#8f9089",
          300: "#b0b1a9",
          200: "#d1d2cb",
          100: "#e9e9e4",
          50: "#f6f6f3",
        },
        // Restrained neutral accent (soft off-white) — the reference design
        // has no separate hue-based "brand color" anywhere; primary CTAs are
        // plain light-filled pills with dark text, and "active" states are a
        // lighter neutral, not a glowing color. Keeping this as a semantic
        // token (rather than inlining ink-50/white at every call site) is
        // what makes `bg-brand text-ink-950` still read as "the app's own
        // primary action style," not require touching each of its ~15 call
        // sites individually.
        brand: {
          DEFAULT: "#f2f2ef",
          bright: "#ffffff",
          dim: "#b5b6ae",
          ink: "#141513",
        },
        // Muted/desaturated risk severity colors, matched to the reference
        // design exactly (its own "Standardize/Lighten risk colors" pass) —
        // NOT the same hue family as `brand` above, so risk color never
        // doubles as a general "this is active/selected" UI signal (the
        // reference design explicitly keeps these meanings separate).
        risk: {
          critical: "#c2453d",
          high: "#d9822b",
          moderate: "#d4a72c",
          low: "#3a9b72",
        },
      },
      fontFamily: {
        sans: ["'IBM Plex Sans'", "system-ui", "sans-serif"],
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
        // Matches the reference design's own "Enhanced Drop Shadows" pass
        // exactly — deep ambient shadow so floating panels read as sitting
        // above the map, not a colored/glow shadow.
        panel: "0 12px 32px rgba(0,0,0,0.85)",
      },
    },
  },
  plugins: [],
};
