export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink-800/70 border border-ink-700 rounded-md px-2 py-1.5 text-center min-w-0">
      <div className="mono text-sm font-bold text-ink-100 truncate">{value}</div>
      <div className="text-2xs text-ink-400 mt-0.5 leading-tight truncate">{label}</div>
    </div>
  );
}
