import { type LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: LucideIcon;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
}

const trendConfig = {
  up: { icon: TrendingUp, className: "text-green-600 dark:text-green-400" },
  down: { icon: TrendingDown, className: "text-red-600 dark:text-red-400" },
  neutral: { icon: Minus, className: "text-muted-foreground" },
} as const;

export function KpiCard({ title, value, description, icon: Icon, trend, trendValue }: KpiCardProps) {
  const TrendIcon = trend ? trendConfig[trend].icon : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {(description || trendValue) && (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            {TrendIcon && trendValue && (
              <>
                <TrendIcon className={cn("h-3 w-3", trendConfig[trend!].className)} />
                <span className={trendConfig[trend!].className}>{trendValue}</span>
              </>
            )}
            {description && <span>{description}</span>}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
