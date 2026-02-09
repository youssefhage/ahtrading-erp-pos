"use client";

import Link from "next/link";

import { ApiError } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function isAiGatingError(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 401 || err.status === 403;
  if (typeof err === "string") return /^HTTP\s+(401|403)\b/.test(err.trim());
  if (err instanceof Error) return /^HTTP\s+(401|403)\b/.test(String(err.message || "").trim());
  return false;
}

export function AiSetupGate(props: { error: unknown }) {
  if (!isAiGatingError(props.error)) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Not Available</CardTitle>
        <CardDescription>This usually means permissions are missing, or AI features are disabled for your role.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-fg-muted">
        <p>
          Next steps:
        </p>
        <ul className="list-disc pl-5">
          <li>
            Check permissions in <Link className="ui-link" href="/system/roles-permissions">Roles & Permissions</Link>.
          </li>
          <li>
            Review company setup in <Link className="ui-link" href="/system/config">System Config</Link>.
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

