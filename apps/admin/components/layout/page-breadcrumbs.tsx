"use client";

import React from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";

import { moduleForPath, type NavModule } from "@/lib/nav-modules";
import { titleForPath } from "@/lib/nav";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export function PageBreadcrumbs() {
  const pathname = usePathname() || "/";
  const module = moduleForPath(pathname);

  if (!module) return null;

  // Build breadcrumb chain: Module > [Section] > Page
  const crumbs = buildCrumbs(pathname, module);

  if (crumbs.length <= 1) return null;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <AnimatePresence initial={false} mode="popLayout">
          {crumbs.map((crumb, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <motion.span
                key={`${i}-${crumb.href}`}
                className="contents"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.15 }}
              >
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {!isLast ? (
                    <BreadcrumbLink asChild>
                      <Link href={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </motion.span>
            );
          })}
        </AnimatePresence>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

type Crumb = { label: string; href: string };

function buildCrumbs(pathname: string, module: NavModule): Crumb[] {
  const crumbs: Crumb[] = [];

  // Module root
  const moduleFirstHref = module.sections[0]?.items[0]?.href || "/dashboard";
  crumbs.push({ label: module.label, href: moduleFirstHref });

  // Find matching nav item
  for (const section of module.sections) {
    for (const item of section.items) {
      if (pathname === item.href || pathname.startsWith(item.href + "/")) {
        // Add section label if it exists and is different from module
        if (section.label) {
          crumbs.push({ label: section.label, href: item.href });
        }

        // If we're on a sub-page (e.g., /catalog/items/123), add the list page
        if (pathname !== item.href) {
          crumbs.push({ label: item.label, href: item.href });

          // Try to get a title for the current page
          const pageTitle = titleForPath(pathname);
          if (pageTitle && pageTitle !== item.label) {
            crumbs.push({ label: pageTitle, href: pathname });
          } else {
            // Use the last segment as a fallback
            const segments = pathname.split("/").filter(Boolean);
            const last = segments[segments.length - 1];
            if (last && last !== "list" && last !== "new") {
              const label = last === "edit" ? "Edit" : last === "new" ? "New" : last;
              crumbs.push({ label, href: pathname });
            }
          }
        } else {
          crumbs.push({ label: item.label, href: item.href });
        }
        return crumbs;
      }
    }
  }

  // Fallback: use titleForPath
  const title = titleForPath(pathname);
  if (title) {
    crumbs.push({ label: title, href: pathname });
  }

  return crumbs;
}
