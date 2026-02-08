import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="min-h-screen p-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
            AH Trading
          </p>
          <h1 className="text-3xl font-semibold">Admin ERP</h1>
          <p className="text-slate-600">
            Next.js + shadcn/ui. Offline-first POS backend is served separately.
          </p>
        </div>
        <div className="flex gap-3">
          <Button asChild>
            <Link href="/login">Login</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard">Dashboard</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
