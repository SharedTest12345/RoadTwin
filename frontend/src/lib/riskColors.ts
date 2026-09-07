// Single source of truth for risk tiers on the frontend — mirrors backend
// risk_engine.CATEGORY_THRESHOLDS exactly (80/60/40/0 -> CRITICAL/HIGH/MODERATE/LOW).
// Kept free of three.js so lightweight pages (the Home map) can import it
// without pulling the 3D scene bundle in. Re-exported from three/geometryUtils
// so every existing import path there keeps working unchanged.
// Muted/desaturated tones (not saturated Tailwind red-500/orange-500/etc) —
// matches tailwind.config.js's risk.* tokens exactly; kept as literal hex
// here too since most callers (map markers, 3D scene materials, SVG gauges)
// need a real color value, not a Tailwind class.
export const RISK_COLORS: Record<string, string> = {
  CRITICAL: "#c2453d",
  HIGH: "#d9822b",
  MODERATE: "#d4a72c",
  LOW: "#3a9b72",
};

export function riskColor(category: string): string {
  return RISK_COLORS[category] ?? RISK_COLORS.LOW;
}

/** Category label for a raw 0-100 score — must stay byte-identical to the
 * backend's CATEGORY_THRESHOLDS. Used where the frontend only has a number
 * (e.g. priority map rows) and shouldn't invent its own bucketing. */
export function riskCategoryFromScore(score: number): string {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 40) return "MODERATE";
  return "LOW";
}
