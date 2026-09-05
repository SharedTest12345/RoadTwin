import { Star } from "lucide-react";

export function StarRating({ stars, size = 22 }: { stars: number; size?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => {
        const fill = Math.max(0, Math.min(1, stars - i));
        return (
          <div key={i} className="relative" style={{ width: size, height: size }}>
            <Star size={size} className="absolute inset-0 text-base-600" strokeWidth={1.5} />
            <div className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star size={size} className="text-accent" fill="currentColor" strokeWidth={1.5} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
