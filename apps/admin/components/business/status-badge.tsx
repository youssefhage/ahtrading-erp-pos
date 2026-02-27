import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning";

const statusVariantMap: Record<string, BadgeVariant> = {
  draft: "secondary",
  posted: "success",
  active: "success",
  paid: "success",
  approved: "success",
  received: "success",
  pending: "warning",
  partial: "warning",
  partially_paid: "warning",
  on_hold: "warning",
  void: "destructive",
  canceled: "destructive",
  cancelled: "destructive",
  rejected: "destructive",
  overdue: "destructive",
};

/** Statuses that show a pulsing dot indicator */
const pulsingStatuses: Record<string, string> = {
  active: "bg-emerald-500",
  pending: "bg-amber-500",
  partial: "bg-amber-500",
  partially_paid: "bg-amber-500",
  on_hold: "bg-amber-500",
  overdue: "bg-red-500",
};

function titleCase(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface StatusBadgeProps {
  status: string;
  className?: string;
  /** Show pulsing dot for live statuses (default: true) */
  pulse?: boolean;
}

export function StatusBadge({ status, className, pulse = true }: StatusBadgeProps) {
  const variant = statusVariantMap[status.toLowerCase()] ?? "outline";
  const dotColor = pulse ? pulsingStatuses[status.toLowerCase()] : undefined;
  return (
    <Badge variant={variant} className={cn("gap-1.5", className)}>
      {dotColor && (
        <span className="relative flex h-2 w-2">
          <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-75", dotColor)} />
          <span className={cn("relative inline-flex h-2 w-2 rounded-full", dotColor)} />
        </span>
      )}
      {titleCase(status)}
    </Badge>
  );
}
