"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { TopNav } from "./top-nav";
import { AppSidebar } from "./app-sidebar";
import { PageBreadcrumbs } from "./page-breadcrumbs";
import { CommandPalette, useCommandPalette } from "./command-palette";
import { addRecent } from "@/lib/nav-memory";
import { itemForPath } from "@/lib/nav-modules";

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
}

export function AppShell({ children }: AppShellProps) {
  const { open: commandOpen, setOpen: setCommandOpen } = useCommandPalette();
  const pathname = usePathname();

  // Track recent pages
  useEffect(() => {
    if (!pathname) return;
    const item = itemForPath(pathname);
    if (item) {
      addRecent({ href: item.href, label: item.label });
    }
  }, [pathname]);

  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider>
        <div className="flex min-h-screen w-full flex-col">
          {/* Top navigation bar */}
          <TopNav onCommandOpen={() => setCommandOpen(true)} />

          <div className="flex flex-1">
            {/* Contextual sidebar */}
            <AppSidebar />

            {/* Main content area */}
            <SidebarInset>
              <div className="flex flex-1 flex-col">
                {/* Breadcrumbs */}
                <div className="border-b bg-background px-6 py-2">
                  <PageBreadcrumbs />
                </div>

                {/* Page content */}
                <main className="flex-1 bg-muted/30 p-6">
                  <div className="mx-auto max-w-screen-2xl">
                    {children}
                  </div>
                </main>
              </div>
            </SidebarInset>
          </div>
        </div>

        {/* Command palette (global) */}
        <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      </SidebarProvider>
    </TooltipProvider>
  );
}
