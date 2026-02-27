"use client";

import { useMemo } from "react";
import { Sparkles } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Time-of-day greetings                                              */
/* ------------------------------------------------------------------ */

function getGreeting(): { greeting: string; brief: string } {
  const h = new Date().getHours();
  if (h < 12) return { greeting: "Good morning", brief: "Here's your operational brief." };
  if (h < 17) return { greeting: "Good afternoon", brief: "Here's where things stand." };
  return { greeting: "Good evening", brief: "Here's your end-of-day wrap-up." };
}

/* ------------------------------------------------------------------ */
/*  GreetingHero                                                       */
/* ------------------------------------------------------------------ */

interface GreetingHeroProps {
  version?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function GreetingHero({ version }: GreetingHeroProps) {
  const { greeting, brief } = useMemo(() => getGreeting(), []);

  return (
    <div className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-primary/5 via-background to-accent/10 px-6 py-5">
      {/* Decorative sparkle */}
      <div className="absolute -top-4 -right-4 opacity-[0.04]">
        <Sparkles className="h-32 w-32 text-primary" />
      </div>

      <div className="relative space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting}.
        </h1>
        <p className="text-sm text-muted-foreground">
          {brief}
          {version && (
            <span className="ml-2 inline-flex items-center rounded-full border bg-muted/50 px-2 py-0.5 text-[10px] font-mono text-muted-foreground/60">
              v{version}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
