"use client";

import * as React from "react";
import { useState } from "react";
import { useLogin, useNotify } from "react-admin";
import {
  Box,
  Button,
  Card,
  CardContent,
  TextField,
  Typography,
} from "@mui/material";

export function LoginPage() {
  const login = useLogin();
  const notify = useNotify();
  const [email, setEmail] = useState("admin@ahtrading.local");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await login({ email, password });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      notify(msg, { type: "warning" });
      setLoading(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        bgcolor: "background.default",
        p: 2,
      }}
    >
      <Card sx={{ width: "100%", maxWidth: 420 }}>
        <CardContent>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            AH Trading Admin
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Sign in to continue
          </Typography>

          <Box component="form" onSubmit={onSubmit} sx={{ mt: 2, display: "grid", gap: 2 }}>
            <TextField
              label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              fullWidth
              size="small"
            />
            <TextField
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              fullWidth
              size="small"
            />
            <Button type="submit" variant="contained" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

