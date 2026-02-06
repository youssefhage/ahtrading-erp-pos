import Link from "next/link";

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
          <Link
            href="/login"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"
          >
            Login
          </Link>
          <Link
            href="/dashboard"
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}

