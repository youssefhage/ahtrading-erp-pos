"use client";

import nextDynamic from "next/dynamic";

const AdminV2App = nextDynamic(() => import("@/v2/admin-v2-app").then((m) => m.AdminV2App), {
  ssr: false,
  loading: () => <div style={{ padding: 16 }}>Loading Admin V2...</div>,
});

export default function AdminV2Page() {
  return <AdminV2App />;
}
