"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function Page(props: { children: React.ReactNode; className?: string; width?: "md" | "lg" | "xl" }) {
  const max =
    props.width === "md" ? "max-w-4xl" : props.width === "xl" ? "max-w-7xl" : "max-w-6xl";
  return <div className={cn("mx-auto space-y-6", max, props.className)}>{props.children}</div>;
}

export function PageHeader(props: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", props.className)}>
      <div className="min-w-[240px]">
        <h1 className="text-xl font-semibold text-foreground">{props.title}</h1>
        {props.description ? <p className="mt-1 text-sm text-fg-muted">{props.description}</p> : null}
        {props.meta ? <div className="mt-2">{props.meta}</div> : null}
      </div>
      {props.actions ? <div className="flex items-center gap-2">{props.actions}</div> : null}
    </div>
  );
}

export function Toolbar(props: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-end justify-between gap-2", props.className)}>{props.children}</div>;
}

export function Section(props: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={props.className}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>{props.title}</CardTitle>
            {props.description ? <CardDescription>{props.description}</CardDescription> : null}
          </div>
          {props.actions ? <div className="flex items-center gap-2">{props.actions}</div> : null}
        </div>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}

