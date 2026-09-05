export function Bar({ label, value, max, color, suffix = "" }: { label: string; value: number; max: number; color: string; suffix?: string }) {
  const pct = Math.max(2, Math.min(100, (value / Math.max(max, 0.001)) * 100));
  return (
    <div className="mb-2.5">
      <div className="flex justify-between text-[11px] mb-1 text-base-300">
        <span className="truncate pr-2">{label}</span>
        <span className="mono shrink-0">{value.toFixed(1)}{suffix}</span>
      </div>
      <div className="h-1.5 bg-base-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full bar-grow" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
