"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Alert, Box, Card, CardContent, CardHeader, Chip, Link as MuiLink, Typography } from "@mui/material";
import { useNotify } from "react-admin";

import { HttpError, httpJson } from "@/v2/http";

type Overview = {
  generated_at: string;
  ai: {
    actions_by_status: Record<string, number>;
    recommendations_by_status: Record<string, number>;
    pending_recommendations_by_agent: Record<string, number>;
  };
  pos: {
    outbox_by_status: Record<string, number>;
    outbox_failed: number;
  };
  inventory: {
    negative_on_hand_rows: number;
    approx_value_usd: string;
    approx_value_lbp: string;
  };
  accounting: {
    period_locks: Array<{ id: string; start_date: string; end_date: string; reason: string | null; locked: boolean }>;
  };
};

function MetricTile(props: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          {props.label}
        </Typography>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          {props.value}
        </Typography>
        {props.hint ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {props.hint}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function OpsPortal() {
  const notify = useNotify();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await httpJson<Overview>("/ai/copilot/overview");
        if (!cancelled) setData(res);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof HttpError && err.status === 403) {
          setError("You don’t have access to Ops Portal (missing permission: ai:read).");
        } else {
          setError(err instanceof Error ? err.message : "Failed to load ops snapshot");
        }
        notify("Ops snapshot failed to load", { type: "warning" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notify]);

  const outboxFailed = data?.pos.outbox_failed ?? 0;
  const negRows = data?.inventory.negative_on_hand_rows ?? 0;
  const locks = data?.accounting.period_locks?.length ?? 0;
  const recPending = data?.ai.recommendations_by_status?.pending ?? 0;

  return (
    <Box sx={{ p: 2, display: "grid", gap: 2, maxWidth: 1200 }}>
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 900 }}>
            Ops Portal
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Read-only operational snapshot with next steps (ERP-style).
          </Typography>
        </Box>
        {data?.generated_at ? (
          <Chip label={`Generated: ${data.generated_at}`} size="small" />
        ) : null}
      </Box>

      {error ? <Alert severity="warning">{error}</Alert> : null}

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(4, 1fr)" } }}>
        <MetricTile
          label="POS Outbox Failures"
          value={loading ? "…" : String(outboxFailed)}
          hint="If > 0: review outbox and requeue failed events."
        />
        <MetricTile
          label="Negative Stock Rows"
          value={loading ? "…" : String(negRows)}
          hint="If > 0: investigate movements and costs."
        />
        <MetricTile label="Period Locks" value={loading ? "…" : String(locks)} hint="Locked periods prevent posting." />
        <MetricTile label="AI Recommendations Pending" value={loading ? "…" : String(recPending)} hint="Review queue." />
      </Box>

      <Card>
        <CardHeader title="What to do next" />
        <CardContent sx={{ display: "grid", gap: 1 }}>
          <Typography variant="body2">
            1. If outbox failures are non-zero, open{" "}
            <MuiLink href="/system/outbox" underline="hover">
              Outbox (legacy)
            </MuiLink>{" "}
            and requeue.
          </Typography>
          <Typography variant="body2">
            2. If negative stock exists, review{" "}
            <MuiLink href="/inventory/stock" underline="hover">
              Stock (legacy)
            </MuiLink>{" "}
            and movements.
          </Typography>
          <Typography variant="body2">
            3. If posting fails due to locks, review Accounting Period Locks.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
