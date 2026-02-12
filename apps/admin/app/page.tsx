import Link from "next/link";
import { ArrowRight, Terminal, Shield, Zap, BarChart3 } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border-subtle">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
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

      {/* Hero Section */}
      <section className="flex-1 px-4 py-12 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-8">
            {/* Left Column */}
            <div className="flex flex-col justify-center space-y-6">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary"></span>
                </span>
                <span className="text-xs font-medium text-primary">v2.0 Terminal Edition</span>
              </div>

              <h1 className="text-4xl font-semibold leading-tight text-foreground sm:text-5xl">
                Command your
                <span className="text-gradient"> operations</span>
              </h1>

              <p className="max-w-lg text-lg text-fg-muted">
                A terminal-inspired ERP interface for warehouse management, sales tracking,
                and accounting workflows. Built for speed, precision, and scale.
              </p>

              <div className="flex flex-wrap gap-3 pt-2">
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

              <div className="flex items-center gap-4 pt-4 text-xs text-fg-subtle">
                <span className="flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5" />
                  Secure login
                </span>
                <span className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5" />
                  Real-time sync
                </span>
                <span className="flex items-center gap-1.5">
                  <BarChart3 className="h-3.5 w-3.5" />
                  Live analytics
                </span>
              </div>
            </div>

            {/* Right Column - Feature Grid */}
            <div className="grid gap-4 sm:grid-cols-2">
              <FeatureCard
                title="Sales & Invoicing"
                description="Create invoices, track payments, and manage returns with precision."
                icon={BarChart3}
              />
              <FeatureCard
                title="Inventory Control"
                description="Real-time stock levels, movements, and automated alerts."
                icon={Terminal}
              />
              <FeatureCard
                title="Purchasing"
                description="Purchase orders, goods receipts, and supplier management."
                icon={Zap}
              />
              <FeatureCard
                title="Accounting"
                description="Journals, chart of accounts, and financial reporting."
                icon={Shield}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Terminal Bar */}
      <div className="border-t border-border-subtle bg-bg-elevated/60 px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-fg-subtle">
            <Terminal className="h-4 w-4" />
            <span className="font-mono">system.ready</span>
            <span className="text-border-strong">|</span>
            <span className="text-success">● online</span>
          </div>
          <div className="text-xs text-fg-subtle">
            Press <kbd className="rounded bg-bg-sunken px-1.5 py-0.5 font-mono text-fg-muted">Cmd</kbd> + <kbd className="rounded bg-bg-sunken px-1.5 py-0.5 font-mono text-fg-muted">K</kbd> for quick navigation
          </div>
        </div>
      </div>
    </main>
  );
}

function FeatureCard({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-elevated/70 p-4 transition-all duration-200 hover:border-border-strong hover:bg-bg-sunken/60">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-bg-sunken text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mb-1 text-sm font-medium text-foreground">{title}</h3>
      <p className="text-xs leading-relaxed text-fg-subtle">{description}</p>
    </div>
  );
}
