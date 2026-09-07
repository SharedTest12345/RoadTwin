// Single source of truth for risk tiers on the frontend — mirrors backend
// risk_engine.CATEGORY_THRESHOLDS exactly (80/60/40/0 -> CRITICAL/HIGH/MODERATE/LOW).
// Kept free of three.js so lightweight pages (the Home map) can import it
// without pulling the 3D scene bundle in. Re-exported from three/geometryUtils
// so every existing import path there keeps working unchanged.
export const RISK_COLORS: Record<string, string> = {
  CRITICAL: "#ef4444",
  HIGH: "#f97316",
  MODERATE: "#eab308",
  LOW: "#22c55e",
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
