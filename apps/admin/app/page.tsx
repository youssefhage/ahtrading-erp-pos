import Link from "next/link";
import {
  ArrowRight,
  Shield,
  Zap,
  BarChart3,
  Package,
  FileText,
  Sparkles,
  Globe,
  Wifi,
  Banknote,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <span className="text-sm font-bold text-primary-foreground">C</span>
            </div>
            <span className="text-sm font-semibold">Codex</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              Modern ERP System
            </span>
            <Button asChild size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="px-4 pt-16 pb-10 sm:px-6 sm:pt-24 sm:pb-14">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Your business,{" "}
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              simplified
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Manage sales, inventory, purchasing, and accounting from a single
            unified interface. Built for speed and clarity.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="gap-2">
              <Link href="/login">
                Get started
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link href="/dashboard">Go to Dashboard</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Trust bar */}
      <section className="border-y bg-muted/40 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs font-medium text-muted-foreground">
          <span className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-primary" />
            Multi-branch
          </span>
          <span className="hidden h-3 w-px bg-border sm:block" />
          <span className="flex items-center gap-2">
            <Wifi className="h-3.5 w-3.5 text-green-600" />
            Real-time sync
          </span>
          <span className="hidden h-3 w-px bg-border sm:block" />
          <span className="flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-primary" />
            Offline POS
          </span>
          <span className="hidden h-3 w-px bg-border sm:block" />
          <span className="flex items-center gap-2">
            <Banknote className="h-3.5 w-3.5 text-primary" />
            Dual currency (USD / LBP)
          </span>
        </div>
      </section>

      {/* Feature grid */}
      <section className="flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center">
            <h2 className="text-xl font-semibold sm:text-2xl">
              Everything you need to run operations
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Six integrated modules. One unified system.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              title="Sales & Invoicing"
              description="Create invoices, track payments, manage returns and credit notes. Full AR aging and receipt management."
              icon={BarChart3}
              featured
            />
            <FeatureCard
              title="Inventory Control"
              description="Real-time stock across branches, movements, transfers, batch tracking, and automated reorder alerts."
              icon={Package}
              featured
            />
            <FeatureCard
              title="Purchasing"
              description="Purchase orders, goods receipts, supplier invoices, and AP payment tracking."
              icon={Zap}
            />
            <FeatureCard
              title="Accounting"
              description="Journals, chart of accounts, banking reconciliation, and financial reporting."
              icon={FileText}
            />
            <FeatureCard
              title="Reports"
              description="VAT reports, trial balance, P&L, AR/AP aging, and custom analytics dashboards."
              icon={BarChart3}
            />
            <FeatureCard
              title="AI & Automation"
              description="AI Hub for smart suggestions, automated AP import, and copilot-assisted workflows."
              icon={Sparkles}
            />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-muted/30 px-4 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-primary">
              <span className="text-[10px] font-bold text-primary-foreground">C</span>
            </div>
            <span>Codex ERP</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono text-[11px]">
              ⌘K
            </kbd>
            <span className="hidden sm:inline">Quick navigation</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({
  title,
  description,
  icon: Icon,
  featured = false,
}: {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  featured?: boolean;
}) {
  return (
    <Card
      className={`group transition-all duration-200 ${
        featured
          ? "border-primary/20 bg-primary/[0.02] hover:border-primary/40 hover:shadow-md"
          : "hover:border-primary/20 hover:shadow-md"
      }`}
    >
      <CardContent className="p-5">
        <div
          className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
            featured
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground group-hover:text-primary"
          }`}
        >
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}
