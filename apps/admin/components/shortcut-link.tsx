import Link, { type LinkProps } from "next/link";

import { cn } from "@/lib/utils";

export function ShortcutLink(
  props: LinkProps & {
    className?: string;
    children: React.ReactNode;
    title?: string;
    stopPropagation?: boolean;
  }
) {
  const { className, children, title, stopPropagation = true, onClick, ...linkProps } = props as any;

  // Default: looks like normal text. On hover/focus: becomes obviously clickable.
  // We also stop event bubbling by default so it works inside "clickable rows" tables.
  return (
    <Link
      {...linkProps}
      title={title}
      className={cn("ui-shortcut", className)}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        onClick?.(e);
      }}
    >
      {children}
    </Link>
  );
}
