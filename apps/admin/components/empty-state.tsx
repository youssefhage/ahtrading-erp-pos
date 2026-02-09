"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function EmptyState(props: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        {props.description ? <CardDescription>{props.description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <div className="text-sm text-fg-muted">{props.description || "No data to show."}</div>
        {props.actionLabel && props.onAction ? (
          <Button type="button" onClick={props.onAction}>
            {props.actionLabel}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

