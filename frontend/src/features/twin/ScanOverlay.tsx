import { motion } from "framer-motion";
import { MapPin, Route, Ruler, Building2, ShieldAlert, Box, Check, Loader2 } from "lucide-react";
import { SCAN_STAGES } from "../../state/store";

const STAGE_ICONS = [MapPin, Route, Ruler, Building2, ShieldAlert, Box];

/** Reflects the real pipeline main.py runs for a scan (provider fetch ->
 * feature_extraction -> risk_engine -> Road assembly) — see SCAN_STAGES in
 * state/store.ts for exactly what's real vs. paced-for-legibility about the
 * timing here. */
export function ScanOverlay({ stage }: { stage: number }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-ink-950/85 backdrop-blur-sm z-40">
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="surface-elevated p-6 w-[380px]"
      >
        <div className="label-caption mb-1">Road Intelligence Pipeline</div>
        <h2 className="font-display text-lg text-ink-100 mb-4">Building digital twin&hellip;</h2>
        <div className="space-y-3">
          {SCAN_STAGES.map((label, i) => {
            const Icon = STAGE_ICONS[i];
            const done = i < stage;
            const active = i === stage;
            return (
              <motion.div
                key={label}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="flex items-center gap-3"
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border transition-colors duration-300 ${
                    done
                      ? "bg-brand/20 border-brand/50 text-brand"
                      : active
                        ? "bg-brand/10 border-brand/40 text-brand"
                        : "bg-ink-800 border-ink-700 text-ink-500"
                  }`}
                >
                  {done ? <Check size={14} /> : <Icon size={14} />}
                </div>
                <span
                  className={`text-sm transition-colors duration-300 ${
                    done ? "text-ink-300" : active ? "text-ink-100 font-medium" : "text-ink-500"
                  }`}
                >
                  {label}
                </span>
                {active && (
                  <span className="ml-auto shrink-0">
                    <Loader2 size={13} className="animate-spin text-brand" />
                  </span>
                )}
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
