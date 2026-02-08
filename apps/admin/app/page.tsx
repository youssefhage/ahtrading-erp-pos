import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="min-h-screen p-10">
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600">AH Trading</p>
          <h1 className="text-4xl font-semibold text-slate-950">
            Admin ERP
            <span className="text-teal-700">.</span>
          </h1>
          <p className="max-w-xl text-sm text-slate-700">
            A unified back-office for POS operations, purchasing, inventory, and accounting.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard">Open dashboard</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
