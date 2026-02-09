import Link, { type LinkProps } from "next/link";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

export function ShortcutLink(
  props: LinkProps & {
    className?: string;
    children: React.ReactNode;
    title?: string;
  }
) {
  const { className, children, title, ...linkProps } = props;

  // Default: look like normal text. On hover/focus: become obviously clickable (color + underline + arrow).
  return (
    <Link
      {...linkProps}
      title={title}
      className={cn(
        "group inline-flex items-center gap-1 rounded-sm px-1 -mx-1 text-foreground hover:text-primary hover:underline underline-offset-4 focus-ring",
        className
      )}
    >
      {children}
      <ArrowRight className="h-3 w-3 opacity-0 -translate-x-0.5 transition-all group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0" />
    </Link>
  );
}

