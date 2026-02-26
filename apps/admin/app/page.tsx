import Link from "next/link";
import {
  ArrowRight,
  Terminal,
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

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border-subtle">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary-dim">
              <span className="text-sm font-bold text-primary-foreground">AD</span>
            </div>
            <span className="text-sm font-semibold text-foreground">AH Trading</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-fg-subtle sm:inline">Industrial ERP System</span>
            <Button asChild size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="px-4 pt-16 pb-10 sm:px-6 sm:pt-24 sm:pb-14">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Your business,{" "}
            <span className="text-gradient">one command away</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-fg-muted sm:text-lg">
            Manage sales, inventory, purchasing, and accounting from a single
            terminal-inspired interface. Built for speed and precision.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="gap-2">
              <Link href="/login">
                Access System
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
      <section className="border-y border-border-subtle bg-bg-elevated/40 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs font-medium text-fg-subtle">
          <span className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-primary" />
            Multi-branch
          </span>
          <span className="hidden h-3 w-px bg-border-subtle sm:block" />
          <span className="flex items-center gap-2">
            <Wifi className="h-3.5 w-3.5 text-success" />
            Real-time sync
          </span>
          <span className="hidden h-3 w-px bg-border-subtle sm:block" />
          <span className="flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-primary" />
            Offline POS
          </span>
          <span className="hidden h-3 w-px bg-border-subtle sm:block" />
          <span className="flex items-center gap-2">
            <Banknote className="h-3.5 w-3.5 text-primary" />
            Dual currency (USD / LBP)
          </span>
        </div>
      </section>

      {/* Bento feature grid */}
      <section className="flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 text-center">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">
              Everything you need to run operations
            </h2>
            <p className="mt-1 text-sm text-fg-subtle">
              Six integrated modules. One unified system.
            </p>
          </div>

          <div className="grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* Sales - featured */}
            <BentoCard
              title="Sales & Invoicing"
              description="Create invoices, track payments, manage returns and credit notes. Full AR aging and receipt management."
              icon={BarChart3}
              featured
            />
            {/* Inventory - featured */}
            <BentoCard
              title="Inventory Control"
              description="Real-time stock across branches, movements, transfers, batch tracking, and automated reorder alerts."
              icon={Package}
              featured
            />
            {/* Purchasing */}
            <BentoCard
              title="Purchasing"
              description="Purchase orders, goods receipts, supplier invoices, and AP payment tracking."
              icon={Zap}
            />
            {/* Accounting */}
            <BentoCard
              title="Accounting"
              description="Journals, chart of accounts, banking reconciliation, and financial reporting."
              icon={FileText}
            />
            {/* Reports */}
            <BentoCard
              title="Reports"
              description="VAT reports, trial balance, P&L, AR/AP aging, and custom analytics dashboards."
              icon={BarChart3}
            />
            {/* Automation */}
            <BentoCard
              title="AI & Automation"
              description="AI Hub for smart suggestions, automated AP import, and copilot-assisted workflows."
              icon={Sparkles}
            />
          </div>
        </div>
      </section>

      {/* Terminal Bar */}
      <div className="border-t border-border-subtle bg-bg-elevated/60 px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-fg-subtle">
            <Terminal className="h-3.5 w-3.5" />
            <span className="font-mono text-[11px]">system.ready</span>
            <span className="text-border-strong">|</span>
            <span className="text-success">● online</span>
          </div>
          <div className="hidden text-xs text-fg-subtle sm:block">
            Press{" "}
            <kbd className="rounded bg-bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
              Cmd
            </kbd>{" "}
            +{" "}
            <kbd className="rounded bg-bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
              K
            </kbd>{" "}
            for quick navigation
          </div>
        </div>
      </div>
    </main>
  );
}

function BentoCard({
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
    <div
      className={`group relative overflow-hidden rounded-xl border p-5 transition-all duration-200
        ${
          featured
            ? "border-primary/20 bg-primary/[0.03] hover:border-primary/35 hover:bg-primary/[0.06]"
            : "border-border-subtle bg-bg-elevated/60 hover:border-border-strong hover:bg-bg-elevated"
        }`}
    >
      <div
        className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${
          featured
            ? "bg-primary/10 text-primary"
            : "bg-bg-sunken text-fg-muted group-hover:text-primary"
        } transition-colors`}
      >
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 text-xs leading-relaxed text-fg-subtle">{description}</p>
    </div>
  );
}
