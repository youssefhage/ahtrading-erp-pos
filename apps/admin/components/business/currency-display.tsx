import { fmtUsd, fmtLbp } from "@/lib/money";
import { cn } from "@/lib/utils";

interface CurrencyDisplayProps {
  amount: number | null | undefined;
  currency: "USD" | "LBP";
  className?: string;
}

export function CurrencyDisplay({ amount, currency, className }: CurrencyDisplayProps) {
  if (amount == null) {
    return <span className={cn("tabular-nums", className)}>--</span>;
  }

  const formatted = currency === "USD" ? fmtUsd(amount) : fmtLbp(amount);

  return (
    <span
      className={cn(
        "tabular-nums",
        currency === "LBP" && "text-muted-foreground",
        className,
      )}
    >
      {formatted}
    </span>
  );
}
