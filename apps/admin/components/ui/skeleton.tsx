import * as React from "react";

import { cn } from "@/lib/utils";

export function Skeleton(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn("animate-pulse rounded-md bg-slate-900/10", props.className)}
    />
  );
}

