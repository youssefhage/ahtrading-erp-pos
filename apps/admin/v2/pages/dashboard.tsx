"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, Typography } from "@mui/material";
import { Box } from "@mui/material";
import { Link } from "react-admin";

export function Dashboard() {
  return (
    <Box sx={{ p: 2, display: "grid", gap: 2, maxWidth: 1200 }}>
      <Typography variant="h4" sx={{ fontWeight: 800 }}>
        Dashboard
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Admin V2 is in progress. Start with Sales Invoices.
      </Typography>

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" } }}>
        <Card>
          <CardHeader title="Sales Invoices" />
          <CardContent>
            <Link to="/sales-invoices">Open list</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Items" />
          <CardContent>
            <Link to="/items">Open list</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Customers" />
          <CardContent>
            <Link to="/customers">Open list</Link>
          </CardContent>
        </Card>
      </Box>

      <Card>
        <CardHeader title="Ops Portal" />
        <CardContent>
          <Link to="/ops">Open operational snapshot</Link>
        </CardContent>
      </Card>
    </Box>
  );
}

