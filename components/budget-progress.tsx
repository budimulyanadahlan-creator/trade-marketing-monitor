interface BudgetProgressProps {
  actualSpent: number;
  requestedBudget: number;
  showLabel?: boolean;
  className?: string;
}

export function BudgetProgress({
  actualSpent,
  requestedBudget,
  showLabel = true,
  className = "",
}: BudgetProgressProps) {
  if (!requestedBudget) return null;

  const rawPercent = (actualSpent / requestedBudget) * 100;
  const clampedPercent = Math.min(rawPercent, 100);

  let barColor = "bg-emerald-500";
  let textColor = "text-emerald-400";
  if (rawPercent >= 100) {
    barColor = "bg-rose-500";
    textColor = "text-rose-400";
  } else if (rawPercent >= 80) {
    barColor = "bg-amber-500";
    textColor = "text-amber-400";
  }

  return (
    <div className={`space-y-1 ${className}`}>
      <div className="h-1.5 w-full rounded-full bg-white/8 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
      {showLabel && (
        <p className={`text-xs ${textColor}`}>
          {rawPercent.toFixed(1)}% terserap
        </p>
      )}
    </div>
  );
}
