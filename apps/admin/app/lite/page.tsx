"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function LiteEntryPage() {
  const router = useRouter();

  useEffect(() => {
    try {
      localStorage.setItem("admin.uiVariant", "lite");
    } catch {
      // ignore
    }
    router.replace("/dashboard");
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-border-subtle bg-bg-elevated/70 p-6">
        <h1 className="text-lg font-semibold text-foreground">Enabling Lite mode...</h1>
        <p className="mt-2 text-sm text-fg-muted">
          If you are not redirected, use the button below.
        </p>
        <div className="mt-4 flex gap-3">
          <Button asChild>
            <Link href="/dashboard">Continue</Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              try {
                localStorage.setItem("admin.uiVariant", "full");
              } catch {
                // ignore
              }
              router.replace("/dashboard");
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    </main>
  );
}
