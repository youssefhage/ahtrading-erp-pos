"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

export type TabBarTab = {
  label: string;
  href: string;
  // When provided, used to determine active state (prefix match against pathname).
  activePathPrefix?: string;
  // When provided, active state is based on `?key=value`.
  activeQuery?: { key: string; value: string };
};

export function TabBar(props: { tabs: TabBarTab[]; className?: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const cur = pathname || "";

  function isActive(t: TabBarTab) {
    if (t.activeQuery) {
      return String(sp.get(t.activeQuery.key) || "") === String(t.activeQuery.value);
    }
    const prefix = t.activePathPrefix || t.href;
    return cur === prefix || (prefix ? cur.startsWith(prefix + "/") : false);
  }

  return (
    <div className={cn("ui-tabbar-wrap", props.className)}>
      <div className="ui-tabbar" role="tablist" aria-label="Section tabs">
        {props.tabs.map((t) => {
          const active = isActive(t);
          return (
            <Link
              key={t.href}
              href={t.href}
              role="tab"
              aria-selected={active}
              className={cn("ui-tabbar-tab", active && "ui-tabbar-tab-active")}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
