interface Props {
  score: number;
  color: string;
  size?: number;
  strokeWidth?: number;
}

/** Circular 0-100 risk gauge — the score is the same real additive total
 * risk_engine computes, just given a visual read instead of plain text. */
export function Gauge({ score, color, size = 132, strokeWidth = 11 }: Props) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.max(0, Math.min(1, score / 100));
  const offset = circumference * (1 - fraction);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1c2537" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.16,1,0.3,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="mono font-bold text-metric leading-none" style={{ color }}>{Math.round(score)}</span>
        <span className="text-2xs text-ink-400 tracking-wide mt-1">/ 100</span>
      </div>
    </div>
  );
}
