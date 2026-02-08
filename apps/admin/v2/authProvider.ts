import type { AuthProvider } from "react-admin";

import { HttpError, httpJson } from "@/v2/http";

type LoginParams = { email: string; password: string };

export const authProvider: AuthProvider = {
  async login(params) {
    const { email, password } = params as unknown as LoginParams;
    if (!email || !password) throw new Error("Email and password are required");
    await httpJson("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  async logout() {
    try {
      await httpJson("/auth/logout", { method: "POST", body: JSON.stringify({}) });
    } catch {
      // ignore
    }
  },

  async checkAuth() {
    await httpJson("/auth/me");
  },

  async checkError(error) {
    // react-admin passes various error shapes; we unify on our HttpError.
    const status = (error && typeof error === "object" && "status" in error ? (error as any).status : undefined) as
      | number
      | undefined;
    if (status === 401) throw new Error("Unauthorized");
  },

  async getIdentity() {
    const me = await httpJson<{ user_id: string; email: string; active_company_id?: string | null }>("/auth/me");
    return {
      id: me.user_id,
      fullName: me.email,
    };
  },

  async getPermissions() {
    try {
      const res = await httpJson<{ permissions: string[] }>("/auth/permissions");
      return res.permissions || [];
    } catch (err) {
      // If we don't have company context yet, backend may 400; treat as "no permissions" and let UI guide.
      if (err instanceof HttpError && (err.status === 400 || err.status === 401)) return [];
      throw err;
    }
  },
};

